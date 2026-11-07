<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import BeltBadge from '../components/BeltBadge.vue';
import EligibilityBadge from '../components/EligibilityBadge.vue';
import ModalDialog from '../components/ModalDialog.vue';
import StatCard from '../components/StatCard.vue';
import {
  addStudent,
  beltDistribution,
  beltOptions,
  currentNow,
  eligibilityList,
  eligibilitySummary,
  isBusy,
  recentGradings,
  state,
  studentsSorted,
} from '../app/store';
import { beltColors } from '../app/beltColors';
import { beltIndex, findBelt } from '../core/config';
import { compareMonthYear, monthYearLabel } from '../core/dates';
import type { EligibilityInfo, EligibilityStatus, Student } from '../core/models';

const router = useRouter();

const eligibilityMap = computed(
  () => new Map(eligibilityList.value.map((entry) => [entry.studentId, entry])),
);

interface Row {
  student: Student;
  eligibility: EligibilityInfo;
}

const rows = computed<Row[]>(() =>
  studentsSorted.value
    .map((student) => ({
      student,
      eligibility: eligibilityMap.value.get(student.id),
    }))
    .filter((row): row is Row => Boolean(row.eligibility)),
);

const search = ref('');
const beltFilter = ref('all');
const statusFilter = ref<'all' | EligibilityStatus>('all');
type SortKey = 'name' | 'belt' | 'stripes' | 'since' | 'months' | 'status';
const sortKey = ref<SortKey>('name');
const sortDir = ref<1 | -1>(1);

const statusOrder: Record<EligibilityStatus, number> = {
  eligible: 0,
  upcoming: 1,
  'not-eligible': 2,
  unknown: 3,
  highest: 4,
};

function compareRows(a: Row, b: Row): number {
  let result = 0;
  switch (sortKey.value) {
    case 'name':
      result = a.student.name.localeCompare(b.student.name);
      break;
    case 'belt':
      result =
        beltIndex(state.config, a.student.currentBelt) -
        beltIndex(state.config, b.student.currentBelt);
      break;
    case 'stripes':
      result = a.student.currentStripes - b.student.currentStripes;
      break;
    case 'since': {
      const aDate = a.eligibility.beltSince;
      const bDate = b.eligibility.beltSince;
      if (!aDate && !bDate) result = 0;
      else if (!aDate) result = 1;
      else if (!bDate) result = -1;
      else result = compareMonthYear(aDate, bDate);
      break;
    }
    case 'months': {
      const aMonths = a.eligibility.monthsAtBelt;
      const bMonths = b.eligibility.monthsAtBelt;
      if (aMonths == null && bMonths == null) result = 0;
      else if (aMonths == null) result = 1;
      else if (bMonths == null) result = -1;
      else result = aMonths - bMonths;
      break;
    }
    case 'status':
      result = statusOrder[a.eligibility.status] - statusOrder[b.eligibility.status];
      break;
  }
  if (result === 0) result = a.student.name.localeCompare(b.student.name);
  return result * sortDir.value;
}

const filteredRows = computed(() =>
  rows.value
    .filter((row) => {
      if (beltFilter.value !== 'all' && row.student.currentBelt !== beltFilter.value) {
        return false;
      }
      if (statusFilter.value !== 'all' && row.eligibility.status !== statusFilter.value) {
        return false;
      }
      const query = search.value.trim().toLowerCase();
      if (query && !row.student.name.toLowerCase().includes(query)) return false;
      return true;
    })
    .sort(compareRows),
);

function sortBy(key: SortKey): void {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 1 ? -1 : 1;
  } else {
    sortKey.value = key;
    sortDir.value = 1;
  }
}

function sortIndicator(key: SortKey): string {
  if (sortKey.value !== key) return '';
  return sortDir.value === 1 ? '▲' : '▼';
}

function beltMax(student: Student): number {
  return findBelt(state.config, student.currentBelt)?.maxStripes ?? 0;
}

function beltName(beltId: string): string {
  return findBelt(state.config, beltId)?.name ?? beltId;
}

function openStudent(studentId: string): void {
  router.push({ name: 'student', params: { id: studentId } });
}

function clearFilters(): void {
  search.value = '';
  beltFilter.value = 'all';
  statusFilter.value = 'all';
}

const maxBeltCount = computed(() =>
  Math.max(1, ...beltDistribution.value.map((entry) => entry.count)),
);

const showAddStudent = ref(false);
const newStudentName = ref('');
const addError = ref('');

function openAddStudent(): void {
  newStudentName.value = '';
  addError.value = '';
  showAddStudent.value = true;
}

