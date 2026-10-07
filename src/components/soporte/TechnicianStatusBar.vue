<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { teardropIcon } from '@/views/mapa/mapIcons';
import { formatElapsedTime } from '@/lib/elapsedTime';
import { waLink, telLink } from '@/lib/phone';
import { ACTIVE_STATUS, type UnifiedJob } from '@/composables/useUnifiedJobs';
import type { AsistenciaRegistro, JobType, StaffProfile } from '@/types/domain';

// Panel estilo despacho de campo (TOA-like): una tarjeta por tecnico con su
// estado en vivo, derivado de SUS ordenes asignadas (averias/altas/rutinas,
// Fase 126 — antes solo miraba tickets, asi que un tecnico "en atencion" de
// una Alta o Rutina se veia incorrectamente como "Disponible").
//
// "En camino" no es un estado real en las tablas (no hay un paso de
// "aceptar" separado de "iniciar") — se aproxima como "tiene una orden
// asignada que todavia no inicio" (ACTIVE_STATUS[jobType] sin 'in_progress':
// ticket 'open', installation/routine 'pending'/'scheduled'). Si tiene una
// 'in_progress', eso manda sobre cualquier otra activa.
//
// Fase 135: "En Almuerzo" (Control de Asistencia) manda sobre CUALQUIER
// orden activa — antes esta tarjeta solo miraba las ordenes asignadas y
// seguia mostrando "en camino"/"en atención" aunque el tecnico ya hubiera
// marcado "Iniciar Almuerzo" en la App de Campo.
const props = withDefaults(
  defineProps<{
    technicians: StaffProfile[];
    jobs: UnifiedJob[];
    /**
     * Fase 128: cuadrilla completa (lider + apoyos) — job.assignedId (la
     * columna assigned_to de tickets/installations/routines) solo refleja al
     * LIDER (trigger sync_assigned_to_from_job_assignees), asi que un
     * tecnico sumado como APOYO (Fase 121) se veia "Disponible" aunque
     * estuviera trabajando en la misma orden.
     */
    crewAssignments?: { job_type: JobType; job_id: string; technician_id: string }[];
    /** Fase 135 — tablero de asistencia de HOY (asistencia_registros), para que "En Almuerzo" mande sobre cualquier orden activa. */
    asistencia?: AsistenciaRegistro[];
    now: number;
    selectedTechId?: string | null;
    /** Minutos desde que entro "en progreso" a partir de los cuales se alerta demora (Fase 111). */
    slaThresholdMinutes?: number;
    /** Minutos sin un ping de telemetria a partir de los cuales se considera "sin señal" (Fase 115). */
    gpsStaleMinutes?: number;
  }>(),
  { selectedTechId: null, slaThresholdMinutes: 60, gpsStaleMinutes: 15, crewAssignments: () => [], asistencia: () => [] },
);

const emit = defineEmits<{
  /** Click simple: filtra la tabla de abajo. jobId viene null si el tecnico esta "disponible". */
  select: [techId: string, jobId: string | null];
  /** Doble click sobre un tecnico con orden activa: ir directo al detalle. */
  openJob: [job: UnifiedJob];
}>();

type TechStatus = 'en_almuerzo' | 'en_atencion' | 'en_camino' | 'disponible';

function isNotStarted(job: UnifiedJob): boolean {
  return ACTIVE_STATUS[job.jobType].includes(job.status) && job.status !== 'in_progress';
}
function isCompletedToday(job: UnifiedJob): boolean {
  if (job.jobType === 'ticket') return job.status === 'resolved' || job.status === 'closed';
  return job.status === 'completed';
}

interface TechCard {
  id: string;
  name: string;
  phone: string | null;
  status: TechStatus;
  job: UnifiedJob | null;
  elapsedMinutes: number | null;
  resolvedToday: number;
  batteryLevel: number | null;
  latitude: number | null;
  longitude: number | null;
  lastPingAt: string | null;
}

