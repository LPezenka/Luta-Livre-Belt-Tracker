<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import BeltBadge from '../components/BeltBadge.vue';
import ChecklistPanel from '../components/ChecklistPanel.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EligibilityBadge from '../components/EligibilityBadge.vue';
import ModalDialog from '../components/ModalDialog.vue';
import PromotionDialog from '../components/PromotionDialog.vue';
import StripeMeter from '../components/StripeMeter.vue';
import {
  deleteGrading,
  eligibilityFor,
  isBusy,
  renameStudent,
  setChecklistProgress,
  state,
  studentById,
  updateGradingDate,
} from '../app/store';
import { nextBeltChecklist } from '../core/checklists';
import { findBelt } from '../core/config';
import {
  inputValueToMonthYear,
  monthYearLabel,
  monthYearToInputValue,
} from '../core/dates';
import { latestBeltAward } from '../core/eligibility';
import { studentGradingHistory } from '../core/grading';
import type { Grading } from '../core/models';

const route = useRoute();
const studentId = computed(() => String(route.params.id ?? ''));
const student = computed(() => studentById(studentId.value));
const eligibility = computed(() => eligibilityFor(studentId.value));
const currentBelt = computed(() =>
  student.value ? findBelt(state.config, student.value.currentBelt) : null,
);
const checklist = computed(() => nextBeltChecklist(state, studentId.value));
const history = computed(() => studentGradingHistory(state, studentId.value));
const availableStripes = computed(() =>
  Math.max(
    0,
    (currentBelt.value?.maxStripes ?? 0) - (student.value?.currentStripes ?? 0),
  ),
);
const hasActualBeltDate = computed(() => {
  if (!student.value) return false;
  return latestBeltAward(state, studentId.value, student.value.currentBelt) != null;
});

const monthsText = computed(() => {
  const months = eligibility.value?.monthsAtBelt;
  if (months == null) return 'Unknown';
  return `${months} month${Math.abs(months) === 1 ? '' : 's'}${months < 0 ? ' (future date)' : ''}`;
});
const minText = computed(() => {
  const min = eligibility.value?.minMonthsToNextBelt;
  return min == null ? '—' : `${min} month${min === 1 ? '' : 's'}`;
});
const earliestText = computed(() =>
  monthYearLabel(eligibility.value?.earliestEligibility ?? null),
);
const remainingText = computed(() => {
  const remaining = eligibility.value?.monthsRemaining;
  if (remaining == null) return '—';
  return `${remaining} month${remaining === 1 ? '' : 's'}`;
});

const showDialog = ref(false);
const dialogMode = ref<'stripe' | 'belt' | 'belt-date'>('stripe');

function openDialog(mode: 'stripe' | 'belt' | 'belt-date'): void {
  dialogMode.value = mode;
  showDialog.value = true;
}

async function toggleChecklist(itemId: string, completed: boolean): Promise<void> {
  await setChecklistProgress(studentId.value, itemId, completed);
}

const editingId = ref<string | null>(null);
const editDate = ref('');

function startEdit(grading: Grading): void {
  editingId.value = grading.id;
  editDate.value = monthYearToInputValue(grading.date);
}

function cancelEdit(): void {
  editingId.value = null;
  editDate.value = '';
}

async function saveEdit(grading: Grading): Promise<void> {
  const date = inputValueToMonthYear(editDate.value);
  if (!date) return;
  const result = await updateGradingDate(grading.id, date);
  if (result.ok) cancelEdit();
}

const deleteTarget = ref<Grading | null>(null);
const deleteMessage = computed(() => {
  if (!deleteTarget.value) return '';
  const target = deleteTarget.value;
  return `Delete ${target.type === 'belt' ? 'belt promotion' : 'stripe award'} ${target.id} dated ${target.date}? The cached belt and stripe count will be recalculated from the remaining history. This cannot be undone.`;
});

async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value) return;
  const result = await deleteGrading(deleteTarget.value.id);
  if (result.ok) deleteTarget.value = null;
}

const showRename = ref(false);
const renameValue = ref('');
const renameError = ref('');

function openRename(): void {
  renameValue.value = student.value?.name ?? '';
  renameError.value = '';
  showRename.value = true;
}

async function submitRename(): Promise<void> {
  renameError.value = '';
  const result = await renameStudent(studentId.value, renameValue.value);
  if (!result.ok) {
    renameError.value = result.error;
    return;
  }
  showRename.value = false;
}

function beltName(beltId: string): string {
  return findBelt(state.config, beltId)?.name ?? beltId;
}
</script>

