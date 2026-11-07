<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  current: number;
  max: number;
}>();

const slots = computed(() => Array.from({ length: Math.max(0, props.max) }, (_, index) => index));
const over = computed(() => props.current > props.max);
</script>

<template>
  <span class="stripe-meter" :class="{ over }">
    <span class="stripes" aria-hidden="true">
      <span
        v-for="index in slots"
        :key="index"
        class="stripe"
        :class="{ filled: index < current }"
      />
    </span>
    <span class="stripe-text">
      <template v-if="max === 0">No stripes configured</template>
      <template v-else>{{ current }} / {{ max }} stripes</template>
      <span v-if="over" class="over-text"> (over maximum)</span>
    </span>
  </span>
</template>

<style scoped>
.stripe-meter {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.stripe-text {
  font-size: 0.8rem;
  color: var(--muted);
  white-space: nowrap;
}

.over .stripe-text {
  color: #a15c00;
}

.over-text {
  font-weight: 700;
}
</style>
