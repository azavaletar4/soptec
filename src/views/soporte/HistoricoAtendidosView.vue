<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import SoporteTabs from '@/components/soporte/SoporteTabs.vue';
import DateRangeFilter, { type DateRange } from '@/components/soporte/DateRangeFilter.vue';
import PhotoLightbox, { type LightboxPhoto } from '@/components/PhotoLightbox.vue';
import { useTicketsStore } from '@/stores/tickets';
import { useInstallationsStore } from '@/stores/installations';
import { useRoutinesStore } from '@/stores/routines';
import { useCatalogsStore } from '@/stores/catalogs';
import { useTicketApprovalsStore, parseEquipmentType } from '@/stores/ticketApprovals';
import { useToast } from '@/composables/useToast';
import { getErrorMessage } from '@/lib/errors';
import { EQUIPMENT_TYPE_LABEL } from '@/lib/equipmentPhotoType';
import { JOB_STATUS_CLASS, JOB_STATUS_LABEL, useUnifiedJobs, type UnifiedJob } from '@/composables/useUnifiedJobs';
import { supabase } from '@/lib/supabase';
import type { JobType, Routine, Ticket } from '@/types/domain';

// Fase 107: todo lo resuelto/cerrado/completado vive aca aparte — asi
// "Operaciones de Hoy" solo tiene que mostrar lo que de verdad hace falta
// atender hoy, sin que el historico la vaya llenando con el tiempo.

const router = useRouter();
const ticketsStore = useTicketsStore();
const installationsStore = useInstallationsStore();
const routinesStore = useRoutinesStore();
const catalogs = useCatalogsStore();
const ticketApprovalsStore = useTicketApprovalsStore();
const toast = useToast();
const { finishedJobs } = useUnifiedJobs();

const TYPE_META: Record<JobType, { label: string; badge: string }> = {
  ticket: { label: '🔴 Avería', badge: 'bg-red-500/15 text-red-700' },
  installation: { label: '🟢 Alta', badge: 'bg-green-500/15 text-green-700' },
  routine: { label: '🟡 Rutina', badge: 'bg-amber-500/15 text-amber-700' },
};
const TYPE_TABS: { value: JobType | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'ticket', label: '🔴 Averías' },
  { value: 'installation', label: '🟢 Altas' },
  { value: 'routine', label: '🟡 Rutinas' },
];

const typeFilter = ref<JobType | 'all'>('all');
const technicianFilter = ref<string>('all');
const searchQuery = ref('');
const dateRange = ref<DateRange | null>(null);

const technicians = computed(() => catalogs.staff.filter((s) => s.role === 'TECNICO_RED'));

const filteredJobs = computed(() => {
  let list = finishedJobs.value;
  if (typeFilter.value !== 'all') list = list.filter((j) => j.jobType === typeFilter.value);
  if (technicianFilter.value !== 'all') list = list.filter((j) => j.assignedId === technicianFilter.value);
  const q = searchQuery.value.trim().toLowerCase();
  // Buscar por texto consulta TODA la base, ignorando el rango de fecha
  // activo (el default de esta vista es "Hoy" — sin esto, buscar un cliente
  // atendido ayer no aparecia hasta cambiar manualmente a "Este mes").
  if (dateRange.value && !q) {
    const { start, end } = dateRange.value;
    list = list.filter((j) => {
      const relevant = j.finishedAt ? new Date(j.finishedAt) : new Date(`${j.fallbackDate}T12:00:00`);
      const time = relevant.getTime();
      return time >= start.getTime() && time <= end.getTime();
    });
  }
  if (q) list = list.filter((j) => `${j.label} ${j.number ?? ''}`.toLowerCase().includes(q));
  return [...list].sort((a, b) => {
    const aTime = a.finishedAt ? new Date(a.finishedAt).getTime() : new Date(a.createdAt).getTime();
    const bTime = b.finishedAt ? new Date(b.finishedAt).getTime() : new Date(b.createdAt).getTime();
    return bTime - aTime;
  });
});

onMounted(() => {
  Promise.all([ticketsStore.fetchTickets(), installationsStore.fetchInstallations(), routinesStore.fetchRoutines(), catalogs.fetchStaff()]);
});

