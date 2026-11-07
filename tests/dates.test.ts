import { describe, expect, it } from 'vitest';
import {
  addMonths,
  compareMonthYear,
  formatMonthYear,
  inputValueToMonthYear,
  isValidMonthYear,
  monthIndex,
  monthYearLabel,
  monthYearToInputValue,
  monthsBetween,
  normalizeMonthYear,
  nowMonthYear,
  parseMonthYear,
} from '../src/core/dates';

describe('month/year parsing and formatting', () => {
  it('parses MM/YY and normalizes to two-digit month', () => {
    expect(parseMonthYear('05/25')).toEqual({ year: 2025, month: 5 });
    expect(parseMonthYear('11/26')).toEqual({ year: 2026, month: 11 });
    expect(normalizeMonthYear('6/25')).toBe('06/25');
    expect(normalizeMonthYear(' 12 / 26 ')).toBe('12/26');
  });

  it('uses the documented 2000-2099 century convention', () => {
    expect(parseMonthYear('01/00')).toEqual({ year: 2000, month: 1 });
    expect(parseMonthYear('12/99')).toEqual({ year: 2099, month: 12 });
    expect(parseMonthYear('01/1999')).toBeNull();
    expect(parseMonthYear('01/2100')).toBeNull();
  });

  it('rejects invalid months and malformed values', () => {
    expect(isValidMonthYear('00/25')).toBe(false);
    expect(isValidMonthYear('13/25')).toBe(false);
    expect(isValidMonthYear('2025-05')).toBe(false);
    expect(isValidMonthYear('')).toBe(false);
    expect(isValidMonthYear(null)).toBe(false);
  });

  it('formats and labels month/year values', () => {
    expect(formatMonthYear({ year: 2025, month: 5 })).toBe('05/25');
    expect(monthYearLabel('05/25')).toBe('May 2025');
    expect(monthYearLabel(null)).toBe('—');
  });

  it('converts to and from input[type=month] values', () => {
    expect(monthYearToInputValue('05/25')).toBe('2025-05');
    expect(inputValueToMonthYear('2025-05')).toBe('05/25');
    expect(inputValueToMonthYear('bad')).toBeNull();
  });
});

describe('calendar month arithmetic', () => {
  it('uses calendar months, not fixed 30-day durations', () => {
    expect(monthsBetween('05/25', '11/26')).toBe(18);
    expect(monthsBetween('11/26', '05/25')).toBe(-18);
    expect(monthsBetween('12/25', '01/26')).toBe(1);
    expect(monthsBetween('01/26', '01/26')).toBe(0);
  });

  it('adds months across year boundaries', () => {
    expect(addMonths('05/25', 18)).toBe('11/26');
    expect(addMonths('12/25', 1)).toBe('01/26');
    expect(addMonths('01/26', -1)).toBe('12/25');
    expect(addMonths('05/25', 0)).toBe('05/25');
  });

  it('compares values by absolute month index', () => {
    expect(monthIndex('01/26')).toBeGreaterThan(monthIndex('12/25'));
    expect(compareMonthYear('05/25', '11/26')).toBeLessThan(0);
    expect(compareMonthYear('11/26', '11/26')).toBe(0);
  });

  it('derives the current month/year locally', () => {
    expect(nowMonthYear(new Date(2026, 10, 7))).toBe('11/26');
    expect(nowMonthYear(new Date(2026, 0, 1))).toBe('01/26');
  });
});
