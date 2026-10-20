<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useSoporteRankingStore } from '@/stores/soporteRanking';
import { fechaLimaISO } from '@/lib/asistenciaReglas';
import { peruDate } from '@/lib/fieldProgress';
import type { RankingPeriod } from '@/stores/soporteRanking';

const router = useRouter();
const rankingStore = useSoporteRankingStore();

const MONTH_LABEL = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const today = fechaLimaISO();
const period = ref<RankingPeriod>('month');
const date = ref(today);
const mes = ref(Number(today.slice(5, 7)));
const anio = ref(Number(today.slice(0, 4)));
const periodLabels = { day: 'Diario', week: 'Semanal', month: 'Mensual' };
const rangeLabel = computed(() => {
  const result = rankingStore.periodResult;
  return result ? `${peruDate(result.start)} – ${peruDate(new Date(Date.parse(result.end) - 1).toISOString())}` : '';
});

const years = computed(() => {
  const current = Number(today.slice(0, 4));
  return Array.from({ length: 5 }, (_, i) => current - i);
});

async function load() {
  const reference = period.value === 'month' ? `${anio.value}-${String(mes.value).padStart(2, '0')}-01` : date.value;
  await rankingStore.fetchPeriodRanking(period.value, reference);
}

onMounted(load);

const winners = computed(() => rankingStore.ranking.filter((r) => r.ranking === 1));

function handlePrint() {
  window.print();
}