const STATUS_META: Record<TechStatus, { dot: string; label: string }> = {
  en_almuerzo: { dot: 'bg-amber-500', label: '🍲 En Almuerzo' },
  en_atencion: { dot: 'bg-green-500', label: 'En atención' },
  en_camino: { dot: 'bg-sky-500', label: 'En camino' },
  disponible: { dot: 'bg-slate-300', label: 'Disponible' },
};

function isToday(iso: string | null, nowMs: number): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date(nowMs);
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

// technician_id -> Set("jobType:jobId") de todas las ordenes donde es parte
// de la cuadrilla (lider o apoyo) — lookup O(1) por tecnico en vez de recorrer
// crewAssignments una vez por cada uno dentro de `cards`.
const crewByTech = computed<Map<string, Set<string>>>(() => {
  const map = new Map<string, Set<string>>();
  for (const a of props.crewAssignments) {
    let set = map.get(a.technician_id);
    if (!set) {
      set = new Set();
      map.set(a.technician_id, set);
    }
    set.add(`${a.job_type}:${a.job_id}`);
  }
  return map;
});

// user_id -> registro de asistencia de HOY, para el chequeo de "En Almuerzo"
// (PRIORIDAD 1, Fase 135) dentro de `cards`.
const asistenciaByTech = computed<Map<string, AsistenciaRegistro>>(
  () => new Map(props.asistencia.map((a) => [a.user_id, a])),
);

const cards = computed<TechCard[]>(() =>
  props.technicians.map((tech) => {
    const name = tech.full_name || tech.email;
    const telemetry = {
      batteryLevel: tech.battery_level,
      latitude: tech.latitude,
      longitude: tech.longitude,
      lastPingAt: tech.last_ping_at,
    };
    const crew = crewByTech.value.get(tech.id);
    const assigned = props.jobs.filter((j) => j.assignedId === tech.id || crew?.has(`${j.jobType}:${j.id}`));
    const resolvedToday = assigned.filter((j) => isCompletedToday(j) && isToday(j.finishedAt, props.now)).length;
    // PRIORIDAD 1 (Fase 135): "En Almuerzo" manda sobre cualquier orden
    // activa — un tecnico que marco "Iniciar Almuerzo" en la App de Campo
    // no deberia seguir viendose "en camino"/"en atención" aqui.
    const asistenciaHoy = asistenciaByTech.value.get(tech.id);
    if (asistenciaHoy?.estado === 'En Almuerzo') {
      const elapsedMinutes = asistenciaHoy.inicio_almuerzo
        ? Math.max(0, props.now - new Date(asistenciaHoy.inicio_almuerzo).getTime()) / 60000
        : null;
      return { id: tech.id, name, phone: tech.phone, status: 'en_almuerzo', job: null, elapsedMinutes, resolvedToday, ...telemetry };
    }
    // PRIORIDAD 2: orden en progreso ("en atención") o ya asignada pero sin
    // iniciar todavia ("en camino").
    const inProgress = assigned.find((j) => j.status === 'in_progress');
    if (inProgress) {
      const elapsedMinutes = Math.max(0, props.now - new Date(inProgress.updatedAt).getTime()) / 60000;
      return { id: tech.id, name, phone: tech.phone, status: 'en_atencion', job: inProgress, elapsedMinutes, resolvedToday, ...telemetry };
    }
    const notStarted = assigned.find((j) => isNotStarted(j));
    if (notStarted) return { id: tech.id, name, phone: tech.phone, status: 'en_camino', job: notStarted, elapsedMinutes: null, resolvedToday, ...telemetry };
    // PRIORIDAD 3: sin almuerzo y sin ninguna orden activa.
    return { id: tech.id, name, phone: tech.phone, status: 'disponible', job: null, elapsedMinutes: null, resolvedToday, ...telemetry };
  }),
);

function timerClass(card: TechCard): string {
  if (card.elapsedMinutes == null) return 'text-slate-500';
  if (card.elapsedMinutes > props.slaThresholdMinutes * 2) return 'text-red-600 font-semibold';
  if (card.elapsedMinutes > props.slaThresholdMinutes) return 'text-orange-600 font-semibold';
  return 'text-slate-500';
}

