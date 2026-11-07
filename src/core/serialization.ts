import {
  booleanFromCsv,
  booleanToCsv,
  columnReader,
  parseCsvTable,
  serializeCsv,
} from './csv';
import { defaultConfig, parseConfigJson, serializeConfig, beltIndex } from './config';
import { normalizeMonthYear } from './dates';
import type {
  AppState,
  ChecklistItem,
  ChecklistProgress,
  FileMap,
  Grading,
  GradingType,
  Student,
  ValidationIssue,
} from './models';
import { recomputeAllStudents } from './grading';
import { emptyState } from './state';

function issue(
  severity: 'error' | 'warning',
  message: string,
): ValidationIssue {
  return { severity, message };
}

function parseInteger(value: string, fallback = 0): number {
  if (value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : Number.NaN;
}

export function parseStudentsCsv(text: string): { students: Student[]; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const table = parseCsvTable(text);
  if (table.rows.length === 0) return { students: [], issues };
  const read = columnReader(table);
  const students: Student[] = [];

  table.rows.forEach((row, index) => {
    const id = read(row, 'id', 0);
    if (!id) {
      // Ignore completely blank lines, but report a row with content and no id.
      if (row.some((cell) => cell.trim() !== '')) {
        issues.push(issue('error', `students.csv row ${index + 2} has no id; row ignored.`));
      }
      return;
    }
    const name = read(row, 'name', 1);
    const currentBelt = read(row, 'current_belt', 2);
    const currentStripes = parseInteger(read(row, 'current_stripes', 3), 0);
    students.push({
      id,
      name,
      currentBelt,
      currentStripes,
    });
  });

  return { students, issues };
}

export function parseGradingsCsv(text: string): { gradings: Grading[]; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const table = parseCsvTable(text);
  if (table.rows.length === 0) return { gradings: [], issues };
  const read = columnReader(table);
  const gradings: Grading[] = [];

  table.rows.forEach((row, index) => {
    const id = read(row, 'id', 0);
    if (!id) {
      if (row.some((cell) => cell.trim() !== '')) {
        issues.push(issue('error', `gradings.csv row ${index + 2} has no id; row ignored.`));
      }
      return;
    }
    const dateRaw = read(row, 'date', 2);
    const normalizedDate = normalizeMonthYear(dateRaw);
    if (!normalizedDate) {
      issues.push(
        issue(
          'error',
          `Grading "${id}" has invalid date "${dateRaw}". The row is retained for correction and excluded from eligibility calculations.`,
        ),
      );
    }
    const date = normalizedDate ?? dateRaw;
    const type = read(row, 'type', 3) as GradingType;
    gradings.push({
      id,
      studentId: read(row, 'student_id', 1),
      date,
      type,
      belt: read(row, 'belt', 4),
      stripesAwarded: parseInteger(read(row, 'stripes_awarded', 5), 0),
    });
  });

  return { gradings, issues };
}

export function parseChecklistsCsv(text: string): {
  items: ChecklistItem[];
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const table = parseCsvTable(text);
  if (table.rows.length === 0) return { items: [], issues };
  const read = columnReader(table);
  const items: ChecklistItem[] = [];

  table.rows.forEach((row, index) => {
    const id = read(row, 'id', 0);
    if (!id) {
      if (row.some((cell) => cell.trim() !== '')) {
        issues.push(issue('error', `checklists.csv row ${index + 2} has no id; row ignored.`));
      }
      return;
    }
    items.push({
      id,
      belt: read(row, 'belt', 1),
      sortOrder: parseInteger(read(row, 'sort_order', 2), index + 1),
      description: read(row, 'description', 3),
      archived: booleanFromCsv(read(row, 'archived', 4)),
    });
  });

  return { items, issues };
}

export function parseChecklistProgressCsv(text: string): {
  progress: ChecklistProgress[];
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const table = parseCsvTable(text);
  if (table.rows.length === 0) return { progress: [], issues };
  const read = columnReader(table);
  const progress: ChecklistProgress[] = [];

  table.rows.forEach((row, index) => {
    const studentId = read(row, 'student_id', 0);
    const itemId = read(row, 'checklist_item_id', 1);
    if (!studentId || !itemId) {
      if (row.some((cell) => cell.trim() !== '')) {
        issues.push(
          issue('error', `checklist_progress.csv row ${index + 2} is missing an id; row ignored.`),
        );
      }
      return;
    }
    progress.push({
      studentId,
      checklistItemId: itemId,
      completed: booleanFromCsv(read(row, 'completed', 2)),
    });
  });

  return { progress, issues };
}

export interface ParseStateResult {
  state: AppState;
  issues: ValidationIssue[];
}

/**
 * Parse the canonical file set. Missing optional files are treated as empty;
 * a missing config falls back to the default configuration.
 */
export function parseStateFiles(files: FileMap): ParseStateResult {
  const issues: ValidationIssue[] = [];

  let config = defaultConfig();
  if (files['config.json'] != null && files['config.json'].trim() !== '') {
    const parsed = parseConfigJson(files['config.json']);
    config = parsed.config;
    issues.push(...parsed.errors.map((message) => issue('error', message)));
  } else {
    issues.push(issue('warning', 'config.json is missing or empty; default belts were loaded.'));
  }

  const students = files['students.csv'] != null
    ? parseStudentsCsv(files['students.csv'])
    : { students: [], issues: [] as ValidationIssue[] };
  const gradings = files['gradings.csv'] != null
    ? parseGradingsCsv(files['gradings.csv'])
    : { gradings: [], issues: [] as ValidationIssue[] };
  const checklists = files['checklists.csv'] != null
    ? parseChecklistsCsv(files['checklists.csv'])
    : { items: [], issues: [] as ValidationIssue[] };
  const progress = files['checklist_progress.csv'] != null
    ? parseChecklistProgressCsv(files['checklist_progress.csv'])
    : { progress: [], issues: [] as ValidationIssue[] };

  issues.push(...students.issues, ...gradings.issues, ...checklists.issues, ...progress.issues);

  if (files['students.csv'] == null) {
    issues.push(issue('warning', 'students.csv is missing; starting with no students.'));
  }

  const state: AppState = {
    config,
    students: students.students,
    gradings: gradings.gradings,
    checklistItems: checklists.items,
    checklistProgress: progress.progress,
  };

  // Detect and repair cached current-state drift from grading history.
  const reconciled = recomputeAllStudents(state);
  state.students.forEach((original, index) => {
    const updated = reconciled.students[index];
    if (
      updated &&
      (updated.currentBelt !== original.currentBelt ||
        updated.currentStripes !== original.currentStripes)
    ) {
      issues.push(
        issue(
          'warning',
          `Cached state for ${original.name || original.id} was corrected from grading history (${original.currentBelt} ${original.currentStripes} → ${updated.currentBelt} ${updated.currentStripes}).`,
        ),
      );
    }
  });

  return { state: reconciled, issues };
}

export function serializeState(state: AppState): FileMap {
  const beltOrder = (beltId: string) => {
    const index = beltIndex(state.config, beltId);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };

  const students = [...state.students].sort((a, b) => a.id.localeCompare(b.id));
  const studentsCsv = serializeCsv([
    ['id', 'name', 'current_belt', 'current_stripes'],
    ...students.map((student) => [
      student.id,
      student.name,
      student.currentBelt,
      student.currentStripes,
    ]),
  ]);

  const gradingsCsv = serializeCsv([
    ['id', 'student_id', 'date', 'type', 'belt', 'stripes_awarded'],
    ...state.gradings.map((grading) => [
      grading.id,
      grading.studentId,
      grading.date,
      grading.type,
      grading.belt,
      grading.stripesAwarded,
    ]),
  ]);

  const checklists = [...state.checklistItems].sort(
    (a, b) =>
      beltOrder(a.belt) - beltOrder(b.belt) ||
      a.sortOrder - b.sortOrder ||
      a.id.localeCompare(b.id),
  );
  const checklistsCsv = serializeCsv([
    ['id', 'belt', 'sort_order', 'description', 'archived'],
    ...checklists.map((item) => [
      item.id,
      item.belt,
      item.sortOrder,
      item.description,
      booleanToCsv(item.archived),
    ]),
  ]);

  const progress = [...state.checklistProgress].sort(
    (a, b) =>
      a.studentId.localeCompare(b.studentId) ||
      a.checklistItemId.localeCompare(b.checklistItemId),
  );
  const progressCsv = serializeCsv([
    ['student_id', 'checklist_item_id', 'completed'],
    ...progress.map((row) => [
      row.studentId,
      row.checklistItemId,
      booleanToCsv(row.completed),
    ]),
  ]);

  return {
    'students.csv': studentsCsv,
    'gradings.csv': gradingsCsv,
    'checklists.csv': checklistsCsv,
    'checklist_progress.csv': progressCsv,
    'config.json': serializeConfig(state.config),
  };
}

export function emptyFileSet(): FileMap {
  return serializeState(emptyState());
}