async function submitAddStudent(): Promise<void> {
  addError.value = '';
  const result = await addStudent(newStudentName.value);
  if (!result.ok) {
    addError.value = result.error;
    return;
  }
  showAddStudent.value = false;
  newStudentName.value = '';
}
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1>Grading overview</h1>
        <p>
          {{ monthYearLabel(currentNow) }} · {{ eligibilitySummary.total }} students ·
          Eligibility indicators are advisory and never block a grading decision.
        </p>
      </div>
      <div class="row">
        <button type="button" class="btn btn-secondary" @click="openAddStudent">
          + Add student
        </button>
        <RouterLink class="btn btn-primary" to="/settings">Import data</RouterLink>
      </div>
    </div>

    <div class="summary-grid">
      <StatCard
        label="Total students"
        :value="eligibilitySummary.total"
        hint="One record per student"
        tone="red"
      />
      <StatCard
        label="Eligible"
        :value="eligibilitySummary.eligible"
        hint="Minimum time reached"
        tone="green"
      />
      <StatCard
        label="Upcoming"
        :value="eligibilitySummary.upcoming"
        :hint="`Within ${state.config.upcomingEligibilityMonths} calendar months`"
        tone="amber"
      />
      <StatCard
        label="Highest belt"
        :value="eligibilitySummary.highest"
        hint="No next belt configured"
        tone="dark"
      />
    </div>

    <div class="dashboard-grid">
      <section class="card">
        <div class="card-head">
          <h2>Belt distribution</h2>
          <span class="small muted">{{ eligibilitySummary.total }} students</span>
        </div>
        <div class="card-body">
          <div class="distribution">
            <div
              v-for="entry in beltDistribution"
              :key="entry.beltId"
              class="distribution-row"
            >
              <BeltBadge :id="entry.beltId" :name="entry.name" small />
              <div class="distribution-track">
                <div
                  class="distribution-fill"
                  :style="{
                    width: `${(entry.count / maxBeltCount) * 100}%`,
                    background: beltColors(entry.beltId, entry.name).bg,
                    border:
                      entry.beltId === 'white'
                        ? `1px solid ${beltColors(entry.beltId, entry.name).border}`
                        : 'none',
                  }"
                />
              </div>
              <strong style="text-align: right">{{ entry.count }}</strong>
            </div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>Recent grading activity</h2>
          <span class="small muted">Latest {{ recentGradings.length }}</span>
        </div>
        <div class="card-body" style="padding-top: 8px; padding-bottom: 8px">
          <div v-if="recentGradings.length > 0" class="activity-list">
            <RouterLink
              v-for="entry in recentGradings"
              :key="entry.id"
              class="activity-item"
              :to="{ name: 'student', params: { id: entry.studentId } }"
            >
              <span class="activity-date">{{ entry.date }}</span>
              <span style="flex: 1">
                <strong>{{ entry.studentName }}</strong>
                <span class="muted small" style="margin-left: 5px">
                  {{ entry.type === 'belt' ? 'belt promotion' : `${entry.stripesAwarded} stripe(s)` }}
                </span>
              </span>
              <BeltBadge :id="entry.belt" :name="beltName(entry.belt)" small />
            </RouterLink>
          </div>
          <div v-else class="empty" style="padding: 20px">
            <strong>No grading activity yet.</strong>
            <span class="small">Promotions and stripe awards appear here.</span>
          </div>
        </div>
      </section>
    </div>

    <section class="card">
      <div class="card-head">
        <h2>Students</h2>
        <span class="small muted">
          {{ filteredRows.length }} of {{ rows.length }} shown
        </span>
      </div>
      <div class="card-body" style="padding-bottom: 10px">
        <div class="filters">
          <div class="field search-field">
            <label class="label" for="student-search">Search</label>
            <input
              id="student-search"
              v-model="search"
              class="input"
              type="search"
              placeholder="Student name…"
            />
          </div>
          <div class="field">
            <label class="label" for="belt-filter">Belt</label>
            <select id="belt-filter" v-model="beltFilter" class="select">
              <option value="all">All belts</option>
              <option v-for="belt in beltOptions" :key="belt.id" :value="belt.id">
                {{ belt.name }}
              </option>
            </select>
          </div>
          <div class="field">
            <label class="label" for="status-filter">Eligibility</label>
            <select id="status-filter" v-model="statusFilter" class="select">
              <option value="all">All statuses</option>
              <option value="eligible">Eligible</option>
              <option value="upcoming">Upcoming</option>
              <option value="not-eligible">Not yet eligible</option>
              <option value="unknown">Unknown</option>
              <option value="highest">Highest belt</option>
            </select>
          </div>
          <button
            v-if="search || beltFilter !== 'all' || statusFilter !== 'all'"
            type="button"
            class="btn btn-ghost btn-sm"
            @click="clearFilters"
          >
            Clear filters
          </button>
        </div>
      </div>

      <div v-if="rows.length === 0" class="empty">
        <strong>No students yet.</strong>
        <span class="small">
          Add a student manually or import the legacy spreadsheet in
          <RouterLink to="/settings">Data settings</RouterLink>.
        </span>
        <div class="row" style="justify-content: center; margin-top: 12px">
          <button type="button" class="btn btn-primary" @click="openAddStudent">
            + Add student
          </button>
        </div>
      </div>

      <div v-else-if="filteredRows.length === 0" class="empty">
        <strong>No students match these filters.</strong>
        <span class="small">Try clearing the search or selecting another belt/status.</span>
      </div>

      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>
                <button class="sort-button" type="button" @click="sortBy('name')">
                  Student <span aria-hidden="true">{{ sortIndicator('name') }}</span>
                </button>
              </th>
              <th>
                <button class="sort-button" type="button" @click="sortBy('belt')">
                  Current belt <span aria-hidden="true">{{ sortIndicator('belt') }}</span>
                </button>
              </th>
              <th>
                <button class="sort-button" type="button" @click="sortBy('stripes')">
                  Stripes <span aria-hidden="true">{{ sortIndicator('stripes') }}</span>
                </button>
              </th>
              <th class="hide-mobile">
                <button class="sort-button" type="button" @click="sortBy('since')">
                  Belt since <span aria-hidden="true">{{ sortIndicator('since') }}</span>
                </button>
              </th>
              <th class="hide-mobile">
                <button class="sort-button" type="button" @click="sortBy('months')">
                  Months <span aria-hidden="true">{{ sortIndicator('months') }}</span>
                </button>
              </th>
              <th>Next belt</th>
              <th>
                <button class="sort-button" type="button" @click="sortBy('status')">
                  Eligibility <span aria-hidden="true">{{ sortIndicator('status') }}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in filteredRows"
              :key="row.student.id"
              class="clickable"
              :class="{
                'row-eligible': row.eligibility.status === 'eligible',
                'row-upcoming': row.eligibility.status === 'upcoming',
              }"
              tabindex="0"
              @click="openStudent(row.student.id)"
              @keydown.enter="openStudent(row.student.id)"
            >
              <td>
                <RouterLink
                  :to="{ name: 'student', params: { id: row.student.id } }"
                  @click.stop
                >
                  <strong>{{ row.student.name }}</strong>
                </RouterLink>
                <div class="tiny muted">{{ row.student.id }}</div>
              </td>
              <td>
                <BeltBadge
                  :id="row.student.currentBelt"
                  :name="row.eligibility.currentBelt?.name ?? row.student.currentBelt"
                  small
                />
              </td>
              <td class="nowrap">
                {{ row.student.currentStripes }} / {{ beltMax(row.student) }}
              </td>
              <td class="hide-mobile nowrap">
                <template v-if="row.eligibility.beltSince">
                  {{ monthYearLabel(row.eligibility.beltSince) }}
                  <span
                    v-if="row.eligibility.beltSinceProvisional"
                    class="provisional-mark"
                    title="Provisional start inferred from the earliest stripe date"
                  >
                    *
                  </span>
                </template>
                <span v-else class="muted">Unknown</span>
              </td>
              <td class="hide-mobile nowrap">
                <template v-if="row.eligibility.monthsAtBelt != null">
                  <span :class="{ 'muted': row.eligibility.futureBeltDate }">
                    {{ row.eligibility.monthsAtBelt }}
                    <span v-if="row.eligibility.futureBeltDate" class="tiny"> (future)</span>
                  </span>
                </template>
                <span v-else class="muted">—</span>
              </td>
              <td>
                <BeltBadge
                  v-if="row.eligibility.nextBelt"
                  :id="row.eligibility.nextBelt.id"
                  :name="row.eligibility.nextBelt.name"
                  small
                />
                <span v-else class="muted small">—</span>
              </td>
              <td>
                <EligibilityBadge
                  :status="row.eligibility.status"
                  :provisional="row.eligibility.beltSinceProvisional"
                  :future="row.eligibility.futureBeltDate"
                  :title="row.eligibility.warnings[0] ?? ''"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <ModalDialog
      :open="showAddStudent"
      title="Add student"
      @close="showAddStudent = false"
    >
      <div class="stack">
        <div class="field">
          <label class="label" for="new-student-name">Student name</label>
          <input
            id="new-student-name"
            v-model="newStudentName"
            class="input"
            type="text"
            maxlength="120"
            placeholder="e.g. Anna Weber"
            @keydown.enter="submitAddStudent"
          />
          <span class="small muted">
            New students start at the first configured belt (white) with zero stripes.
          </span>
        </div>
        <div v-if="addError" class="banner banner-error">{{ addError }}</div>
      </div>
      <template #footer>
        <button type="button" class="btn btn-secondary" @click="showAddStudent = false">
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="isBusy || !newStudentName.trim()"
          @click="submitAddStudent"
        >
          {{ isBusy ? 'Saving…' : 'Add student' }}
        </button>
      </template>
    </ModalDialog>
  </div>
</template>
