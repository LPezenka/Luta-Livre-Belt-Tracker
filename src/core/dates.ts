import type { MonthYear, MonthYearParts } from './models';

export type { MonthYearParts };

/**
 * Month/year handling.
 *
 * The application stores grading dates with month precision only ("MM/YY").
 * Two-digit years are interpreted as 2000-2099. This is deliberate and
 * documented in docs/handoff.md; the app is for current grading activity and
 * four-digit years outside 2000-2099 are rejected rather than silently
 * truncated into an ambiguous two-digit value.
 */

const MONTH_YEAR_RE = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function parseMonthYear(value: string | null | undefined): MonthYearParts | null {
  if (value == null) return null;
  const match = MONTH_YEAR_RE.exec(String(value).trim());
  if (!match) return null;

  const month = Number(match[1]);
  const yearText = match[2];
  let year = Number(yearText);
  if (yearText.length === 2) {
    year += 2000;
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2099) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;

  return { year, month };
}

export function isValidMonthYear(value: string | null | undefined): boolean {
  return parseMonthYear(value) != null;
}

export function formatMonthYear(parts: MonthYearParts): MonthYear {
  return `${pad2(parts.month)}/${pad2(parts.year % 100)}`;
}

export function normalizeMonthYear(value: string | null | undefined): MonthYear | null {
  const parts = parseMonthYear(value);
  return parts ? formatMonthYear(parts) : null;
}

/** Absolute month index used for reliable calendar arithmetic. */
export function monthIndex(value: MonthYear | MonthYearParts): number {
  const parts = typeof value === 'string' ? parseMonthYear(value) : value;
  if (!parts) throw new Error(`Invalid month/year: ${String(value)}`);
  return parts.year * 12 + (parts.month - 1);
}

/** Number of calendar months from `from` to `to` (to - from). */
export function monthsBetween(
  from: MonthYear | MonthYearParts,
  to: MonthYear | MonthYearParts,
): number {
  return monthIndex(to) - monthIndex(from);
}

export function addMonths(value: MonthYear, months: number): MonthYear {
  if (!Number.isInteger(months)) throw new Error('months must be an integer');
  const index = monthIndex(value) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return formatMonthYear({ year, month });
}

export function compareMonthYear(a: MonthYear, b: MonthYear): number {
  return monthIndex(a) - monthIndex(b);
}

/** Local calendar month of a Date. */
export function nowMonthYear(now: Date = new Date()): MonthYear {
  return formatMonthYear({ year: now.getFullYear(), month: now.getMonth() + 1 });
}

/** Value for an <input type="month"> element (YYYY-MM). */
export function monthYearToInputValue(value: MonthYear | null | undefined): string {
  const parts = parseMonthYear(value ?? undefined);
  if (!parts) return '';
  return `${parts.year}-${pad2(parts.month)}`;
}

/** Convert an <input type="month"> value (YYYY-MM) into normalized MM/YY. */
export function inputValueToMonthYear(value: string | null | undefined): MonthYear | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  return normalizeMonthYear(`${Number(match[2])}/${match[1]}`);
}

/** Human-readable month name for the UI (e.g. "May 2025"). */
export function monthYearLabel(value: MonthYear | null | undefined): string {
  const parts = parseMonthYear(value ?? undefined);
  if (!parts) return '—';
  const names = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${names[parts.month - 1]} ${parts.year}`;
}
