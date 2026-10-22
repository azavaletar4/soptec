<script setup lang="ts">
import { computed } from 'vue';
import CampoCustodiaView from './CampoCustodiaView.vue';
import { useAuthStore } from '@/stores/auth';
const auth = useAuthStore();
const identity = computed(() => auth.role === 'TECNICO_RED' ? auth.user?.id : null);
</script>

<template>
  <CampoCustodiaView v-if="identity" :key="identity" />
</template>
