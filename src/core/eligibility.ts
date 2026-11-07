import {
  addMonths,
  compareMonthYear,
  isValidMonthYear,
  monthsBetween,
  nowMonthYear,
} from './dates';
import { findBelt, nextBelt } from './config';
import type {
  AppState,
  EligibilityInfo,
  EligibilityStatus,
  Grading,
  MonthYear,
  Student,
} from './models';

export const ELIGIBILITY_LABELS: Record<EligibilityStatus, string> = {
  eligible: 'Eligible',
  upcoming: 'Upcoming',
  'not-eligible': 'Not yet eligible',
  unknown: 'Unknown',
  highest: 'Highest belt',
};

export const ELIGIBILITY_SYMBOLS: Record<EligibilityStatus, string> = {
  eligible: '✓',
  upcoming: '◔',
  'not-eligible': '○',
  unknown: '?',
  highest: '★',
};

function byDateThenId(a: Grading, b: Grading): number {
  const diff = compareMonthYear(a.date, b.date);
  return diff !== 0 ? diff : a.id.localeCompare(b.id);
}

/** Latest actual belt-award event for a given belt, if one exists. */
export function latestBeltAward(
  state: AppState,
  studentId: string,
  beltId: string,
): Grading | null {
  const events = state.gradings
    .filter(
      (grading) =>
        grading.studentId === studentId &&
        grading.type === 'belt' &&
        grading.belt === beltId &&
        isValidMonthYear(grading.date),
    )
    .sort(byDateThenId);
  return events.length > 0 ? events[events.length - 1] : null;
}

/** Earliest recorded stripe date for a given belt, used only as a provisional start. */
export function earliestStripeDate(
  state: AppState,
  studentId: string,
  beltId: string,
): MonthYear | null {
  const events = state.gradings
    .filter(
      (grading) =>
        grading.studentId === studentId &&
        grading.type === 'stripe' &&
        grading.belt === beltId &&
        isValidMonthYear(grading.date),
    )
    .sort(byDateThenId);
  return events.length > 0 ? events[0].date : null;
}

export interface BeltStart {
  date: MonthYear | null;
  provisional: boolean;
  source: 'belt-award' | 'earliest-stripe' | 'none';
}

export function beltStartDate(
  state: AppState,
  student: Student,
): BeltStart {
  const actual = latestBeltAward(state, student.id, student.currentBelt);
  if (actual) {
    return { date: actual.date, provisional: false, source: 'belt-award' };
  }
  const stripeDate = earliestStripeDate(state, student.id, student.currentBelt);
  if (stripeDate) {
    return { date: stripeDate, provisional: true, source: 'earliest-stripe' };
  }
  return { date: null, provisional: false, source: 'none' };
}

/**
 * Eligibility is informational only. Nothing in this function is used to block
 * a coach from awarding stripes or promoting a student.
 */
