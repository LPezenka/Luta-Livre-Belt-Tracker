import { computed, reactive, ref } from 'vue';
import { beltDistribution as computeBeltDistribution, computeAllEligibility, computeEligibility, summarizeEligibility } from '../core/eligibility';
import { compareMonthYear, isValidMonthYear, nowMonthYear } from '../core/dates';
import { importLegacyCsv, type LegacyImportReport } from '../core/legacyImport';
import type {
  AppState,
  EligibilityInfo,
  FileMap,
  MutationResult,
  Student,
  ValidationIssue,
} from '../core/models';
import { parseStateFiles, serializeState } from '../core/serialization';
import { emptyState, sortStudents, validateState } from '../core/state';
import * as grading from '../core/grading';
import * as checklists from '../core/checklists';
import * as configActions from '../core/configActions';
import type { BeltPatch } from '../core/configActions';
import { browserStorage } from './storage/browser';
import { electronStorage } from './storage/electron';
import type {
  BackupInfo,
  LoadedData,
  StorageAdapter,
  StorageCapabilities,
} from './storage/types';

export type SaveState = 'loading' | 'saved' | 'unsaved' | 'saving' | 'error';

const state = reactive<AppState>(emptyState());
const status = ref<SaveState>('loading');
const statusMessage = ref('Loading data…');
const sourceLabel = ref('');
const capabilities = ref<StorageCapabilities>(browserStorage.capabilities());
const issues = ref<ValidationIssue[]>([]);
const errorMessage = ref('');
const lastMessage = ref('');
const lastWarning = ref('');
const lastSavedAt = ref<string | null>(null);
const backups = ref<BackupInfo[]>([]);
const busy = ref(false);
const initialized = ref(false);
const now = ref(nowMonthYear());
const importReport = ref<LegacyImportReport | null>(null);
const platform = ref<'electron' | 'pwa'>('pwa');

let activeAdapter: StorageAdapter = browserStorage;
let initPromise: Promise<void> | null = null;

function plainState(): AppState {
  return JSON.parse(JSON.stringify(state)) as AppState;
}

function setState(next: AppState): void {
  state.config = next.config;
  state.students = next.students;
  state.gradings = next.gradings;
  state.checklistItems = next.checklistItems;
  state.checklistProgress = next.checklistProgress;
}

function statusForCapabilities(caps: StorageCapabilities): { state: SaveState; message: string } {
  if (caps.autoSave) {
    return { state: 'saved', message: 'Saved to CSV files' };
  }
  return {
    state: 'unsaved',
    message: 'Browser working copy — not saved to CSV files. Export regularly.',
  };
}

async function refreshBackups(): Promise<void> {
  if (!activeAdapter.listBackups) {
    backups.value = [];
    return;
  }
  try {
    backups.value = await activeAdapter.listBackups();
  } catch {
    backups.value = [];
  }
}

function applyLoaded(loaded: LoadedData): void {
  const parsed = parseStateFiles(loaded.files);
  setState(parsed.state);
  const extra: ValidationIssue[] = (loaded.warnings ?? []).map((message) => ({
    severity: 'warning',
    message,
  }));
  issues.value = [...parsed.issues, ...extra, ...validateState(parsed.state)];
  sourceLabel.value = loaded.sourceLabel;
  capabilities.value = loaded.capabilities ?? activeAdapter.capabilities();
  const nextStatus = statusForCapabilities(capabilities.value);
  status.value = nextStatus.state;
  statusMessage.value = nextStatus.message;
  lastSavedAt.value = capabilities.value.autoSave ? new Date().toISOString() : null;
  errorMessage.value = '';
  if (loaded.seeded) {
    lastMessage.value = 'Started from the bundled normalized data set.';
  }
  if (loaded.recovery && typeof loaded.recovery === 'object') {
    const recovery = loaded.recovery as { recovered?: boolean; error?: string };
    if (recovery.recovered) {
      lastWarning.value =
        'Recovered an interrupted save from the transaction journal. Please review the data.';
    } else if (recovery.error) {
      lastWarning.value = `A transaction journal could not be replayed: ${recovery.error}`;
    }
  }
  initialized.value = true;
  void refreshBackups();
}

