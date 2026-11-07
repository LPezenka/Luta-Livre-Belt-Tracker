import { describe, expect, it } from 'vitest';
import {
  addChecklistItem,
  checklistCompletionCount,
  checklistItemsForBelt,
  checklistSummary,
  deleteChecklistItem,
  nextBeltChecklist,
  reorderChecklistItem,
  setChecklistItemArchived,
  setChecklistProgress,
  updateChecklistItem,
} from '../src/core/checklists';
import { parseStateFiles, serializeState } from '../src/core/serialization';
import { makeChecklistItem, makeProgress, makeState, makeStudent } from './helpers';

function checklistState() {
  return makeState({
    students: [
      makeStudent({ id: 's001', name: 'Anna', currentBelt: 'orange' }),
      makeStudent({ id: 's002', name: 'Max', currentBelt: 'orange' }),
      makeStudent({ id: 's003', name: 'Black Belt', currentBelt: 'black' }),
    ],
    checklistItems: [
      makeChecklistItem({ id: 'c001', belt: 'blue', sortOrder: 1, description: 'Guard retention' }),
      makeChecklistItem({ id: 'c002', belt: 'blue', sortOrder: 2, description: 'Passing fundamentals' }),
      makeChecklistItem({ id: 'c003', belt: 'purple', sortOrder: 1, description: 'Advanced transitions' }),
    ],
  });
}

describe('checklist definitions', () => {
  it('keeps checklists separate per belt', () => {
    const state = checklistState();
    expect(checklistItemsForBelt(state, 'blue').map((item) => item.id)).toEqual(['c001', 'c002']);
    expect(checklistItemsForBelt(state, 'purple').map((item) => item.id)).toEqual(['c003']);
    expect(checklistItemsForBelt(state, 'yellow')).toEqual([]);
  });

  it('shows the next-belt checklist for the belt being awarded', () => {
    const summary = nextBeltChecklist(checklistState(), 's001');
    expect(summary.beltId).toBe('blue');
    expect(summary.beltName).toBe('Blue');
    expect(summary.totalCount).toBe(2);
  });

  it('shows the next-belt checklist even when the student is not eligible', () => {
    const state = checklistState();
    state.gradings = [];
    const summary = nextBeltChecklist(state, 's001');
    expect(summary.totalCount).toBe(2);
    expect(summary.completedCount).toBe(0);
  });

  it('returns no checklist for the highest belt', () => {
    const summary = nextBeltChecklist(checklistState(), 's003');
    expect(summary.beltId).toBeNull();
    expect(summary.totalCount).toBe(0);
  });

  it('adds items at the end of the belt checklist', () => {
    const result = addChecklistItem(checklistState(), 'blue', 'New criterion');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const items = checklistItemsForBelt(result.state, 'blue');
    expect(items).toHaveLength(3);
    expect(items.at(-1)?.description).toBe('New criterion');
    expect(items.at(-1)?.sortOrder).toBe(3);
  });

  it('edits descriptions without touching completion records', () => {
    const state = checklistState();
    state.checklistProgress = [makeProgress({ studentId: 's001', checklistItemId: 'c001' })];
    const result = updateChecklistItem(state, 'c001', 'Updated guard retention');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.checklistItems.find((item) => item.id === 'c001')?.description).toBe(
      'Updated guard retention',
    );
    expect(result.state.checklistProgress).toHaveLength(1);
    expect(result.state.checklistProgress[0].completed).toBe(true);
  });

  it('reorders items within a belt', () => {
    const result = reorderChecklistItem(checklistState(), 'c002', 'up');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(checklistItemsForBelt(result.state, 'blue').map((item) => item.id)).toEqual([
      'c002',
      'c001',
    ]);
  });

  it('archives items and retains completion records', () => {
    const state = checklistState();
    state.checklistProgress = [makeProgress({ studentId: 's001', checklistItemId: 'c001' })];
    const result = setChecklistItemArchived(state, 'c001', true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(checklistItemsForBelt(result.state, 'blue').map((item) => item.id)).toEqual(['c002']);
    expect(checklistItemsForBelt(result.state, 'blue', true)).toHaveLength(2);
    expect(result.state.checklistProgress).toHaveLength(1);
    expect(checklistCompletionCount(result.state, 'c001')).toBe(1);
  });

  it('blocks destructive deletion when completion records reference the item', () => {
    const state = checklistState();
    state.checklistProgress = [makeProgress({ studentId: 's001', checklistItemId: 'c001' })];
    const result = deleteChecklistItem(state, 'c001');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Archive');
    expect(state.checklistItems).toHaveLength(3);
  });

  it('deletes unreferenced items', () => {
    const result = deleteChecklistItem(checklistState(), 'c003');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.checklistItems.some((item) => item.id === 'c003')).toBe(false);
  });
});

describe('per-student checklist progress', () => {
  it('tracks completion independently for each student', () => {
    let state = checklistState();
    const first = setChecklistProgress(state, 's001', 'c001', true);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    state = first.state;

    const second = setChecklistProgress(state, 's002', 'c001', true);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    state = second.state;

    const summaryAnna = checklistSummary(state, 's001', 'blue');
    const summaryMax = checklistSummary(state, 's002', 'blue');
    expect(summaryAnna.completedCount).toBe(1);
    expect(summaryMax.completedCount).toBe(1);

    const clearAnna = setChecklistProgress(state, 's001', 'c001', false);
    expect(clearAnna.ok).toBe(true);
    if (!clearAnna.ok) return;
    expect(checklistSummary(clearAnna.state, 's001', 'blue').completedCount).toBe(0);
    expect(checklistSummary(clearAnna.state, 's002', 'blue').completedCount).toBe(1);
  });

  it('reports completion counts', () => {
    let state = checklistState();
    const first = setChecklistProgress(state, 's001', 'c001', true);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    state = first.state;
    const second = setChecklistProgress(state, 's001', 'c002', true);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    state = second.state;
    const summary = checklistSummary(state, 's001', 'blue');
    expect(summary.completedCount).toBe(2);
    expect(summary.totalCount).toBe(2);
  });

  it('rejects progress for unknown students or items', () => {
    const state = checklistState();
    expect(setChecklistProgress(state, 's999', 'c001', true).ok).toBe(false);
    expect(setChecklistProgress(state, 's001', 'c999', true).ok).toBe(false);
  });

  it('persists completion through CSV serialization and parsing', () => {
    let state = checklistState();
    const a = setChecklistProgress(state, 's001', 'c001', true);
    if (!a.ok) throw new Error(a.error);
    state = a.state;
    const b = setChecklistProgress(state, 's002', 'c002', true);
    if (!b.ok) throw new Error(b.error);
    state = b.state;
    const archived = setChecklistItemArchived(state, 'c001', true);
    if (!archived.ok) throw new Error(archived.error);
    state = archived.state;

    const files = serializeState(state);
    const parsed = parseStateFiles(files);
    const summary = checklistSummary(parsed.state, 's001', 'blue');
    expect(summary.completedCount).toBe(0); // c001 is archived and hidden from active checklist
    expect(checklistCompletionCount(parsed.state, 'c001')).toBe(1);
    expect(checklistSummary(parsed.state, 's002', 'blue').completedCount).toBe(1);
  });
});
