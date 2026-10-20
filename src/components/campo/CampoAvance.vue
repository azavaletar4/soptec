<script setup lang="ts">
import { ref } from 'vue';
import { contributionsInPeriod, pointNumber, peruDate, type FieldProgress } from '@/lib/fieldProgress';
defineProps<{ data: FieldProgress | null; loading: boolean; error: string | null }>();
defineEmits<{ refresh: [] }>();
const period = ref<'today' | 'week' | 'month'>('month');
const labels = { today: 'Hoy', week: 'Semana', month: 'Mes' } as const;
const jobs = { installation: 'Alta', ticket: 'Ticket', routine: 'Rutina' };
</script>

<template>
  <section class="surface p-3 mb-3 min-w-0" aria-labelledby="mi-avance-title" aria-live="polite">
    <div class="flex justify-between items-center gap-2">
      <div><h2 id="mi-avance-title" class="text-sm font-semibold">Mi Avance</h2><p class="text-xs text-slate-500">Valores actuales; pueden variar</p></div>
      <button class="text-xs text-sky-700 min-h-11 px-2 rounded-lg focus-visible:outline-2 focus-visible:outline-sky-600" aria-label="Actualizar puntos" :disabled="loading" @click="$emit('refresh')">Actualizar</button>
    </div>
    <p v-if="loading" class="text-xs text-slate-500 py-2">Consultando tus puntos…</p>
    <p v-else-if="error" class="text-xs text-red-700 py-2">No se pudieron consultar tus puntos. Intenta actualizar.</p>
    <template v-else-if="data">
      <div class="grid grid-cols-3 gap-2 mt-1">
        <div v-for="(label, key) in labels" :key="key" class="min-w-0 rounded-lg bg-slate-50 p-2">
          <p class="text-xs text-slate-600">{{ label }}</p>
          <p class="font-bold text-lg break-words">{{ pointNumber(data.periods[key].points) }} <span class="text-xs font-normal">pts</span></p>
        </div>
      </div>
      <slot />
      <router-link to="/soporte/ranking" class="flex items-center justify-between min-h-11 px-3 mt-1 rounded-lg bg-sky-50 border border-sky-200 text-sm font-semibold text-sky-800 focus-visible:outline-2 focus-visible:outline-sky-600">Ver ranking de técnicos <span aria-hidden="true">→</span></router-link>
      <div class="grid grid-cols-2 gap-x-2 text-xs">
      <details data-progress-info class="min-w-0 open:col-span-2">
        <summary class="cursor-pointer min-h-11 py-3 font-medium">Sobre los puntos</summary>
        <div class="text-xs text-slate-600 space-y-2 pb-2">
          <p>Horario de Perú · semana de lunes a domingo. Valores actuales; pueden cambiar por ajustes posteriores.</p>
          <p>Consultado: {{ new Date(data.asOf).toLocaleString('es-PE', { timeZone: 'America/Lima' }) }}</p>
          <p v-for="(label, key) in labels" :key="key">{{ label }}: {{ peruDate(data.periods[key].start) }} – {{ peruDate(new Date(Date.parse(data.periods[key].end) - 1).toISOString()) }}</p>
        </div>
      </details>
      <details class="min-w-0 open:col-span-2">
        <summary class="cursor-pointer min-h-11 py-3 font-medium">Historial de aportes</summary>
        <label class="block mb-2">Período
          <select v-model="period" class="field-input mt-1"><option v-for="(label, key) in labels" :key="key" :value="key">{{ label }}</option></select>
        </label>
        <p v-if="!contributionsInPeriod(data, period).length" class="text-slate-500 py-2">No hay aportes en este período.</p>
        <ul class="divide-y divide-slate-100">
          <li v-for="e in contributionsInPeriod(data, period)" :key="`${e.jobType}-${e.jobId}-${e.kind}`" class="py-2 flex justify-between gap-2">
            <div class="min-w-0">
              <router-link :to="`/campo/${e.jobType}/${e.jobId}`" class="text-sky-700 break-all">{{ jobs[e.jobType] }} · {{ e.reference || e.jobId.slice(0, 8) }}</router-link>
              <p class="text-slate-500">{{ peruDate(e.occurredAt) }} · {{ e.kind === 'recurrence' ? 'Descuento por reincidencia' : 'Aporte del trabajo' }} · {{ e.crewSize }} integrante(s)</p>
            </div>
            <span class="font-semibold shrink-0" :class="e.points < 0 ? 'text-red-700' : ''">{{ pointNumber(e.points) }} pts</span>
          </li>
        </ul>
        <p class="text-slate-500 mt-2">Detalle con hasta cuatro decimales; el total se redondea a un decimal como el ranking.</p>
      </details>
      </div>
    </template>
    <router-link v-if="!data || loading || error" to="/soporte/ranking" class="flex items-center min-h-11 px-3 mt-2 rounded-lg bg-sky-50 text-sm font-semibold text-sky-800">Ver ranking de técnicos →</router-link>
  </section>
</template>
