<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import L from 'leaflet';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useAsistenciaStore } from '@/stores/asistencia';
import { useCatalogsStore } from '@/stores/catalogs';
import { getErrorMessage } from '@/lib/errors';
import { teardropIcon } from '@/views/mapa/mapIcons';
import {
  diasLaborablesEnRango,
  ESTADO_BADGE_CLASS,
  fechaLimaISO,
  formatHora,
  formatMinutos,
} from '@/lib/asistenciaReglas';
import type { AsistenciaRegistro, StaffProfile } from '@/types/domain';

const store = useAsistenciaStore();
const catalogs = useCatalogsStore();

onMounted(async () => {
  await Promise.all([catalogs.fetchStaff(), store.fetchSettings(), store.fetchFeriados()]);
  await loadTablero();
});

// ---- Tablero en vivo ----
const fecha = ref(fechaLimaISO());
const search = ref('');

async function loadTablero() {
  await store.fetchTablero(fecha.value);
}
watch(fecha, loadTablero);

const esPasado = computed(() => fecha.value < fechaLimaISO());
const esFeriado = computed(() => store.feriados.some((f) => f.fecha === fecha.value));
const esDomingo = computed(() => new Date(`${fecha.value}T00:00:00`).getDay() === 0);
const esLaborable = computed(() => !esDomingo.value && !esFeriado.value);

interface FilaTablero {
  profile: StaffProfile;
  registro: AsistenciaRegistro | null;
  falta: boolean;
}
const filas = computed<FilaTablero[]>(() => {
  const q = search.value.trim().toLowerCase();
  return catalogs.staff
    .filter((p) => !q || (p.full_name ?? p.email).toLowerCase().includes(q))
    .map((p) => {
      const registro = store.tablero.find((r) => r.user_id === p.id) ?? null;
      // "Falta" solo tiene sentido para un dia laborable ya pasado (o de hoy,
      // una vez transcurrido el dia) sin ningun ingreso marcado — un dia de
      // hoy a media mañana sin marcar todavia no es una falta, es "sin marcar".
      const falta = esLaborable.value && esPasado.value && !registro?.hora_ingreso;
      return { profile: p, registro, falta };
    })
    .sort((a, b) => (a.profile.full_name ?? a.profile.email).localeCompare(b.profile.full_name ?? b.profile.email));
});

const resumenHoy = computed(() => ({
  puntuales: filas.value.filter((f) => f.registro?.estado === 'Puntual').length,
  tardanzas: filas.value.filter((f) => f.registro?.estado === 'Tardanza' || (f.registro && f.registro.minutos_tardanza > 0)).length,
  enAlmuerzo: filas.value.filter((f) => f.registro?.estado === 'En Almuerzo').length,
  faltas: filas.value.filter((f) => f.falta).length,
}));

// Refresco liviano (cada 30s) para que "lleva X min en almuerzo" avance solo mientras el admin mira el tablero.
const now = ref(Date.now());
let tick: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  tick = setInterval(() => {
    now.value = Date.now();
  }, 30000);
});
onUnmounted(() => {
  if (tick) clearInterval(tick);
});
function minutosEnAlmuerzo(r: AsistenciaRegistro): number {
  if (!r.inicio_almuerzo) return 0;
  return Math.max(0, Math.round((now.value - new Date(r.inicio_almuerzo).getTime()) / 60000));
}

// ---- Mapa flotante de ubicacion (Fase 117) — mismo patron que TechnicianStatusBar.vue ----
const mapRegistro = ref<AsistenciaRegistro | null>(null);
const mapEl = ref<HTMLDivElement | null>(null);
let leafletMap: L.Map | null = null;

function puntosDe(r: AsistenciaRegistro) {
  const puntos: { label: string; lat: number; lng: number; color: string }[] = [];
  if (r.lat_ingreso != null && r.lng_ingreso != null) puntos.push({ label: `Ingreso ${formatHora(r.hora_ingreso)}`, lat: r.lat_ingreso, lng: r.lng_ingreso, color: '#22c55e' });
  if (r.lat_fin_almuerzo != null && r.lng_fin_almuerzo != null)
    puntos.push({ label: `Fin almuerzo ${formatHora(r.fin_almuerzo)}`, lat: r.lat_fin_almuerzo, lng: r.lng_fin_almuerzo, color: '#0ea5e9' });
  if (r.lat_salida != null && r.lng_salida != null) puntos.push({ label: `Salida ${formatHora(r.hora_salida)}`, lat: r.lat_salida, lng: r.lng_salida, color: '#ef4444' });
  return puntos;
}