// Export simple a CSV, sin dependencias — el navegador lo descarga solo.
function handleExportCsv() {
  const header = ['Ranking', 'Tecnico', 'Instalaciones', 'Averias', 'Reconexiones', 'Rutinas', 'Reincidencias', 'Puntos'];
  const rows = rankingStore.ranking.map((r) => [
    r.ranking,
    r.technician_name,
    r.installations_count,
    r.averias_count,
    r.reconexiones_count,
    r.rutinas_count,
    r.reincidencias_count,
    r.total_points,
  ]);
  const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ranking-tecnicos-${period.value}-${rankingStore.periodResult?.start.slice(0, 10) ?? date.value}.csv`;
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
        <p class="text-slate-600 text-sm mt-1">Productividad compartida · horario de Perú · semana de lunes a domingo</p>
        <p class="text-slate-500 text-xs mt-1">{{ rangeLabel }} · Valores actuales; pueden cambiar por ajustes posteriores.</p>
      </div>
      <div class="flex gap-2">
        <button class="btn-ghost text-xs" :disabled="!rankingStore.ranking.length" @click="handleExportCsv">Exportar CSV</button>
        <button class="btn-ghost text-xs" :disabled="!rankingStore.ranking.length" @click="handlePrint">Imprimir</button>
      </div>
    </div>

    <div class="flex flex-wrap items-end gap-3 mb-6 print:hidden">
      <div>
        <label for="ranking-period" class="block text-xs text-slate-600 mb-1">Período</label>
        <select id="ranking-period" v-model="period" class="field-input" @change="load">
          <option v-for="(label, key) in periodLabels" :key="key" :value="key">{{ label }}</option>
        </select>
      </div>
      <div v-if="period !== 'month'">
        <label for="ranking-date" class="block text-xs text-slate-600 mb-1">Fecha de referencia</label>
        <input id="ranking-date" v-model="date" type="date" min="2000-01-01" max="2100-12-31" class="field-input" @change="load" />
      </div>
      <div v-if="period === 'month'">
        <label class="block text-xs text-slate-600 mb-1">Mes</label>
        <select v-model.number="mes" class="field-input" @change="load">
          <option v-for="(label, idx) in MONTH_LABEL" :key="idx" :value="idx + 1">{{ label }}</option>
        </select>
      </div>
      <div v-if="period === 'month'">
        <label class="block text-xs text-slate-600 mb-1">Año</label>
        <select v-model.number="anio" class="field-input" @change="load">
          <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
        </select>
      </div>
      <button class="btn-secondary text-xs" :disabled="rankingStore.loading" @click="load">Actualizar</button>
    </div>

    <h2 class="hidden print:block text-lg font-semibold mb-4">
      Ranking de técnicos — {{ periodLabels[period] }} · {{ rangeLabel }}
    </h2>

    <p v-if="rankingStore.loading" class="text-slate-500 text-sm">Calculando...</p>
    <p v-else-if="rankingStore.error" class="text-sm text-red-600">{{ rankingStore.error }}</p>
    <p v-else-if="!rankingStore.ranking.length" class="text-slate-500 text-sm">
      No hay trabajos computables en este período.
    </p>

    <template v-else>
      <!-- Tecnico del mes -->
      <div
        v-for="winner in winners" :key="winner.technician_id"
        class="rounded-2xl p-3 sm:p-6 mb-3 flex flex-wrap items-center gap-3 text-white"
        style="background: linear-gradient(135deg, #f59e0b, #d97706)"
      >
        <div class="text-2xl">🏆</div>
        <div class="flex-1 min-w-0">
          <div class="text-xs uppercase tracking-wide text-white/80">Primer lugar del período</div>
          <div class="text-lg sm:text-2xl font-bold break-words">{{ winner.technician_name }}</div>
          <div class="text-sm text-white/90 mt-1">
            {{ winner.installations_count }} instalaciones · {{ winner.averias_count }} averías ·
            {{ winner.reconexiones_count }} reconexiones · {{ winner.rutinas_count }} rutinas
            <span v-if="winner.reincidencias_count"> · {{ winner.reincidencias_count }} reincidencias</span>
          </div>
        </div>
        <div class="text-right">
          <div class="text-2xl font-bold">{{ winner.total_points }}</div>
          <div class="text-xs text-white/80">puntos</div>
        </div>
      </div>

      <ul class="space-y-2 sm:hidden">
        <li v-for="r in rankingStore.ranking" :key="r.technician_id" class="surface p-3 text-sm">
          <div class="flex justify-between gap-2"><p class="min-w-0 break-words">#{{ r.ranking }} · {{ r.technician_name }}</p><strong class="shrink-0">{{ r.total_points }} pts</strong></div>
          <p class="text-xs text-slate-500 mt-1">{{ r.installations_count }} Altas · {{ r.averias_count }} averías · {{ r.reconexiones_count }} reconexiones · {{ r.rutinas_count }} rutinas · {{ r.reincidencias_count }} reincidencias</p>
        </li>
      </ul>
      <div class="table-shell hidden sm:block print:block">
        <table class="w-full text-sm min-w-[720px]">
          <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
            <tr>
              <th class="text-left px-4 py-3">#</th>
              <th class="text-left px-4 py-3">Técnico</th>
              <th class="text-right px-4 py-3">Instalaciones</th>
              <th class="text-right px-4 py-3">Averías</th>
              <th class="text-right px-4 py-3">Reconexiones</th>
              <th class="text-right px-4 py-3">Rutinas</th>
              <th class="text-right px-4 py-3">Reincidencias</th>
              <th class="text-right px-4 py-3">Puntos</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rankingStore.ranking" :key="r.technician_id" class="border-t border-slate-200">
              <td class="px-4 py-3 font-mono text-xs text-slate-500">#{{ r.ranking }}</td>
              <td class="px-4 py-3 font-medium text-slate-900">{{ r.technician_name }}</td>
              <td class="px-4 py-3 text-right text-slate-600">{{ r.installations_count }}</td>
              <td class="px-4 py-3 text-right text-slate-600">{{ r.averias_count }}</td>
              <td class="px-4 py-3 text-right text-slate-600">{{ r.reconexiones_count }}</td>
              <td class="px-4 py-3 text-right text-slate-600">{{ r.rutinas_count }}</td>
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
        −5 por reincidencia imputable dentro de los 7 días. Rutinas: puntaje asignado, o cero si no tiene.
        Si un ticket tiene puntos asignados a mano (desde "Asignar técnico"), esos puntos mandan sobre la regla
        automática de avería/reconexión. Si una orden (instalación, ticket o rutina) tuvo cuadrilla, el puntaje se
        reparte según la regla existente entre sus integrantes; los tickets conservan el truncamiento de la división entera.
      </p>
    </template>
  </AppLayout>
</template>
