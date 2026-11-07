<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BeltBadge from './BeltBadge.vue';
import ModalDialog from './ModalDialog.vue';
import {
  awardStripes,
  currentNow,
  isBusy,
  promoteStudent,
  recordBeltAwardDate,
  state,
} from '../app/store';
import { nextBeltChecklist, type ChecklistSummary } from '../core/checklists';
import { inputValueToMonthYear, monthYearToInputValue } from '../core/dates';
import type { Belt, EligibilityInfo, Student } from '../core/models';

const props = defineProps<{
  open: boolean;
  mode: 'stripe' | 'belt' | 'belt-date';
  student: Student;
  eligibility: EligibilityInfo;
  availableStripes: number;
  currentBelt: Belt | null;
}>();

const emit = defineEmits<{ close: []; done: [] }>();

const dateInput = ref('');
const count = ref(1);
const error = ref('');
const submitting = ref(false);

const title = computed(() => {
  if (props.mode === 'stripe') return 'Award stripe(s)';
  if (props.mode === 'belt') return 'Award next belt';
  return 'Record belt-award date';
});

const targetBelt = computed(() =>
  props.mode === 'belt' ? props.eligibility.nextBelt : props.currentBelt,
);

const maxCount = computed(() => Math.max(0, props.availableStripes));

const checklist = computed<ChecklistSummary | null>(() =>
  props.mode === 'belt' ? nextBeltChecklist(state, props.student.id) : null,
);

const dateLabel = computed(() =>
  props.mode === 'belt-date' ? 'Belt awarded in' : 'Grading month',
);

const earlyWarning = computed(() => {
  if (props.mode !== 'belt') return '';
  const months = props.eligibility.monthsAtBelt;
  const min = props.eligibility.minMonthsToNextBelt;
  if (months == null || min == null || months >= min) return '';
  return `Minimum recommended time has not yet been reached (${months} of ${min} months). Promotion is still allowed.`;
});

const checklistWarning = computed(() => {
  if (props.mode !== 'belt' || !checklist.value) return '';
  if (
    checklist.value.totalCount > 0 &&
    checklist.value.completedCount < checklist.value.totalCount
  ) {
    return `Checklist is not complete (${checklist.value.completedCount} of ${checklist.value.totalCount}). This does not block promotion.`;
  }
  return '';
});

const provisionalWarning = computed(() => {
  if (!props.eligibility.beltSinceProvisional) return '';
  return `The current belt start (${props.eligibility.beltSince}) is provisional, inferred from the earliest stripe date.`;
});

const canSubmit = computed(() => {
  if (submitting.value || isBusy.value) return false;
  if (!inputValueToMonthYear(dateInput.value)) return false;
  if (props.mode === 'stripe') {
    return maxCount.value > 0 && count.value >= 1 && count.value <= maxCount.value;
  }
  if (props.mode === 'belt') return Boolean(props.eligibility.nextBelt);
  return true;
});

function reset(): void {
  dateInput.value = monthYearToInputValue(currentNow.value);
  count.value = Math.min(1, Math.max(0, props.availableStripes)) || 1;
  error.value = '';
  submitting.value = false;
}

watch(
  () => props.open,
  (open) => {
    if (open) reset();
  },
  { immediate: true },
);

watch(
  () => props.student.id,
  () => {
    if (props.open) reset();
  },
);

function setCount(value: number): void {
  count.value = Math.max(1, Math.min(maxCount.value, value));
}

