<script setup lang="ts">
import { computed } from 'vue';
import { beltColors } from '../app/beltColors';

const props = withDefaults(
  defineProps<{
    id: string;
    name?: string;
    small?: boolean;
  }>(),
  { name: '', small: false },
);

const colors = computed(() => beltColors(props.id, props.name));
const label = computed(() => props.name || props.id);
</script>

<template>
  <span class="belt-badge" :class="{ 'belt-badge-sm': small }" :title="`${label} belt`">
    <span
      class="belt-swatch"
      :style="{ background: colors.bg, borderColor: colors.border }"
      aria-hidden="true"
    />
    {{ label }}
  </span>
</template>

<style scoped>
.belt-badge-sm {
  font-size: 0.74rem;
  padding: 2px 7px 2px 3px;
}
</style>
