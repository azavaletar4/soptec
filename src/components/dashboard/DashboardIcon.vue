<script setup lang="ts">
defineProps<{ name: 'arrow' | 'chevron' | 'refresh' | 'network' | 'warning' | 'plus' }>();
const paths = {
  arrow: 'M5 12h14m-5-5 5 5-5 5', chevron: 'm9 5 7 7-7 7',
  refresh: 'M20 10a8 8 0 1 0-1 8m1-15v7h-7',
  network: 'M3 9a14 14 0 0 1 18 0M6 13a9 9 0 0 1 12 0m-9 4a4 4 0 0 1 6 0m-3 4h.01',
  warning: 'm12 3 10 18H2L12 3Zm0 6v5m0 3v.01', plus: 'M12 5v14M5 12h14',
};
</script>
<template><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name]" /></svg></template>