export function computeEligibility(
  state: AppState,
  student: Student,
  now: MonthYear = nowMonthYear(),
): EligibilityInfo {
  const currentBelt = findBelt(state.config, student.currentBelt);
  const next = currentBelt ? nextBelt(state.config, currentBelt.id) : null;
  const start = beltStartDate(state, student);
  const warnings: string[] = [];

  if (!currentBelt) {
    return {
      studentId: student.id,
      currentBelt: null,
      nextBelt: null,
      currentStripes: student.currentStripes,
      maxStripes: 0,
      beltSince: start.date,
      beltSinceProvisional: start.provisional,
      provisionalFromStripe: start.source === 'earliest-stripe',
      monthsAtBelt: null,
      minMonthsToNextBelt: null,
      earliestEligibility: null,
      monthsRemaining: null,
      status: 'unknown',
      futureBeltDate: false,
      warnings: [`Unknown belt id "${student.currentBelt}".`],
    };
  }

  if (student.currentStripes > currentBelt.maxStripes) {
    warnings.push(
      `Current stripe count (${student.currentStripes}) exceeds the configured maximum (${currentBelt.maxStripes}) for ${currentBelt.name} belt.`,
    );
  }

  if (!next) {
    return {
      studentId: student.id,
      currentBelt,
      nextBelt: null,
      currentStripes: student.currentStripes,
      maxStripes: currentBelt.maxStripes,
      beltSince: start.date,
      beltSinceProvisional: start.provisional,
      provisionalFromStripe: start.source === 'earliest-stripe',
      monthsAtBelt: start.date ? monthsBetween(start.date, now) : null,
      minMonthsToNextBelt: null,
      earliestEligibility: null,
      monthsRemaining: null,
      status: 'highest',
      futureBeltDate: start.date ? compareMonthYear(start.date, now) > 0 : false,
      warnings,
    };
  }

  if (!start.date) {
    warnings.push(
      `No belt-award date or stripe date is recorded for ${currentBelt.name} belt; time at belt and eligibility are unknown.`,
    );
    return {
      studentId: student.id,
      currentBelt,
      nextBelt: next,
      currentStripes: student.currentStripes,
      maxStripes: currentBelt.maxStripes,
      beltSince: null,
      beltSinceProvisional: false,
      provisionalFromStripe: false,
      monthsAtBelt: null,
      minMonthsToNextBelt: currentBelt.minMonthsToNextBelt,
      earliestEligibility: null,
      monthsRemaining: null,
      status: 'unknown',
      futureBeltDate: false,
      warnings,
    };
  }

  if (start.provisional) {
    warnings.push(
      `Belt-award date is missing; ${start.date} (earliest recorded stripe) is used as a provisional start. It may underestimate time at belt.`,
    );
  }

  const monthsAtBelt = monthsBetween(start.date, now);
  const futureBeltDate = monthsAtBelt < 0;
  if (futureBeltDate) {
    warnings.push(
      `Belt-award date ${start.date} is in the future; eligibility is shown for completeness but the date should be corrected.`,
    );
  }

  const minMonths = currentBelt.minMonthsToNextBelt;
  const earliest = addMonths(start.date, minMonths);
  const rawRemaining = monthsBetween(now, earliest);
  const monthsRemaining = Math.max(0, rawRemaining);

  let status: EligibilityStatus;
  if (rawRemaining <= 0) status = 'eligible';
  else if (rawRemaining <= state.config.upcomingEligibilityMonths) status = 'upcoming';
  else status = 'not-eligible';

  return {
    studentId: student.id,
    currentBelt,
    nextBelt: next,
    currentStripes: student.currentStripes,
    maxStripes: currentBelt.maxStripes,
    beltSince: start.date,
    beltSinceProvisional: start.provisional,
    provisionalFromStripe: start.source === 'earliest-stripe',
    monthsAtBelt,
    minMonthsToNextBelt: minMonths,
    earliestEligibility: earliest,
    monthsRemaining,
    status,
    futureBeltDate,
    warnings,
  };
}

export function computeAllEligibility(
  state: AppState,
  now: MonthYear = nowMonthYear(),
): EligibilityInfo[] {
  return state.students.map((student) => computeEligibility(state, student, now));
}

export interface EligibilitySummary {
  total: number;
  eligible: number;
  upcoming: number;
  notEligible: number;
  unknown: number;
  highest: number;
}

export function summarizeEligibility(infos: EligibilityInfo[]): EligibilitySummary {
  const summary: EligibilitySummary = {
    total: infos.length,
    eligible: 0,
    upcoming: 0,
    notEligible: 0,
    unknown: 0,
    highest: 0,
  };
  for (const info of infos) {
    switch (info.status) {
      case 'eligible':
        summary.eligible += 1;
        break;
      case 'upcoming':
        summary.upcoming += 1;
        break;
      case 'not-eligible':
        summary.notEligible += 1;
        break;
      case 'unknown':
        summary.unknown += 1;
        break;
      case 'highest':
        summary.highest += 1;
        break;
    }
  }
  return summary;
}

export function beltDistribution(state: AppState): Array<{ beltId: string; name: string; count: number }> {
  return state.config.belts.map((belt) => ({
    beltId: belt.id,
    name: belt.name,
    count: state.students.filter((student) => student.currentBelt === belt.id).length,
  }));
}
