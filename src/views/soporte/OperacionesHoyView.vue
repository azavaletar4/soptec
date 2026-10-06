<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import TicketFlowGuide from '@/components/soporte/TicketFlowGuide.vue';
import TechnicianStatusBar from '@/components/soporte/TechnicianStatusBar.vue';
import SoporteTabs from '@/components/soporte/SoporteTabs.vue';
import { useTicketsStore } from '@/stores/tickets';
import { useInstallationsStore } from '@/stores/installations';
import { useRoutinesStore } from '@/stores/routines';
import { useClientsStore } from '@/stores/clients';
import { useContractsStore } from '@/stores/contracts';
import { useCatalogsStore } from '@/stores/catalogs';
import { useJobAssigneesStore } from '@/stores/jobAssignees';
import { useAuthStore } from '@/stores/auth';
import { JOB_STATUS_CLASS, JOB_STATUS_LABEL, useUnifiedJobs, type UnifiedJob } from '@/composables/useUnifiedJobs';
import { getErrorMessage } from '@/lib/errors';
import { formatElapsedTime } from '@/lib/elapsedTime';
import { MOTIVO_AVERIA_OPTIONS } from '@/lib/ticketMotivoAveria';
import { PRIORITY_CLASS, PRIORITY_LABEL } from '@/lib/ticketPriority';
import { TURNOS, todayStr, dateTimeToIso } from '@/lib/turnos';
import { AVERIA_TICKET_CATEGORIES } from '@/types/domain';
import type { JobType, ServiceContract, Ticket, TicketCategory, TicketMotivoAveria, TicketPriority } from '@/types/domain';

// Fase 107: reemplaza el switcher de pestañas por tipo (Fase 101,
// SoporteModeTabs.vue — ya no existe) por una sola bandeja que cruza
// Averias/Altas/Rutinas ACTIVAS del dia a dia. Lo resuelto/cerrado vive
// aparte en HistoricoAtendidosView.vue — asi esta vista no se va llenando
// de trabajo que ya no hace falta revisar.

const route = useRoute();
const router = useRouter();
const ticketsStore = useTicketsStore();
const installationsStore = useInstallationsStore();
const routinesStore = useRoutinesStore();
const clientsStore = useClientsStore();
const contractsStore = useContractsStore();
const catalogsStore = useCatalogsStore();
const jobAssigneesStore = useJobAssigneesStore();
const auth = useAuthStore();
const { allJobs, activeJobs } = useUnifiedJobs();

const technicians = computed(() => catalogsStore.staff.filter((s) => s.role === 'TECNICO_RED'));

// Reloj compartido para los cronometros en vivo (barra de tecnicos + chip
// "en progreso" de cada ticket) — un solo interval para toda la vista.
const now = ref(Date.now());
let clockTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  clockTimer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});
onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer);
});

// Mismo criterio que TicketDetailView.vue: TECNICO_RED solo actua sobre lo
// que tiene asignado; el resto del staff puede actuar sobre cualquier ticket.
function canActOn(t: Ticket): boolean {
  if (auth.role !== 'TECNICO_RED') return true;
  return t.assigned_to === auth.user?.id;
}

const startingId = ref<string | null>(null);
async function handleQuickStart(t: Ticket) {
  startingId.value = t.id;
  try {
    await ticketsStore.updateTicketStatus(t.id, 'in_progress');
  } catch (e) {
    alert(getErrorMessage(e, 'Error al iniciar la orden'));
  } finally {
    startingId.value = null;
  }
}

// Crear tickets es solo para ADMIN/SUPERADMIN; TECNICO_RED y SOPORTE
// pueden ver/atender los que ya existen.
const canCreateTickets = computed(() => auth.role === 'SUPERADMIN' || auth.role === 'ADMIN');
const canCreateOthers = computed(() => auth.role !== 'TECNICO_RED');

// La App de Campo (Fase 32) no tiene entrada propia en el sidebar para no
// amontonarlo — se accede desde aqui, mismo criterio que "Ranking tecnicos".
const canOpenCampo = computed(() => ['SUPERADMIN', 'ADMIN', 'TECNICO_RED'].includes(auth.role ?? ''));

const showModal = ref(false);
const saving = ref(false);
const formError = ref<string | null>(null);
const clientFilter = ref('');
const typeFilter = ref<JobType | 'all'>('all');
const searchQuery = ref('');

