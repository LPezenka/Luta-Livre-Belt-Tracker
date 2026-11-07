<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import BeltBadge from '../components/BeltBadge.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import ModalDialog from '../components/ModalDialog.vue';
import {
  addBelt,
  backups,
  beltOptions,
  capabilities,
  chooseDirectory,
  exportFiles,
  importLegacyFile,
  importNormalizedFiles,
  importReport,
  isBusy,
  isDraftMode,
  issues,
  moveBelt,
  openFolder,
  platform,
  refreshBackupsList,
  reloadFromDisk,
  removeBelt,
  renameBeltId,
  restoreBackup,
  saveNow,
  setUpcomingEligibilityMonths,
  sourceLabel,
  state,
  status,
  statusMessage,
  updateBeltConfig,
} from '../app/store';
import { downloadTextFile, pickMultipleTextFiles, pickTextFile } from '../app/files';
import { importLegacyCsv, type LegacyImportReport } from '../core/legacyImport';
import { parseStateFiles } from '../core/serialization';
import { FILE_NAMES, type Belt, type FileMap, type ValidationIssue } from '../core/models';
import type { BackupInfo } from '../app/storage/types';

const newBelt = reactive({
  id: '',
  name: '',
  maxStripes: 4,
  minMonthsToNextBelt: 18,
});
const addBeltError = ref('');

async function submitAddBelt(): Promise<void> {
  addBeltError.value = '';
  const result = await addBelt({ ...newBelt });
  if (!result.ok) {
    addBeltError.value = result.error;
    return;
  }
  newBelt.id = '';
  newBelt.name = '';
  newBelt.maxStripes = 4;
  newBelt.minMonthsToNextBelt = 18;
}

async function saveBeltName(belt: Belt, event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const result = await updateBeltConfig(belt.id, { name: input.value });
  if (!result.ok) input.value = belt.name;
}

async function saveBeltNumber(
  belt: Belt,
  field: 'maxStripes' | 'minMonthsToNextBelt',
  event: Event,
): Promise<void> {
  const input = event.target as HTMLInputElement;
  const value = Number(input.value);
  const patch = field === 'maxStripes' ? { maxStripes: value } : { minMonthsToNextBelt: value };
  const result = await updateBeltConfig(belt.id, patch);
  if (!result.ok) input.value = String(belt[field]);
}

async function saveBeltId(belt: Belt, event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const result = await renameBeltId(belt.id, input.value);
  if (!result.ok) input.value = belt.id;
}

const removeTarget = ref<Belt | null>(null);
const removeMessage = computed(() =>
  removeTarget.value
    ? `Remove ${removeTarget.value.name} belt from the sequence? This is blocked if students, grading history or checklist items still reference it.`
    : '',
);

async function confirmRemoveBelt(): Promise<void> {
  if (!removeTarget.value) return;
  const result = await removeBelt(removeTarget.value.id);
  if (result.ok) removeTarget.value = null;
}

const upcomingInput = ref(String(state.config.upcomingEligibilityMonths));
watch(
  () => state.config.upcomingEligibilityMonths,
  (value) => {
    upcomingInput.value = String(value);
  },
);

async function saveUpcoming(): Promise<void> {
  const result = await setUpcomingEligibilityMonths(Number(upcomingInput.value));
  if (!result.ok) upcomingInput.value = String(state.config.upcomingEligibilityMonths);
}

/* ----------------------------- data actions ----------------------------- */

const confirmFolder = ref(false);
const confirmReload = ref(false);
const dataError = ref('');

async function confirmChooseFolder(): Promise<void> {
  confirmFolder.value = false;
  await chooseDirectory();
}

async function confirmReloadFromDisk(): Promise<void> {
  confirmReload.value = false;
  await reloadFromDisk();
}

async function doExport(): Promise<void> {
  await exportFiles();
}

const legacyPreview = ref<{
  name: string;
  text: string;
  report: LegacyImportReport;
} | null>(null);

