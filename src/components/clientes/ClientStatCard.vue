<script setup lang="ts">
defineProps<{
  icon: string;
  label: string;
}>();
</script>

<template>
  <div class="surface p-4 flex items-start gap-3">
    <span class="w-10 h-10 rounded-full bg-sky-500/15 text-sky-600 flex items-center justify-center text-lg shrink-0">
      {{ icon }}
    </span>
    <div class="min-w-0 flex-1">
      <div class="text-xs text-slate-500 mb-1">{{ label }}</div>
      <slot />
    </div>
  </div>
</template>