async function doInit(): Promise<void> {
  platform.value = window.vca?.isElectron ? 'electron' : 'pwa';
  activeAdapter = platform.value === 'electron' ? electronStorage : browserStorage;
  status.value = 'loading';
  statusMessage.value = 'Loading data…';
  try {
    const loaded = await activeAdapter.load();
    applyLoaded(loaded);
  } catch (error) {
    status.value = 'error';
    statusMessage.value = `Could not load data: ${(error as Error).message}`;
    errorMessage.value = statusMessage.value;
    initialized.value = true;
  }
  now.value = nowMonthYear();
}

export function initStore(): Promise<void> {
  if (!initPromise) initPromise = doInit();
  return initPromise;
}

async function commit(
  next: AppState,
  message?: string,
  warning?: string,
): Promise<boolean> {
  const errors = validateState(next).filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    status.value = 'error';
    statusMessage.value = `Validation failed: ${errors[0].message}`;
    errorMessage.value = statusMessage.value;
    return false;
  }

  status.value = 'saving';
  statusMessage.value = 'Saving…';
  try {
    const files = serializeState(next);
    await activeAdapter.save(files);
    setState(next);
    issues.value = validateState(next);
    capabilities.value = activeAdapter.capabilities();
    const nextStatus = statusForCapabilities(capabilities.value);
    status.value = nextStatus.state;
    statusMessage.value = nextStatus.message;
    lastSavedAt.value = capabilities.value.autoSave ? new Date().toISOString() : null;
    lastMessage.value = message ?? 'Saved.';
    lastWarning.value = warning ?? '';
    errorMessage.value = '';
    void refreshBackups();
    return true;
  } catch (error) {
    status.value = 'error';
    statusMessage.value = `Save failed: ${(error as Error).message}. Changes were NOT saved.`;
    errorMessage.value = statusMessage.value;
    return false;
  }
}

async function mutate(
  action: (draft: AppState) => MutationResult,
  successMessage?: string,
): Promise<MutationResult> {
  if (busy.value) {
    return { ok: false, error: 'Another change is being saved. Please wait.' };
  }
  busy.value = true;
  try {
    const result = action(plainState());
    if (!result.ok) {
      errorMessage.value = result.error;
      statusMessage.value = result.error;
      return result;
    }
    const saved = await commit(
      result.state,
      result.message ?? successMessage,
      result.warning,
    );
    if (!saved) {
      return { ok: false, error: errorMessage.value };
    }
    return result;
  } finally {
    busy.value = false;
  }
}

export async function retryLoad(): Promise<void> {
  initPromise = null;
  await initStore();
}

export async function reloadFromDisk(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const loaded = await activeAdapter.load();
    applyLoaded(loaded);
  } catch (error) {
    status.value = 'error';
    statusMessage.value = `Could not reload: ${(error as Error).message}`;
    errorMessage.value = statusMessage.value;
  } finally {
    busy.value = false;
  }
}

export async function saveNow(): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  try {
    return await commit(plainState(), 'Saved.');
  } finally {
    busy.value = false;
  }
}

/* ------------------------------ actions ------------------------------ */

export function addStudent(name: string): Promise<MutationResult> {
  return mutate((draft) => grading.addStudent(draft, name));
}

export function renameStudent(studentId: string, name: string): Promise<MutationResult> {
  return mutate((draft) => grading.renameStudent(draft, studentId, name));
}

export function awardStripes(
  studentId: string,
  count: number,
  date: string,
): Promise<MutationResult> {
  return mutate((draft) => grading.awardStripes(draft, studentId, count, date));
}

export function promoteStudent(studentId: string, date: string): Promise<MutationResult> {
  return mutate((draft) => grading.promoteStudent(draft, studentId, date));
}

export function recordBeltAwardDate(
  studentId: string,
  date: string,
): Promise<MutationResult> {
  return mutate((draft) => grading.recordBeltAwardDate(draft, studentId, date));
}

export function updateGradingDate(
  gradingId: string,
  date: string,
): Promise<MutationResult> {
  return mutate((draft) => grading.updateGradingDate(draft, gradingId, date));
}

