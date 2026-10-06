<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';

// Fase 113: le da a "Histórico de Atendidos" el mismo protagonismo que
// "Operaciones de Hoy" — antes era un link de texto chiquito debajo del
// título, facil de pasar por alto. Reusado en ambas vistas para que la
// pestaña activa se note igual desde cualquiera de las dos.
const route = useRoute();
const router = useRouter();

const TABS = [
  { to: '/soporte', label: '📋 Operaciones de Hoy' },
  { to: '/soporte/historico', label: '📁 Histórico de Atendidos' },
];
</script>

<template>
  <div class="flex flex-wrap gap-2 mb-3">
    <button
      v-for="tab in TABS"
      :key="tab.to"
      type="button"
      class="px-4 py-2 rounded-lg text-sm font-semibold"
      :class="route.path === tab.to ? 'bg-sky-500 text-slate-950' : 'bg-slate-100 text-slate-600 hover:text-slate-900'"
      @click="router.push(tab.to)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>
