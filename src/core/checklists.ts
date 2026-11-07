import { findBelt, nextBelt } from './config';
import { nextId } from './ids';
import type {
  AppState,
  ChecklistItem,
  ChecklistProgress,
  MutationResult,
} from './models';
import { cloneState, findChecklistItem, findStudent } from './state';

export interface ChecklistEntry {
  item: ChecklistItem;
  completed: boolean;
}

export interface ChecklistSummary {
  beltId: string | null;
  beltName: string;
  items: ChecklistEntry[];
  completedCount: number;
  totalCount: number;
}

export function checklistItemsForBelt(
  state: AppState,
  beltId: string,
  includeArchived = false,
): ChecklistItem[] {
  return state.checklistItems
    .filter((item) => item.belt === beltId && (includeArchived || !item.archived))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

export function checklistSummary(
  state: AppState,
  studentId: string,
  beltId: string | null,
): ChecklistSummary {
  if (!beltId) {
    return {
      beltId: null,
      beltName: '—',
      items: [],
      completedCount: 0,
      totalCount: 0,
    };
  }
  const belt = findBelt(state.config, beltId);
  const items = checklistItemsForBelt(state, beltId).map((item) => {
    const progress = state.checklistProgress.find(
      (row) => row.studentId === studentId && row.checklistItemId === item.id,
    );
    return { item, completed: progress?.completed ?? false };
  });
  return {
    beltId,
    beltName: belt?.name ?? beltId,
    items,
    completedCount: items.filter((entry) => entry.completed).length,
    totalCount: items.length,
  };
}

/** Checklist for the belt the student would be promoted to, if any. */
export function nextBeltChecklist(
  state: AppState,
  studentId: string,
): ChecklistSummary {
  const student = findStudent(state, studentId);
  if (!student) {
    return checklistSummary(state, studentId, null);
  }
  const target = nextBelt(state.config, student.currentBelt);
  return checklistSummary(state, studentId, target?.id ?? null);
}

export function checklistCompletionCount(state: AppState, itemId: string): number {
  return state.checklistProgress.filter(
    (row) => row.checklistItemId === itemId && row.completed,
  ).length;
}

export function setChecklistProgress(
  state: AppState,
  studentId: string,
  itemId: string,
  completed: boolean,
): MutationResult {
  const next = cloneState(state);
  if (!findStudent(next, studentId)) return { ok: false, error: 'Student not found.' };
  if (!findChecklistItem(next, itemId)) {
    return { ok: false, error: 'Checklist item not found.' };
  }

  const existing = next.checklistProgress.find(
    (row) => row.studentId === studentId && row.checklistItemId === itemId,
  );
  if (existing) {
    existing.completed = completed;
  } else {
    const row: ChecklistProgress = {
      studentId,
      checklistItemId: itemId,
      completed,
    };
    next.checklistProgress.push(row);
  }

  return {
    ok: true,
    state: next,
    message: completed ? 'Checklist item marked complete.' : 'Checklist item marked incomplete.',
  };
}

function renumberActive(state: AppState, beltId: string): void {
  const active = checklistItemsForBelt(state, beltId);
  active.forEach((item, index) => {
    item.sortOrder = index + 1;
  });
}

export function addChecklistItem(
  state: AppState,
  beltId: string,
  descriptionRaw: string,
): MutationResult {
  const next = cloneState(state);
  if (!findBelt(next.config, beltId)) return { ok: false, error: 'Belt not found.' };
  const description = descriptionRaw.trim();
  if (!description) return { ok: false, error: 'Enter a checklist description.' };

  const maxOrder = next.checklistItems
    .filter((item) => item.belt === beltId)
    .reduce((max, item) => Math.max(max, item.sortOrder), 0);

  next.checklistItems.push({
    id: nextId('c', next.checklistItems.map((item) => item.id)),
    belt: beltId,
    sortOrder: maxOrder + 1,
    description,
    archived: false,
  });

  return { ok: true, state: next, message: 'Checklist item added.' };
}

export function updateChecklistItem(
  state: AppState,
  itemId: string,
  descriptionRaw: string,
): MutationResult {
  const next = cloneState(state);
  const item = findChecklistItem(next, itemId);
  if (!item) return { ok: false, error: 'Checklist item not found.' };
  const description = descriptionRaw.trim();
  if (!description) return { ok: false, error: 'Checklist description cannot be empty.' };
  item.description = description;
  return { ok: true, state: next, message: 'Checklist item updated.' };
}

export function setChecklistItemArchived(
  state: AppState,
  itemId: string,
  archived: boolean,
): MutationResult {
  const next = cloneState(state);
  const item = findChecklistItem(next, itemId);
  if (!item) return { ok: false, error: 'Checklist item not found.' };

  item.archived = archived;
  if (archived) {
    renumberActive(next, item.belt);
  } else {
    const maxOrder = next.checklistItems
      .filter((entry) => entry.belt === item.belt)
      .reduce((max, entry) => Math.max(max, entry.sortOrder), 0);
    item.sortOrder = maxOrder + 1;
  }

  return {
    ok: true,
    state: next,
    message: archived ? 'Checklist item archived. Completion records retained.' : 'Checklist item restored.',
  };
}

export function deleteChecklistItem(state: AppState, itemId: string): MutationResult {
  const next = cloneState(state);
  const item = findChecklistItem(next, itemId);
  if (!item) return { ok: false, error: 'Checklist item not found.' };

  const referenced = next.checklistProgress.some(
    (row) => row.checklistItemId === itemId,
  );
  if (referenced) {
    return {
      ok: false,
      error:
        'This item has student completion records and cannot be deleted. Archive it instead to preserve history.',
    };
  }

  next.checklistItems = next.checklistItems.filter((entry) => entry.id !== itemId);
  renumberActive(next, item.belt);
  return { ok: true, state: next, message: 'Checklist item deleted.' };
}

export function reorderChecklistItem(
  state: AppState,
  itemId: string,
  direction: 'up' | 'down',
): MutationResult {
  const next = cloneState(state);
  const item = findChecklistItem(next, itemId);
  if (!item) return { ok: false, error: 'Checklist item not found.' };

  const active = checklistItemsForBelt(next, item.belt);
  const index = active.findIndex((entry) => entry.id === itemId);
  const swapWith = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= active.length) {
    return { ok: true, state: next, message: 'Item is already at the edge of the checklist.' };
  }

  const currentOrder = active[index].sortOrder;
  active[index].sortOrder = active[swapWith].sortOrder;
  active[swapWith].sortOrder = currentOrder;
  renumberActive(next, item.belt);

  return { ok: true, state: next, message: 'Checklist order updated.' };
}
