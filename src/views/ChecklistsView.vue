<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BeltBadge from '../components/BeltBadge.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import {
  addChecklistItem,
  beltOptions,
  deleteChecklistItem,
  isBusy,
  reorderChecklistItem,
  setChecklistItemArchived,
  state,
  updateChecklistItem,
} from '../app/store';
import {
  checklistCompletionCount,
  checklistItemsForBelt,
} from '../core/checklists';
import type { ChecklistItem } from '../core/models';

const selectedBeltId = ref(beltOptions.value[0]?.id ?? '');

watch(
  () => beltOptions.value.map((belt) => belt.id),
  (ids) => {
    if (!ids.includes(selectedBeltId.value)) {
      selectedBeltId.value = ids[0] ?? '';
    }
  },
  { immediate: true },
);

const selectedBelt = computed(() =>
  beltOptions.value.find((belt) => belt.id === selectedBeltId.value) ?? null,
);
const activeItems = computed(() =>
  checklistItemsForBelt(state, selectedBeltId.value),
);
const archivedItems = computed(() =>
  checklistItemsForBelt(state, selectedBeltId.value, true).filter((item) => item.archived),
);

const newDescription = ref('');
const addError = ref('');
const showArchived = ref(false);

async function addItem(): Promise<void> {
  addError.value = '';
  const result = await addChecklistItem(selectedBeltId.value, newDescription.value);
  if (!result.ok) {
    addError.value = result.error;
    return;
  }
  newDescription.value = '';
}

const editingId = ref<string | null>(null);
const editText = ref('');

function startEdit(item: ChecklistItem): void {
  editingId.value = item.id;
  editText.value = item.description;
}

function cancelEdit(): void {
  editingId.value = null;
  editText.value = '';
}

async function saveEdit(item: ChecklistItem): Promise<void> {
  const result = await updateChecklistItem(item.id, editText.value);
  if (result.ok) cancelEdit();
}

async function archiveItem(item: ChecklistItem): Promise<void> {
  await setChecklistItemArchived(item.id, true);
}

async function restoreItem(item: ChecklistItem): Promise<void> {
  await setChecklistItemArchived(item.id, false);
}

const deleteTarget = ref<ChecklistItem | null>(null);
const deleteMessage = computed(() =>
  deleteTarget.value
    ? `Delete "${deleteTarget.value.description}"? This is only allowed when no student completion records reference it.`
    : '',
);

async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value) return;
  const result = await deleteChecklistItem(deleteTarget.value.id);
  if (result.ok) deleteTarget.value = null;
}

