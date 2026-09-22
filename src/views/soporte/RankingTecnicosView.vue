<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useSoporteRankingStore } from '@/stores/soporteRanking';
import { getErrorMessage } from '@/lib/errors';

const router = useRouter();
const rankingStore = useSoporteRankingStore();

const MONTH_LABEL = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const now = new Date();
const mes = ref(now.getMonth() + 1);
const anio = ref(now.getFullYear());
const loadError = ref<string | null>(null);

const years = computed(() => {
  const current = now.getFullYear();
  return Array.from({ length: 5 }, (_, i) => current - i);
});

async function load() {
  loadError.value = null;
  try {
    await rankingStore.fetchRanking(mes.value, anio.value);
  } catch (e) {
    loadError.value = getErrorMessage(e, 'Error al calcular el ranking');
  }
}

onMounted(load);

const winner = computed(() => rankingStore.ranking.find((r) => r.ranking === 1) ?? null);
const rest = computed(() => rankingStore.ranking.filter((r) => r.ranking !== 1));

function handlePrint() {
  window.print();
}

// Export simple a CSV, sin dependencias — el navegador lo descarga solo.
function handleExportCsv() {
  const header = ['Ranking', 'Tecnico', 'Instalaciones', 'Averias', 'Reconexiones', 'Reincidencias', 'Puntos'];
  const rows = rankingStore.ranking.map((r) => [
    r.ranking,
    r.technician_name,
    r.installations_count,
    r.averias_count,
    r.reconexiones_count,
    r.reincidencias_count,
    r.total_points,
  ]);
  const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ranking-tecnicos-${anio.value}-${String(mes.value).padStart(2, '0')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <AppLayout>
    <button class="text-sm text-slate-600 hover:text-slate-900 mb-4 print:hidden" @click="router.push('/soporte')">
      ← Volver a soporte
    </button>

    <div class="flex flex-wrap items-center justify-between gap-3 mb-6 print:hidden">
      <div>
        <h1 class="text-2xl font-semibold">Ranking de técnicos</h1>
        <p class="text-slate-600 text-sm mt-1">Puntaje mensual — instalaciones, averías, reconexiones y reincidencias</p>
      </div>
      <div class="flex gap-2">
        <button class="btn-ghost text-xs" :disabled="!rankingStore.ranking.length" @click="handleExportCsv">Exportar CSV</button>
        <button class="btn-ghost text-xs" :disabled="!rankingStore.ranking.length" @click="handlePrint">Imprimir</button>
      </div>
    </div>

    <div class="flex flex-wrap items-end gap-3 mb-6 print:hidden">
      <div>
        <label class="block text-xs text-slate-600 mb-1">Mes</label>
        <select v-model.number="mes" class="field-input" @change="load">
          <option v-for="(label, idx) in MONTH_LABEL" :key="idx" :value="idx + 1">{{ label }}</option>
        </select>
      </div>
      <div>
        <label class="block text-xs text-slate-600 mb-1">Año</label>
        <select v-model.number="anio" class="field-input" @change="load">
          <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
        </select>
      </div>
    </div>

    <h2 class="hidden print:block text-lg font-semibold mb-4">
      Ranking de técnicos — {{ MONTH_LABEL[mes - 1] }} {{ anio }}
    </h2>

    <p v-if="rankingStore.loading" class="text-slate-500 text-sm">Calculando...</p>
    <p v-else-if="loadError" class="text-sm text-red-600">{{ loadError }}</p>
    <p v-else-if="!rankingStore.ranking.length" class="text-slate-500 text-sm">
      Nadie sumó puntos en {{ MONTH_LABEL[mes - 1] }} {{ anio }} (sin instalaciones completadas ni tickets resueltos en el periodo).
    </p>

    <template v-else>
      <!-- Tecnico del mes -->
      <div
        v-if="winner"
        class="rounded-2xl p-6 mb-6 flex items-center gap-5 text-white"
        style="background: linear-gradient(135deg, #f59e0b, #d97706)"
      >
        <div class="text-5xl">🏆</div>
        <div class="flex-1">
          <div class="text-xs uppercase tracking-wide text-white/80">Técnico del mes</div>
          <div class="text-2xl font-bold">{{ winner.technician_name }}</div>
          <div class="text-sm text-white/90 mt-1">
            {{ winner.installations_count }} instalaciones · {{ winner.averias_count }} averías ·
            {{ winner.reconexiones_count }} reconexiones
            <span v-if="winner.reincidencias_count"> · {{ winner.reincidencias_count }} reincidencias</span>
          </div>
        </div>
        <div class="text-right">
          <div class="text-4xl font-bold">{{ winner.total_points }}</div>
          <div class="text-xs text-white/80">puntos</div>
        </div>
      </div>

      <div class="table-shell">
        <table class="w-full text-sm min-w-[720px]">
          <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
            <tr>
              <th class="text-left px-4 py-3">#</th>
              <th class="text-left px-4 py-3">Técnico</th>
              <th class="text-right px-4 py-3">Instalaciones</th>
              <th class="text-right px-4 py-3">Averías</th>
              <th class="text-right px-4 py-3">Reconexiones</th>
              <th class="text-right px-4 py-3">Reincidencias</th>
              <th class="text-right px-4 py-3">Puntos</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rest" :key="r.technician_id" class="border-t border-slate-200">
              <td class="px-4 py-3 font-mono text-xs text-slate-500">#{{ r.ranking }}</td>
              <td class="px-4 py-3 font-medium text-slate-900">{{ r.technician_name }}</td>
              <td class="px-4 py-3 text-right text-slate-600">{{ r.installations_count }}</td>
              <td class="px-4 py-3 text-right text-slate-600">{{ r.averias_count }}</td>
              <td class="px-4 py-3 text-right text-slate-600">{{ r.reconexiones_count }}</td>
              <td class="px-4 py-3 text-right" :class="r.reincidencias_count ? 'text-red-600' : 'text-slate-600'">
                {{ r.reincidencias_count || '—' }}
              </td>
              <td class="px-4 py-3 text-right font-semibold">{{ r.total_points }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="text-xs text-slate-500 mt-3">
        Reglas: +10 instalación nueva completada, +5 avería/mantenimiento resuelto, +3 reconexión/traslado resuelto,
        −5 por reincidencia (mismo cliente reporta otra avería dentro de los 7 días de haberse resuelto la anterior).
        Si un ticket tiene puntos asignados a mano (desde "Asignar técnico"), esos puntos mandan sobre la regla
        automática de avería/reconexión.
      </p>
    </template>
  </AppLayout>
</template>
