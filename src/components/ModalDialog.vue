<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    wide?: boolean;
    closeOnBackdrop?: boolean;
  }>(),
  { wide: false, closeOnBackdrop: true },
);

const emit = defineEmits<{ close: [] }>();
const dialogRef = ref<HTMLElement | null>(null);

function close(): void {
  emit('close');
}

function onBackdrop(): void {
  if (props.closeOnBackdrop) close();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close();
}

function lockScroll(locked: boolean): void {
  document.body.style.overflow = locked ? 'hidden' : '';
}

watch(
  () => props.open,
  async (open) => {
    lockScroll(open);
    if (open) {
      document.addEventListener('keydown', onKeydown);
      await nextTick();
      const focusable = dialogRef.value?.querySelector<HTMLElement>(
        'input, select, textarea, button',
      );
      focusable?.focus();
    } else {
      document.removeEventListener('keydown', onKeydown);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  lockScroll(false);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop" @click.self="onBackdrop">
      <div
        ref="dialogRef"
        class="modal"
        :class="{ wide }"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <header class="modal-head">
          <h2>{{ title }}</h2>
          <button class="modal-close" type="button" aria-label="Close" @click="close">×</button>
        </header>
        <div class="modal-body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="modal-foot">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
