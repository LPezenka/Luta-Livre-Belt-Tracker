import { describe, expect, it } from 'vitest';
import {
  addBelt,
  moveBelt,
  removeBelt,
  renameBeltId,
  setUpcomingEligibilityMonths,
  updateBeltConfig,
} from '../src/core/configActions';
import { nextBelt } from '../src/core/config';
import { makeChecklistItem, makeGrading, makeState, makeStudent } from './helpers';

describe('belt configuration changes', () => {
  it('renames a belt id and updates every reference', () => {
    const state = makeState({
      students: [makeStudent({ currentBelt: 'orange' })],
      gradings: [makeGrading({ date: '01/25', type: 'belt', belt: 'orange' })],
      checklistItems: [makeChecklistItem({ belt: 'orange' })],
    });
    const result = renameBeltId(state, 'orange', 'amber');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.config.belts.some((belt) => belt.id === 'amber')).toBe(true);
    expect(result.state.students[0].currentBelt).toBe('amber');
    expect(result.state.gradings[0].belt).toBe('amber');
    expect(result.state.checklistItems[0].belt).toBe('amber');
  });

  it('rejects duplicate or invalid belt ids', () => {
    const state = makeState();
    expect(renameBeltId(state, 'orange', 'blue').ok).toBe(false);
    expect(renameBeltId(state, 'orange', 'not valid!').ok).toBe(false);
  });

  it('changes the belt sequence and therefore the next-belt target', () => {
    const state = makeState();
    expect(nextBelt(state.config, 'orange')?.id).toBe('blue');
    const result = moveBelt(state, 'blue', 'down');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(nextBelt(result.state.config, 'orange')?.id).toBe('purple');
  });

  it('adds a belt at the end of the sequence', () => {
    const result = addBelt(makeState(), {
      id: 'red',
      name: 'Red',
      maxStripes: 4,
      minMonthsToNextBelt: 12,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.config.belts.at(-1)?.id).toBe('red');
    expect(nextBelt(result.state.config, 'black')?.id).toBe('red');
  });

  it('blocks removal of a referenced belt and allows removal when safe', () => {
    const state = makeState({
      students: [makeStudent({ currentBelt: 'orange' })],
      gradings: [makeGrading({ date: '01/25', type: 'belt', belt: 'orange' })],
    });
    const blocked = removeBelt(state, 'orange');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toContain('referenced');

    const added = addBelt(state, { id: 'temp', name: 'Temporary' });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const removed = removeBelt(added.state, 'temp');
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.state.config.belts.some((belt) => belt.id === 'temp')).toBe(false);
  });

  it('updates maximum stripes and warns about existing over-maximum students', () => {
    const state = makeState({
      students: [makeStudent({ currentBelt: 'orange', currentStripes: 3 })],
    });
    const result = updateBeltConfig(state, 'orange', { maxStripes: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warning).toContain('exceed');
    expect(result.state.students[0].currentStripes).toBe(3);
    expect(result.state.config.belts.find((belt) => belt.id === 'orange')?.maxStripes).toBe(2);
  });

  it('updates minimum months and the upcoming window', () => {
    const state = makeState();
    const beltResult = updateBeltConfig(state, 'orange', { minMonthsToNextBelt: 12 });
    expect(beltResult.ok).toBe(true);
    if (!beltResult.ok) return;
    expect(
      beltResult.state.config.belts.find((belt) => belt.id === 'orange')?.minMonthsToNextBelt,
    ).toBe(12);
    const windowResult = setUpcomingEligibilityMonths(beltResult.state, 6);
    expect(windowResult.ok).toBe(true);
    if (!windowResult.ok) return;
    expect(windowResult.state.config.upcomingEligibilityMonths).toBe(6);
  });

  it('rejects invalid configuration values', () => {
    const state = makeState();
    expect(updateBeltConfig(state, 'orange', { maxStripes: -1 }).ok).toBe(false);
    expect(updateBeltConfig(state, 'orange', { minMonthsToNextBelt: 1.5 }).ok).toBe(false);
    expect(updateBeltConfig(state, 'orange', { name: '  ' }).ok).toBe(false);
    expect(setUpcomingEligibilityMonths(state, -1).ok).toBe(false);
  });

  it('refuses to remove the final remaining belt', () => {
    const state = makeState();
    state.config.belts = [state.config.belts[0]];
    expect(removeBelt(state, state.config.belts[0].id).ok).toBe(false);
  });
});