function goToJob(job: UnifiedJob) {
  if (job.jobType === 'ticket') {
    router.push(`/soporte/${job.id}`);
  } else if (job.jobType === 'installation') {
    // Fase 122: ahora si tiene su propia vista de detalle (igual que un
    // ticket en /soporte/:id) — ahi se ve todo lo que registro el tecnico
    // (materiales, equipos) en modo solo-lectura por estar completada, con
    // un acceso directo a la ficha del cliente para ver las fotos.
    router.push(`/soporte/instalaciones/${job.id}`);
  } else {
    // Fase 133: detalle dedicado (cierre de campo + evidencias) — antes
    // volvia a la lista de Rutinas con una busqueda, que solo reabria el
    // modal de creacion/edicion sin mostrar nada del cierre registrado por
    // el tecnico en la App de Campo.
    router.push(`/soporte/rutinas/${job.id}`);
  }
}

// DD/MM/YYYY hh:mm a.m./p.m. — a mano en vez de Intl porque el formato con
// puntos ("a.m."/"p.m.", no "a. m." con espacio) lo pide especifico el usuario.
function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const suffix = d.getHours() >= 12 ? 'p.m.' : 'a.m.';
  let hours = d.getHours() % 12;
  if (hours === 0) hours = 12;
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${String(hours).padStart(2, '0')}:${minutes} ${suffix}`;
}

// Tiempo de respuesta (creacion -> atencion): verde < 4h, amarillo 4h-24h,
// rojo > 24h (el tramo 4h-12h/12h-24h del pedido original comparte el mismo
// amarillo, no hay un 4to color definido).
interface SlaInfo {
  label: string;
  cls: string;
}
function slaInfo(job: UnifiedJob): SlaInfo | null {
  if (!job.finishedAt) return null;
  const ms = new Date(job.finishedAt).getTime() - new Date(job.createdAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const label = h > 0 ? `⏱️ ${h}h ${m}m` : `⏱️ ${m}m`;
  const hours = ms / 3_600_000;
  const cls = hours < 4 ? 'bg-green-500/15 text-green-700' : hours <= 24 ? 'bg-yellow-500/15 text-yellow-700' : 'bg-red-500/15 text-red-700';
  return { label, cls };
}
function slaPlainLabel(job: UnifiedJob): string {
  return slaInfo(job)?.label.replace('⏱️ ', '') ?? '';
}

// Notas de cierre: mismo campo que ya muestra cada detalle dedicado —
// tickets.observacion_cierre (TicketDetailView) / routines.closure_notes
// (RoutineDetailView, Fase 133). Instalaciones no tiene un campo de notas de
// cierre propio (Fase 64b aplica fotos/GPS directo, sin texto aparte) — la
// celda queda vacia para ese tipo, no es un dato faltante.
function closureNotesFor(job: UnifiedJob): string {
  if (job.jobType === 'ticket') return (job.raw as Ticket).observacion_cierre ?? '';
  if (job.jobType === 'routine') return (job.raw as Routine).closure_notes ?? '';
  return '';
}

/** Conteo de evidencias (work_order_photos, sin contar rechazadas) por orden — una sola consulta por tipo en vez de una por fila. */
async function fetchEvidenceCounts(jobs: UnifiedJob[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const idsByType: Record<JobType, string[]> = { ticket: [], installation: [], routine: [] };
  for (const j of jobs) idsByType[j.jobType].push(j.id);
  for (const jobType of Object.keys(idsByType) as JobType[]) {
    const ids = idsByType[jobType];
    if (!ids.length) continue;
    const { data } = await supabase.from('work_order_photos').select('job_id').eq('job_type', jobType).in('job_id', ids).neq('status', 'rejected');
    for (const row of data ?? []) {
      const key = `${jobType}:${row.job_id}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

const exportingCsv = ref(false);

