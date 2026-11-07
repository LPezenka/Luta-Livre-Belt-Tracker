import { parseCsv } from './csv';
import { findBelt, defaultConfig } from './config';
import { compareMonthYear, normalizeMonthYear, nowMonthYear } from './dates';
import { collapseWhitespace, nextId, normalizeNameKey } from './ids';
import type {
  AppConfig,
  AppState,
  Grading,
  MonthYear,
  Student,
} from './models';
import { emptyState } from './state';

export interface LegacyImportIssue {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  studentName?: string;
  row?: number;
}

export interface LegacyBeltGroup {
  beltId: string;
  beltName: string;
  startColumn: number;
  width: number;
}

export interface LegacyImportReport {
  sourceName: string;
  importedAt: string;
  monthYear: MonthYear;
  beltGroups: LegacyBeltGroup[];
  studentCount: number;
  gradingEventCount: number;
  skippedRows: number;
  mergedNames: Array<{ name: string; belts: string[]; rows: number[] }>;
  issues: LegacyImportIssue[];
}

export interface LegacyImportResult {
  state: AppState;
  report: LegacyImportReport;
}

interface LegacyRow {
  name: string;
  nameKey: string;
  beltId: string;
  rowNumber: number;
  beltDate: MonthYear | null;
  beltDateRaw: string;
  stripes: Array<{ index: number; date: MonthYear }>;
}

interface LegacyStudentGroup {
  name: string;
  nameKey: string;
  rows: LegacyRow[];
}

function matchBelt(config: AppConfig, raw: string) {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  return (
    config.belts.find(
      (belt) => belt.id.toLowerCase() === value || belt.name.trim().toLowerCase() === value,
    ) ?? null
  );
}

function addIssue(
  issues: LegacyImportIssue[],
  severity: LegacyImportIssue['severity'],
  code: string,
  message: string,
  extra: { studentName?: string; row?: number } = {},
): void {
  issues.push({ severity, code, message, ...extra });
}

/**
 * Import the original spreadsheet-style CSV.
 *
 * Column 0 of each belt group is the belt-award date; columns 1..n are stripe
 * dates. People appear on multiple belt rows and are merged by normalized name.
 * No dates are invented. When a stripe column is filled but an earlier stripe
 * column is empty, the known date is used for the implied stripes and the gap is
 * reported for manual review.
 */
