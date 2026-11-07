<script setup lang="ts">
import ModalDialog from './ModalDialog.vue';

withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    busy?: boolean;
  }>(),
  {
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    danger: false,
    busy: false,
  },
);

const emit = defineEmits<{ close: []; confirm: [] }>();
</script>

<template>
  <ModalDialog :open="open" :title="title" @close="emit('close')">
    <p>{{ message }}</p>
    <slot />
    <template #footer>
      <button type="button" class="btn btn-secondary" :disabled="busy" @click="emit('close')">
        {{ cancelLabel }}
      </button>
      <button
        type="button"
        class="btn"
        :class="danger ? 'btn-danger' : 'btn-primary'"
        :disabled="busy"
        @click="emit('confirm')"
      >
        {{ busy ? 'Working…' : confirmLabel }}
      </button>
    </template>
  </ModalDialog>
</template>
