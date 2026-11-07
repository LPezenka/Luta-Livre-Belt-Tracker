import { findBelt, validateBeltId } from './config';
import type { AppState, Belt, MutationResult } from './models';
import { cloneState } from './state';

export interface BeltPatch {
  name?: string;
  maxStripes?: number;
  minMonthsToNextBelt?: number;
}

export function updateBeltConfig(
  state: AppState,
  beltId: string,
  patch: BeltPatch,
): MutationResult {
  const next = cloneState(state);
  const belt = findBelt(next.config, beltId);
  if (!belt) return { ok: false, error: 'Belt not found.' };

  if (patch.name != null) {
    const name = patch.name.trim();
    if (!name) return { ok: false, error: 'Belt name cannot be empty.' };
    belt.name = name;
  }
  if (patch.maxStripes != null) {
    const maxStripes = Number(patch.maxStripes);
    if (!Number.isInteger(maxStripes) || maxStripes < 0 || maxStripes > 20) {
      return { ok: false, error: 'Maximum stripes must be a whole number from 0 to 20.' };
    }
    belt.maxStripes = maxStripes;
  }
  if (patch.minMonthsToNextBelt != null) {
    const months = Number(patch.minMonthsToNextBelt);
    if (!Number.isInteger(months) || months < 0 || months > 240) {
      return { ok: false, error: 'Minimum months must be a whole number from 0 to 240.' };
    }
    belt.minMonthsToNextBelt = months;
  }

  const affected = next.students.filter(
    (student) =>
      student.currentBelt === belt.id && student.currentStripes > belt.maxStripes,
  );
  return {
    ok: true,
    state: next,
    message: 'Belt configuration saved.',
    warning:
      affected.length > 0
        ? `${affected.length} student${affected.length === 1 ? '' : 's'} already exceed the new maximum stripe count. Existing stripes were not removed; future awards are limited.`
        : undefined,
  };
}

export function renameBeltId(
  state: AppState,
  oldId: string,
  newIdRaw: string,
): MutationResult {
  const next = cloneState(state);
  const belt = findBelt(next.config, oldId);
  if (!belt) return { ok: false, error: 'Belt not found.' };

  const newId = newIdRaw.trim().toLowerCase();
  const idError = validateBeltId(newId);
  if (idError) return { ok: false, error: idError };
  if (newId === oldId) return { ok: true, state: next, message: 'Belt id unchanged.' };
  if (findBelt(next.config, newId)) {
    return { ok: false, error: `Belt id "${newId}" already exists.` };
  }

  belt.id = newId;
  for (const student of next.students) {
    if (student.currentBelt === oldId) student.currentBelt = newId;
  }
  for (const grading of next.gradings) {
    if (grading.belt === oldId) grading.belt = newId;
  }
  for (const item of next.checklistItems) {
    if (item.belt === oldId) item.belt = newId;
  }

  return {
    ok: true,
    state: next,
    message: `Belt id changed from "${oldId}" to "${newId}". Students, grading history and checklists were updated.`,
  };
}

export function addBelt(
  state: AppState,
  input: { id: string; name: string; maxStripes?: number; minMonthsToNextBelt?: number },
): MutationResult {
  const next = cloneState(state);
  const id = input.id.trim().toLowerCase();
  const idError = validateBeltId(id);
  if (idError) return { ok: false, error: idError };
  if (findBelt(next.config, id)) {
    return { ok: false, error: `Belt id "${id}" already exists.` };
  }
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Belt name cannot be empty.' };

  const maxStripes = input.maxStripes ?? 4;
  const minMonths = input.minMonthsToNextBelt ?? 18;
  if (!Number.isInteger(maxStripes) || maxStripes < 0 || maxStripes > 20) {
    return { ok: false, error: 'Maximum stripes must be a whole number from 0 to 20.' };
  }
  if (!Number.isInteger(minMonths) || minMonths < 0 || minMonths > 240) {
    return { ok: false, error: 'Minimum months must be a whole number from 0 to 240.' };
  }

  const belt: Belt = { id, name, maxStripes, minMonthsToNextBelt: minMonths };
  next.config.belts.push(belt);
  return { ok: true, state: next, message: `Belt "${name}" added at the end of the sequence.` };
}

export function removeBelt(state: AppState, beltId: string): MutationResult {
  const next = cloneState(state);
  const belt = findBelt(next.config, beltId);
  if (!belt) return { ok: false, error: 'Belt not found.' };
  if (next.config.belts.length <= 1) {
    return { ok: false, error: 'At least one belt must remain configured.' };
  }

  const studentRefs = next.students.filter(
    (student) => student.currentBelt === beltId,
  ).length;
  const gradingRefs = next.gradings.filter((grading) => grading.belt === beltId).length;
  const checklistRefs = next.checklistItems.filter((item) => item.belt === beltId).length;

  if (studentRefs > 0 || gradingRefs > 0 || checklistRefs > 0) {
    const parts: string[] = [];
    if (studentRefs > 0) parts.push(`${studentRefs} student record(s)`);
    if (gradingRefs > 0) parts.push(`${gradingRefs} grading event(s)`);
    if (checklistRefs > 0) parts.push(`${checklistRefs} checklist item(s)`);
    return {
      ok: false,
      error: `Cannot remove "${belt.name}" because it is referenced by ${parts.join(', ')}. Remove or reassign those records first.`,
    };
  }

  next.config.belts = next.config.belts.filter((entry) => entry.id !== beltId);
  return { ok: true, state: next, message: `Belt "${belt.name}" removed.` };
}

export function moveBelt(
  state: AppState,
  beltId: string,
  direction: 'up' | 'down',
): MutationResult {
  const next = cloneState(state);
  const index = next.config.belts.findIndex((belt) => belt.id === beltId);
  if (index < 0) return { ok: false, error: 'Belt not found.' };
  const swapWith = direction === 'up' ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= next.config.belts.length) {
    return { ok: true, state: next, message: 'Belt is already at the edge of the sequence.' };
  }
  const belts = next.config.belts;
  [belts[index], belts[swapWith]] = [belts[swapWith], belts[index]];
  return {
    ok: true,
    state: next,
    message: 'Belt sequence updated. Next-belt targets now follow the new order.',
  };
}

export function setUpcomingEligibilityMonths(
  state: AppState,
  months: number,
): MutationResult {
  const next = cloneState(state);
  const value = Number(months);
  if (!Number.isInteger(value) || value < 0 || value > 24) {
    return { ok: false, error: 'Upcoming window must be a whole number from 0 to 24 months.' };
  }
  next.config.upcomingEligibilityMonths = value;
  return { ok: true, state: next, message: 'Upcoming eligibility window saved.' };
}