export function importLegacyCsv(
  text: string,
  config: AppConfig = defaultConfig(),
  options: { sourceName?: string; now?: Date } = {},
): LegacyImportResult {
  const now = nowMonthYear(options.now ?? new Date());
  const sourceName = options.sourceName ?? 'legacy.csv';
  const issues: LegacyImportIssue[] = [];
  const rows = parseCsv(text);

  const state = emptyState();
  state.config = JSON.parse(JSON.stringify(config)) as AppConfig;
  state.students = [];
  state.gradings = [];
  state.checklistItems = [];
  state.checklistProgress = [];

  const nameRowIndex = rows.findIndex((row) =>
    row.some((cell) => cell.trim().toLowerCase() === 'name'),
  );
  if (nameRowIndex < 0) {
    addIssue(
      issues,
      'error',
      'no-name-header',
      'Could not find the "Name" header row. The file was not imported.',
    );
    return {
      state,
      report: buildReport(sourceName, now, [], 0, 0, 0, [], issues),
    };
  }

  let beltHeaderIndex = -1;
  let bestMatches = 0;
  for (let i = 0; i < nameRowIndex; i += 1) {
    const matches = rows[i].filter((cell) => matchBelt(config, cell)).length;
    if (matches > bestMatches) {
      bestMatches = matches;
      beltHeaderIndex = i;
    }
  }

  if (beltHeaderIndex < 0 || bestMatches < 2) {
    addIssue(
      issues,
      'error',
      'no-belt-header',
      'Could not find the belt header row (expected belt names such as White, Yellow, Orange...). The file was not imported.',
    );
    return {
      state,
      report: buildReport(sourceName, now, [], 0, 0, 0, [], issues),
    };
  }

  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const starts: Array<{ beltId: string; beltName: string; startColumn: number }> = [];
  rows[beltHeaderIndex].forEach((cell, column) => {
    const belt = matchBelt(config, cell);
    if (belt) {
      starts.push({ beltId: belt.id, beltName: belt.name, startColumn: column });
    }
  });
  starts.sort((a, b) => a.startColumn - b.startColumn);

  const groups: LegacyBeltGroup[] = starts.map((entry, index) => {
    const nextStart = starts[index + 1]?.startColumn ?? maxColumns;
    return {
      beltId: entry.beltId,
      beltName: entry.beltName,
      startColumn: entry.startColumn,
      width: Math.max(1, nextStart - entry.startColumn),
    };
  });

  for (const belt of config.belts) {
    if (!groups.some((group) => group.beltId === belt.id)) {
      addIssue(
        issues,
        'warning',
        'belt-column-missing',
        `No column group was found for ${belt.name} belt in the legacy file.`,
      );
    }
  }

  const legacyRows: LegacyRow[] = [];
  let skippedRows = 0;

  for (let i = nameRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    const name = collapseWhitespace(row[0] ?? '');
    if (!name) continue;
    const rowNumber = i + 1;
    const beltRaw = (row[1] ?? '').trim();
    const belt = matchBelt(config, beltRaw);

    if (!beltRaw) {
      skippedRows += 1;
      addIssue(
        issues,
        'error',
        'missing-belt',
        `Row ${rowNumber} for "${name}" has no current belt; row skipped.`,
        { studentName: name, row: rowNumber },
      );
      continue;
    }
    if (!belt) {
      skippedRows += 1;
      addIssue(
        issues,
        'error',
        'unknown-belt',
        `Row ${rowNumber} for "${name}" has unknown belt "${beltRaw}"; row skipped.`,
        { studentName: name, row: rowNumber },
      );
      continue;
    }

    const group = groups.find((entry) => entry.beltId === belt.id);
    if (!group) {
      skippedRows += 1;
      addIssue(
        issues,
        'error',
        'missing-group',
        `Row ${rowNumber} for "${name}" uses ${belt.name} belt, but no ${belt.name} date columns were found; row skipped.`,
        { studentName: name, row: rowNumber },
      );
      continue;
    }

    const beltDateRaw = (row[group.startColumn] ?? '').trim();
    const beltDate = beltDateRaw ? normalizeMonthYear(beltDateRaw) : null;
    if (beltDateRaw && !beltDate) {
      addIssue(
        issues,
        'error',
        'invalid-belt-date',
        `Row ${rowNumber} for "${name}" (${belt.name}) has invalid belt date "${beltDateRaw}". It was not imported; the original value is preserved in the source file.`,
        { studentName: name, row: rowNumber },
      );
    } else if (beltDate && compareMonthYear(beltDate, now) > 0) {
      addIssue(
        issues,
        'warning',
        'future-belt-date',
        `Row ${rowNumber} for "${name}" (${belt.name}) has a future belt date ${beltDate}.`,
        { studentName: name, row: rowNumber },
      );
    }

    const stripes: Array<{ index: number; date: MonthYear }> = [];
    for (let stripeIndex = 1; stripeIndex < group.width; stripeIndex += 1) {
      const column = group.startColumn + stripeIndex;
      const raw = (row[column] ?? '').trim();
      if (!raw) continue;
      const date = normalizeMonthYear(raw);
      if (!date) {
        addIssue(
          issues,
          'error',
          'invalid-stripe-date',
          `Row ${rowNumber} for "${name}" (${belt.name}, stripe column ${stripeIndex}) has invalid date "${raw}". It was not imported; the original value is preserved in the source file.`,
          { studentName: name, row: rowNumber },
        );
        continue;
      }
      if (compareMonthYear(date, now) > 0) {
        addIssue(
          issues,
          'warning',
          'future-stripe-date',
          `Row ${rowNumber} for "${name}" (${belt.name}, stripe ${stripeIndex}) has a future date ${date}.`,
          { studentName: name, row: rowNumber },
        );
      }
      if (beltDate && compareMonthYear(date, beltDate) < 0) {
        addIssue(
          issues,
          'warning',
          'stripe-before-belt',
          `Row ${rowNumber} for "${name}" (${belt.name}) has stripe ${stripeIndex} dated ${date}, before the belt-award date ${beltDate}.`,
          { studentName: name, row: rowNumber },
        );
      }
      stripes.push({ index: stripeIndex, date });
    }

    if (!beltDate && stripes.length === 0) {
      addIssue(
        issues,
        'warning',
        'no-dates',
        `Row ${rowNumber} for "${name}" (${belt.name}) has no belt or stripe dates. Tenure for this belt is unknown.`,
        { studentName: name, row: rowNumber },
      );
    } else if (!beltDate && stripes.length > 0) {
      addIssue(
        issues,
        'warning',
        'missing-belt-date',
        `Row ${rowNumber} for "${name}" (${belt.name}) has no belt-award date. The earliest stripe date ${stripes[0].date} will be used only as a provisional start; no belt event is invented.`,
        { studentName: name, row: rowNumber },
      );
    }

    legacyRows.push({
      name,
      nameKey: normalizeNameKey(name),
      beltId: belt.id,
      rowNumber,
      beltDate,
      beltDateRaw,
      stripes: stripes.sort((a, b) => a.index - b.index),
    });
  }

  // Merge rows by normalized name.
  const byName = new Map<string, LegacyStudentGroup>();
  for (const row of legacyRows) {
    const existing = byName.get(row.nameKey);
    if (existing) {
      existing.rows.push(row);
    } else {
      byName.set(row.nameKey, { name: row.name, nameKey: row.nameKey, rows: [row] });
    }
  }

  const mergedNames: LegacyImportReport['mergedNames'] = [];
  const students: Student[] = [];
  const gradings: Grading[] = [];

  for (const group of byName.values()) {
    const beltNamesInOrder = [...group.rows]
      .sort(
        (a, b) =>
          config.belts.findIndex((belt) => belt.id === a.beltId) -
          config.belts.findIndex((belt) => belt.id === b.beltId),
      )
      .map((row) => row.beltId);

    if (group.rows.length > 1) {
      mergedNames.push({
        name: group.name,
        belts: beltNamesInOrder,
        rows: group.rows.map((row) => row.rowNumber),
      });
      addIssue(
        issues,
        'warning',
        'merged-name',
        `Name "${group.name}" appears on ${group.rows.length} belt rows (${beltNamesInOrder
          .map((beltId) => findBelt(config, beltId)?.name ?? beltId)
          .join(', ')}). They were assumed to be the same student. Verify identity.`,
        { studentName: group.name },
      );
    }

    const duplicateBelts = beltNamesInOrder.filter(
      (beltId, index) => beltNamesInOrder.indexOf(beltId) !== index,
    );
    for (const beltId of new Set(duplicateBelts)) {
      addIssue(
        issues,
        'warning',
        'duplicate-belt-row',
        `Student "${group.name}" has more than one row for ${findBelt(config, beltId)?.name ?? beltId} belt. Both histories were kept.`,
        { studentName: group.name },
      );
    }

    const sortedRows = [...group.rows].sort(
      (a, b) =>
        config.belts.findIndex((belt) => belt.id === a.beltId) -
        config.belts.findIndex((belt) => belt.id === b.beltId),
    );
    const currentRow = sortedRows[sortedRows.length - 1];
    const currentStripeIndex =
      currentRow.stripes.length > 0
        ? Math.max(...currentRow.stripes.map((stripe) => stripe.index))
        : 0;

    const student: Student = {
      id: nextId('s', students.map((entry) => entry.id)),
      name: group.name,
      currentBelt: currentRow.beltId,
      currentStripes: currentStripeIndex,
    };
    students.push(student);

    const studentEvents: Array<{ grading: Omit<Grading, 'id'>; order: number }> = [];
    let eventOrder = 0;

    for (const row of sortedRows) {
      const belt = findBelt(config, row.beltId);
      if (row.beltDate) {
        studentEvents.push({
          grading: {
            studentId: student.id,
            date: row.beltDate,
            type: 'belt',
            belt: row.beltId,
            stripesAwarded: 0,
          },
          order: eventOrder++,
        });
      }

      let previousStripe = 0;
      for (const stripe of row.stripes) {
        const awarded = stripe.index - previousStripe;
        if (awarded > 1) {
          addIssue(
            issues,
            'warning',
            'stripe-gap',
            `Student "${group.name}" (${belt?.name ?? row.beltId}) is missing a recorded date for stripe ${
              previousStripe + 1
            }${awarded > 2 ? `-${stripe.index - 1}` : ''}. ${awarded} stripes are attributed to the known date ${stripe.date}; this is the only non-invented interpretation. Verify manually.`,
            { studentName: group.name, row: row.rowNumber },
          );
        }
        if (belt && stripe.index > belt.maxStripes) {
          addIssue(
            issues,
            'warning',
            'stripe-over-max',
            `Student "${group.name}" has stripe ${stripe.index} recorded for ${belt.name} belt, but the configured maximum is ${belt.maxStripes}. The history was preserved; adjust the configuration or correct the record.`,
            { studentName: group.name, row: row.rowNumber },
          );
        }
        studentEvents.push({
          grading: {
            studentId: student.id,
            date: stripe.date,
            type: 'stripe',
            belt: row.beltId,
            stripesAwarded: awarded,
          },
          order: eventOrder++,
        });
        previousStripe = stripe.index;
      }
    }

    // Chronological history; belt awards precede stripes on the same date.
    studentEvents.sort((a, b) => {
      const dateDiff = compareMonthYear(a.grading.date, b.grading.date);
      if (dateDiff !== 0) return dateDiff;
      if (a.grading.type !== b.grading.type) {
        return a.grading.type === 'belt' ? -1 : 1;
      }
      return a.order - b.order;
    });

    for (const entry of studentEvents) {
      gradings.push({
        id: nextId('g', gradings.map((grading) => grading.id)),
        ...entry.grading,
      });
    }
  }

  state.students = students;
  state.gradings = gradings;

  const report = buildReport(
    sourceName,
    now,
    groups,
    students.length,
    gradings.length,
    skippedRows,
    mergedNames,
    issues,
  );

  return { state, report };
}

function buildReport(
  sourceName: string,
  monthYear: MonthYear,
  beltGroups: LegacyBeltGroup[],
  studentCount: number,
  gradingEventCount: number,
  skippedRows: number,
  mergedNames: LegacyImportReport['mergedNames'],
  issues: LegacyImportIssue[],
): LegacyImportReport {
  return {
    sourceName,
    importedAt: new Date().toISOString(),
    monthYear,
    beltGroups,
    studentCount,
    gradingEventCount,
    skippedRows,
    mergedNames,
    issues,
  };
}
