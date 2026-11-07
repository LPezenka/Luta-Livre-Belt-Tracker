<script setup lang="ts">
import { computed } from 'vue';
import { ELIGIBILITY_LABELS, ELIGIBILITY_SYMBOLS } from '../core/eligibility';
import type { EligibilityStatus } from '../core/models';

const props = withDefaults(
  defineProps<{
    status: EligibilityStatus;
    provisional?: boolean;
    future?: boolean;
    title?: string;
  }>(),
  { provisional: false, future: false, title: '' },
);

const label = computed(() => ELIGIBILITY_LABELS[props.status]);
const symbol = computed(() => ELIGIBILITY_SYMBOLS[props.status]);
const tooltip = computed(() => {
  if (props.title) return props.title;
  if (props.future) return 'The belt-award date is in the future; review the history.';
  if (props.provisional) return 'Based on a provisional belt start date.';
  return label.value;
});
</script>

<template>
  <span
    class="badge"
    :class="`badge-${status}`"
    :title="tooltip"
  >
    <span aria-hidden="true">{{ symbol }}</span>
    <span>{{ label }}</span>
    <span v-if="provisional" class="badge-provisional-mark" title="Provisional date">*</span>
  </span>
</template>

<style scoped>
.badge-provisional-mark {
  font-weight: 800;
  color: #7a4a00;
}
</style>
