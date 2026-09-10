<script setup lang="ts">
import AppLayout from '@/components/layout/AppLayout.vue';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();

const METRICAS = [
  { label: 'Clientes activos', value: '—' },
  { label: 'ONUs online', value: '—' },
  { label: 'Facturado este mes', value: '—' },
  { label: 'Tickets abiertos', value: '—' },
];
</script>

<template>
  <AppLayout>
    <h1 class="text-2xl font-semibold mb-1">Panel SmartRayco</h1>
    <p class="text-slate-400 mb-6">Sesion iniciada como {{ auth.user?.email }}</p>

    <div class="grid gap-4" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))">
      <div v-for="m in METRICAS" :key="m.label" class="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div class="text-2xl font-semibold">{{ m.value }}</div>
        <div class="text-sm text-slate-400 mt-1">{{ m.label }}</div>
      </div>
    </div>
  </AppLayout>
</template>