// Filtro por tecnico desde TechnicianStatusBar (Fase 111): un clic en una
// tarjeta filtra+resalta abajo. techFilterTicketId es el ticket puntual a
// resaltar (tecnico "en atencion"/"en camino"); si viene null pero
// techFilterId si, el tecnico esta "disponible" y se amplia la busqueda a
// TODAS sus ordenes (activas o ya atendidas) agendadas/completadas hoy, no
// solo las activas — por eso usa allJobs en vez de activeJobs en ese caso.
const techFilterId = ref<string | null>(null);
const techFilterTicketId = ref<string | null>(null);

function handleTechSelect(techId: string, ticketId: string | null) {
  if (techFilterId.value === techId) {
    techFilterId.value = null;
    techFilterTicketId.value = null;
    return;
  }
  techFilterId.value = techId;
  techFilterTicketId.value = ticketId;
}

function handleTechOpenTicket(ticketId: string) {
  router.push(`/soporte/${ticketId}`);
}

function clearTechFilter() {
  techFilterId.value = null;
  techFilterTicketId.value = null;
}

const selectedTechName = computed(() => technicians.value.find((t) => t.id === techFilterId.value)?.full_name ?? null);

const emptyForm = () => ({
  client_id: '',
  contract_id: '',
  title: '',
  description: '',
  category: 'other' as TicketCategory,
  priority: 'medium' as TicketPriority,
  // Fase 103 — sospecha inicial opcional, pre-llena el cierre del tecnico.
  motivo_preliminar: '' as TicketMotivoAveria | '',
  // Fase 104 — agendamiento y asignacion directa (opcional): si se eligen
  // turno + tecnico juntos, el ticket nace ya ubicado en el Cronograma.
  schedule_date: todayStr(),
  schedule_turno: '',
  schedule_tech_id: '',
});
const form = ref(emptyForm());
const ticketContracts = ref<ServiceContract[]>([]);
const loadingTicketContracts = ref(false);

const TYPE_META: Record<JobType, { label: string; dot: string; badge: string }> = {
  ticket: { label: '🔴 Avería', dot: 'bg-red-500', badge: 'bg-red-500/15 text-red-700' },
  installation: { label: '🟢 Alta', dot: 'bg-green-500', badge: 'bg-green-500/15 text-green-700' },
  routine: { label: '🟡 Rutina', dot: 'bg-amber-500', badge: 'bg-amber-500/15 text-amber-700' },
};
const TYPE_TABS: { value: JobType | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'ticket', label: '🔴 Solo Averías' },
  { value: 'installation', label: '🟢 Solo Altas' },
  { value: 'routine', label: '🟡 Solo Rutinas' },
];

const CATEGORY_LABEL: Record<TicketCategory, string> = {
  no_service: 'Sin servicio',
  slow_speed: 'Lentitud',
  billing: 'Facturación',
  installation: 'Instalación',
  equipment: 'Equipo',
  reconnection_relocation: 'Reconexión / Traslado',
  other: 'Otro',
};

// Orden automatico (Fase 90, extendido en Fase 108 a Altas/Rutinas ya que
// las 3 tienen su propia prioridad): dentro de lo activo, por urgencia
// (urgente > alta > media > baja) y como ultimo, lo mas reciente primero.
const PRIORITY_SORT_RANK: Record<TicketPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// Cliente Ausente / re-agendamiento prioritario (Fase 102): un ticket
// 'rescheduled' cuya fecha ya llego se va al Top 1 absoluto de la lista.
function isDueReschedule(job: UnifiedJob, nowMs: number): boolean {
  if (job.jobType !== 'ticket') return false;
  const t = job.raw as Ticket;
  return t.status === 'rescheduled' && !!t.rescheduled_to && new Date(t.rescheduled_to).getTime() <= nowMs;
}

// Agendada o completada "hoy" para el tecnico "disponible" seleccionado:
// por su propia fecha de agenda, o por fallbackDate si no tiene hora exacta,
// o por cuando se atendio (finishedAt) — igual criterio que fallbackDate en
// useUnifiedJobs.ts, en formato de fecha simple YYYY-MM-DD.
function isRelevantToday(job: UnifiedJob): boolean {
  const today = todayStr();
  if (job.finishedAt && job.finishedAt.slice(0, 10) === today) return true;
  if (job.scheduledStartAt) return job.scheduledStartAt.slice(0, 10) === today;
  return job.fallbackDate === today;
}

