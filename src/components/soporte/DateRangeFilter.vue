<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';

// Filtro de rango de fechas compartido por las 3 bandejas de Soporte
// (Averias/Altas/Rutinas, Fase 101) — mismo control en los 3, cada vista
// decide contra que columna de fecha filtra (created_at o scheduled_date).
// 'Hoy' es el default pedido: al entrar a cualquiera de las 3 vistas se ve
// primero lo de hoy, no el historico completo.
export type DateRangePreset = 'hoy' | 'semana' | 'mes' | 'rango';
export interface DateRange {
  start: Date;
  end: Date;
}

const preset = defineModel<DateRangePreset>('preset', { default: 'hoy' });
const emit = defineEmits<{ change: [DateRange] }>();

const rangeStart = ref('');
const rangeEnd = ref('');

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function computeRange(): DateRange | null {
  const now = new Date();
  if (preset.value === 'hoy') return { start: startOfDay(now), end: endOfDay(now) };
  if (preset.value === 'semana') {
    // Semana de lunes a domingo (convencion local) — getDay(): 0=domingo.
    const day = now.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: startOfDay(monday), end: endOfDay(sunday) };
  }
  if (preset.value === 'mes') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: startOfDay(first), end: endOfDay(last) };
  }
  // 'rango': hasta que el usuario elija ambas fechas, no hay filtro aplicable todavia.
  if (!rangeStart.value || !rangeEnd.value) return null;
  return { start: startOfDay(new Date(`${rangeStart.value}T00:00:00`)), end: endOfDay(new Date(`${rangeEnd.value}T00:00:00`)) };
}

function emitChange() {
  const range = computeRange();
  if (range) emit('change', range);
}

watch([preset, rangeStart, rangeEnd], emitChange);
onMounted(emitChange);

const PRESET_OPTIONS: { value: DateRangePreset; label: string }[] = [
  { value: 'hoy', label: 'Hoy' },
  { value: 'semana', label: 'Esta semana' },
  { value: 'mes', label: 'Este mes' },
  { value: 'rango', label: 'Calendario / Rango' },
];
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <div class="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
      <button
        v-for="opt in PRESET_OPTIONS"
        :key="opt.value"
        type="button"
        class="rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
        :class="preset === opt.value ? 'bg-sky-500 text-slate-950 shadow-sm' : 'text-slate-600 hover:text-slate-900'"
        @click="preset = opt.value"
      >
        {{ opt.label }}
      </button>
    </div>
    <div v-if="preset === 'rango'" class="flex items-center gap-1.5">
      <input v-model="rangeStart" type="date" class="field-input text-xs py-1.5" />
      <span class="text-slate-400 text-xs">a</span>
      <input v-model="rangeEnd" type="date" class="field-input text-xs py-1.5" />
    </div>
  </div>
</template>
