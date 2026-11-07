import { describe, expect, it } from 'vitest';
import {
  addStudent,
  awardStripes,
  deleteGrading,
  promoteStudent,
  recomputeAllStudents,
  recomputeStudent,
  recordBeltAwardDate,
  renameStudent,
  updateGradingDate,
} from '../src/core/grading';
import { computeEligibility } from '../src/core/eligibility';
import type { AppState } from '../src/core/models';
import { makeChecklistItem, makeGrading, makeProgress, makeState, makeStudent } from './helpers';

function orangeState(stripes = 0, beltDate = '05/25'): AppState {
  const gradings = [
    makeGrading({ id: 'g001', date: beltDate, type: 'belt', belt: 'orange' }),
  ];
  if (stripes > 0) {
    gradings.push(
      makeGrading({
        id: 'g002',
        date: beltDate,
        type: 'stripe',
        belt: 'orange',
        stripesAwarded: stripes,
      }),
    );
  }
  return makeState({
    students: [makeStudent({ currentBelt: 'orange', currentStripes: stripes })],
    gradings,
  });
}

describe('stripe awards', () => {
  it('awards a single stripe', () => {
    const result = awardStripes(orangeState(0), 's001', 1, '11/26');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.students[0].currentStripes).toBe(1);
    const event = result.state.gradings.at(-1);
    expect(event?.type).toBe('stripe');
    expect(event?.stripesAwarded).toBe(1);
    expect(event?.belt).toBe('orange');
  });

  it('awards multiple stripes simultaneously', () => {
    const result = awardStripes(orangeState(1), 's001', 3, '11/26');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.students[0].currentStripes).toBe(4);
    expect(result.state.gradings.at(-1)?.stripesAwarded).toBe(3);
  });

  it('enforces the configured maximum stripe count', () => {
    const result = awardStripes(orangeState(3), 's001', 2, '11/26');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Only 1 additional stripe');
  });

  it('rejects awards when the belt allows zero stripes', () => {
    const state = orangeState(0);
    const belt = state.config.belts.find((entry) => entry.id === 'orange');
    if (belt) belt.maxStripes = 0;
    const result = awardStripes(state, 's001', 1, '11/26');
    expect(result.ok).toBe(false);
  });

  it('rejects invalid dates and dates before the belt start', () => {
    expect(awardStripes(orangeState(0), 's001', 1, '13/26').ok).toBe(false);
    const result = awardStripes(orangeState(0, '05/25'), 's001', 1, '04/25');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('before the current');
  });

  it('rejects non-positive or fractional stripe counts', () => {
    expect(awardStripes(orangeState(0), 's001', 0, '11/26').ok).toBe(false);
    expect(awardStripes(orangeState(0), 's001', 1.5, '11/26').ok).toBe(false);
  });
});

describe('belt promotions', () => {
  it('allows early promotion before the minimum time is reached', () => {
    const state = orangeState(2, '10/26');
    const eligibility = computeEligibility(state, state.students[0], '11/26');
    expect(eligibility.status).toBe('not-eligible');
    expect(eligibility.monthsAtBelt).toBe(1);

    const result = promoteStudent(state, 's001', '11/26');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.students[0].currentBelt).toBe('blue');
  });

  it('allows promotion despite an incomplete checklist', () => {
    const state = orangeState(2);
    state.checklistItems = [
      makeChecklistItem({ id: 'c001', belt: 'blue', sortOrder: 1, description: 'Guard retention' }),
      makeChecklistItem({ id: 'c002', belt: 'blue', sortOrder: 2, description: 'Passing' }),
    ];
    state.checklistProgress = [
      makeProgress({ studentId: 's001', checklistItemId: 'c001', completed: true }),
      makeProgress({ studentId: 's001', checklistItemId: 'c002', completed: false }),
    ];
    const result = promoteStudent(state, 's001', '11/26');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.students[0].currentBelt).toBe('blue');
  });

  it('allows promotion with zero stripes', () => {
    const result = promoteStudent(orangeState(0), 's001', '11/26');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.students[0].currentBelt).toBe('blue');
    expect(result.state.students[0].currentStripes).toBe(0);
  });

  it('allows promotion with fewer than the maximum stripes and resets the count', () => {
    const result = promoteStudent(orangeState(2), 's001', '11/26');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.students[0].currentBelt).toBe('blue');
    expect(result.state.students[0].currentStripes).toBe(0);
  });

  it('preserves historical grading events after promotion', () => {
    const state = orangeState(2);
    const before = state.gradings.length;
    const result = promoteStudent(state, 's001', '11/26');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.gradings.length).toBe(before + 1);
    expect(result.state.gradings.some((grading) => grading.belt === 'orange')).toBe(true);
    expect(result.state.gradings.at(-1)?.type).toBe('belt');
    expect(result.state.gradings.at(-1)?.belt).toBe('blue');
  });

  it('rejects promotion at the highest configured belt', () => {
    const state = makeState({
      students: [makeStudent({ currentBelt: 'black' })],
      gradings: [makeGrading({ date: '01/20', type: 'belt', belt: 'black' })],
    });
    const result = promoteStudent(state, 's001', '11/26');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('highest configured belt');
  });

  it('rejects promotion dated before the current belt start', () => {
    const result = promoteStudent(orangeState(0, '05/25'), 's001', '04/25');
    expect(result.ok).toBe(false);
  });

  it('accepts a different month/year, including a future month', () => {
    const result = promoteStudent(orangeState(0, '10/25'), 's001', '01/27');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.students[0].currentBelt).toBe('blue');
  });
});