async function exportCsv() {
  exportingCsv.value = true;
  try {
    const counts = await fetchEvidenceCounts(filteredJobs.value);
    const header = [
      'Orden',
      'Cliente',
      'Tipo',
      'Estado',
      'Asignado',
      'Creado',
      'Atendido',
      'Tiempo de respuesta',
      'Notas de cierre',
      'Evidencias',
    ];
    const rows = filteredJobs.value.map((j) => [
      j.number ?? '',
      j.label,
      TYPE_META[j.jobType].label,
      JOB_STATUS_LABEL[j.status] ?? j.status,
      j.assignedName ?? 'Sin asignar',
      formatDateTime(j.createdAt),
      formatDateTime(j.finishedAt),
      slaPlainLabel(j),
      closureNotesFor(j),
      String(counts.get(`${j.jobType}:${j.id}`) ?? 0),
    ]);
    const csv = [header, ...rows].map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `historico-atendidos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast.error(getErrorMessage(e, 'Error al exportar el CSV'));
  } finally {
    exportingCsv.value = false;
  }
}

// ---- Acceso rapido a evidencias (fotos de campo), via el mismo PhotoLightbox
// que usa TicketDetailView — aca es solo lectura, sin aprobar/rechazar. ----
const PHOTO_LABELS: Record<string, string> = {
  facade: 'Fachada',
  service_sheet: 'Hoja de servicio',
  modem_position: 'Posición del módem',
  nap_box: 'Caja NAP',
  pon_power: 'Potencia Óptica Recibida',
  evidencia_1: 'Evidencia 1',
  evidencia_2: 'Evidencia 2',
};
function photoLabel(category: string): string {
  const equipmentType = parseEquipmentType(category);
  if (equipmentType) return EQUIPMENT_TYPE_LABEL[equipmentType];
  return PHOTO_LABELS[category] ?? category;
}

const lightboxPhotos = ref<LightboxPhoto[]>([]);
const loadingEvidenciasId = ref<string | null>(null);
const evidenciasError = ref<string | null>(null);

async function openEvidencias(job: UnifiedJob) {
  const key = `${job.jobType}-${job.id}`;
  loadingEvidenciasId.value = key;
  evidenciasError.value = null;
  try {
    const photos = await ticketApprovalsStore.fetchJobPhotos(job.jobType, job.id);
    if (!photos.length) {
      toast.info('Esta orden no tiene fotos registradas desde la App de Campo.');
      return;
    }
    lightboxPhotos.value = photos.map((p) => ({ id: p.id, url: p.url ?? '', label: photoLabel(p.category) }));
  } catch (e) {
    evidenciasError.value = getErrorMessage(e, 'Error al cargar las evidencias');
    toast.error(evidenciasError.value);
  } finally {
    loadingEvidenciasId.value = null;
  }
}
</script>

<template>
  <AppLayout>
    <SoporteTabs />

    <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <h1 class="text-2xl font-semibold">📁 Histórico de Atendidos</h1>
        <p class="text-slate-600 text-sm mt-1">{{ filteredJobs.length }} órdenes resueltas / cerradas / completadas / canceladas</p>
      </div>
      <div class="flex items-center gap-2">
        <button class="btn-secondary text-sm" :disabled="!filteredJobs.length || exportingCsv" @click="exportCsv">
          {{ exportingCsv ? 'Exportando...' : '⬇️ Exportar a CSV' }}
        </button>
      </div>
    </div>

    <div class="surface flex flex-col gap-3 p-3 mb-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input v-model="searchQuery" placeholder="Buscar por cliente, título o número..." class="field-input sm:max-w-xs" />
        <div class="flex flex-wrap gap-2">
          <button
            v-for="tab in TYPE_TABS"
            :key="tab.value"
            class="px-3 py-1.5 rounded-lg text-xs font-medium"
            :class="typeFilter === tab.value ? 'bg-sky-500 text-slate-950' : 'bg-slate-100 text-slate-600 hover:text-slate-900'"
            @click="typeFilter = tab.value"
          >
            {{ tab.label }}
          </button>
        </div>
        <select v-model="technicianFilter" class="field-input sm:max-w-[220px]">
          <option value="all">Todos los técnicos</option>
          <option v-for="t in technicians" :key="t.id" :value="t.id">{{ t.full_name || t.email }}</option>
        </select>
      </div>
      <DateRangeFilter @change="dateRange = $event" />
    </div>

    <p v-if="!filteredJobs.length" class="text-center text-slate-500 py-6">No hay órdenes atendidas en este filtro.</p>

    <template v-else>
      <div class="flex flex-col gap-3 sm:hidden">
        <div v-for="job in filteredJobs" :key="`${job.jobType}-${job.id}`" class="surface p-3 cursor-pointer" @click="goToJob(job)">
          <div class="flex items-start justify-between gap-2 mb-1.5">
            <span class="font-mono text-xs text-slate-500">{{ job.number ?? '—' }}</span>
            <span class="badge text-[10px]" :class="TYPE_META[job.jobType].badge">{{ TYPE_META[job.jobType].label }}</span>
          </div>
          <div class="text-slate-900 font-medium mb-1">{{ job.label }}</div>
          <div class="text-xs text-slate-500">
            {{ JOB_STATUS_LABEL[job.status] ?? job.status }} · {{ job.assignedName ?? 'Sin asignar' }}
          </div>
          <div class="text-xs text-slate-500 mt-1">
            Creado: {{ formatDateTime(job.createdAt) }}<br />
            Atendido: {{ formatDateTime(job.finishedAt) }}
          </div>
          <div class="flex items-center justify-between mt-2">
            <span v-if="slaInfo(job)" class="badge text-[11px]" :class="slaInfo(job)!.cls">{{ slaInfo(job)!.label }}</span>
            <span v-else />
            <button
              type="button"
              class="text-xs text-sky-700"
              :disabled="loadingEvidenciasId === `${job.jobType}-${job.id}`"
              @click.stop="openEvidencias(job)"
            >
              📷 Evidencias
            </button>
          </div>
        </div>
      </div>

      <div class="table-shell hidden sm:block">
        <table class="w-full text-sm min-w-[820px]">
          <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
            <tr>
              <th class="text-left px-4 py-3">Orden</th>
              <th class="text-left px-4 py-3">Cliente</th>
              <th class="text-left px-4 py-3">Tipo</th>
              <th class="text-left px-4 py-3">Estado</th>
              <th class="text-left px-4 py-3">Asignado</th>
              <th class="text-left px-4 py-3">Atendido</th>
              <th class="text-left px-4 py-3">Tiempo de respuesta</th>
              <th class="text-left px-4 py-3">Evidencias</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="job in filteredJobs"
              :key="`${job.jobType}-${job.id}`"
              class="border-t border-slate-200 hover:bg-slate-50 cursor-pointer"
              @click="goToJob(job)"
            >
              <td class="px-4 py-3">
                <div class="font-mono text-xs text-slate-500">{{ job.number ?? '—' }}</div>
                <div class="text-slate-900">{{ job.jobType === 'ticket' ? (job.raw as Ticket).title : job.label }}</div>
              </td>
              <td class="px-4 py-3 text-slate-600">{{ job.label }}</td>
              <td class="px-4 py-3"><span class="badge" :class="TYPE_META[job.jobType].badge">{{ TYPE_META[job.jobType].label }}</span></td>
              <td class="px-4 py-3"><span class="badge" :class="JOB_STATUS_CLASS[job.status]">{{ JOB_STATUS_LABEL[job.status] ?? job.status }}</span></td>
              <td class="px-4 py-3 text-slate-600">{{ job.assignedName ?? 'Sin asignar' }}</td>
              <td class="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                Creado: {{ formatDateTime(job.createdAt) }}<br />
                Atendido: {{ formatDateTime(job.finishedAt) }}
              </td>
              <td class="px-4 py-3">
                <span v-if="slaInfo(job)" class="badge text-[11px] whitespace-nowrap" :class="slaInfo(job)!.cls">{{ slaInfo(job)!.label }}</span>
                <span v-else class="text-slate-400 text-xs">—</span>
              </td>
              <td class="px-4 py-3">
                <button
                  type="button"
                  class="btn-ghost text-xs px-2 py-1"
                  :disabled="loadingEvidenciasId === `${job.jobType}-${job.id}`"
                  @click.stop="openEvidencias(job)"
                >
                  {{ loadingEvidenciasId === `${job.jobType}-${job.id}` ? 'Cargando...' : '📷 Evidencias' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <PhotoLightbox v-if="lightboxPhotos.length" :photos="lightboxPhotos" @close="lightboxPhotos = []" />
  </AppLayout>
</template>
