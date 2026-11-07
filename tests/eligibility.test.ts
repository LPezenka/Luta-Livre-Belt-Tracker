import { describe, expect, it } from 'vitest';
import {
  beltDistribution,
  beltStartDate,
  computeEligibility,
  summarizeEligibility,
} from '../src/core/eligibility';
import type { AppState } from '../src/core/models';
import { defaultConfig } from '../src/core/config';
import { makeGrading, makeState, makeStudent } from './helpers';

function orangeState(beltDate: string, extra = {}): AppState {
  return makeState({
    students: [makeStudent({ currentBelt: 'orange', currentStripes: 2 })],
    gradings: [makeGrading({ date: beltDate, type: 'belt', belt: 'orange' })],
    ...extra,
  });
}

describe('eligibility calculation', () => {
  it('is eligible exactly at the configured minimum month', () => {
    const info = computeEligibility(orangeState('05/25'), orangeState('05/25').students[0], '11/26');
    expect(info.monthsAtBelt).toBe(18);
    expect(info.minMonthsToNextBelt).toBe(18);
    expect(info.earliestEligibility).toBe('11/26');
    expect(info.monthsRemaining).toBe(0);
    expect(info.status).toBe('eligible');
    expect(info.nextBelt?.id).toBe('blue');
  });

  it('is upcoming when eligibility begins within the configured window', () => {
    const state = orangeState('08/25');
    const info = computeEligibility(state, state.students[0], '11/26');
    expect(info.earliestEligibility).toBe('02/27');
    expect(info.monthsRemaining).toBe(3);
    expect(info.status).toBe('upcoming');
  });

  it('is not yet eligible when more than three months remain', () => {
    const state = orangeState('09/25');
    const info = computeEligibility(state, state.students[0], '11/26');
    expect(info.monthsRemaining).toBe(4);
    expect(info.status).toBe('not-eligible');
  });

  it('respects a configured upcoming window', () => {
    const state = orangeState('09/25');
    state.config.upcomingEligibilityMonths = 4;
    const info = computeEligibility(state, state.students[0], '11/26');
    expect(info.status).toBe('upcoming');
  });

  it('uses the earliest stripe date as a provisional start and marks it', () => {
    const state = makeState({
      students: [makeStudent({ currentBelt: 'yellow', currentStripes: 1 })],
      gradings: [
        makeGrading({ id: 'g001', date: '06/26', type: 'stripe', belt: 'yellow', stripesAwarded: 1 }),
      ],
    });
    const info = computeEligibility(state, state.students[0], '11/26');
    expect(info.beltSince).toBe('06/26');
    expect(info.beltSinceProvisional).toBe(true);
    expect(info.provisionalFromStripe).toBe(true);
    expect(info.monthsAtBelt).toBe(5);
    expect(info.warnings.some((warning) => warning.includes('provisional'))).toBe(true);
  });

  it('marks an actual belt-award date as not provisional', () => {
    const state = orangeState('05/25');
    const info = computeEligibility(state, state.students[0], '11/26');
    expect(info.beltSince).toBe('05/25');
    expect(info.beltSinceProvisional).toBe(false);
    expect(beltStartDate(state, state.students[0]).source).toBe('belt-award');
  });

  it('reports unknown when no belt or stripe dates exist', () => {
    const state = makeState({
      students: [makeStudent({ currentBelt: 'orange' })],
    });
    const info = computeEligibility(state, state.students[0], '11/26');
    expect(info.beltSince).toBeNull();
    expect(info.monthsAtBelt).toBeNull();
    expect(info.earliestEligibility).toBeNull();
    expect(info.status).toBe('unknown');
    expect(info.warnings.length).toBeGreaterThan(0);
  });

  it('handles future grading dates without inventing eligibility', () => {
    const state = orangeState('07/27');
    const info = computeEligibility(state, state.students[0], '11/26');
    expect(info.monthsAtBelt).toBe(-8);
    expect(info.futureBeltDate).toBe(true);
    expect(info.status).toBe('not-eligible');
    expect(info.warnings.some((warning) => warning.includes('future'))).toBe(true);
  });

  it('returns highest belt when there is no next belt', () => {
    const state = makeState({
      students: [makeStudent({ currentBelt: 'black' })],
      gradings: [makeGrading({ date: '01/20', type: 'belt', belt: 'black' })],
    });
    const info = computeEligibility(state, state.students[0], '11/26');
    expect(info.status).toBe('highest');
    expect(info.nextBelt).toBeNull();
    expect(info.minMonthsToNextBelt).toBeNull();
    expect(info.monthsAtBelt).toBe(82);
  });

  it('recalculates when configuration changes', () => {
    const state = orangeState('10/25');
    const before = computeEligibility(state, state.students[0], '11/26');
    expect(before.status).toBe('not-eligible');

    const orange = state.config.belts.find((belt) => belt.id === 'orange');
    if (orange) orange.minMonthsToNextBelt = 12;
    const after = computeEligibility(state, state.students[0], '11/26');
    expect(after.status).toBe('eligible');
  });

  it('warns when cached stripes exceed the configured maximum', () => {
    const state = makeState({
      students: [makeStudent({ currentBelt: 'orange', currentStripes: 9 })],
      gradings: [makeGrading({ date: '05/25', type: 'belt', belt: 'orange' })],
    });
    const info = computeEligibility(state, state.students[0], '11/26');
    expect(info.warnings.some((warning) => warning.includes('exceeds'))).toBe(true);
  });

  it('returns unknown for an unknown belt id', () => {
    const state = makeState({
      students: [makeStudent({ currentBelt: 'mystery' })],
    });
    const info = computeEligibility(state, state.students[0], '11/26');
    expect(info.status).toBe('unknown');
    expect(info.currentBelt).toBeNull();
  });
});

describe('eligibility summaries', () => {
  it('summarizes statuses and belt distribution', () => {
    const state = makeState({
      config: defaultConfig(),
      students: [
        makeStudent({ id: 's001', currentBelt: 'orange' }),
        makeStudent({ id: 's002', name: 'Second', currentBelt: 'orange' }),
        makeStudent({ id: 's003', name: 'Third', currentBelt: 'blue' }),
      ],
      gradings: [
        makeGrading({ id: 'g001', studentId: 's001', date: '05/25', belt: 'orange' }),
        makeGrading({ id: 'g002', studentId: 's002', date: '10/26', belt: 'orange' }),
        makeGrading({ id: 'g003', studentId: 's003', date: '01/26', belt: 'blue' }),
      ],
    });
    const infos = state.students.map((student) => computeEligibility(state, student, '11/26'));
    const summary = summarizeEligibility(infos);
    expect(summary.total).toBe(3);
    expect(summary.eligible).toBe(1);
    expect(summary.notEligible).toBe(2);
    const distribution = beltDistribution(state);
    expect(distribution.find((entry) => entry.beltId === 'orange')?.count).toBe(2);
    expect(distribution.find((entry) => entry.beltId === 'blue')?.count).toBe(1);
    expect(distribution.find((entry) => entry.beltId === 'white')?.count).toBe(0);
  });
});