function destroyMap() {
  if (leafletMap) leafletMap.remove();
  leafletMap = null;
}
function openMap(r: AsistenciaRegistro) {
  mapRegistro.value = r;
}
function closeMap() {
  mapRegistro.value = null;
}
watch(mapRegistro, async (r) => {
  destroyMap();
  if (!r || !mapEl.value) return;
  await nextTick();
  const puntos = puntosDe(r);
  const center: [number, number] = puntos.length ? [puntos[0].lat, puntos[0].lng] : [store.settings?.oficina_lat ?? 0, store.settings?.oficina_lng ?? 0];
  leafletMap = L.map(mapEl.value, { zoomControl: true }).setView(center, 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(leafletMap);

  if (store.settings) {
    L.circle([store.settings.oficina_lat, store.settings.oficina_lng], {
      radius: store.settings.oficina_radio_m,
      color: '#0ea5e9',
      fillOpacity: 0.07,
    }).addTo(leafletMap);
  }
  const bounds: [number, number][] = [];
  for (const p of puntos) {
    L.marker([p.lat, p.lng], { icon: teardropIcon(p.color, '<circle cx="12" cy="12" r="5"/>') })
      .addTo(leafletMap)
      .bindPopup(p.label);
    bounds.push([p.lat, p.lng]);
  }
  if (bounds.length > 1) leafletMap.fitBounds(bounds, { padding: [30, 30] });
});
onUnmounted(destroyMap);

// ---- Reporte mensual ----
const mesSeleccionado = ref(fechaLimaISO().slice(0, 7)); // YYYY-MM
const rangoRows = ref<AsistenciaRegistro[]>([]);
const loadingReporte = ref(false);
const reporteError = ref<string | null>(null);

async function cargarReporte() {
  loadingReporte.value = true;
  reporteError.value = null;
  try {
    const [year, month] = mesSeleccionado.value.split('-').map(Number);
    const desde = `${mesSeleccionado.value}-01`;
    const hasta = new Date(year, month, 0).toISOString().slice(0, 10); // ultimo dia del mes
    rangoRows.value = await store.fetchRango(desde, hasta);
  } catch (e) {
    reporteError.value = getErrorMessage(e, 'Error al cargar el reporte');
  } finally {
    loadingReporte.value = false;
  }
}
onMounted(cargarReporte);

interface FilaReporte {
  profile: StaffProfile;
  tardanzaMin: number;
  excesoAlmuerzoMin: number;
  faltas: number;
  diasTrabajados: number;
}
const reporte = computed<FilaReporte[]>(() => {
  const [year, month] = mesSeleccionado.value.split('-').map(Number);
  const desde = `${mesSeleccionado.value}-01`;
  const hastaFull = new Date(year, month, 0).toISOString().slice(0, 10);
  // No se cuentan como "falta" los dias laborables todavia no transcurridos del mes en curso.
  const hastaCorte = hastaFull < fechaLimaISO() ? hastaFull : fechaLimaISO();
  const feriadosSet = new Set(store.feriados.map((f) => f.fecha));
  const diasLaborables = desde <= hastaCorte ? diasLaborablesEnRango(desde, hastaCorte, feriadosSet) : [];

  return catalogs.staff
    .map((p) => {
      const propios = rangoRows.value.filter((r) => r.user_id === p.id);
      const diasConIngreso = new Set(propios.filter((r) => r.hora_ingreso).map((r) => r.fecha));
      return {
        profile: p,
        tardanzaMin: propios.reduce((sum, r) => sum + (r.minutos_tardanza || 0), 0),
        excesoAlmuerzoMin: propios.reduce((sum, r) => sum + (r.exceso_almuerzo_min || 0), 0),
        diasTrabajados: diasConIngreso.size,
        faltas: diasLaborables.filter((d) => !diasConIngreso.has(d)).length,
      };
    })
    .sort((a, b) => b.tardanzaMin - a.tardanzaMin);
});

function exportReporteCsv() {
  const header = ['Colaborador', 'Días trabajados', 'Minutos de tardanza (total)', 'Minutos de exceso de almuerzo (total)', 'Faltas'];
  const rows = reporte.value.map((f) => [f.profile.full_name || f.profile.email, f.diasTrabajados, f.tardanzaMin, f.excesoAlmuerzoMin, f.faltas]);
  const csv = [header, ...rows].map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `asistencia-${mesSeleccionado.value}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Feriados ----
const feriadoForm = ref({ fecha: '', nombre: '' });
const savingFeriado = ref(false);
const feriadoError = ref<string | null>(null);

async function handleAddFeriado() {
  if (!feriadoForm.value.fecha || !feriadoForm.value.nombre.trim()) return;
  savingFeriado.value = true;
  feriadoError.value = null;
  try {
    await store.createFeriado(feriadoForm.value.fecha, feriadoForm.value.nombre.trim());
    feriadoForm.value = { fecha: '', nombre: '' };
  } catch (e) {
    feriadoError.value = getErrorMessage(e, 'Error al agregar el feriado');
  } finally {
    savingFeriado.value = false;
  }
}
async function handleDeleteFeriado(f: string) {
  if (!confirm('¿Eliminar este feriado?')) return;
  try {
    await store.deleteFeriado(f);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al eliminar el feriado'));
  }
}

// ---- Configuracion (geocerca/horarios) ----
const showSettings = ref(false);
const settingsForm = ref({ oficina_lat: 0, oficina_lng: 0, oficina_radio_m: 1550, tolerancia_min: 5, lunes_hora_ingreso: '07:30', resto_hora_ingreso: '08:00', almuerzo_min: 120 });
const savingSettings = ref(false);
const settingsError = ref<string | null>(null);

watch(
  () => store.settings,
  (s) => {
    if (!s) return;
    settingsForm.value = {
      oficina_lat: s.oficina_lat,
      oficina_lng: s.oficina_lng,
      oficina_radio_m: s.oficina_radio_m,
      tolerancia_min: s.tolerancia_min,
      lunes_hora_ingreso: s.lunes_hora_ingreso.slice(0, 5),
      resto_hora_ingreso: s.resto_hora_ingreso.slice(0, 5),
      almuerzo_min: s.almuerzo_min,
    };
  },
  { immediate: true },
);

async function handleSaveSettings() {
  savingSettings.value = true;
  settingsError.value = null;
  try {
    await store.updateSettings(settingsForm.value);
  } catch (e) {
    settingsError.value = getErrorMessage(e, 'Error al guardar la configuración');
  } finally {
    savingSettings.value = false;
  }
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">🕐 Control de Asistencia</h1>
        <p class="text-slate-600 text-sm mt-1">Marcación de ingreso, almuerzo y salida del staff interno.</p>
      </div>
      <button class="btn-secondary" @click="showSettings = !showSettings">⚙️ Configuración</button>
    </div>

    <!-- Configuracion de geocerca/horarios -->
    <div v-if="showSettings" class="surface p-4 mb-6">
      <h2 class="text-sm font-semibold mb-3">Geocerca y horarios</h2>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div>
          <label class="field-label">Latitud oficina</label>
          <input v-model.number="settingsForm.oficina_lat" type="number" step="0.000001" class="field-input" />
        </div>
        <div>
          <label class="field-label">Longitud oficina</label>
          <input v-model.number="settingsForm.oficina_lng" type="number" step="0.000001" class="field-input" />
        </div>
        <div>
          <label class="field-label">Radio geocerca (m)</label>
          <input v-model.number="settingsForm.oficina_radio_m" type="number" min="0" class="field-input" />
        </div>
        <div>
          <label class="field-label">Tolerancia (min)</label>
          <input v-model.number="settingsForm.tolerancia_min" type="number" min="0" class="field-input" />
        </div>
        <div>
          <label class="field-label">Ingreso Lunes</label>
          <input v-model="settingsForm.lunes_hora_ingreso" type="time" class="field-input" />
        </div>
        <div>
          <label class="field-label">Ingreso Martes a Sábado</label>
          <input v-model="settingsForm.resto_hora_ingreso" type="time" class="field-input" />
        </div>
        <div>
          <label class="field-label">Refrigerio (min)</label>
          <input v-model.number="settingsForm.almuerzo_min" type="number" min="0" class="field-input" />
        </div>
      </div>
      <p v-if="settingsError" class="text-sm text-red-600 mb-2">{{ settingsError }}</p>
      <button class="btn-primary text-sm" :disabled="savingSettings" @click="handleSaveSettings">
        {{ savingSettings ? 'Guardando...' : 'Guardar configuración' }}
      </button>

      <h2 class="text-sm font-semibold mt-5 mb-2">Feriados</h2>
      <form class="flex flex-wrap items-end gap-2 mb-3" @submit.prevent="handleAddFeriado">
        <div>
          <label class="field-label">Fecha</label>
          <input v-model="feriadoForm.fecha" type="date" required class="field-input" />
        </div>
        <div class="flex-1 min-w-[160px]">
          <label class="field-label">Nombre</label>
          <input v-model="feriadoForm.nombre" required class="field-input" placeholder="ej. Día de la Independencia" />
        </div>
        <button type="submit" class="btn-secondary text-sm" :disabled="savingFeriado">{{ savingFeriado ? 'Agregando...' : '+ Agregar' }}</button>
      </form>
      <p v-if="feriadoError" class="text-sm text-red-600 mb-2">{{ feriadoError }}</p>
      <ul v-if="store.feriados.length" class="space-y-1 text-xs">
        <li v-for="f in store.feriados" :key="f.fecha" class="flex items-center justify-between gap-2 py-1 border-t border-slate-100">
          <span>{{ f.fecha }} — {{ f.nombre }}</span>
          <button class="text-red-500/80 hover:text-red-600" @click="handleDeleteFeriado(f.fecha)">Eliminar</button>
        </li>
      </ul>
      <p v-else class="text-xs text-slate-400">Sin feriados registrados.</p>
    </div>

    <!-- Tablero en vivo -->
    <div class="surface p-4 mb-6">
      <div class="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label class="field-label">Fecha</label>
            <input v-model="fecha" type="date" class="field-input" />
          </div>
          <div>
            <label class="field-label">Buscar</label>
            <input v-model="search" class="field-input" placeholder="Nombre del colaborador" />
          </div>
        </div>
        <div class="flex flex-wrap gap-2 text-xs">
          <span class="badge bg-green-500/15 text-green-600">✅ {{ resumenHoy.puntuales }} puntuales</span>
          <span class="badge bg-amber-500/15 text-amber-700">⏱️ {{ resumenHoy.tardanzas }} tardanzas</span>
          <span class="badge bg-sky-500/15 text-sky-700">🍲 {{ resumenHoy.enAlmuerzo }} en almuerzo</span>
          <span class="badge bg-red-500/15 text-red-600">🚫 {{ resumenHoy.faltas }} faltas</span>
        </div>
      </div>

      <p v-if="!esLaborable" class="text-xs text-slate-400 mb-3">
        {{ esDomingo ? 'Domingo — no es un día laborable.' : 'Feriado — no es un día laborable.' }}
      </p>

      <div class="table-shell">
        <table class="w-full text-sm min-w-[900px]">
          <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
            <tr>
              <th class="text-left px-4 py-3">Colaborador</th>
              <th class="text-left px-4 py-3">Estado</th>
              <th class="text-left px-4 py-3">Ingreso</th>
              <th class="text-left px-4 py-3">Almuerzo</th>
              <th class="text-left px-4 py-3">Salida</th>
              <th class="text-right px-4 py-3">Ubicación</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="store.loadingTablero">
              <td colspan="6" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
            </tr>
            <tr v-else-if="!filas.length">
              <td colspan="6" class="px-4 py-6 text-center text-slate-500">No hay personal registrado.</td>
            </tr>
            <tr v-for="f in filas" :key="f.profile.id" class="border-t border-slate-200 hover:bg-slate-50">
              <td class="px-4 py-3 text-slate-800">{{ f.profile.full_name || f.profile.email }}</td>
              <td class="px-4 py-3">
                <span v-if="f.registro" class="badge" :class="ESTADO_BADGE_CLASS[f.registro.estado]">{{ f.registro.estado }}</span>
                <span v-else-if="f.falta" class="badge" :class="ESTADO_BADGE_CLASS.Falta">Falta</span>
                <span v-else class="text-xs text-slate-400">Sin marcar</span>
              </td>
              <td class="px-4 py-3 text-xs">
                <template v-if="f.registro?.hora_ingreso">
                  {{ formatHora(f.registro.hora_ingreso) }}
                  <span v-if="f.registro.minutos_tardanza > 0" class="text-amber-600"> (+{{ f.registro.minutos_tardanza }} min)</span>
                  <span v-if="f.registro.fuera_oficina_ingreso" class="block text-red-600">⚠️ Fuera de oficina</span>
                </template>
                <span v-else class="text-slate-400">—</span>
              </td>
              <td class="px-4 py-3 text-xs">
                <template v-if="f.registro?.inicio_almuerzo">
                  {{ formatHora(f.registro.inicio_almuerzo) }} – {{ formatHora(f.registro.fin_almuerzo) }}
                  <template v-if="f.registro.fin_almuerzo">
                    <span v-if="f.registro.exceso_almuerzo_min" class="block text-amber-600">+{{ f.registro.exceso_almuerzo_min }} min exceso</span>
                  </template>
                  <span v-else class="block text-sky-600">⏱️ lleva {{ minutosEnAlmuerzo(f.registro) }} min</span>
                </template>
                <span v-else class="text-slate-400">—</span>
              </td>
              <td class="px-4 py-3 text-xs">{{ f.registro?.hora_salida ? formatHora(f.registro.hora_salida) : '—' }}</td>
              <td class="px-4 py-3 text-right">
                <button
                  v-if="f.registro && (f.registro.lat_ingreso != null || f.registro.lat_fin_almuerzo != null || f.registro.lat_salida != null)"
                  type="button"
                  class="text-xs text-sky-700 hover:underline"
                  @click="openMap(f.registro)"
                >
                  📍 Ver
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Reporte mensual -->
    <div class="surface p-4">
      <div class="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 class="text-sm font-semibold mb-1">📊 Reporte mensual</h2>
          <label class="field-label">Mes</label>
          <input v-model="mesSeleccionado" type="month" class="field-input" @change="cargarReporte" />
        </div>
        <button class="btn-secondary text-sm" :disabled="!reporte.length" @click="exportReporteCsv">⬇️ Exportar a CSV</button>
      </div>
      <p v-if="reporteError" class="text-sm text-red-600 mb-2">{{ reporteError }}</p>
      <div class="table-shell">
        <table class="w-full text-sm min-w-[700px]">
          <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
            <tr>
              <th class="text-left px-4 py-3">Colaborador</th>
              <th class="text-right px-4 py-3">Días trabajados</th>
              <th class="text-right px-4 py-3">Tardanzas acumuladas</th>
              <th class="text-right px-4 py-3">Exceso de almuerzo acumulado</th>
              <th class="text-right px-4 py-3">Faltas</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loadingReporte">
              <td colspan="5" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
            </tr>
            <tr v-for="f in reporte" :key="f.profile.id" class="border-t border-slate-200">
              <td class="px-4 py-3 text-slate-800">{{ f.profile.full_name || f.profile.email }}</td>
              <td class="px-4 py-3 text-right font-mono">{{ f.diasTrabajados }}</td>
              <td class="px-4 py-3 text-right font-mono" :class="f.tardanzaMin > 0 ? 'text-amber-700' : ''">{{ formatMinutos(f.tardanzaMin) }}</td>
              <td class="px-4 py-3 text-right font-mono" :class="f.excesoAlmuerzoMin > 0 ? 'text-amber-700' : ''">{{ formatMinutos(f.excesoAlmuerzoMin) }}</td>
              <td class="px-4 py-3 text-right font-mono" :class="f.faltas > 0 ? 'text-red-600' : ''">{{ f.faltas }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Mapa flotante de ubicacion -->
    <Teleport to="body">
      <div v-if="mapRegistro" class="modal-overlay" @click.self="closeMap">
        <div class="w-full max-w-lg modal-panel p-0 overflow-hidden">
          <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <div class="text-sm font-medium text-slate-800">📍 Ubicación de marcación</div>
            <button type="button" class="text-slate-500 hover:text-slate-800" @click="closeMap">✕</button>
          </div>
          <div ref="mapEl" class="w-full h-80"></div>
          <div class="px-4 py-2 text-[11px] text-slate-500 border-t border-slate-200">
            Círculo celeste = geocerca de oficina. 🟢 Ingreso · 🔵 Fin de almuerzo · 🔴 Salida.
          </div>
        </div>
      </div>
    </Teleport>
  </AppLayout>
</template>