<template>
  <div v-if="!student || !eligibility" class="card">
    <div class="empty">
      <strong>Student not found.</strong>
      <span class="small">The record may have been removed or the link is invalid.</span>
      <div style="margin-top: 12px">
        <RouterLink class="btn btn-secondary" to="/">Back to dashboard</RouterLink>
      </div>
    </div>
  </div>

  <div v-else class="stack">
    <div>
      <RouterLink class="btn btn-ghost btn-sm" to="/">← Back to dashboard</RouterLink>
    </div>

    <section class="card card-pad">
      <div class="detail-head">
        <div class="avatar">{{ student.name.slice(0, 1).toUpperCase() }}</div>
        <div class="detail-title" style="flex: 1; min-width: 220px">
          <h1>{{ student.name }}</h1>
          <div class="detail-meta">
            <BeltBadge
              :id="student.currentBelt"
              :name="currentBelt?.name ?? student.currentBelt"
            />
            <StripeMeter
              :current="student.currentStripes"
              :max="currentBelt?.maxStripes ?? 0"
            />
            <EligibilityBadge
              :status="eligibility.status"
              :provisional="eligibility.beltSinceProvisional"
              :future="eligibility.futureBeltDate"
            />
          </div>
          <div class="small muted">
            Student ID <span class="mono">{{ student.id }}</span>
            · Next belt:
            <template v-if="eligibility.nextBelt">
              <BeltBadge
                :id="eligibility.nextBelt.id"
                :name="eligibility.nextBelt.name"
                small
              />
            </template>
            <template v-else>highest configured belt</template>
          </div>
        </div>
        <div class="action-bar">
          <button type="button" class="btn btn-ghost btn-sm" @click="openRename">
            Rename
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            :disabled="isBusy"
            @click="openDialog('belt-date')"
          >
            {{ hasActualBeltDate ? 'Correct belt date' : 'Record belt date' }}
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            :disabled="isBusy || availableStripes === 0"
            :title="
              availableStripes === 0
                ? 'Maximum stripes already awarded'
                : `Up to ${availableStripes} additional stripe(s)`
            "
            @click="openDialog('stripe')"
          >
            Award stripe(s)
          </button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="isBusy || !eligibility.nextBelt"
            @click="openDialog('belt')"
          >
            Award next belt
          </button>
        </div>
      </div>
    </section>

    <div class="dashboard-grid">
      <section class="card">
        <div class="card-head">
          <h2>Eligibility &amp; time at belt</h2>
          <EligibilityBadge
            :status="eligibility.status"
            :provisional="eligibility.beltSinceProvisional"
            :future="eligibility.futureBeltDate"
          />
        </div>
        <div class="card-body">
          <div class="info-grid">
            <div class="info-item">
              <span class="label">Belt since</span>
              <div class="info-value">
                <template v-if="eligibility.beltSince">
                  {{ monthYearLabel(eligibility.beltSince) }}
                  <span
                    v-if="eligibility.beltSinceProvisional"
                    class="badge badge-provisional"
                    style="margin-left: 4px"
                  >
                    provisional
                  </span>
                </template>
                <span v-else class="muted">Unknown</span>
              </div>
            </div>
            <div class="info-item">
              <span class="label">Time at belt</span>
              <div class="info-value">{{ monthsText }}</div>
            </div>
            <div class="info-item">
              <span class="label">Minimum recommended</span>
              <div class="info-value">{{ minText }}</div>
            </div>
            <div class="info-item">
              <span class="label">Earliest eligibility</span>
              <div class="info-value">{{ earliestText }}</div>
            </div>
            <div class="info-item">
              <span class="label">Months remaining</span>
              <div class="info-value">{{ remainingText }}</div>
            </div>
            <div class="info-item">
              <span class="label">Next belt</span>
              <div class="info-value">
                <BeltBadge
                  v-if="eligibility.nextBelt"
                  :id="eligibility.nextBelt.id"
                  :name="eligibility.nextBelt.name"
                  small
                />
                <span v-else class="muted">Highest belt</span>
              </div>
            </div>
          </div>

          <div
            v-if="eligibility.beltSinceProvisional"
            class="banner banner-warning"
            style="margin-top: 14px"
          >
            <span>
              The belt start is provisional ({{ eligibility.beltSince }}), inferred from the
              earliest recorded stripe date. It may underestimate time at belt. Record the
              actual belt-award date if known.
            </span>
            <span class="spacer" />
            <button
              type="button"
              class="btn btn-sm btn-secondary"
              :disabled="isBusy"
              @click="openDialog('belt-date')"
            >
              Record date
            </button>
          </div>

          <div v-if="eligibility.warnings.length > 0" class="stack" style="margin-top: 12px">
            <div
              v-for="warning in eligibility.warnings"
              :key="warning"
              class="banner banner-warning"
            >
              {{ warning }}
            </div>
          </div>

          <p class="tiny muted" style="margin-top: 12px">
            Eligibility is informational. The coach may promote at any time, with any
            stripe count, and regardless of checklist completion.
          </p>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>Grading actions</h2>
        </div>
        <div class="card-body stack">
          <div class="row">
            <button
              type="button"
              class="btn btn-secondary"
              :disabled="isBusy || availableStripes === 0"
              @click="openDialog('stripe')"
            >
              Award stripe(s)
            </button>
            <span class="small muted">
              {{ student.currentStripes }} / {{ currentBelt?.maxStripes ?? 0 }} currently
              awarded · up to {{ availableStripes }} more
            </span>
          </div>
          <div class="row">
            <button
              type="button"
              class="btn btn-primary"
              :disabled="isBusy || !eligibility.nextBelt"
              @click="openDialog('belt')"
            >
              Award next belt
            </button>
            <span class="small muted">
              <template v-if="eligibility.nextBelt">
                Promote to {{ eligibility.nextBelt.name }} and reset stripes to zero.
              </template>
              <template v-else>No next belt is configured.</template>
            </span>
          </div>
          <div class="row">
            <button
              type="button"
              class="btn btn-secondary"
              :disabled="isBusy"
              @click="openDialog('belt-date')"
            >
              {{ hasActualBeltDate ? 'Correct current belt date' : 'Record belt-award date' }}
            </button>
            <span class="small muted">Fixes a missing or incorrect belt start.</span>
          </div>
        </div>
      </section>
    </div>

    <section class="card">
      <div class="card-head">
        <h2>Promotion checklist</h2>
        <span class="small muted">
          {{
            eligibility.nextBelt
              ? `For ${eligibility.nextBelt.name} belt`
              : 'No next belt configured'
          }}
        </span>
      </div>
      <div class="card-body">
        <div
          v-if="eligibility.nextBelt && eligibility.status !== 'eligible'"
          class="banner banner-info"
          style="margin-bottom: 14px"
        >
          This student is not yet marked eligible. The checklist is still available because
          early promotions are permitted.
        </div>
        <ChecklistPanel
          :summary="checklist"
          :busy="isBusy"
          @toggle="toggleChecklist"
        />
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>Grading history</h2>
        <span class="small muted">{{ history.length }} event(s)</span>
      </div>
      <div v-if="history.length === 0" class="empty">
        <strong>No grading events recorded.</strong>
        <span class="small">
          Belt promotions and stripe awards will appear here. A provisional belt start can
          still be inferred from stripe dates.
        </span>
      </div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Event</th>
              <th>Belt</th>
              <th>Stripes</th>
              <th style="text-align: right">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="grading in history" :key="grading.id">
              <td>
                <template v-if="editingId === grading.id">
                  <div class="row" style="gap: 4px; flex-wrap: nowrap">
                    <input v-model="editDate" class="input input-sm" type="month" style="width: 140px" />
                    <button
                      type="button"
                      class="btn btn-primary btn-sm"
                      :disabled="isBusy"
                      @click="saveEdit(grading)"
                    >
                      Save
                    </button>
                    <button type="button" class="btn btn-secondary btn-sm" @click="cancelEdit">
                      Cancel
                    </button>
                  </div>
                </template>
                <template v-else>
                  <span class="history-date">{{ grading.date }}</span>
                </template>
              </td>
              <td>
                <strong>{{ grading.type === 'belt' ? 'Belt promotion' : 'Stripe award' }}</strong>
                <div class="tiny muted">{{ grading.id }}</div>
              </td>
              <td>
                <BeltBadge
                  :id="grading.belt"
                  :name="beltName(grading.belt)"
                  small
                />
              </td>
              <td>
                <template v-if="grading.type === 'stripe'">+{{ grading.stripesAwarded }}</template>
                <span v-else class="muted">—</span>
              </td>
              <td style="text-align: right">
                <div class="history-actions" style="justify-content: flex-end">
                  <button
                    v-if="editingId !== grading.id"
                    type="button"
                    class="btn btn-ghost btn-sm"
                    :disabled="isBusy"
                    @click="startEdit(grading)"
                  >
                    Edit date
                  </button>
                  <button
                    type="button"
                    class="btn btn-danger btn-sm"
                    :disabled="isBusy"
                    @click="deleteTarget = grading"
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="card-body" style="padding-top: 0">
        <p class="tiny muted">
          Correcting a date recalculates the cached current belt and stripe count from the
          recorded events. Historical events are never invented or silently removed.
        </p>
      </div>
    </section>

    <PromotionDialog
      v-if="student && eligibility"
      :open="showDialog"
      :mode="dialogMode"
      :student="student"
      :eligibility="eligibility"
      :available-stripes="availableStripes"
      :current-belt="currentBelt"
      @close="showDialog = false"
      @done="showDialog = false"
    />

    <ModalDialog :open="showRename" title="Rename student" @close="showRename = false">
      <div class="stack">
        <div class="field">
          <label class="label" for="rename-student">Student name</label>
          <input
            id="rename-student"
            v-model="renameValue"
            class="input"
            type="text"
            maxlength="120"
            @keydown.enter="submitRename"
          />
          <span class="small muted">
            The stable student ID <span class="mono">{{ student.id }}</span> does not change.
          </span>
        </div>
        <div v-if="renameError" class="banner banner-error">{{ renameError }}</div>
      </div>
      <template #footer>
        <button type="button" class="btn btn-secondary" @click="showRename = false">
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="isBusy || !renameValue.trim()"
          @click="submitRename"
        >
          {{ isBusy ? 'Saving…' : 'Save name' }}
        </button>
      </template>
    </ModalDialog>

    <ConfirmDialog
      :open="Boolean(deleteTarget)"
      title="Delete grading event"
      :message="deleteMessage"
      confirm-label="Delete event"
      danger
      :busy="isBusy"
      @close="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </div>
</template>
