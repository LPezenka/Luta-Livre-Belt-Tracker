<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string;
    value: string | number;
    hint?: string;
    tone?: 'red' | 'green' | 'amber' | 'dark' | 'neutral';
  }>(),
  { hint: '', tone: 'neutral' },
);
</script>

<template>
  <div class="stat-card" :class="`tone-${tone}`">
    <div class="stat-label">{{ label }}</div>
    <div class="stat-value">{{ value }}</div>
    <div v-if="hint" class="stat-hint">{{ hint }}</div>
  </div>
</template>