describe('history corrections and recomputation', () => {
  it('updates a grading date without contradictory current state', () => {
    const state = orangeState(0, '01/26');
    state.gradings.push(
      makeGrading({ id: 'g002', date: '05/26', type: 'stripe', belt: 'orange', stripesAwarded: 1 }),
    );
    state.students[0].currentStripes = 1;
    const result = updateGradingDate(state, 'g001', '06/26');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.gradings.find((grading) => grading.id === 'g001')?.date).toBe('06/26');
    // The stripe event now falls before the belt-award date and no longer counts.
    expect(result.state.students[0].currentStripes).toBe(0);
    expect(result.state.gradings.some((grading) => grading.id === 'g002')).toBe(true);
  });

  it('falls back to the previous belt when the latest belt event is deleted', () => {
    const state = makeState({
      students: [makeStudent({ currentBelt: 'blue', currentStripes: 0 })],
      gradings: [
        makeGrading({ id: 'g001', date: '01/25', type: 'belt', belt: 'orange' }),
        makeGrading({ id: 'g002', date: '06/26', type: 'belt', belt: 'blue' }),
      ],
    });
    const result = deleteGrading(state, 'g002');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.students[0].currentBelt).toBe('orange');
  });

  it('recomputes stripes after deleting a stripe event', () => {
    const state = orangeState(0, '01/26');
    state.gradings.push(
      makeGrading({ id: 'g002', date: '05/26', type: 'stripe', belt: 'orange', stripesAwarded: 2 }),
    );
    state.students[0].currentStripes = 2;
    const result = deleteGrading(state, 'g002');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.students[0].currentStripes).toBe(0);
  });

  it('records a missing belt-award date while retaining stripes', () => {
    const state = makeState({
      students: [makeStudent({ currentBelt: 'yellow', currentStripes: 1 })],
      gradings: [
        makeGrading({ id: 'g001', date: '06/26', type: 'stripe', belt: 'yellow', stripesAwarded: 1 }),
      ],
    });
    const result = recordBeltAwardDate(state, 's001', '05/26');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.students[0].currentStripes).toBe(1);
    const beltEvent = result.state.gradings.find((grading) => grading.type === 'belt');
    expect(beltEvent?.date).toBe('05/26');
    const info = computeEligibility(result.state, result.state.students[0], '11/26');
    expect(info.beltSince).toBe('05/26');
    expect(info.beltSinceProvisional).toBe(false);
  });

  it('repairs cached state from history', () => {
    const state = makeState({
      students: [makeStudent({ currentBelt: 'orange', currentStripes: 0 })],
      gradings: [
        makeGrading({ id: 'g001', date: '01/25', type: 'belt', belt: 'orange' }),
        makeGrading({ id: 'g002', date: '06/26', type: 'stripe', belt: 'orange', stripesAwarded: 1 }),
      ],
    });
    const repaired = recomputeAllStudents(state);
    expect(repaired.students[0].currentStripes).toBe(1);
  });

  it('keeps a legacy current belt that has stripe events but no belt event', () => {
    const state = makeState({
      students: [makeStudent({ currentBelt: 'blue', currentStripes: 1 })],
      gradings: [
        makeGrading({ id: 'g001', date: '01/25', type: 'belt', belt: 'orange' }),
        makeGrading({ id: 'g002', date: '06/26', type: 'stripe', belt: 'blue', stripesAwarded: 1 }),
      ],
    });
    const student = recomputeStudent(state, 's001');
    expect(student?.currentBelt).toBe('blue');
    expect(student?.currentStripes).toBe(1);
  });
});

describe('student records', () => {
  it('adds a student at the starting belt with zero stripes', () => {
    const result = addStudent(makeState(), '  New   Student ');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.students).toHaveLength(1);
    expect(result.state.students[0].name).toBe('New Student');
    expect(result.state.students[0].currentBelt).toBe('white');
    expect(result.state.students[0].currentStripes).toBe(0);
  });

  it('renames a student without changing the stable id', () => {
    const state = makeState({ students: [makeStudent()] });
    const result = renameStudent(state, 's001', 'Renamed');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.students[0].id).toBe('s001');
    expect(result.state.students[0].name).toBe('Renamed');
  });
});
