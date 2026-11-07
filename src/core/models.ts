/**
 * Shared data model for the Luta Belt Tracker.
 *
 * The same types are used by the PWA, the Electron renderer, the Electron
 * main-process data store and the test suite.
 */

export type MonthYear = string; // Normalized "MM/YY" (century convention: 2000-2099)

export interface MonthYearParts {
  year: number;
  month: number;
}

export type GradingType = 'belt' | 'stripe';

export interface Belt {
  id: string;
  name: string;
  maxStripes: number;
  minMonthsToNextBelt: number;
}

export interface AppConfig {
  belts: Belt[];
  upcomingEligibilityMonths: number;
}

export interface Student {
  id: string;
  name: string;
  currentBelt: string;
  currentStripes: number;
}

export interface Grading {
  id: string;
  studentId: string;
  /** Normalized MM/YY */
  date: MonthYear;
  type: GradingType;
  belt: string;
  /** For stripe awards: number of stripes awarded in this single event. */
  stripesAwarded: number;
}

export interface ChecklistItem {
  id: string;
  /** Belt being awarded (not necessarily the student's current belt). */
  belt: string;
  sortOrder: number;
  description: string;
  /** Archived items stay in the CSV so historical completion data is retained. */
  archived: boolean;
}

export interface ChecklistProgress {
  studentId: string;
  checklistItemId: string;
  completed: boolean;
}

export interface AppState {
  config: AppConfig;
  students: Student[];
  gradings: Grading[];
  checklistItems: ChecklistItem[];
  checklistProgress: ChecklistProgress[];
}

export type FileName =
  | 'students.csv'
  | 'gradings.csv'
  | 'checklists.csv'
  | 'checklist_progress.csv'
  | 'config.json';

export type FileMap = Record<string, string>;

export const FILE_NAMES: FileName[] = [
  'students.csv',
  'gradings.csv',
  'checklists.csv',
  'checklist_progress.csv',
  'config.json',
];

export const WHITE_BELT_ID = 'white';

export type EligibilityStatus =
  | 'eligible'
  | 'upcoming'
  | 'not-eligible'
  | 'unknown'
  | 'highest';

export interface EligibilityInfo {
  studentId: string;
  currentBelt: Belt | null;
  nextBelt: Belt | null;
  currentStripes: number;
  maxStripes: number;
  /** Actual belt-award date or provisional earliest stripe date. */
  beltSince: MonthYear | null;
  beltSinceProvisional: boolean;
  /** Earliest stripe date used for a provisional start, if any. */
  provisionalFromStripe: boolean;
  monthsAtBelt: number | null;
  minMonthsToNextBelt: number | null;
  earliestEligibility: MonthYear | null;
  monthsRemaining: number | null;
  status: EligibilityStatus;
  futureBeltDate: boolean;
  warnings: string[];
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
  entity?: string;
}

export type MutationResult =
  | { ok: true; state: AppState; message?: string; warning?: string }
  | { ok: false; error: string };
