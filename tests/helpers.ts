import { defaultConfig } from '../src/core/config';
import type {
  AppConfig,
  AppState,
  ChecklistItem,
  ChecklistProgress,
  Grading,
  Student,
} from '../src/core/models';
import { emptyState } from '../src/core/state';

export function makeState(overrides: Partial<AppState> = {}): AppState {
  const base = emptyState();
  return {
    config: overrides.config ?? base.config,
    students: overrides.students ?? [],
    gradings: overrides.gradings ?? [],
    checklistItems: overrides.checklistItems ?? [],
    checklistProgress: overrides.checklistProgress ?? [],
  };
}

export function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: 's001',
    name: 'Test Student',
    currentBelt: 'white',
    currentStripes: 0,
    ...overrides,
  };
}

export function makeGrading(overrides: Partial<Grading> = {}): Grading {
  return {
    id: 'g001',
    studentId: 's001',
    date: '01/26',
    type: 'belt',
    belt: 'white',
    stripesAwarded: 0,
    ...overrides,
  };
}

export function makeChecklistItem(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id: 'c001',
    belt: 'blue',
    sortOrder: 1,
    description: 'Guard retention',
    archived: false,
    ...overrides,
  };
}

export function makeProgress(overrides: Partial<ChecklistProgress> = {}): ChecklistProgress {
  return {
    studentId: 's001',
    checklistItemId: 'c001',
    completed: true,
    ...overrides,
  };
}

export function configWithMinMonths(minMonths: number): AppConfig {
  const config = defaultConfig();
  const orange = config.belts.find((belt) => belt.id === 'orange');
  if (orange) orange.minMonthsToNextBelt = minMonths;
  return config;
}
