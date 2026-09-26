<script setup lang="ts">
defineProps<{
  title: string;
  icon?: string;
  subtitle?: string;
}>();
</script>

<template>
  <div class="surface p-5 mb-4">
    <div class="flex items-start justify-between gap-3 mb-4">
      <div>
        <h3 class="text-base font-semibold flex items-center gap-2">
          <span v-if="icon">{{ icon }}</span>
          {{ title }}
        </h3>
        <p v-if="subtitle" class="text-xs text-slate-500 mt-1">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="shrink-0">
        <slot name="actions" />
      </div>
    </div>
    <slot />
  </div>
</template>