export function deleteGrading(gradingId: string): Promise<MutationResult> {
  return mutate((draft) => grading.deleteGrading(draft, gradingId));
}

export function setChecklistProgress(
  studentId: string,
  itemId: string,
  completed: boolean,
): Promise<MutationResult> {
  return mutate((draft) =>
    checklists.setChecklistProgress(draft, studentId, itemId, completed),
  );
}

export function addChecklistItem(
  beltId: string,
  description: string,
): Promise<MutationResult> {
  return mutate((draft) => checklists.addChecklistItem(draft, beltId, description));
}

export function updateChecklistItem(
  itemId: string,
  description: string,
): Promise<MutationResult> {
  return mutate((draft) => checklists.updateChecklistItem(draft, itemId, description));
}

export function setChecklistItemArchived(
  itemId: string,
  archived: boolean,
): Promise<MutationResult> {
  return mutate((draft) =>
    checklists.setChecklistItemArchived(draft, itemId, archived),
  );
}

export function deleteChecklistItem(itemId: string): Promise<MutationResult> {
  return mutate((draft) => checklists.deleteChecklistItem(draft, itemId));
}

export function reorderChecklistItem(
  itemId: string,
  direction: 'up' | 'down',
): Promise<MutationResult> {
  return mutate((draft) => checklists.reorderChecklistItem(draft, itemId, direction));
}

export function updateBeltConfig(
  beltId: string,
  patch: BeltPatch,
): Promise<MutationResult> {
  return mutate((draft) => configActions.updateBeltConfig(draft, beltId, patch));
}

export function renameBeltId(
  oldId: string,
  newId: string,
): Promise<MutationResult> {
  return mutate((draft) => configActions.renameBeltId(draft, oldId, newId));
}

export function addBelt(input: {
  id: string;
  name: string;
  maxStripes?: number;
  minMonthsToNextBelt?: number;
}): Promise<MutationResult> {
  return mutate((draft) => configActions.addBelt(draft, input));
}

export function removeBelt(beltId: string): Promise<MutationResult> {
  return mutate((draft) => configActions.removeBelt(draft, beltId));
}

export function moveBelt(
  beltId: string,
  direction: 'up' | 'down',
): Promise<MutationResult> {
  return mutate((draft) => configActions.moveBelt(draft, beltId, direction));
}

export function setUpcomingEligibilityMonths(months: number): Promise<MutationResult> {
  return mutate((draft) => configActions.setUpcomingEligibilityMonths(draft, months));
}

/* --------------------------- import / export --------------------------- */

export async function importLegacyFile(name: string, text: string): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  try {
    const result = importLegacyCsv(text, plainState().config, { sourceName: name });
    importReport.value = result.report;
    try {
      await activeAdapter.saveLegacyOriginal?.(name, text);
    } catch (error) {
      lastWarning.value = `The original file could not be backed up automatically: ${(error as Error).message}`;
    }
    const errorCount = result.report.issues.filter((issue) => issue.severity === 'error').length;
    const warning = errorCount
      ? `${errorCount} source row(s) or value(s) could not be imported. Review the import report.`
      : undefined;
    return await commit(
      result.state,
      `Imported ${result.report.studentCount} students and ${result.report.gradingEventCount} grading events.`,
      warning,
    );
  } finally {
    busy.value = false;
  }
}

export async function importNormalizedFiles(files: FileMap): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  try {
    const parsed = parseStateFiles(files);
    const errors = parsed.issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0) {
      errorMessage.value = `Import rejected: ${errors[0].message}`;
      status.value = 'error';
      statusMessage.value = errorMessage.value;
      return false;
    }
    const saved = await commit(parsed.state, 'Normalized CSV data imported.');
    if (saved) {
      issues.value = parsed.issues;
      importReport.value = null;
    }
    return saved;
  } finally {
    busy.value = false;
  }
}

