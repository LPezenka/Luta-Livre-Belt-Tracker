import { defaultConfig, findBelt, beltIndex } from './config';
import { compareMonthYear, isValidMonthYear } from './dates';
import type {
  AppState,
  ChecklistItem,
  ChecklistProgress,
  Grading,
  Student,
  ValidationIssue,
} from './models';

export function emptyState(): AppState {
  return {
    config: defaultConfig(),
    students: [],
    gradings: [],
    checklistItems: [],
    checklistProgress: [],
  };
}

export function cloneState(state: AppState): AppState {
  if (typeof structuredClone === 'function') return structuredClone(state);
  return JSON.parse(JSON.stringify(state)) as AppState;
}

export function findStudent(state: AppState, studentId: string): Student | null {
  return state.students.find((student) => student.id === studentId) ?? null;
}

export function findChecklistItem(
  state: AppState,
  itemId: string,
): ChecklistItem | null {
  return state.checklistItems.find((item) => item.id === itemId) ?? null;
}

export function progressFor(
  state: AppState,
  studentId: string,
  itemId: string,
): ChecklistProgress | null {
  return (
    state.checklistProgress.find(
      (row) => row.studentId === studentId && row.checklistItemId === itemId,
    ) ?? null
  );
}

function duplicateIds<T>(items: T[], getId: (item: T) => string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    const id = getId(item);
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

/**
 * Structural validation. Errors indicate data that cannot be represented
 * safely; warnings indicate suspicious but recoverable data.
 */
export function validateState(state: AppState): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!state.config || !Array.isArray(state.config.belts) || state.config.belts.length === 0) {
    issues.push({ severity: 'error', message: 'Configuration has no belts.' });
  }
  const beltIds = new Set<string>();
  for (const belt of state.config?.belts ?? []) {
    if (!belt.id) issues.push({ severity: 'error', message: 'A belt is missing an id.' });
    if (beltIds.has(belt.id)) {
      issues.push({ severity: 'error', message: `Duplicate belt id "${belt.id}".` });
    }
    beltIds.add(belt.id);
    if (!Number.isInteger(belt.maxStripes) || belt.maxStripes < 0) {
      issues.push({
        severity: 'error',
        message: `Belt "${belt.id}" has an invalid maximum stripe count.`,
      });
    }
    if (!Number.isInteger(belt.minMonthsToNextBelt) || belt.minMonthsToNextBelt < 0) {
      issues.push({
        severity: 'error',
        message: `Belt "${belt.id}" has an invalid minimum time.`,
      });
    }
  }
  if (
    !Number.isInteger(state.config?.upcomingEligibilityMonths) ||
    (state.config?.upcomingEligibilityMonths ?? -1) < 0
  ) {
    issues.push({
      severity: 'error',
      message: 'upcomingEligibilityMonths must be a non-negative integer.',
    });
  }

  for (const id of duplicateIds(state.students, (student) => student.id)) {
    issues.push({ severity: 'error', message: `Duplicate student id "${id}".` });
  }
  for (const student of state.students) {
    if (!student.name.trim()) {
      issues.push({
        severity: 'error',
        message: `Student "${student.id}" has an empty name.`,
        entity: student.id,
      });
    }
    if (!beltIds.has(student.currentBelt)) {
      issues.push({
        severity: 'error',
        message: `Student "${student.name}" references unknown belt "${student.currentBelt}".`,
        entity: student.id,
      });
    }
    if (!Number.isInteger(student.currentStripes) || student.currentStripes < 0) {
      issues.push({
        severity: 'error',
        message: `Student "${student.name}" has an invalid stripe count.`,
        entity: student.id,
      });
    } else {
      const belt = findBelt(state.config, student.currentBelt);
      if (belt && student.currentStripes > belt.maxStripes) {
        issues.push({
          severity: 'warning',
          message: `Student "${student.name}" has ${student.currentStripes} stripes but ${belt.name} belt allows ${belt.maxStripes}.`,
          entity: student.id,
        });
      }
    }
  }

  const studentIds = new Set(state.students.map((student) => student.id));
  for (const id of duplicateIds(state.gradings, (grading) => grading.id)) {
    issues.push({ severity: 'error', message: `Duplicate grading id "${id}".` });
  }
  for (const grading of state.gradings) {
    if (!studentIds.has(grading.studentId)) {
      issues.push({
        severity: 'error',
        message: `Grading "${grading.id}" references unknown student "${grading.studentId}".`,
        entity: grading.id,
      });
    }
    if (!isValidMonthYear(grading.date)) {
      issues.push({
        severity: 'error',
        message: `Grading "${grading.id}" has invalid date "${grading.date}".`,
        entity: grading.id,
      });
    }
    if (grading.type !== 'belt' && grading.type !== 'stripe') {
      issues.push({
        severity: 'error',
        message: `Grading "${grading.id}" has invalid type "${grading.type}".`,
        entity: grading.id,
      });
    }
    if (!beltIds.has(grading.belt)) {
      issues.push({
        severity: 'error',
        message: `Grading "${grading.id}" references unknown belt "${grading.belt}".`,
        entity: grading.id,
      });
    }
    if (!Number.isInteger(grading.stripesAwarded) || grading.stripesAwarded < 0) {
      issues.push({
        severity: 'error',
        message: `Grading "${grading.id}" has an invalid stripe count.`,
        entity: grading.id,
      });
    } else if (grading.type === 'stripe' && grading.stripesAwarded < 1) {
      issues.push({
        severity: 'error',
        message: `Stripe grading "${grading.id}" awards zero stripes.`,
        entity: grading.id,
      });
    } else if (grading.type === 'belt' && grading.stripesAwarded !== 0) {
      issues.push({
        severity: 'warning',
        message: `Belt grading "${grading.id}" has a non-zero stripe count; it is ignored.`,
        entity: grading.id,
      });
    }
  }

  for (const id of duplicateIds(state.checklistItems, (item) => item.id)) {
    issues.push({ severity: 'error', message: `Duplicate checklist item id "${id}".` });
  }
  for (const item of state.checklistItems) {
    if (!beltIds.has(item.belt)) {
      issues.push({
        severity: 'error',
        message: `Checklist item "${item.id}" references unknown belt "${item.belt}".`,
        entity: item.id,
      });
    }
    if (!item.description.trim()) {
      issues.push({
        severity: 'warning',
        message: `Checklist item "${item.id}" has an empty description.`,
        entity: item.id,
      });
    }
  }

  const itemIds = new Set(state.checklistItems.map((item) => item.id));
  const progressKeys = new Set<string>();
  for (const row of state.checklistProgress) {
    const key = `${row.studentId}\u0000${row.checklistItemId}`;
    if (progressKeys.has(key)) {
      issues.push({
        severity: 'warning',
        message: `Duplicate checklist progress row for student "${row.studentId}" and item "${row.checklistItemId}".`,
      });
    }
    progressKeys.add(key);
    if (!studentIds.has(row.studentId)) {
      issues.push({
        severity: 'error',
        message: `Checklist progress references unknown student "${row.studentId}".`,
      });
    }
    if (!itemIds.has(row.checklistItemId)) {
      issues.push({
        severity: 'warning',
        message: `Checklist progress references missing item "${row.checklistItemId}" (kept for safety).`,
      });
    }
  }

  return issues;
}

/** Belt order helper used by UI and import. */
export function beltOrder(state: AppState, beltId: string): number {
  return beltIndex(state.config, beltId);
}

export function sortStudents(students: Student[]): Student[] {
  return [...students].sort((a, b) => a.name.localeCompare(b.name));
}

export function sortGradingsChronologically(gradings: Grading[]): Grading[] {
  return [...gradings].sort((a, b) => {
    const aValid = isValidMonthYear(a.date);
    const bValid = isValidMonthYear(b.date);
    if (aValid && bValid) {
      const dateDiff = compareMonthYear(a.date, b.date);
      if (dateDiff !== 0) return dateDiff;
    } else if (aValid !== bValid) {
      return aValid ? -1 : 1;
    }
    if (a.type !== b.type) return a.type === 'belt' ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}