function batteryClass(level: number | null): string {
  if (level == null) return 'text-slate-400';
  return level < 20 ? 'text-red-600 font-semibold' : 'text-slate-500';
}

// Señal/GPS (Fase 115): "hace N min" desde el ultimo ping de telemetria de
// la App de Campo, o "Sin señal" si nunca reporto o lleva mas de
// gpsStaleMinutes sin hacerlo (celular apagado, sin datos, app cerrada por
// MIUI en 2do plano, etc).
function signalInfo(card: TechCard): { label: string; stale: boolean } {
  if (!card.lastPingAt) return { label: 'Sin señal', stale: true };
  const minutes = Math.max(0, props.now - new Date(card.lastPingAt).getTime()) / 60000;
  if (minutes > props.gpsStaleMinutes) return { label: '⚠️ Sin señal', stale: true };
  const m = Math.round(minutes);
  return { label: m < 1 ? '📍 ahora' : `📍 hace ${m} min`, stale: false };
}

function handleClick(card: TechCard) {
  emit('select', card.id, card.job?.id ?? null);
}

function handleDblClick(card: TechCard) {
  if (card.job) emit('openJob', card.job);
}

// ---- Modal de mapa (Fase 115) — guarda solo el ID, no una copia de la
// tarjeta: asi mapTech queda derivado de `cards` y se mueve solo si llega
// un ping de telemetria nuevo mientras el modal sigue abierto. ----
const mapTechId = ref<string | null>(null);
const mapTech = computed(() => cards.value.find((c) => c.id === mapTechId.value) ?? null);
const mapEl = ref<HTMLDivElement | null>(null);
let leafletMap: L.Map | null = null;
let marker: L.Marker | null = null;

function openMap(card: TechCard) {
  if (card.latitude == null || card.longitude == null) return;
  mapTechId.value = card.id;
}
function closeMap() {
  mapTechId.value = null;
}

function destroyMap() {
  if (leafletMap) leafletMap.remove();
  leafletMap = null;
  marker = null;
}