export async function chooseDirectory(): Promise<boolean> {
  if (!activeAdapter.chooseDirectory) return false;
  if (busy.value) return false;
  busy.value = true;
  try {
    const current = serializeState(plainState());
    const loaded = await activeAdapter.chooseDirectory(current);
    if (!loaded) return false;
    applyLoaded(loaded);
    lastMessage.value = capabilities.value.autoSave
      ? 'Folder connected. Future changes save automatically.'
      : 'Folder not connected.';
    return true;
  } catch (error) {
    errorMessage.value = `Could not connect the folder: ${(error as Error).message}`;
    status.value = 'error';
    statusMessage.value = errorMessage.value;
    return false;
  } finally {
    busy.value = false;
  }
}

export async function exportFiles(): Promise<boolean> {
  if (!activeAdapter.exportFiles) return false;
  if (busy.value) return false;
  busy.value = true;
  try {
    await activeAdapter.exportFiles(serializeState(plainState()));
    lastMessage.value = 'CSV files exported.';
    return true;
  } catch (error) {
    errorMessage.value = `Export failed: ${(error as Error).message}`;
    status.value = 'error';
    statusMessage.value = errorMessage.value;
    return false;
  } finally {
    busy.value = false;
  }
}

export async function openFolder(): Promise<void> {
  try {
    await activeAdapter.openFolder?.();
  } catch (error) {
    errorMessage.value = `Could not open the folder: ${(error as Error).message}`;
  }
}

export async function restoreBackup(backupId: string): Promise<boolean> {
  if (!activeAdapter.restoreBackup) return false;
  if (busy.value) return false;
  busy.value = true;
  try {
    const loaded = await activeAdapter.restoreBackup(backupId);
    applyLoaded(loaded);
    lastMessage.value = `Restored backup ${backupId}.`;
    return true;
  } catch (error) {
    errorMessage.value = `Restore failed: ${(error as Error).message}`;
    status.value = 'error';
    statusMessage.value = errorMessage.value;
    return false;
  } finally {
    busy.value = false;
  }
}

export function clearMessages(): void {
  errorMessage.value = '';
  lastMessage.value = '';
  lastWarning.value = '';
}

export function refreshNow(): void {
  now.value = nowMonthYear();
}

export async function refreshBackupsList(): Promise<void> {
  await refreshBackups();
}

/* ------------------------------ computed ------------------------------ */

export const eligibilityList = computed<EligibilityInfo[]>(() =>
  computeAllEligibility(state, now.value),
);
export const eligibilitySummary = computed(() => summarizeEligibility(eligibilityList.value));
export const beltDistribution = computed(() => computeBeltDistribution(state));
export const studentsSorted = computed(() => sortStudents(state.students));
export const beltOptions = computed(() => state.config.belts);
export const isDraftMode = computed(() => !capabilities.value.directFileAccess);
export const isBusy = computed(() => busy.value);
export const isReady = computed(() => initialized.value);
export const currentNow = computed(() => now.value);

export function eligibilityFor(studentId: string): EligibilityInfo | null {
  const student = state.students.find((entry) => entry.id === studentId);
  if (!student) return null;
  return computeEligibility(state, student, now.value);
}

export function studentById(studentId: string): Student | null {
  return state.students.find((entry) => entry.id === studentId) ?? null;
}

export const recentGradings = computed(() =>
  [...state.gradings]
    .filter((gradingEntry) => state.students.some((student) => student.id === gradingEntry.studentId))
    .sort((a, b) => {
      const aValid = isValidMonthYear(a.date);
      const bValid = isValidMonthYear(b.date);
      if (aValid && bValid) {
        const diff = compareMonthYear(b.date, a.date);
        if (diff !== 0) return diff;
      } else if (aValid !== bValid) {
        return aValid ? -1 : 1;
      }
      return b.id.localeCompare(a.id);
    })
    .slice(0, 6)
    .map((gradingEntry) => ({
      ...gradingEntry,
      studentName:
        state.students.find((student) => student.id === gradingEntry.studentId)?.name ?? 'Unknown',
    })),
);

export {
  state,
  status,
  statusMessage,
  sourceLabel,
  capabilities,
  issues,
  errorMessage,
  lastMessage,
  lastWarning,
  lastSavedAt,
  backups,
  importReport,
  platform,
  activeAdapter,
};
