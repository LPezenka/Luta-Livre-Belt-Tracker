<script setup lang="ts">
import { computed } from 'vue';
import {
  capabilities,
  lastSavedAt,
  sourceLabel,
  status as saveStatus,
  statusMessage,
} from '../app/store';

const label = computed(() => {
  switch (saveStatus.value) {
    case 'loading':
      return 'Loading…';
    case 'saved':
      return 'Saved to CSV';
    case 'saving':
      return 'Saving…';
    case 'unsaved':
      return 'Working copy';
    case 'error':
      return 'Save failed';
    default:
      return 'Unknown';
  }
});

const title = computed(() => {
  const parts = [statusMessage.value, `Source: ${sourceLabel.value}`];
  if (capabilities.value.kind === 'pwa-draft') {
    parts.push('Changes are kept in this browser only until exported.');
  }
  if (lastSavedAt.value) {
    parts.push(`Last written: ${new Date(lastSavedAt.value).toLocaleString()}`);
  }
  return parts.filter(Boolean).join('\n');
});
</script>

<template>
  <span class="save-status" :class="saveStatus" :title="title" role="status" aria-live="polite">
    <span class="dot" aria-hidden="true" />
    <span>{{ label }}</span>
  </span>
</template>