const filteredJobs = computed(() => {
  let list =
    techFilterId.value && !techFilterTicketId.value
      ? allJobs.value.filter((j) => j.assignedId === techFilterId.value && isRelevantToday(j))
      : activeJobs.value;
  if (techFilterId.value) list = list.filter((j) => j.assignedId === techFilterId.value);
  if (typeFilter.value !== 'all') list = list.filter((j) => j.jobType === typeFilter.value);
  const q = searchQuery.value.trim().toLowerCase();
  if (q) list = list.filter((j) => `${j.label} ${j.number ?? ''}`.toLowerCase().includes(q));
  return [...list].sort((a, b) => {
    const dueDiff = Number(isDueReschedule(b, now.value)) - Number(isDueReschedule(a, now.value));
    if (dueDiff !== 0) return dueDiff;
    const priorityDiff = PRIORITY_SORT_RANK[a.priority] - PRIORITY_SORT_RANK[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
});

const filteredClients = computed(() => {
  const q = clientFilter.value.trim().toLowerCase();
  const list = clientsStore.clients;
  if (!q) return list.slice(0, 30);
  return list
    .filter((c) => `${c.first_name} ${c.last_name} ${c.document_number}`.toLowerCase().includes(q))
    .slice(0, 30);
});

onMounted(async () => {
  await Promise.all([
    ticketsStore.fetchTickets(),
    installationsStore.fetchInstallations(),
    routinesStore.fetchRoutines(),
    clientsStore.fetchClients(),
    catalogsStore.fetchStaff(),
  ]);
  // Deep link desde la ficha de un servicio puntual (Fase 37):
  // /soporte?client_id=..&contract_id=.. abre el modal ya precargado.
  //
  // Deep link "Click & Create" desde el Cronograma de Campo (Fase 104):
  // /soporte?schedule_date=..&schedule_turno=..&tech_id=.. abre el modal con
  // el bloque de agendamiento ya precargado (click en una casilla vacia).
  const clientId = route.query.client_id as string | undefined;
  const scheduleDate = route.query.schedule_date as string | undefined;
  const scheduleTurno = route.query.schedule_turno as string | undefined;
  const techId = route.query.tech_id as string | undefined;
  if ((clientId || scheduleDate || scheduleTurno || techId) && canCreateTickets.value) {
    openCreate();
    if (clientId) {
      form.value.client_id = clientId;
      await onTicketClientChange();
      const contractId = route.query.contract_id as string | undefined;
      if (contractId && ticketContracts.value.some((c) => c.id === contractId)) form.value.contract_id = contractId;
    }
    if (scheduleDate) form.value.schedule_date = scheduleDate;
    if (scheduleTurno) form.value.schedule_turno = scheduleTurno;
    if (techId) form.value.schedule_tech_id = techId;
  }
});

// Un cliente puede tener mas de un servicio (Fase 37): al elegirlo, se
// cargan sus contratos para poder asociar el ticket a la linea puntual
// (o dejarlo general si no aplica a una linea especifica).
async function onTicketClientChange() {
  form.value.contract_id = '';
  ticketContracts.value = [];
  if (!form.value.client_id) return;
  loadingTicketContracts.value = true;
  try {
    ticketContracts.value = await contractsStore.fetchContractsByClient(form.value.client_id);
    if (ticketContracts.value.length === 1) form.value.contract_id = ticketContracts.value[0].id;
  } finally {
    loadingTicketContracts.value = false;
  }
}

function openCreate() {
  form.value = emptyForm();
  clientFilter.value = '';
  ticketContracts.value = [];
  formError.value = null;
  showModal.value = true;
}

async function handleSubmit() {
  if (!form.value.client_id) {
    formError.value = 'Selecciona un cliente';
    return;
  }
  // Fase 104: turno y tecnico van de la mano — un turno sin tecnico (o
  // viceversa) dejaria la orden con hora pero invisible en el Cronograma
  // (no cae en ninguna fila) o con tecnico pero sin hora (cae en "Sin
  // horario" igual, asi que no tiene sentido pedir solo el tecnico aca).
  if (form.value.schedule_turno && !form.value.schedule_tech_id) {
    formError.value = 'Elegiste un turno — selecciona también el técnico para esa cita.';
    return;
  }
  if (form.value.schedule_tech_id && !form.value.schedule_turno) {
    formError.value = 'Asignaste un técnico — selecciona también el turno de la cita.';
    return;
  }
  saving.value = true;
  formError.value = null;
  try {
    const turno = TURNOS.find((t) => t.value === form.value.schedule_turno);
    const created = await ticketsStore.createTicket({
      client_id: form.value.client_id,
      contract_id: form.value.contract_id || null,
      title: form.value.title,
      description: form.value.description || null,
      category: form.value.category,
      priority: form.value.priority,
      motivo_preliminar: AVERIA_TICKET_CATEGORIES.includes(form.value.category) ? form.value.motivo_preliminar || null : null,
      scheduled_start_at: turno ? dateTimeToIso(form.value.schedule_date, turno.start) : null,
      scheduled_end_at: turno ? dateTimeToIso(form.value.schedule_date, turno.end) : null,
    });
    // Agendamiento y asignacion directa (Fase 104): el tecnico queda como
    // lider de la cuadrilla del ticket nuevo — mismo mecanismo que
    // CrewAssignEditor.vue, para que job_assignees/assigned_to/el
    // Cronograma queden consistentes desde el primer momento.
    if (turno && form.value.schedule_tech_id) {
      await jobAssigneesStore.addAssignee('ticket', created.id, form.value.schedule_tech_id, []);
      // El trigger de sync (Fase 94) recien al insertar en job_assignees deja
      // assigned_to en el ticket — sin este refetch, TicketDetailView lo
      // veria "Sin tecnicos asignados" hasta recargar a mano.
      await ticketsStore.fetchTickets();
    }
    showModal.value = false;
    router.push(`/soporte/${created.id}`);
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al crear el ticket');
  } finally {
    saving.value = false;
  }
}

// Click en una fila: un ticket tiene su propia pagina de detalle; una
// instalacion/rutina se edita inline en su propia tabla (materiales,
// cuadrilla, censo...) — no tiene un modal de detalle aparte, asi que
// navega ahi con el nombre precargado en el buscador que esas vistas ya
// tienen, en vez de inventar un mecanismo de deep-link nuevo.
function goToJob(job: UnifiedJob) {
  if (job.jobType === 'ticket') router.push(`/soporte/${job.id}`);
  else if (job.jobType === 'installation') router.push(`/soporte/instalaciones?q=${encodeURIComponent(job.label)}`);
  else router.push(`/soporte/rutinas?q=${encodeURIComponent(job.label)}`);
}

const deletingId = ref<string | null>(null);

async function handleDelete(ticket: Ticket) {
  const ok = confirm(
    `¿Eliminar el ticket ${ticket.ticket_number}? Esta accion no se puede deshacer. Si tiene materiales asignados, se devuelven a bodega.`,
  );
  if (!ok) return;
  deletingId.value = ticket.id;
  try {
    const { materialsReturned } = await ticketsStore.deleteTicket(ticket.id);
    if (materialsReturned) alert(`Ticket eliminado. Se devolvieron ${materialsReturned} material(es) a bodega.`);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al eliminar el ticket'));
  } finally {
    deletingId.value = null;
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
}
</script>

<template>
  <AppLayout>
    <SoporteTabs />

    <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <h1 class="text-2xl font-semibold">📋 Operaciones de Hoy</h1>
        <p class="text-slate-600 text-sm mt-1">
          {{ filteredJobs.length }} {{ techFilterId && !techFilterTicketId ? 'órdenes de hoy' : 'órdenes activas' }} — Averías, Altas y Rutinas
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button v-if="canOpenCampo" class="btn-ghost" @click="router.push('/campo')">📱 App de Campo</button>
        <button v-if="auth.role !== 'TECNICO_RED'" class="btn-ghost" @click="router.push('/soporte/agenda')">📅 Agenda</button>
        <button class="btn-ghost" @click="router.push('/soporte/ranking')">🏆 Ranking técnicos</button>
        <button v-if="canCreateOthers" class="btn-secondary" @click="router.push('/soporte/instalaciones?create=1')">+ Alta</button>
        <button v-if="canCreateOthers" class="btn-secondary" @click="router.push('/soporte/rutinas?create=1')">+ Rutina</button>
        <button v-if="canCreateTickets" class="btn-primary" @click="openCreate">+ Avería</button>
      </div>
    </div>

    <TicketFlowGuide />

    <TechnicianStatusBar
      :technicians="technicians"
      :tickets="ticketsStore.tickets"
      :now="now"
      :selected-tech-id="techFilterId"
      @select="handleTechSelect"
      @open-ticket="handleTechOpenTicket"
    />

    <div v-if="techFilterId" class="flex items-center gap-2 mb-4 text-sm">
      <span class="badge bg-sky-500/15 text-sky-700">
        👷 Filtrando por {{ selectedTechName ?? 'técnico' }}
        {{ techFilterTicketId ? '· orden activa' : '· agenda/atendido hoy' }}
      </span>
      <button type="button" class="text-xs text-slate-500 hover:text-slate-800" @click="clearTechFilter">✕ Quitar filtro</button>
    </div>

    <div class="surface flex flex-col gap-3 p-3 mb-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input v-model="searchQuery" placeholder="Buscar por título, número o cliente..." class="field-input sm:max-w-xs" />
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
      </div>
    </div>

    <p v-if="ticketsStore.error" class="mb-4 text-sm text-red-600">{{ ticketsStore.error }}</p>

    <p v-if="ticketsStore.loading" class="text-center text-slate-500 py-6">Cargando...</p>
    <p v-else-if="!filteredJobs.length" class="text-center text-slate-500 py-6">No hay operaciones activas en este filtro.</p>

    <template v-else>
      <!-- Movil: cards (asi operan los tecnicos en campo) -->
      <div class="flex flex-col gap-3 sm:hidden">
        <div
          v-for="job in filteredJobs"
          :key="`${job.jobType}-${job.id}`"
          class="surface p-3 cursor-pointer"
          :class="isDueReschedule(job, now) ? 'ring-2 ring-red-500' : job.id === techFilterTicketId ? 'ring-2 ring-sky-500' : ''"
          @click="goToJob(job)"
        >
          <p v-if="isDueReschedule(job, now)" class="text-[11px] font-bold text-red-600 mb-1.5">🔴 REPROGRAMADO - ATENDER PRIMERO</p>
          <div class="flex items-start justify-between gap-2 mb-1.5">
            <span class="font-mono text-xs text-slate-500" :title="formatDate(job.createdAt)">{{ job.number ?? '—' }}</span>
            <div class="flex gap-1.5 shrink-0">
              <span class="badge text-[10px]" :class="TYPE_META[job.jobType].badge">{{ TYPE_META[job.jobType].label }}</span>
              <span v-if="job.priority" class="badge text-[10px]" :class="PRIORITY_CLASS[job.priority]">{{ PRIORITY_LABEL[job.priority] }}</span>
            </div>
          </div>
          <div class="text-slate-900 font-medium mb-1">{{ job.label }}</div>
          <div class="text-xs text-slate-500 mb-3">
            {{ job.jobType === 'ticket' ? CATEGORY_LABEL[(job.raw as Ticket).category] : job.assignedName ?? 'Sin asignar' }}
          </div>

          <div v-if="job.jobType === 'ticket'" class="flex items-center justify-between gap-2" @click.stop>
            <button
              v-if="(job.raw as Ticket).status === 'open' && (job.raw as Ticket).assigned_to && canActOn(job.raw as Ticket)"
              class="btn-primary flex-1 text-sm py-2"
              :disabled="startingId === job.id"
              @click="handleQuickStart(job.raw as Ticket)"
            >
              {{ startingId === job.id ? 'Iniciando...' : '▶ Iniciar orden' }}
            </button>
            <button v-else-if="(job.raw as Ticket).status === 'in_progress'" class="btn-secondary flex-1 text-sm py-2" @click="goToJob(job)">
              ⏱️ {{ formatElapsedTime((job.raw as Ticket).updated_at, now) }} · Finalizar
            </button>
            <button v-else class="btn-ghost flex-1 text-sm py-2" @click="goToJob(job)">Ver detalle</button>
            <button
              v-if="canCreateTickets"
              class="text-xs text-red-500/80 hover:text-red-600 shrink-0"
              :disabled="deletingId === job.id"
              @click="handleDelete(job.raw as Ticket)"
            >
              {{ deletingId === job.id ? '...' : 'Eliminar' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Desktop: tabla compacta -->
      <div class="table-shell hidden sm:block">
        <table class="w-full text-sm min-w-[760px]">
          <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
            <tr>
              <th class="text-left px-4 py-3">Orden</th>
              <th class="text-left px-4 py-3">Cliente</th>
              <th class="text-left px-4 py-3">Tipo</th>
              <th class="text-left px-4 py-3">Prioridad</th>
              <th class="text-left px-4 py-3">Estado</th>
              <th class="text-left px-4 py-3">Asignado</th>
              <th class="text-right px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="job in filteredJobs"
              :key="`${job.jobType}-${job.id}`"
              class="border-t border-slate-200 hover:bg-slate-50 cursor-pointer"
              :class="isDueReschedule(job, now) ? 'bg-red-50' : job.id === techFilterTicketId ? 'bg-sky-50 ring-1 ring-inset ring-sky-400' : ''"
              @click="goToJob(job)"
            >
              <td class="px-4 py-3">
                <div class="font-mono text-xs text-slate-500" :title="formatDate(job.createdAt)">{{ job.number ?? '—' }}</div>
                <div class="text-slate-900">{{ job.jobType === 'ticket' ? (job.raw as Ticket).title : job.label }}</div>
                <p v-if="isDueReschedule(job, now)" class="text-[11px] font-bold text-red-600 mt-0.5">🔴 REPROGRAMADO - ATENDER PRIMERO</p>
              </td>
              <td class="px-4 py-3 text-slate-600">{{ job.label }}</td>
              <td class="px-4 py-3">
                <span class="badge" :class="TYPE_META[job.jobType].badge">{{ TYPE_META[job.jobType].label }}</span>
                <span v-if="job.jobType === 'ticket'" class="block text-[11px] text-slate-400 mt-0.5">
                  {{ CATEGORY_LABEL[(job.raw as Ticket).category] }}
                </span>
              </td>
              <td class="px-4 py-3">
                <span v-if="job.priority" class="badge" :class="PRIORITY_CLASS[job.priority]">{{ PRIORITY_LABEL[job.priority] }}</span>
                <span v-else class="text-slate-300">—</span>
              </td>
              <td class="px-4 py-3">
                <span
                  class="badge"
                  :class="job.jobType === 'ticket' && isDueReschedule(job, now) ? 'bg-red-500/15 text-red-700' : JOB_STATUS_CLASS[job.status]"
                >
                  {{ JOB_STATUS_LABEL[job.status] ?? job.status }}
                </span>
              </td>
              <td class="px-4 py-3 text-slate-600">{{ job.assignedName ?? 'Sin asignar' }}</td>
              <td class="px-4 py-3 text-right whitespace-nowrap" @click.stop>
                <template v-if="job.jobType === 'ticket'">
                  <button
                    v-if="(job.raw as Ticket).status === 'open' && (job.raw as Ticket).assigned_to && canActOn(job.raw as Ticket)"
                    class="text-xs text-sky-700 hover:text-sky-800 font-medium mr-3"
                    :disabled="startingId === job.id"
                    @click="handleQuickStart(job.raw as Ticket)"
                  >
                    {{ startingId === job.id ? 'Iniciando...' : '▶ Iniciar' }}
                  </button>
                  <span v-else-if="(job.raw as Ticket).status === 'in_progress'" class="text-xs text-sky-700 mr-3">
                    ⏱️ {{ formatElapsedTime((job.raw as Ticket).updated_at, now) }}
                  </span>
                  <button
                    v-if="canCreateTickets"
                    class="text-xs text-red-500/80 hover:text-red-600"
                    :disabled="deletingId === job.id"
                    @click="handleDelete(job.raw as Ticket)"
                  >
                    {{ deletingId === job.id ? 'Eliminando...' : 'Eliminar' }}
                  </button>
                </template>
                <button v-else type="button" class="text-xs text-sky-700 hover:underline" @click="goToJob(job)">Ver / editar →</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay">
        <form class="w-full max-w-lg modal-panel max-h-[90vh] overflow-y-auto" @submit.prevent="handleSubmit">
          <h2 class="text-lg font-semibold mb-4">Nueva avería</h2>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Cliente</label>
            <input v-model="clientFilter" placeholder="Buscar por nombre o documento..." class="field-input mb-2" />
            <select v-model="form.client_id" required size="5" class="field-input" @change="onTicketClientChange">
              <option v-for="c in filteredClients" :key="c.id" :value="c.id">
                {{ c.first_name }} {{ c.last_name }} — {{ c.document_number }}
              </option>
            </select>
          </div>

          <div v-if="form.client_id" class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Servicio/línea</label>
            <select v-model="form.contract_id" class="field-input" :disabled="loadingTicketContracts">
              <option value="">{{ loadingTicketContracts ? 'Cargando...' : 'General (no aplica a una línea específica)' }}</option>
              <option v-for="ct in ticketContracts" :key="ct.id" :value="ct.id">
                {{ ct.contract_number }} — {{ ct.installation_address || 'Sin dirección' }}
              </option>
            </select>
            <p v-if="ticketContracts.length > 1" class="text-xs text-amber-700 mt-1">
              Este cliente tiene {{ ticketContracts.length }} servicios — elige a cuál corresponde el reclamo.
            </p>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Título</label>
            <input v-model="form.title" required class="field-input" />
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Descripción</label>
            <textarea v-model="form.description" rows="3" class="field-input"></textarea>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Categoría</label>
              <select v-model="form.category" class="field-input">
                <option v-for="(label, value) in CATEGORY_LABEL" :key="value" :value="value">{{ label }}</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Prioridad</label>
              <select v-model="form.priority" class="field-input">
                <option v-for="(label, value) in PRIORITY_LABEL" :key="value" :value="value">{{ label }}</option>
              </select>
            </div>
          </div>

          <div v-if="AVERIA_TICKET_CATEGORIES.includes(form.category)" class="mb-4">
            <label class="block text-xs text-slate-600 mb-1">Causa preliminar (opcional)</label>
            <select v-model="form.motivo_preliminar" class="field-input">
              <option value="">Sin sospecha todavía</option>
              <option v-for="m in MOTIVO_AVERIA_OPTIONS" :key="m.value" :value="m.value">{{ m.label }}</option>
            </select>
            <p class="text-[11px] text-slate-400 mt-1">
              Si ya sospechas la causa, el técnico la verá pre-seleccionada al cerrar — puede cambiarla en campo.
            </p>
          </div>

          <!-- Agendamiento y asignacion directa (Fase 104): opcional — si se
               deja en blanco, el ticket cae en "Sin horario asignado" del
               Cronograma, igual que hoy. -->
          <div class="mb-4 rounded-lg border border-slate-200 p-3">
            <p class="text-xs font-semibold text-slate-700 mb-2">📅 Agendamiento y Asignación Directa (opcional)</p>
            <div class="grid grid-cols-2 gap-3 mb-2">
              <div>
                <label class="block text-xs text-slate-600 mb-1">Fecha programada</label>
                <input v-model="form.schedule_date" type="date" class="field-input text-sm" />
              </div>
              <div>
                <label class="block text-xs text-slate-600 mb-1">Turno / rango horario</label>
                <select v-model="form.schedule_turno" class="field-input text-sm">
                  <option value="">Sin agendar</option>
                  <option v-for="t in TURNOS" :key="t.value" :value="t.value">{{ t.label }}</option>
                </select>
              </div>
            </div>
            <label class="block text-xs text-slate-600 mb-1">Técnico / cuadrilla asignada</label>
            <select v-model="form.schedule_tech_id" class="field-input text-sm">
              <option value="">Sin asignar</option>
              <option v-for="t in technicians" :key="t.id" :value="t.id">{{ t.full_name || t.email }}</option>
            </select>
            <p class="text-[11px] text-slate-400 mt-1">
              Si eliges turno y técnico, el ticket aparece ya ubicado en el Cronograma de Campo.
            </p>
          </div>

          <p v-if="formError" class="text-sm text-red-600 mb-3">{{ formError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showModal = false">Cancelar</button>
            <button type="submit" :disabled="saving" class="btn-primary">
              {{ saving ? 'Creando...' : 'Crear avería' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
