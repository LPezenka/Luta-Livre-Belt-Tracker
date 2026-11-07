<script setup lang="ts">
import type { ChecklistSummary } from '../core/checklists';

withDefaults(
  defineProps<{
    summary: ChecklistSummary;
    busy?: boolean;
    showManageLink?: boolean;
  }>(),
  { busy: false, showManageLink: true },
);

const emit = defineEmits<{
  toggle: [itemId: string, completed: boolean];
}>();

function onToggle(event: Event, itemId: string): void {
  const checked = (event.target as HTMLInputElement).checked;
  emit('toggle', itemId, checked);
}
</script>

<template>
  <div>
    <div class="row" style="justify-content: space-between; margin-bottom: 10px">
      <div>
        <h3>
          <template v-if="summary.beltId">
            Checklist for {{ summary.beltName }} belt
          </template>
          <template v-else>Next-belt checklist</template>
        </h3>
        <p class="small muted" style="margin-top: 3px">
          <template v-if="summary.beltId">
            {{ summary.completedCount }} of {{ summary.totalCount }} criteria completed
          </template>
          <template v-else>No next belt is configured.</template>
        </p>
      </div>
      <RouterLink v-if="showManageLink" class="btn btn-ghost btn-sm" to="/checklists">
        Manage checklists
      </RouterLink>
    </div>

    <template v-if="summary.beltId">
      <div class="progress" style="margin-bottom: 10px" aria-hidden="true">
        <span
          :style="{
            width: `${summary.totalCount ? (summary.completedCount / summary.totalCount) * 100 : 0}%`,
          }"
        />
      </div>

      <div v-if="summary.items.length > 0" class="checklist">
        <label
          v-for="(entry, index) in summary.items"
          :key="entry.item.id"
          class="checklist-item"
        >
          <input
            type="checkbox"
            :checked="entry.completed"
            :disabled="busy"
            @change="onToggle($event, entry.item.id)"
          />
          <span class="index">{{ index + 1 }}</span>
          <span class="description" :class="{ done: entry.completed }">
            {{ entry.item.description }}
          </span>
        </label>
      </div>

      <div v-else class="empty" style="padding: 18px">
        <strong>No criteria configured for {{ summary.beltName }} belt.</strong>
        <span class="small">
          Add criteria in
          <RouterLink to="/checklists">Checklist management</RouterLink>.
        </span>
      </div>

      <p class="tiny muted" style="margin-top: 10px">
        Checklist completion is advisory. It is tracked per student and never blocks a
        promotion.
      </p>
    </template>

    <div v-else class="empty" style="padding: 18px">
      <strong>Highest configured belt.</strong>
      <span class="small">There is no next-belt checklist for this student.</span>
    </div>
  </div>
</template>