watch(mapTechId, async (id) => {
  destroyMap();
  if (!id) return;
  await nextTick();
  const tech = mapTech.value;
  if (!mapEl.value || !tech || tech.latitude == null || tech.longitude == null) return;
  leafletMap = L.map(mapEl.value, { zoomControl: true }).setView([tech.latitude, tech.longitude], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(leafletMap);
  marker = L.marker([tech.latitude, tech.longitude], { icon: teardropIcon('#0ea5e9', '<circle cx="12" cy="12" r="5"/>') }).addTo(leafletMap);
});

// Si llega telemetria nueva (Realtime) mientras el modal esta abierto, el
// marcador/mapa se mueven solos — esto es lo que hace que sea "en vivo".
watch(
  () => (mapTech.value && mapTech.value.latitude != null && mapTech.value.longitude != null ? [mapTech.value.latitude, mapTech.value.longitude] : null),
  (coords) => {
    if (!coords || !leafletMap || !marker) return;
    const latlng = L.latLng(coords[0], coords[1]);
    marker.setLatLng(latlng);
    leafletMap.panTo(latlng);
  },
);

onUnmounted(destroyMap);
</script>

<template>
  <div v-if="technicians.length" class="surface mb-4 p-3">
    <div class="text-sm font-medium text-slate-700 mb-2">👷 Técnicos activos</div>
    <div class="flex gap-2 overflow-x-auto pb-1">
      <button
        v-for="card in cards"
        :key="card.id"
        type="button"
        class="flex min-w-[170px] shrink-0 flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors"
        :class="
          card.id === selectedTechId
            ? 'border-sky-400 bg-sky-50 ring-1 ring-sky-300'
            : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
        "
        :title="card.job ? 'Clic: filtrar · Doble clic: abrir la orden' : 'Clic: ver sus órdenes de hoy'"
        @click="handleClick(card)"
        @dblclick="handleDblClick(card)"
      >
        <div class="flex items-center justify-between gap-1.5">
          <div class="flex items-center gap-1.5 text-xs font-medium text-slate-800 truncate">
            <span class="inline-block h-2 w-2 shrink-0 rounded-full" :class="STATUS_META[card.status].dot"></span>
            <span class="truncate">{{ card.name }}</span>
          </div>
          <div v-if="card.phone" class="flex items-center gap-1 shrink-0" @click.stop @dblclick.stop>
            <a :href="waLink(card.phone)" target="_blank" rel="noopener" title="WhatsApp" class="text-green-600 hover:text-green-700">
              💬
            </a>
            <a :href="telLink(card.phone)" title="Llamar" class="text-sky-600 hover:text-sky-700">📞</a>
          </div>
        </div>
        <div class="text-[11px] text-slate-500">
          <template v-if="card.status === 'en_almuerzo'">
            <span class="font-medium text-amber-700">{{ STATUS_META.en_almuerzo.label }}</span>
            <span v-if="card.elapsedMinutes != null"> · lleva {{ Math.round(card.elapsedMinutes) }} min</span>
          </template>
          <template v-else-if="card.status === 'en_atencion' && card.job">
            <span class="font-mono">{{ card.job.number ?? card.job.label }}</span> ·
            <span :class="timerClass(card)">⏱️ {{ formatElapsedTime(card.job.updatedAt, now) }}</span>
            <span v-if="card.elapsedMinutes! > slaThresholdMinutes" class="ml-0.5" title="Demora sobre el umbral configurado">⚠️</span>
          </template>
          <template v-else-if="card.status === 'en_camino' && card.job">
            <span class="font-mono">{{ card.job.number ?? card.job.label }}</span> · en camino
          </template>
          <template v-else>
            <span class="badge text-[10px] bg-green-500/15 text-green-700">✓ {{ STATUS_META.disponible.label }}</span>
          </template>
        </div>

        <!-- Telemetria (Fase 115): bateria + ultimo ping de GPS, clickeable a un mapa. -->
        <div class="flex items-center justify-between gap-1.5 text-[11px]">
          <span :class="batteryClass(card.batteryLevel)" :title="card.batteryLevel != null ? `Batería ${card.batteryLevel}%` : 'Sin dato de batería'">
            🔋 {{ card.batteryLevel != null ? `${card.batteryLevel}%` : '—' }}
          </span>
          <button
            v-if="card.latitude != null && card.longitude != null"
            type="button"
            class="hover:underline"
            :class="signalInfo(card).stale ? 'text-amber-600 font-medium' : 'text-slate-500'"
            title="Ver ubicación en el mapa"
            @click.stop="openMap(card)"
          >
            {{ signalInfo(card).label }}
          </button>
          <span v-else class="text-slate-400">Sin ubicación</span>
        </div>

        <div v-if="card.resolvedToday" class="badge text-[10px] self-start bg-green-500/15 text-green-700">
          ✓ {{ card.resolvedToday }} hoy
        </div>
      </button>
    </div>

    <Teleport to="body">
      <div v-if="mapTech" class="modal-overlay" @click.self="closeMap">
        <div class="w-full max-w-lg modal-panel p-0 overflow-hidden">
          <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <div class="text-sm font-medium text-slate-800">📍 Ubicación de {{ mapTech.name }}</div>
            <button type="button" class="text-slate-500 hover:text-slate-800" @click="closeMap">✕</button>
          </div>
          <div ref="mapEl" class="w-full h-80"></div>
          <div class="px-4 py-2 text-[11px] text-slate-500 border-t border-slate-200 flex items-center justify-between">
            <span>{{ signalInfo(mapTech).label }}</span>
            <span class="font-mono">{{ mapTech.latitude?.toFixed(5) }}, {{ mapTech.longitude?.toFixed(5) }}</span>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
