<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAuthStore } from '@/stores/auth';
import AusenciasPanel from '@/components/asistencia/AusenciasPanel.vue';
import NovedadesPanel from '@/components/asistencia/NovedadesPanel.vue';
import IntercambiosPanel from '@/components/asistencia/IntercambiosPanel.vue';
import { fetchIntercambiosResumen, intercambioDeDia, diasLaborablesConIntercambios, type IntercambioDia } from '@/lib/asistenciaIntercambios';
import HorariosPersonalesPanel from '@/components/asistencia/HorariosPersonalesPanel.vue';
import { AUSENCIA_LABEL, cuentaFalta, exentoDeAsistencia, fetchAusenciasResumen, type AusenciaResumen } from '@/lib/asistenciaAusencias';
import { diaAutorizado, fetchNovedadesResumen, NOVEDAD_BADGE_CLASS, novedadTexto } from '@/lib/asistenciaNovedades';
import { horarioPersonalDeDia, horarioPersonalTexto } from '@/lib/asistenciaHorariosPersonales';
import type { NovedadResumen } from '@/types/domain';
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
  puntosGpsDe,
} from '@/lib/asistenciaReglas';
import type { AsistenciaRegistro, StaffProfile } from '@/types/domain';

const store = useAsistenciaStore();
const auth = useAuthStore();
const canConfigure = computed(() => auth.role === 'SUPERADMIN');
const tabs = [
  { id: 'asistencia', label: 'Asistencia' },
  { id: 'ausencias', label: 'Ausencias' },
  { id: 'descansos', label: 'Descansos y permisos' },
  { id: 'horarios', label: 'Horarios' },
] as const;
const activeTab = ref<(typeof tabs)[number]['id']>('asistencia');
function selectTab(id: (typeof tabs)[number]['id']) {
  activeTab.value = id;
  void nextTick(() => document.getElementById(`attendance-tab-${id}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
}
function navigateTabs(event: KeyboardEvent, index: number) {
  const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
    : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
    : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
  if (next === null) return;
  event.preventDefault();
  selectTab(tabs[next].id);
  document.getElementById(`attendance-tab-${activeTab.value}`)?.focus();
}
const ausenciasDia = ref<AusenciaResumen[]>([]);
const ausenciasMes = ref<AusenciaResumen[]>([]);
const intercambiosDia = ref<IntercambioDia[]>([]);
const intercambiosMes = ref<IntercambioDia[]>([]);
const novedadesDia = ref<NovedadResumen[]>([]);
const novedadesMes = ref<NovedadResumen[]>([]);
const tableroError = ref<string | null>(null);
const tableroReady = ref(false);
const catalogs = useCatalogsStore();

onMounted(async () => {
  await Promise.all([catalogs.fetchStaff(), store.fetchSettings(), store.fetchFeriados(), store.fetchHorariosPersonales()]);
  await loadTablero();
});

// ---- Tablero en vivo ----
const fecha = ref(fechaLimaISO());
const search = ref('');

let tableroRequest = 0;
async function loadTablero() {
  const request = ++tableroRequest;
  const dia = fecha.value;
  tableroReady.value = false; tableroError.value = null;
  try {
    const [, rows, novedades, intercambios] = await Promise.all([store.fetchTablero(dia), fetchAusenciasResumen(dia, dia), fetchNovedadesResumen(dia, dia), fetchIntercambiosResumen(dia, dia)]);
    if (request !== tableroRequest) return;
    ausenciasDia.value = rows;
    novedadesDia.value = novedades; intercambiosDia.value = intercambios;
    tableroReady.value = true;
  } catch (e) {
    if (request !== tableroRequest) return;
    ausenciasDia.value = [];
    novedadesDia.value = [];
    tableroError.value = getErrorMessage(e, 'No se pudo cargar el tablero completo');
  }
}
watch(fecha, loadTablero);


const esFeriado = computed(() => store.feriados.some((f) => f.fecha === fecha.value));
const esDomingo = computed(() => new Date(`${fecha.value}T00:00:00`).getDay() === 0);
const esLaborable = computed(() => !esDomingo.value && !esFeriado.value);

interface FilaTablero {
  profile: StaffProfile;
  registro: AsistenciaRegistro | null;
  falta: boolean;
  ausencia?: AusenciaResumen;
  novedadesDelDia: NovedadResumen[];
  intercambio?: IntercambioDia;
  horarioHabitual?: ReturnType<typeof horarioPersonalDeDia>;
}
const filas = computed<FilaTablero[]>(() => {
  if (!tableroReady.value) return [];
  const q = search.value.trim().toLowerCase();
  const diaSemana = new Date(`${fecha.value}T00:00:00`).getDay();
  return catalogs.staff
    .filter(p => !exentoDeAsistencia(p.role))
    .filter((p) => !q || (p.full_name ?? p.email).toLowerCase().includes(q))
    .map((p) => {
      const registro = store.tablero.find((r) => r.user_id === p.id) ?? null;
      // "Falta" solo tiene sentido para un dia laborable ya pasado (o de hoy,
      // una vez transcurrido el dia) sin ningun ingreso marcado — un dia de
      // hoy a media mañana sin marcar todavia no es una falta, es "sin marcar".
      // La tardanza/falta en si ya viene calculada por el servidor contra el
      // horario REAL de cada persona (horario habitual recurrente o permiso
      // excepcional de hoy, ver mark_attendance_ingreso) — aqui solo se
      // muestran como contexto, sin recalcular ni suprimir nada en el cliente.
      const ausencia = ausenciasDia.value.find(a => a.user_id === p.id);
      const novedadesDelDia = novedadesDia.value.filter(n => n.user_id === p.id);
      const intercambio = intercambioDeDia(intercambiosDia.value, p.id, fecha.value);
      const autorizado = intercambio?.tipo === 'descanso' || diaAutorizado(fecha.value, novedadesDelDia);
      const falta = cuentaFalta(!!registro?.hora_ingreso, ausencia?.estado, fecha.value, fechaLimaISO(), intercambio?.tipo === 'trabajo' || esLaborable.value, ['ADMIN', 'TECNICO_RED'].includes(p.role), autorizado);
      const horarioHabitual = horarioPersonalDeDia(store.horariosPersonales.filter(h => h.user_id === p.id), diaSemana);
      return { profile: p, registro, falta, ausencia, novedadesDelDia, horarioHabitual, intercambio };
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

const mapPuntos = computed(() => (mapRegistro.value ? puntosGpsDe(mapRegistro.value) : []));

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
  if (!r) return;
  const puntos = puntosGpsDe(r);
  if (!puntos.length) return; // sin coordenadas guardadas -> se muestra el aviso, nunca un mapa vacio
  await nextTick();
  if (!mapEl.value) return;
  const center: [number, number] = [puntos[0].lat, puntos[0].lng];
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
const reporteReady = ref(false);

async function cargarReporte() {
  reporteReady.value = false;
  loadingReporte.value = true;
  reporteError.value = null;
  try {
    const [year, month] = mesSeleccionado.value.split('-').map(Number);
    const desde = `${mesSeleccionado.value}-01`;
    const hasta = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10); // ultimo dia del mes
    const [marcaciones, ausencias, novedades, intercambios] = await Promise.all([store.fetchRango(desde, hasta), fetchAusenciasResumen(desde, hasta), fetchNovedadesResumen(desde, hasta), fetchIntercambiosResumen(desde, hasta)]);
    rangoRows.value = marcaciones; ausenciasMes.value = ausencias; novedadesMes.value = novedades; intercambiosMes.value = intercambios;
    reporteReady.value = true;
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
  pendientes: number;
  justificadas: number;
  rechazadas: number;
  descansosIntercambio: number;
  jornadasCompensatorias: number;
}
const reporte = computed<FilaReporte[]>(() => {
  if (!reporteReady.value) return [];
  const [year, month] = mesSeleccionado.value.split('-').map(Number);
  const desde = `${mesSeleccionado.value}-01`;
  const hastaFull = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  // No se cuentan como "falta" los dias laborables todavia no transcurridos del mes en curso.
  const hastaCorte = hastaFull < fechaLimaISO() ? hastaFull : fechaLimaISO();
  const feriadosSet = new Set(store.feriados.map((f) => f.fecha));
  const diasLaborables = desde <= hastaCorte ? diasLaborablesEnRango(desde, hastaCorte, feriadosSet) : [];

  return catalogs.staff
    .filter(p => !exentoDeAsistencia(p.role))
    .map((p) => {
      const propios = rangoRows.value.filter((r) => r.user_id === p.id);
      const diasConIngreso = new Set(propios.filter((r) => r.hora_ingreso).map((r) => r.fecha));
      const solicitudes = ausenciasMes.value.filter(a => a.user_id === p.id);
      const novedadesPropias = novedadesMes.value.filter(n => n.user_id === p.id);
      // minutos_tardanza ya viene calculado por el servidor contra el horario
      // real de cada persona (habitual o permiso excepcional) — se suma tal cual.
      return {
        profile: p,
        tardanzaMin: propios.reduce((sum, r) => sum + (r.minutos_tardanza || 0), 0),
        excesoAlmuerzoMin: propios.reduce((sum, r) => sum + (r.exceso_almuerzo_min || 0), 0),
        diasTrabajados: diasConIngreso.size,
        descansosIntercambio: intercambiosMes.value.filter(i => i.user_id === p.id && i.tipo === 'descanso').length,
        jornadasCompensatorias: intercambiosMes.value.filter(i => i.user_id === p.id && i.tipo === 'trabajo').length,
        pendientes: solicitudes.filter(a => a.estado === 'pendiente').length,
        justificadas: solicitudes.filter(a => a.estado === 'aprobada').length,
        rechazadas: solicitudes.filter(a => a.estado === 'rechazada').length,
        faltas: diasLaborablesConIntercambios(diasLaborables, intercambiosMes.value, p.id, desde, hastaCorte).filter(d => cuentaFalta(
          diasConIngreso.has(d), ausenciasMes.value.find(a => a.user_id === p.id && a.fecha === d)?.estado, d, fechaLimaISO(), true,
          ['ADMIN', 'TECNICO_RED'].includes(p.role), diaAutorizado(d, novedadesPropias),
        )).length,
      };
    })
    .sort((a, b) => b.tardanzaMin - a.tardanzaMin);
});

function exportReporteCsv() {
  const header = ['Colaborador', 'Días trabajados', 'Minutos de tardanza (total)', 'Minutos de exceso de almuerzo (total)', 'Faltas', 'Ausencias pendientes', 'Ausencias justificadas', 'Ausencias rechazadas', 'Descansos por intercambio programados', 'Jornadas compensatorias programadas'];
  const rows = reporte.value.map((f) => [f.profile.full_name || f.profile.email, f.diasTrabajados, f.tardanzaMin, f.excesoAlmuerzoMin, f.faltas, f.pendientes, f.justificadas, f.rechazadas, f.descansosIntercambio, f.jornadasCompensatorias]);
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
    <div class="attendance-page">
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <p class="text-xs font-semibold uppercase tracking-widest text-sky-700 mb-2">Gestión del equipo</p>
        <h1 class="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">Control de Asistencia</h1>
        <p class="text-slate-500 text-sm mt-2">Revisa la jornada y organiza los días de tu equipo. Horario de Perú.</p>
      </div>
      <button v-if="canConfigure" class="btn-secondary" :aria-expanded="showSettings" aria-controls="attendance-settings" @click="showSettings = !showSettings">{{ showSettings ? 'Cerrar configuración' : 'Configuración' }}</button>
    </div>

    <!-- Configuracion de geocerca/horarios -->
    <fieldset v-if="canConfigure" v-show="showSettings" id="attendance-settings" class="surface p-5 mb-6">
      <h2 class="text-sm font-semibold mb-3">Geocerca y horarios</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
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
    </fieldset>

    <div role="tablist" aria-label="Secciones de Control de Asistencia" class="attendance-tabs">
      <button v-for="(tab, index) in tabs" :id="`attendance-tab-${tab.id}`" :key="tab.id" type="button" role="tab"
        :aria-selected="activeTab === tab.id" :aria-controls="`attendance-panel-${tab.id}`" :tabindex="activeTab === tab.id ? 0 : -1"
        :class="['attendance-tab', { 'attendance-tab-active': activeTab === tab.id }]"
        @click="selectTab(tab.id)" @keydown="navigateTabs($event, index)">{{ tab.label }}</button>
    </div>

    <!-- v-show conserva instancias, filtros, borradores y eventos al cambiar de pestaña. -->
    <section v-show="activeTab === 'ausencias'" id="attendance-panel-ausencias" role="tabpanel" aria-labelledby="attendance-tab-ausencias" class="attendance-panel">
      <p class="text-sm text-slate-500 mb-4">{{ ausenciasDia.filter(a => a.estado === 'pendiente').length }} pendientes · {{ ausenciasDia.filter(a => a.estado === 'aprobada').length }} justificadas · {{ ausenciasDia.filter(a => a.estado === 'rechazada').length }} rechazadas en la fecha del tablero. Las justificaciones no alteran las marcaciones.</p>
      <AusenciasPanel administracion @changed="loadTablero(); cargarReporte()" />
      <p v-if="!canConfigure" class="surface p-5 text-sm text-slate-500">La aprobación de solicitudes está a cargo de SUPERADMIN. Puedes consultar tus solicitudes desde «Marcar asistencia».</p>
    </section>
    <section v-show="activeTab === 'descansos'" id="attendance-panel-descansos" role="tabpanel" aria-labelledby="attendance-tab-descansos" class="attendance-panel space-y-8">
      <IntercambiosPanel administracion @changed="loadTablero(); cargarReporte()" />
      <NovedadesPanel administracion @changed="loadTablero(); cargarReporte()" />
      <p v-if="!canConfigure" class="surface p-5 text-sm text-slate-500">SUPERADMIN programa los descansos y permisos. Tus días autorizados están disponibles en «Marcar asistencia».</p>
    </section>
    <section v-show="activeTab === 'horarios'" id="attendance-panel-horarios" role="tabpanel" aria-labelledby="attendance-tab-horarios" class="attendance-panel">
      <HorariosPersonalesPanel administracion @changed="loadTablero()" />
      <p v-if="!canConfigure" class="surface p-5 text-sm text-slate-500">SUPERADMIN administra los horarios habituales. Puedes consultar tu horario desde «Marcar asistencia».</p>
    </section>
    <section v-show="activeTab === 'asistencia'" id="attendance-panel-asistencia" role="tabpanel" aria-labelledby="attendance-tab-asistencia" class="attendance-panel">
    <!-- Tablero en vivo -->
    <p v-if="tableroError" role="alert" class="text-red-600">{{ tableroError }}</p>
    <div class="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
      <div class="surface p-4 border-t-2 border-t-emerald-500"><p class="text-sm text-slate-500">Puntuales</p><p class="text-3xl font-semibold text-emerald-700 mt-2">{{ resumenHoy.puntuales }}</p></div>
      <div class="surface p-4 border-t-2 border-t-amber-500"><p class="text-sm text-slate-500">Tardanzas</p><p class="text-3xl font-semibold text-amber-700 mt-2">{{ resumenHoy.tardanzas }}</p></div>
      <div class="surface p-4 border-t-2 border-t-sky-500"><p class="text-sm text-slate-500">En almuerzo</p><p class="text-3xl font-semibold text-sky-700 mt-2">{{ resumenHoy.enAlmuerzo }}</p></div>
      <div class="surface p-4 border-t-2 border-t-rose-500"><p class="text-sm text-slate-500">Faltas</p><p class="text-3xl font-semibold text-rose-700 mt-2">{{ resumenHoy.faltas }}</p></div>
    </div>
    <div class="surface p-4 mb-6">
      <h2 class="text-base font-semibold text-slate-900 mb-4">Jornada del equipo</h2>
      <div class="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div class="grid grid-cols-1 sm:grid-cols-[180px_minmax(220px,1fr)] gap-3 w-full lg:max-w-2xl">
          <div>
            <label class="field-label">Fecha</label>
            <input v-model="fecha" type="date" class="field-input" />
          </div>
          <div>
            <label class="field-label">Buscar</label>
            <input v-model="search" class="field-input" placeholder="Nombre del colaborador" />
          </div>
        </div>
      </div>

      <p v-if="!esLaborable" class="text-xs text-slate-400 mb-3">
        {{ esDomingo ? 'Domingo: descanso general, salvo jornada compensatoria autorizada.' : 'Feriado: descanso general, salvo jornada compensatoria autorizada.' }}
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
                <span v-if="f.intercambio" class="badge mr-1 bg-indigo-500/15 text-indigo-700">{{ f.intercambio.tipo === 'descanso' ? 'Descanso autorizado por intercambio' : 'Jornada compensatoria' }} · {{ f.intercambio.fecha_vinculada }}<template v-if="f.intercambio.tipo === 'trabajo'"> · {{ f.intercambio.hora_ingreso.slice(0, 5) }}–{{ f.intercambio.hora_salida.slice(0, 5) }}</template></span>
                <span v-if="f.horarioHabitual && !f.intercambio" class="badge mr-1 bg-violet-500/15 text-violet-700">📌 Horario habitual {{ horarioPersonalTexto(f.horarioHabitual) }}</span>
                <span v-for="n in f.novedadesDelDia" :key="n.tipo + n.hora_inicio" class="badge mr-1" :class="NOVEDAD_BADGE_CLASS[n.tipo]">{{ novedadTexto(n) }}</span>
                <span v-if="f.ausencia" class="badge">{{ AUSENCIA_LABEL[f.ausencia.estado] }}{{ f.registro?.hora_ingreso ? ' - Con ingreso: revisar coincidencia' : '' }}</span>
                <span v-if="f.registro" class="badge" :class="ESTADO_BADGE_CLASS[f.registro.estado]">{{ f.registro.estado }}</span>
                <span v-else-if="f.falta" class="badge" :class="ESTADO_BADGE_CLASS.Falta">Falta</span>
                <span v-else-if="!f.ausencia && !f.novedadesDelDia.length && f.intercambio?.tipo !== 'descanso'" class="text-xs text-slate-400">Sin marcar</span>
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
              <th class="text-right px-4 py-3">Ausencias pendientes / justificadas / rechazadas</th>
              <th class="text-right px-4 py-3">Intercambios programados: descansos / jornadas compensatorias</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loadingReporte">
              <td colspan="7" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
            </tr>
            <tr v-for="f in reporte" :key="f.profile.id" class="border-t border-slate-200">
              <td class="px-4 py-3 text-slate-800">{{ f.profile.full_name || f.profile.email }}</td>
              <td class="px-4 py-3 text-right font-mono">{{ f.diasTrabajados }}</td>
              <td class="px-4 py-3 text-right font-mono" :class="f.tardanzaMin > 0 ? 'text-amber-700' : ''">{{ formatMinutos(f.tardanzaMin) }}</td>
              <td class="px-4 py-3 text-right font-mono" :class="f.excesoAlmuerzoMin > 0 ? 'text-amber-700' : ''">{{ formatMinutos(f.excesoAlmuerzoMin) }}</td>
              <td class="px-4 py-3 text-right font-mono" :class="f.faltas > 0 ? 'text-red-600' : ''">{{ f.faltas }}</td>
              <td class="px-4 py-3 text-right font-mono">{{ f.pendientes }} / {{ f.justificadas }} / {{ f.rechazadas }}</td>
              <td class="px-4 py-3 text-right font-mono">{{ f.descansosIntercambio }} / {{ f.jornadasCompensatorias }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <p class="text-xs text-slate-500 mt-4">SUPERADMIN está exento de indicadores laborales y pendientes. Sus marcaciones históricas se conservan.</p>
    </section>

    <!-- Mapa flotante de ubicacion -->
    <Teleport to="body">
      <div v-if="mapRegistro" class="modal-overlay" @click.self="closeMap">
        <div class="w-full max-w-lg modal-panel p-0 overflow-hidden">
          <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <div class="text-sm font-medium text-slate-800">📍 Ubicación de marcación</div>
            <button type="button" class="text-slate-500 hover:text-slate-800" @click="closeMap">✕</button>
          </div>
          <div v-if="mapPuntos.length" ref="mapEl" class="w-full h-80"></div>
          <div v-else class="w-full h-80 flex items-center justify-center text-center text-sm text-slate-500 px-6">
            📍 Ubicación GPS no disponible para esta marcación.
          </div>
          <div v-if="mapPuntos.length" class="px-4 py-2 text-[11px] text-slate-500 border-t border-slate-200">
            Círculo celeste = geocerca de oficina. 🟢 Ingreso · 🔵 Fin de almuerzo · 🔴 Salida.
          </div>
        </div>
      </div>
    </Teleport>
    </div>
  </AppLayout>
</template>

<style scoped>
.attendance-page { width: 100%; min-width: 0; }
.attendance-tabs { display: flex; gap: 0.375rem; overflow-x: auto; padding: 0.375rem; margin-bottom: 1.5rem; border: 1px solid #e2e8f0; border-radius: 0.875rem; background: #f1f5f9; scrollbar-width: thin; }
.attendance-tab { flex-shrink: 0; min-height: 44px; padding: 0.625rem 1.25rem; border-radius: 0.625rem; color: #475569; font-size: 0.875rem; font-weight: 600; white-space: nowrap; }
.attendance-tab:hover { background: #e2e8f0; color: #0f172a; }
.attendance-tab-active, .attendance-tab-active:hover { background: white; color: #0369a1; box-shadow: 0 1px 3px #0f172a1a; }
.attendance-tab:focus-visible { outline: 2px solid #0284c7; outline-offset: -2px; }
.attendance-panel { min-width: 0; }
.attendance-page :deep(.field-input), .attendance-page :deep(.btn-primary), .attendance-page :deep(.btn-secondary) { min-height: 44px; }
.attendance-page :deep(.field-input), .attendance-page :deep(label) { min-width: 0; }
.attendance-page :deep(.attendance-management) { display: grid; gap: 1.25rem; align-items: start; }
.attendance-page :deep(.attendance-management form) { margin: 0; padding: 1.25rem; grid-template-columns: minmax(0, 1fr); }
.attendance-page :deep(.attendance-management form > *) { grid-column: auto; }
.attendance-page :deep(.attendance-list) { min-width: 0; }
.attendance-page :deep(.attendance-list-heading) { font-size: 0.875rem; font-weight: 600; color: #334155; margin-bottom: 1rem; }
@media (min-width: 1100px) {
  .attendance-page :deep(.attendance-management) { grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr); gap: 1.5rem; }
}
</style>