async function chooseLegacyFile(): Promise<void> {
  dataError.value = '';
  try {
    const picked = await pickTextFile({
      title: 'Import legacy Luta Livre belt spreadsheet',
      accept: '.csv,text/csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (!picked) return;
    const preview = importLegacyCsv(picked.text, state.config, {
      sourceName: picked.name,
    });
    legacyPreview.value = { name: picked.name, text: picked.text, report: preview.report };
  } catch (error) {
    dataError.value = `Could not read the file: ${(error as Error).message}`;
  }
}

async function confirmLegacyImport(): Promise<void> {
  if (!legacyPreview.value) return;
  const saved = await importLegacyFile(legacyPreview.value.name, legacyPreview.value.text);
  if (saved) legacyPreview.value = null;
}

const normalizedPreview = ref<{
  files: FileMap;
  studentCount: number;
  gradingCount: number;
  issues: ValidationIssue[];
} | null>(null);

async function chooseNormalizedFiles(): Promise<void> {
  dataError.value = '';
  try {
    const picked = await pickMultipleTextFiles('.csv,.json,text/csv,application/json');
    if (picked.length === 0) return;
    const files: FileMap = {};
    for (const entry of picked) {
      const base = entry.name.split(/[\\/]/).pop() ?? entry.name;
      if ((FILE_NAMES as string[]).includes(base)) files[base] = entry.text;
    }
    const missing = FILE_NAMES.filter((name) => files[name] == null);
    if (missing.length > 0) {
      dataError.value = `Select all five canonical files. Missing: ${missing.join(', ')}.`;
      return;
    }
    const parsed = parseStateFiles(files);
    normalizedPreview.value = {
      files,
      studentCount: parsed.state.students.length,
      gradingCount: parsed.state.gradings.length,
      issues: parsed.issues,
    };
  } catch (error) {
    dataError.value = `Could not read the files: ${(error as Error).message}`;
  }
}

async function confirmNormalizedImport(): Promise<void> {
  if (!normalizedPreview.value) return;
  const saved = await importNormalizedFiles(normalizedPreview.value.files);
  if (saved) normalizedPreview.value = null;
}

const restoreTarget = ref<BackupInfo | null>(null);
const restoreMessage = computed(() =>
  restoreTarget.value
    ? `Restore snapshot ${restoreTarget.value.id}? The current files are backed up first, then the snapshot is written.`
    : '',
);

async function confirmRestore(): Promise<void> {
  if (!restoreTarget.value) return;
  const restored = await restoreBackup(restoreTarget.value.id);
  if (restored) restoreTarget.value = null;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function backupTypeLabel(type: BackupInfo['type']): string {
  if (type === 'legacy-original') return 'Original import backup';
  if (type === 'draft') return 'Working-copy snapshot';
  return 'CSV snapshot';
}

function downloadImportReport(): void {
  if (!importReport.value) return;
  downloadTextFile(
    'import-report.json',
    `${JSON.stringify(importReport.value, null, 2)}\n`,
    'application/json',
  );
}

onMounted(() => {
  void refreshBackupsList();
});
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1>Settings</h1>
        <p>
          Belt sequence, advisory minimum times, data folder, imports, backups and local
          storage status.
        </p>
      </div>
      <RouterLink class="btn btn-secondary" to="/checklists">Manage checklists</RouterLink>
    </div>

    <div class="settings-grid">
      <section class="card">
        <div class="card-head">
          <h2>Belt progression</h2>
          <span class="small muted">Changes save immediately</span>
        </div>
        <div class="card-body settings-section">
          <div class="banner banner-info">
            Minimum times and stripe limits are configurable and <strong>advisory</strong>.
            Changing them never blocks a promotion. Reordering belts changes the next-belt
            target; renaming an ID rewrites references in students, history and checklists.
          </div>

          <div class="table-wrap">
            <table class="table belt-config-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Name</th>
                  <th>ID</th>
                  <th>Max stripes</th>
                  <th>Min months</th>
                  <th style="text-align: right">Remove</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(belt, index) in beltOptions" :key="belt.id">
                  <td>
                    <div class="order-buttons">
                      <button
                        type="button"
                        class="btn btn-secondary btn-icon btn-sm"
                        title="Move up"
                        :disabled="isBusy || index === 0"
                        @click="moveBelt(belt.id, 'up')"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        class="btn btn-secondary btn-icon btn-sm"
                        title="Move down"
                        :disabled="isBusy || index === beltOptions.length - 1"
                        @click="moveBelt(belt.id, 'down')"
                      >
                        ↓
                      </button>
                    </div>
                  </td>
                  <td style="min-width: 130px">
                    <div class="row" style="gap: 6px; flex-wrap: nowrap">
                      <BeltBadge :id="belt.id" :name="belt.name" small />
                      <input
                        class="input input-sm"
                        :value="belt.name"
                        aria-label="Belt name"
                        @change="saveBeltName(belt, $event)"
                      />
                    </div>
                  </td>
                  <td>
                    <input
                      class="input input-sm mono"
                      :value="belt.id"
                      aria-label="Belt identifier"
                      style="min-width: 100px"
                      @change="saveBeltId(belt, $event)"
                    />
                  </td>
                  <td>
                    <input
                      class="input input-sm"
                      type="number"
                      min="0"
                      max="20"
                      :value="belt.maxStripes"
                      aria-label="Maximum stripes"
                      @change="saveBeltNumber(belt, 'maxStripes', $event)"
                    />
                  </td>
                  <td>
                    <input
                      class="input input-sm"
                      type="number"
                      min="0"
                      max="240"
                      :value="belt.minMonthsToNextBelt"
                      aria-label="Minimum months to next belt"
                      @change="saveBeltNumber(belt, 'minMonthsToNextBelt', $event)"
                    />
                  </td>
                  <td style="text-align: right">
                    <button
                      type="button"
                      class="btn btn-danger btn-sm"
                      :disabled="isBusy"
                      @click="removeTarget = belt"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="settings-section">
            <h3>Add belt</h3>
            <div class="field-row">
              <div class="field">
                <label class="label" for="new-belt-id">ID</label>
                <input
                  id="new-belt-id"
                  v-model="newBelt.id"
                  class="input"
                  placeholder="e.g. green"
                />
              </div>
              <div class="field">
                <label class="label" for="new-belt-name">Display name</label>
                <input
                  id="new-belt-name"
                  v-model="newBelt.name"
                  class="input"
                  placeholder="e.g. Green"
                />
              </div>
              <div class="field">
                <label class="label" for="new-belt-stripes">Max stripes</label>
                <input
                  id="new-belt-stripes"
                  v-model.number="newBelt.maxStripes"
                  class="input"
                  type="number"
                  min="0"
                  max="20"
                />
              </div>
              <div class="field">
                <label class="label" for="new-belt-months">Min months</label>
                <input
                  id="new-belt-months"
                  v-model.number="newBelt.minMonthsToNextBelt"
                  class="input"
                  type="number"
                  min="0"
                  max="240"
                />
              </div>
            </div>
            <div class="row">
              <button
                type="button"
                class="btn btn-primary"
                :disabled="isBusy || !newBelt.id.trim() || !newBelt.name.trim()"
                @click="submitAddBelt"
              >
                + Add belt
              </button>
              <span class="small muted">The new belt is appended to the end of the sequence.</span>
            </div>
            <div v-if="addBeltError" class="banner banner-error">{{ addBeltError }}</div>
          </div>

          <div class="settings-section">
            <h3>Upcoming eligibility window</h3>
            <div class="row" style="align-items: flex-end">
              <div class="field" style="width: 160px">
                <label class="label" for="upcoming-months">Months</label>
                <input
                  id="upcoming-months"
                  v-model="upcomingInput"
                  class="input"
                  type="number"
                  min="0"
                  max="24"
                />
              </div>
              <button type="button" class="btn btn-secondary" :disabled="isBusy" @click="saveUpcoming">
                Save window
              </button>
              <span class="small muted">
                Students become "Upcoming" when eligibility is within this many calendar
                months.
              </span>
            </div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>Data, storage &amp; backups</h2>
          <span class="small muted">{{ platform === 'electron' ? 'Electron' : 'PWA' }}</span>
        </div>
        <div class="card-body settings-section">
          <div class="info-grid">
            <div class="info-item">
              <span class="label">Storage mode</span>
              <div class="info-value">{{ capabilities.label }}</div>
            </div>
            <div class="info-item">
              <span class="label">Data source</span>
              <div class="info-value">{{ sourceLabel || '—' }}</div>
            </div>
            <div class="info-item">
              <span class="label">Save status</span>
              <div class="info-value">{{ statusMessage }}</div>
            </div>
            <div class="info-item">
              <span class="label">Canonical CSV</span>
              <div class="info-value">
                {{ capabilities.directFileAccess ? 'Yes — written automatically' : 'No — working copy' }}
              </div>
            </div>
          </div>

          <div v-if="isDraftMode" class="banner banner-warning">
            <span>
              This browser session is using a local working copy. Changes are kept in this
              browser only. Connect a data folder (supported browsers) or export the CSV
              files to make the data canonical. A save failure is never reported as saved.
            </span>
          </div>

          <div class="row">
            <button type="button" class="btn btn-primary" :disabled="isBusy" @click="saveNow">
              Save now
            </button>
            <button type="button" class="btn btn-secondary" :disabled="isBusy" @click="doExport">
              Export CSV files
            </button>
            <button
              v-if="capabilities.canChooseDirectory"
              type="button"
              class="btn btn-secondary"
              :disabled="isBusy"
              @click="confirmFolder = true"
            >
              Choose data folder
            </button>
            <button
              v-if="capabilities.canOpenFolder"
              type="button"
              class="btn btn-secondary"
              :disabled="isBusy"
              @click="openFolder"
            >
              Open data folder
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              :disabled="isBusy"
              @click="confirmReload = true"
            >
              Reload from disk
            </button>
          </div>

          <div class="settings-section">
            <h3>Import</h3>
            <p class="small muted">
              Importing replaces the current data set. The original legacy file is copied to
              the backups folder before conversion; no date is invented.
            </p>
            <div class="row">
              <button type="button" class="btn btn-secondary" :disabled="isBusy" @click="chooseLegacyFile">
                Import legacy spreadsheet CSV
              </button>
              <button
                type="button"
                class="btn btn-secondary"
                :disabled="isBusy"
                @click="chooseNormalizedFiles"
              >
                Import normalized CSV set
              </button>
            </div>
            <div v-if="dataError" class="banner banner-error">{{ dataError }}</div>
          </div>

          <div class="settings-section">
            <div class="row" style="justify-content: space-between">
              <h3>Backups</h3>
              <button type="button" class="btn btn-ghost btn-sm" :disabled="isBusy" @click="refreshBackupsList">
                Refresh
              </button>
            </div>
            <div v-if="backups.length === 0" class="empty" style="padding: 16px">
              <strong>No backups yet.</strong>
              <span class="small">A timestamped backup is created before each save.</span>
            </div>
            <div v-else class="backup-list">
              <div v-for="backup in backups" :key="backup.id" class="backup-item">
                <span class="badge" :class="backup.type === 'legacy-original' ? 'badge-neutral' : 'badge-eligible'">
                  {{ backupTypeLabel(backup.type) }}
                </span>
                <span class="mono tiny" style="flex: 1; min-width: 160px">{{ backup.id }}</span>
                <span class="tiny muted">{{ formatDate(backup.createdAt) }}</span>
                <span class="tiny muted">{{ backup.files.length }} file(s)</span>
                <button
                  v-if="backup.restorable && backup.type !== 'legacy-original'"
                  type="button"
                  class="btn btn-secondary btn-sm"
                  :disabled="isBusy"
                  @click="restoreTarget = backup"
                >
                  Restore
                </button>
              </div>
            </div>
            <p class="tiny muted">
              Backups are stored under <span class="mono">backups/</span> next to the CSV
              files. Legacy original files are preserved but cannot be restored as data.
            </p>
          </div>

          <div v-if="issues.length > 0" class="settings-section">
            <h3>Data notes ({{ issues.length }})</h3>
            <div class="issue-list">
              <div
                v-for="(issue, index) in issues"
                :key="`${index}-${issue.message}`"
                class="issue"
                :class="issue.severity"
              >
                <span class="code">{{ issue.severity }}</span>
                {{ issue.message }}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section v-if="importReport" class="card">
        <div class="card-head">
          <h2>Last legacy import report</h2>
          <button type="button" class="btn btn-ghost btn-sm" @click="downloadImportReport">
            Download JSON
          </button>
        </div>
        <div class="card-body settings-section">
          <div class="info-grid">
            <div class="info-item">
              <span class="label">Source</span>
              <div class="info-value">{{ importReport.sourceName }}</div>
            </div>
            <div class="info-item">
              <span class="label">Students</span>
              <div class="info-value">{{ importReport.studentCount }}</div>
            </div>
            <div class="info-item">
              <span class="label">Grading events</span>
              <div class="info-value">{{ importReport.gradingEventCount }}</div>
            </div>
            <div class="info-item">
              <span class="label">Skipped rows</span>
              <div class="info-value">{{ importReport.skippedRows }}</div>
            </div>
          </div>
          <div v-if="importReport.mergedNames.length > 0" class="banner banner-info">
            <span>
              Merged names (verify identity):
              <strong>{{ importReport.mergedNames.map((entry) => entry.name).join(', ') }}</strong>
            </span>
          </div>
          <div class="issue-list">
            <div
              v-for="(issue, index) in importReport.issues"
              :key="`${index}-${issue.code}`"
              class="issue"
              :class="issue.severity"
            >
              <span class="code">{{ issue.severity }} · {{ issue.code }}</span>
              {{ issue.message }}
            </div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>About this application</h2>
        </div>
        <div class="card-body settings-section">
          <p class="small">
            Luta Belt Tracker is a local-first administrative and decision-support tool for
            Vienna Combat Academy. It tracks progression, highlights eligibility and supports
            the coach's decisions. It is <strong>not</strong> an automated grading system.
          </p>
          <p class="small">
            The coach has complete authority: promotions are never blocked by minimum time,
            stripe count or checklist completion. All requirements are advisory.
          </p>
          <p class="small">
            Dates use month/year precision (<span class="mono">MM/YY</span>). Two-digit years
            are interpreted as 2000–2099. Eligibility is calculated with calendar months, not
            fixed 30-day durations.
          </p>
          <p class="small">
            Storage is CSV and JSON only. There is no backend server, account, cloud database
            or automatic promotion. Electron writes through a secure preload bridge with
            context isolation; the PWA uses File System Access where available and otherwise
            a clearly marked browser working copy with export/import.
          </p>
          <p class="tiny muted">
            See <span class="mono">docs/handoff.md</span> for architecture, decisions, test
            coverage and the next implementation task.
          </p>
        </div>
      </section>
    </div>

    <ConfirmDialog
      :open="Boolean(removeTarget)"
      title="Remove belt"
      :message="removeMessage"
      confirm-label="Remove belt"
      danger
      :busy="isBusy"
      @close="removeTarget = null"
      @confirm="confirmRemoveBelt"
    />

    <ConfirmDialog
      :open="confirmFolder"
      title="Choose data folder"
      message="Connecting a folder reads its CSV files. If the folder is empty, the current working copy is written there. If it already contains data, that data replaces the current working copy. The current files are backed up first when saving. Continue?"
      confirm-label="Choose folder"
      :busy="isBusy"
      @close="confirmFolder = false"
      @confirm="confirmChooseFolder"
    />

    <ConfirmDialog
      :open="confirmReload"
      title="Reload from disk"
      message="Discard the current in-memory state and reload the CSV files from the data folder? Any unsaved browser working-copy changes are not affected unless you are in direct-file mode."
      confirm-label="Reload"
      :busy="isBusy"
      @close="confirmReload = false"
      @confirm="confirmReloadFromDisk"
    />

    <ConfirmDialog
      :open="Boolean(restoreTarget)"
      title="Restore backup"
      :message="restoreMessage"
      confirm-label="Restore snapshot"
      :busy="isBusy"
      @close="restoreTarget = null"
      @confirm="confirmRestore"
    />

    <ModalDialog
      :open="Boolean(legacyPreview)"
      title="Legacy import preview"
      wide
      @close="legacyPreview = null"
    >
      <div v-if="legacyPreview" class="stack">
        <p class="small">
          <strong>{{ legacyPreview.name }}</strong> will be converted into normalized student,
          grading and checklist CSVs. The original file is backed up first. Importing replaces
          the current data set.
        </p>
        <div class="info-grid">
          <div class="info-item">
            <span class="label">Students</span>
            <div class="info-value">{{ legacyPreview.report.studentCount }}</div>
          </div>
          <div class="info-item">
            <span class="label">Grading events</span>
            <div class="info-value">{{ legacyPreview.report.gradingEventCount }}</div>
          </div>
          <div class="info-item">
            <span class="label">Skipped rows</span>
            <div class="info-value">{{ legacyPreview.report.skippedRows }}</div>
          </div>
          <div class="info-item">
            <span class="label">Issues</span>
            <div class="info-value">{{ legacyPreview.report.issues.length }}</div>
          </div>
        </div>
        <div v-if="legacyPreview.report.mergedNames.length > 0" class="banner banner-warning">
          <span>
            Names appearing on multiple belt rows were merged:
            {{ legacyPreview.report.mergedNames.map((entry) => entry.name).join(', ') }}.
            Verify that these are the same people.
          </span>
        </div>
        <div class="issue-list">
          <div
            v-for="(issue, index) in legacyPreview.report.issues"
            :key="`${index}-${issue.code}`"
            class="issue"
            :class="issue.severity"
          >
            <span class="code">{{ issue.severity }} · {{ issue.code }}</span>
            {{ issue.message }}
          </div>
        </div>
      </div>
      <template #footer>
        <button type="button" class="btn btn-secondary" @click="legacyPreview = null">
          Cancel
        </button>
        <button type="button" class="btn btn-primary" :disabled="isBusy" @click="confirmLegacyImport">
          {{ isBusy ? 'Importing…' : 'Import and replace data' }}
        </button>
      </template>
    </ModalDialog>

    <ModalDialog
      :open="Boolean(normalizedPreview)"
      title="Normalized CSV import preview"
      wide
      @close="normalizedPreview = null"
    >
      <div v-if="normalizedPreview" class="stack">
        <p class="small">
          The selected normalized files will replace the current data set. The current files
          are backed up before writing.
        </p>
        <div class="info-grid">
          <div class="info-item">
            <span class="label">Students</span>
            <div class="info-value">{{ normalizedPreview.studentCount }}</div>
          </div>
          <div class="info-item">
            <span class="label">Grading events</span>
            <div class="info-value">{{ normalizedPreview.gradingCount }}</div>
          </div>
          <div class="info-item">
            <span class="label">Files</span>
            <div class="info-value">{{ Object.keys(normalizedPreview.files).length }} / 5</div>
          </div>
        </div>
        <div v-if="normalizedPreview.issues.length > 0" class="issue-list">
          <div
            v-for="(issue, index) in normalizedPreview.issues"
            :key="`${index}-${issue.message}`"
            class="issue"
            :class="issue.severity"
          >
            <span class="code">{{ issue.severity }}</span>
            {{ issue.message }}
          </div>
        </div>
        <div
          v-if="normalizedPreview.issues.some((issue) => issue.severity === 'error')"
          class="banner banner-error"
        >
          Errors must be resolved in the CSV files before importing.
        </div>
      </div>
      <template #footer>
        <button type="button" class="btn btn-secondary" @click="normalizedPreview = null">
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="
            isBusy ||
            !normalizedPreview ||
            normalizedPreview.issues.some((issue) => issue.severity === 'error')
          "
          @click="confirmNormalizedImport"
        >
          {{ isBusy ? 'Importing…' : 'Import and replace data' }}
        </button>
      </template>
    </ModalDialog>
  </div>
</template>