async function submit(): Promise<void> {
  error.value = '';
  const date = inputValueToMonthYear(dateInput.value);
  if (!date) {
    error.value = 'Choose a valid grading month/year.';
    return;
  }
  if (props.mode === 'stripe') {
    if (count.value < 1 || count.value > maxCount.value) {
      error.value = `Enter between 1 and ${maxCount.value} stripe(s).`;
      return;
    }
  }

  submitting.value = true;
  try {
    const result =
      props.mode === 'stripe'
        ? await awardStripes(props.student.id, count.value, date)
        : props.mode === 'belt'
          ? await promoteStudent(props.student.id, date)
          : await recordBeltAwardDate(props.student.id, date);
    if (!result.ok) {
      error.value = result.error;
      return;
    }
    emit('done');
    emit('close');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <ModalDialog :open="open" :title="title" @close="emit('close')">
    <div class="stack">
      <div class="row" style="gap: 10px">
        <div class="avatar" style="width: 42px; height: 42px; font-size: 0.95rem">
          {{ student.name.slice(0, 1).toUpperCase() }}
        </div>
        <div>
          <strong>{{ student.name }}</strong>
          <div class="small muted">
            Currently
            <BeltBadge
              :id="student.currentBelt"
              :name="currentBelt?.name ?? student.currentBelt"
              small
            />
            with {{ student.currentStripes }} of {{ currentBelt?.maxStripes ?? 0 }} stripes
          </div>
        </div>
      </div>

      <div v-if="mode === 'belt'" class="banner banner-info">
        <span>
          Promote to
          <BeltBadge
            v-if="targetBelt"
            :id="targetBelt.id"
            :name="targetBelt.name"
            small
          /><strong v-else>no next belt</strong>. Stripes reset to zero; all previous
          grading events remain in history.
        </span>
      </div>

      <div v-if="mode === 'belt-date'" class="banner banner-warning">
        <span>
          This records or corrects the belt-award date for the current
          <BeltBadge
            :id="student.currentBelt"
            :name="currentBelt?.name ?? student.currentBelt"
            small
          />
          belt. A provisional stripe-derived start is replaced; no grading event is invented.
        </span>
      </div>

      <div v-if="mode === 'stripe'" class="field">
        <span class="label">Additional stripes</span>
        <div class="row">
          <input
            v-model.number="count"
            class="input"
            style="width: 100px"
            type="number"
            min="1"
            :max="maxCount"
            :disabled="maxCount === 0"
          />
          <button
            v-for="value in Math.min(maxCount, 4)"
            :key="value"
            type="button"
            class="btn btn-secondary btn-sm"
            @click="setCount(value)"
          >
            +{{ value }}
          </button>
        </div>
        <span class="hint small muted">
          Up to {{ maxCount }} additional stripe{{ maxCount === 1 ? '' : 's' }} can be
          awarded now. Multiple stripes may be awarded in one grading.
        </span>
      </div>

      <div v-if="mode === 'belt' && checklist" class="card" style="box-shadow: none">
        <div class="card-body" style="padding: 13px">
          <div class="row" style="justify-content: space-between">
            <strong>Next-belt checklist</strong>
            <span class="small muted">
              {{ checklist.completedCount }} of {{ checklist.totalCount }} completed
            </span>
          </div>
          <div class="progress" style="margin-top: 8px" aria-hidden="true">
            <span
              :style="{
                width: `${checklist.totalCount ? (checklist.completedCount / checklist.totalCount) * 100 : 0}%`,
              }"
            />
          </div>
          <p v-if="checklist.totalCount === 0" class="small muted" style="margin-top: 8px">
            No criteria are configured for this belt. You can still promote.
          </p>
          <p v-else class="tiny muted" style="margin-top: 8px">
            Checklist completion is advisory and does not block promotion.
          </p>
        </div>
      </div>

      <div v-if="earlyWarning" class="banner banner-warning">{{ earlyWarning }}</div>
      <div v-if="checklistWarning" class="banner banner-warning">{{ checklistWarning }}</div>
      <div v-if="provisionalWarning" class="banner banner-warning">
        {{ provisionalWarning }}
      </div>
      <div v-if="eligibility.futureBeltDate" class="banner banner-warning">
        The current belt-award date is in the future. Review the historical record.
      </div>
      <div v-if="mode === 'stripe' && maxCount === 0" class="banner banner-warning">
        This belt already has the maximum number of stripes. A belt promotion is still
        available.
      </div>

      <div class="field">
        <label class="label" for="grading-month">{{ dateLabel }}</label>
        <input id="grading-month" v-model="dateInput" class="input" type="month" />
        <span class="small muted">
          Month/year precision only. The current month is suggested; a different month can
          be chosen.
        </span>
      </div>

      <div v-if="error" class="banner banner-error">{{ error }}</div>

      <p class="tiny muted">
        The coach has final authority. This grading is saved immediately and recorded in
        the grading history.
      </p>
    </div>

    <template #footer>
      <button type="button" class="btn btn-secondary" :disabled="submitting" @click="emit('close')">
        Cancel
      </button>
      <button type="button" class="btn btn-primary" :disabled="!canSubmit" @click="submit">
        {{ submitting ? 'Saving…' : title }}
      </button>
    </template>
  </ModalDialog>
</template>