function completionCount(itemId: string): number {
  return checklistCompletionCount(state, itemId);
}
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1>Promotion checklists</h1>
        <p>
          Checklists belong to the belt being awarded, not the student's current belt.
          Completion is tracked per student and is advisory only.
        </p>
      </div>
      <RouterLink class="btn btn-secondary" to="/settings">Belt settings</RouterLink>
    </div>

    <section class="card">
      <div class="card-head">
        <div class="row">
          <label class="label" for="checklist-belt" style="margin: 0">Belt</label>
          <select id="checklist-belt" v-model="selectedBeltId" class="select" style="width: auto">
            <option v-for="belt in beltOptions" :key="belt.id" :value="belt.id">
              {{ belt.name }}
            </option>
          </select>
          <BeltBadge
            v-if="selectedBelt"
            :id="selectedBelt.id"
            :name="selectedBelt.name"
            small
          />
        </div>
        <span class="small muted">
          {{ activeItems.length }} active item(s)
          <template v-if="archivedItems.length"> · {{ archivedItems.length }} archived</template>
        </span>
      </div>

      <div class="card-body stack">
        <div class="banner banner-info">
          <span>
            These criteria are shown when a student is considered for
            <strong>{{ selectedBelt?.name ?? 'this' }} belt</strong>. They never block a
            promotion. Editing a description keeps existing student completion records.
          </span>
        </div>

        <div class="row" style="align-items: flex-end">
          <div class="field" style="flex: 1; min-width: 220px">
            <label class="label" for="new-checklist-item">Add requirement</label>
            <input
              id="new-checklist-item"
              v-model="newDescription"
              class="input"
              type="text"
              placeholder="e.g. Guard retention"
              @keydown.enter="addItem"
            />
          </div>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="isBusy || !newDescription.trim()"
            @click="addItem"
          >
            + Add item
          </button>
        </div>
        <div v-if="addError" class="banner banner-error">{{ addError }}</div>

        <div v-if="activeItems.length === 0" class="empty">
          <strong>No active criteria for {{ selectedBelt?.name ?? 'this' }} belt.</strong>
          <span class="small">Add the first requirement above. The checklist is optional.</span>
        </div>

        <div v-else class="checklist">
          <div
            v-for="(item, index) in activeItems"
            :key="item.id"
            class="checklist-item"
            style="align-items: center"
          >
            <span class="index">{{ index + 1 }}.</span>
            <div class="description">
              <template v-if="editingId === item.id">
                <div class="row" style="gap: 6px">
                  <input
                    v-model="editText"
                    class="input input-sm"
                    type="text"
                    style="flex: 1; min-width: 180px"
                    @keydown.enter="saveEdit(item)"
                    @keydown.esc="cancelEdit"
                  />
                  <button
                    type="button"
                    class="btn btn-primary btn-sm"
                    :disabled="isBusy || !editText.trim()"
                    @click="saveEdit(item)"
                  >
                    Save
                  </button>
                  <button type="button" class="btn btn-secondary btn-sm" @click="cancelEdit">
                    Cancel
                  </button>
                </div>
              </template>
              <template v-else>
                <div>{{ item.description }}</div>
                <div class="tiny muted">
                  <template v-if="completionCount(item.id) > 0">
                    {{ completionCount(item.id) }} student(s) have this marked complete
                  </template>
                  <template v-else>No completion records yet</template>
                  · item {{ item.id }}
                </div>
              </template>
            </div>
            <div class="order-buttons">
              <button
                type="button"
                class="btn btn-secondary btn-icon btn-sm"
                title="Move up"
                :disabled="isBusy || index === 0"
                @click="reorderChecklistItem(item.id, 'up')"
              >
                ↑
              </button>
              <button
                type="button"
                class="btn btn-secondary btn-icon btn-sm"
                title="Move down"
                :disabled="isBusy || index === activeItems.length - 1"
                @click="reorderChecklistItem(item.id, 'down')"
              >
                ↓
              </button>
            </div>
            <div class="history-actions">
              <button
                v-if="editingId !== item.id"
                type="button"
                class="btn btn-ghost btn-sm"
                :disabled="isBusy"
                @click="startEdit(item)"
              >
                Edit
              </button>
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                :disabled="isBusy"
                title="Archive keeps student completion records"
                @click="archiveItem(item)"
              >
                Archive
              </button>
              <button
                type="button"
                class="btn btn-danger btn-sm"
                :disabled="isBusy || completionCount(item.id) > 0"
                :title="
                  completionCount(item.id) > 0
                    ? 'Cannot delete: completion records exist. Archive instead.'
                    : 'Delete this item'
                "
                @click="deleteTarget = item"
              >
                Delete
              </button>
            </div>
          </div>
        </div>

        <div v-if="archivedItems.length > 0">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            @click="showArchived = !showArchived"
          >
            {{ showArchived ? 'Hide' : 'Show' }} archived items ({{ archivedItems.length }})
          </button>
          <div v-if="showArchived" class="checklist" style="margin-top: 8px">
            <div
              v-for="item in archivedItems"
              :key="item.id"
              class="checklist-item"
              style="align-items: center; opacity: 0.8"
            >
              <span class="badge badge-neutral">Archived</span>
              <div class="description">
                <div>{{ item.description }}</div>
                <div class="tiny muted">
                  {{ completionCount(item.id) }} completion record(s) retained · item
                  {{ item.id }}
                </div>
              </div>
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                :disabled="isBusy"
                @click="restoreItem(item)"
              >
                Restore
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <ConfirmDialog
      :open="Boolean(deleteTarget)"
      title="Delete checklist item"
      :message="deleteMessage"
      confirm-label="Delete item"
      danger
      :busy="isBusy"
      @close="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </div>
</template>
