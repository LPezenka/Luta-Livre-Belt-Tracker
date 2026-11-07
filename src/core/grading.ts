import { beltIndex, findBelt, nextBelt, startingBeltId } from './config';
import {
  compareMonthYear,
  isValidMonthYear,
  monthIndex,
  normalizeMonthYear,
  parseMonthYear,
} from './dates';
import { beltStartDate } from './eligibility';
import { collapseWhitespace, nextId } from './ids';
import type { AppState, Grading, MutationResult, Student } from './models';
import { cloneState, findStudent } from './state';

function sortEvents(gradings: Grading[]): Grading[] {
  return [...gradings].sort((a, b) => {
    const aParts = parseMonthYear(a.date);
    const bParts = parseMonthYear(b.date);
    if (!aParts && !bParts) {
      if (a.type !== b.type) return a.type === 'belt' ? -1 : 1;
      return a.id.localeCompare(b.id);
    }
    if (!aParts) return 1; // invalid dates sort last for display
    if (!bParts) return -1;
    const dateDiff = monthIndex(aParts) - monthIndex(bParts);
    if (dateDiff !== 0) return dateDiff;
    if (a.type !== b.type) return a.type === 'belt' ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

function eventsForStudent(state: AppState, studentId: string): Grading[] {
  return sortEvents(state.gradings.filter((grading) => grading.studentId === studentId));
}

function validEventsForStudent(state: AppState, studentId: string): Grading[] {
  return eventsForStudent(state, studentId).filter((grading) =>
    isValidMonthYear(grading.date),
  );
}

/**
 * Recompute a student's cached current belt and stripe count from grading
 * history.
 *
 * Special case: a legacy student may have a current belt with no belt-award
 * event (the spreadsheet omitted it). If there is no belt event at all we keep
 * the cached belt. If the cached belt is ahead of the latest belt event and has
 * its own grading events, we also keep it (the missing belt event is a data gap,
 * not a reason to demote the student).
 */
export function recomputeStudent(state: AppState, studentId: string): Student | null {
  const student = findStudent(state, studentId);
  if (!student) return null;

  const events = validEventsForStudent(state, studentId);
  const beltEvents = events.filter((grading) => grading.type === 'belt');
  const latestBeltEvent = beltEvents.length > 0 ? beltEvents[beltEvents.length - 1] : null;

  let belt = student.currentBelt;
  if (beltEvents.length > 0 && latestBeltEvent) {
    const cachedIndex = beltIndex(state.config, student.currentBelt);
    const latestIndex = beltIndex(state.config, latestBeltEvent.belt);
    const cachedHasOwnEvents = events.some(
      (grading) => grading.belt === student.currentBelt,
    );
    if (cachedIndex > latestIndex && cachedHasOwnEvents) {
      belt = student.currentBelt;
    } else {
      belt = latestBeltEvent.belt;
    }
  }

  const beltEventsForChosen = beltEvents
    .filter((grading) => grading.belt === belt)
    .sort((a, b) => compareMonthYear(a.date, b.date));
  const resetEvent =
    beltEventsForChosen.length > 0
      ? beltEventsForChosen[beltEventsForChosen.length - 1]
      : null;

  const stripeEvents = events.filter(
    (grading) =>
      grading.type === 'stripe' &&
      grading.belt === belt &&
      (!resetEvent || compareMonthYear(grading.date, resetEvent.date) >= 0),
  );
  const stripes = stripeEvents.reduce(
    (total, grading) => total + grading.stripesAwarded,
    0,
  );

  const updated: Student = {
    ...student,
    currentBelt: belt,
    currentStripes: Math.max(0, stripes),
  };
  const index = state.students.findIndex((entry) => entry.id === studentId);
  if (index >= 0) state.students[index] = updated;
  return updated;
}

export function recomputeAllStudents(state: AppState): AppState {
  const next = cloneState(state);
  for (const student of next.students) {
    recomputeStudent(next, student.id);
  }
  return next;
}

function validateDate(raw: string): string | null {
  const normalized = normalizeMonthYear(raw);
  if (!normalized) return null;
  return normalized;
}

function checkDateNotBeforeBeltStart(
  state: AppState,
  student: Student,
  date: string,
): string | null {
  const start = beltStartDate(state, student);
  if (start.date && compareMonthYear(date, start.date) < 0) {
    return `The date ${date} is before the current ${findBelt(state.config, student.currentBelt)?.name ?? student.currentBelt} belt start (${start.date}${start.provisional ? ', provisional' : ''}). Choose a date on or after the belt start.`;
  }
  return null;
}

/** Award one or more additional stripes. Never blocks on time or checklist. */
export function awardStripes(
  state: AppState,
  studentId: string,
  additionalStripes: number,
  dateRaw: string,
): MutationResult {
  const next = cloneState(state);
  const student = findStudent(next, studentId);
  if (!student) return { ok: false, error: 'Student not found.' };

  const belt = findBelt(next.config, student.currentBelt);
  if (!belt) return { ok: false, error: 'Current belt configuration is missing.' };

  const date = validateDate(dateRaw);
  if (!date) return { ok: false, error: 'Enter a valid grading month/year (MM/YY).' };

  const count = Number(additionalStripes);
  if (!Number.isInteger(count) || count < 1) {
    return { ok: false, error: 'Enter at least one stripe to award.' };
  }

  const available = belt.maxStripes - student.currentStripes;
  if (available <= 0) {
    return {
      ok: false,
      error: `${student.name} already has the maximum of ${belt.maxStripes} stripes for ${belt.name} belt.`,
    };
  }
  if (count > available) {
    return {
      ok: false,
      error: `Only ${available} additional stripe${available === 1 ? '' : 's'} can be awarded (maximum ${belt.maxStripes}).`,
    };
  }

  const dateError = checkDateNotBeforeBeltStart(next, student, date);
  if (dateError) return { ok: false, error: dateError };

  next.gradings.push({
    id: nextId('g', next.gradings.map((grading) => grading.id)),
    studentId,
    date,
    type: 'stripe',
    belt: student.currentBelt,
    stripesAwarded: count,
  });
  const updated = recomputeStudent(next, studentId);

  return {
    ok: true,
    state: next,
    message: `Awarded ${count} stripe${count === 1 ? '' : 's'} to ${student.name}.`,
    warning:
      updated && updated.currentStripes !== student.currentStripes + count
        ? 'The cached stripe count did not change exactly as expected; review the grading history.'
        : undefined,
  };
}

/** Promote to the next configured belt. Never blocks on time or checklist. */
export function promoteStudent(
  state: AppState,
  studentId: string,
  dateRaw: string,
): MutationResult {
  const next = cloneState(state);
  const student = findStudent(next, studentId);
  if (!student) return { ok: false, error: 'Student not found.' };

  const target = nextBelt(next.config, student.currentBelt);
  if (!target) {
    return {
      ok: false,
      error: `${student.name} is already at the highest configured belt (${findBelt(next.config, student.currentBelt)?.name ?? student.currentBelt}).`,
    };
  }

  const date = validateDate(dateRaw);
  if (!date) return { ok: false, error: 'Enter a valid grading month/year (MM/YY).' };

  const dateError = checkDateNotBeforeBeltStart(next, student, date);
  if (dateError) return { ok: false, error: dateError };

  next.gradings.push({
    id: nextId('g', next.gradings.map((grading) => grading.id)),
    studentId,
    date,
    type: 'belt',
    belt: target.id,
    stripesAwarded: 0,
  });
  const updated = recomputeStudent(next, studentId);

  const warning =
    updated && updated.currentBelt !== target.id
      ? `The grading was recorded, but the latest history still points to ${findBelt(next.config, updated.currentBelt)?.name ?? updated.currentBelt} belt. Review later grading dates.`
      : undefined;

  return {
    ok: true,
    state: next,
    message: `Promoted ${student.name} to ${target.name} belt. Stripes reset to zero.`,
    warning,
  };
}

/**
 * Record (or correct) the belt-award date for the student's current belt.
 * Used when the legacy data only contains a provisional stripe-derived start.
 */
export function recordBeltAwardDate(
  state: AppState,
  studentId: string,
  dateRaw: string,
): MutationResult {
  const next = cloneState(state);
  const student = findStudent(next, studentId);
  if (!student) return { ok: false, error: 'Student not found.' };

  const date = validateDate(dateRaw);
  if (!date) return { ok: false, error: 'Enter a valid grading month/year (MM/YY).' };

  const before = student.currentStripes;
  const existing = next.gradings
    .filter(
      (grading) =>
        grading.studentId === studentId &&
        grading.type === 'belt' &&
        grading.belt === student.currentBelt,
    )
    .sort((a, b) => compareMonthYear(a.date, b.date));

  if (existing.length > 0) {
    existing[existing.length - 1].date = date;
  } else {
    next.gradings.push({
      id: nextId('g', next.gradings.map((grading) => grading.id)),
      studentId,
      date,
      type: 'belt',
      belt: student.currentBelt,
      stripesAwarded: 0,
    });
  }

  const updated = recomputeStudent(next, studentId);
  const after = updated?.currentStripes ?? before;
  const warning =
    after < before
      ? `${before - after} stripe${before - after === 1 ? '' : 's'} now fall before the belt-award date and are not counted toward the current belt. The historical events are preserved.`
      : undefined;

  return {
    ok: true,
    state: next,
    message: `Belt-award date for ${student.name} saved as ${date}.`,
    warning,
  };
}

export function updateGradingDate(
  state: AppState,
  gradingId: string,
  dateRaw: string,
): MutationResult {
  const next = cloneState(state);
  const grading = next.gradings.find((entry) => entry.id === gradingId);
  if (!grading) return { ok: false, error: 'Grading event not found.' };

  const date = validateDate(dateRaw);
  if (!date) return { ok: false, error: 'Enter a valid grading month/year (MM/YY).' };

  grading.date = date;
  recomputeStudent(next, grading.studentId);

  return {
    ok: true,
    state: next,
    message: `Grading ${grading.id} date updated to ${date}.`,
  };
}

export function deleteGrading(state: AppState, gradingId: string): MutationResult {
  const next = cloneState(state);
  const grading = next.gradings.find((entry) => entry.id === gradingId);
  if (!grading) return { ok: false, error: 'Grading event not found.' };

  next.gradings = next.gradings.filter((entry) => entry.id !== gradingId);

  const student = findStudent(next, grading.studentId);
  if (student) {
    const remainingBeltEvents = next.gradings.filter(
      (entry) => entry.studentId === student.id && entry.type === 'belt',
    );
    const ownStripeEvents = next.gradings.filter(
      (entry) =>
        entry.studentId === student.id &&
        entry.type === 'stripe' &&
        entry.belt === student.currentBelt,
    );
    if (remainingBeltEvents.length === 0 && ownStripeEvents.length === 0) {
      student.currentBelt = startingBeltId(next.config);
      student.currentStripes = 0;
    }
    recomputeStudent(next, student.id);
  }

  return {
    ok: true,
    state: next,
    message: `Deleted grading ${grading.id}.`,
  };
}

export function addStudent(state: AppState, nameRaw: string): MutationResult {
  const next = cloneState(state);
  const name = collapseWhitespace(nameRaw);
  if (!name) return { ok: false, error: 'Enter a student name.' };
  if (name.length > 120) return { ok: false, error: 'Student name is too long.' };

  const duplicate = next.students.find(
    (student) => student.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
  );

  next.students.push({
    id: nextId('s', next.students.map((student) => student.id)),
    name,
    currentBelt: startingBeltId(next.config),
    currentStripes: 0,
  });

  return {
    ok: true,
    state: next,
    message: `Added ${name}.`,
    warning: duplicate
      ? `Another student named ${duplicate.name} already exists. Names are not used as identifiers, so both records can coexist.`
      : undefined,
  };
}

export function renameStudent(
  state: AppState,
  studentId: string,
  nameRaw: string,
): MutationResult {
  const next = cloneState(state);
  const student = findStudent(next, studentId);
  if (!student) return { ok: false, error: 'Student not found.' };
  const name = collapseWhitespace(nameRaw);
  if (!name) return { ok: false, error: 'Enter a student name.' };
  student.name = name;
  return { ok: true, state: next, message: `Renamed student to ${name}.` };
}

export function studentGradingHistory(
  state: AppState,
  studentId: string,
): Grading[] {
  return sortEvents(state.gradings.filter((grading) => grading.studentId === studentId));
}
