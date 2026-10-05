<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import SoporteModeTabs from '@/components/soporte/SoporteModeTabs.vue';
import TicketFlowGuide from '@/components/soporte/TicketFlowGuide.vue';
import TechnicianStatusBar from '@/components/soporte/TechnicianStatusBar.vue';
import DateRangeFilter, { type DateRange } from '@/components/soporte/DateRangeFilter.vue';
import { useTicketsStore } from '@/stores/tickets';
import { useClientsStore } from '@/stores/clients';
import { useContractsStore } from '@/stores/contracts';
import { useCatalogsStore } from '@/stores/catalogs';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/lib/errors';
import { formatElapsedTime } from '@/lib/elapsedTime';
import { MOTIVO_AVERIA_OPTIONS } from '@/lib/ticketMotivoAveria';
import { AVERIA_TICKET_CATEGORIES } from '@/types/domain';
import type { ServiceContract, Ticket, TicketCategory, TicketMotivoAveria, TicketPriority, TicketStatus } from '@/types/domain';

const route = useRoute();
const router = useRouter();
const ticketsStore = useTicketsStore();
const clientsStore = useClientsStore();
const contractsStore = useContractsStore();
const catalogsStore = useCatalogsStore();
const auth = useAuthStore();

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

// La App de Campo (Fase 32) no tiene entrada propia en el sidebar para no
// amontonarlo — se accede desde aqui, mismo criterio que "Ranking tecnicos".
const canOpenCampo = computed(() => ['SUPERADMIN', 'ADMIN', 'TECNICO_RED'].includes(auth.role ?? ''));

const showModal = ref(false);
const saving = ref(false);
const formError = ref<string | null>(null);
const clientFilter = ref('');
const statusFilter = ref<TicketStatus | 'all'>('all');
const searchQuery = ref('');
// Filtro de fecha (Fase 101) — contra created_at (cuando se reporto la averia).
const dateRange = ref<DateRange | null>(null);

const emptyForm = () => ({
  client_id: '',
  contract_id: '',
  title: '',
  description: '',
  category: 'other' as TicketCategory,
  priority: 'medium' as TicketPriority,
  // Fase 103 — sospecha inicial opcional, pre-llena el cierre del tecnico.
  motivo_preliminar: '' as TicketMotivoAveria | '',
});
const form = ref(emptyForm());
const ticketContracts = ref<ServiceContract[]>([]);
const loadingTicketContracts = ref(false);

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Abierto',
  in_progress: 'En progreso',
  resolved: 'Resuelto',
  closed: 'Cerrado',
  rescheduled: 'Reprogramado',
};
const STATUS_CLASS: Record<TicketStatus, string> = {
  open: 'bg-yellow-500/15 text-yellow-600',
  in_progress: 'bg-sky-500/15 text-sky-700',
  resolved: 'bg-green-500/15 text-green-600',
  closed: 'bg-slate-500/15 text-slate-600',
  rescheduled: 'bg-red-500/15 text-red-600',
};
const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  urgent: 'Urgente',
};
const PRIORITY_CLASS: Record<TicketPriority, string> = {
  low: 'bg-slate-500/15 text-slate-600',
  medium: 'bg-sky-500/15 text-sky-700',
  high: 'bg-orange-500/15 text-orange-600',
  urgent: 'bg-red-500/15 text-red-600',
};
const CATEGORY_LABEL: Record<TicketCategory, string> = {
  no_service: 'Sin servicio',
  slow_speed: 'Lentitud',
  billing: 'Facturación',
  installation: 'Instalación',
  equipment: 'Equipo',
  reconnection_relocation: 'Reconexión / Traslado',
  other: 'Otro',
};

const STATUS_TABS: { value: TicketStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'open', label: 'Abiertos' },
  { value: 'in_progress', label: 'En progreso' },
  { value: 'rescheduled', label: 'Reprogramados' },
  { value: 'resolved', label: 'Resueltos' },
  { value: 'closed', label: 'Cerrados' },
];

// Orden automatico (Fase 90): los activos (abierto/en progreso/reprogramado)
// siempre arriba, resueltos/cerrados al fondo; dentro de los activos, por
// urgencia (urgente > alta > media > baja); y como ultimo criterio, los mas
// recientes primero. Es reactivo: como updateTicketStatus reemplaza el
// ticket en ticketsStore.tickets, este computed se re-ordena solo en
// cuanto cambia el estado, sin recargar la pagina.
const STATUS_SORT_TIER: Record<TicketStatus, number> = {
  open: 0,
  in_progress: 0,
  rescheduled: 0,
  resolved: 1,
  closed: 1,
};
const PRIORITY_SORT_RANK: Record<TicketPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// Cliente Ausente / re-agendamiento prioritario (Fase 102): un ticket
// 'rescheduled' cuya fecha ya llego (o paso) se va al Top 1 absoluto de la
// lista, por encima de cualquier otro criterio — ni siquiera un 'urgent'
// recien creado le gana. Antes de que llegue esa fecha, sigue el orden
// normal (ya quedo con priority='urgent' al marcarlo, asi que igual flota
// cerca de arriba dentro del tier activo).
function isDueReschedule(t: Ticket, nowMs: number): boolean {
  return t.status === 'rescheduled' && !!t.rescheduled_to && new Date(t.rescheduled_to).getTime() <= nowMs;
}

const filteredTickets = computed(() => {
  let list = ticketsStore.tickets;
  if (statusFilter.value !== 'all') list = list.filter((t) => t.status === statusFilter.value);
  if (dateRange.value) {
    const { start, end } = dateRange.value;
    list = list.filter((t) => {
      // Un reprogramado se filtra por SU fecha de reprogramacion, no por
      // cuando se creo originalmente — si no, "Hoy" lo esconderia justo el
      // dia que debe atenderse primero.
      const relevant = t.status === 'rescheduled' && t.rescheduled_to ? new Date(t.rescheduled_to) : new Date(t.created_at);
      const time = relevant.getTime();
      return time >= start.getTime() && time <= end.getTime();
    });
  }
  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    list = list.filter((t) =>
      `${t.title} ${t.ticket_number ?? ''} ${t.clients?.first_name ?? ''} ${t.clients?.last_name ?? ''}`
        .toLowerCase()
        .includes(q),
    );
  }
  return [...list].sort((a, b) => {
    const dueDiff = Number(isDueReschedule(b, now.value)) - Number(isDueReschedule(a, now.value));
    if (dueDiff !== 0) return dueDiff;
    const tierDiff = STATUS_SORT_TIER[a.status] - STATUS_SORT_TIER[b.status];
    if (tierDiff !== 0) return tierDiff;
    const priorityDiff = PRIORITY_SORT_RANK[a.priority] - PRIORITY_SORT_RANK[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
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
  await Promise.all([ticketsStore.fetchTickets(), clientsStore.fetchClients(), catalogsStore.fetchStaff()]);
  // Deep link desde la ficha de un servicio puntual (Fase 37):
  // /soporte?client_id=..&contract_id=.. abre el modal ya precargado, para
  // que el ticket quede asociado a ESA linea y no solo al cliente.
  const clientId = route.query.client_id as string | undefined;
  if (clientId && canCreateTickets.value) {
    openCreate();
    form.value.client_id = clientId;
    await onTicketClientChange();
    const contractId = route.query.contract_id as string | undefined;
    if (contractId && ticketContracts.value.some((c) => c.id === contractId)) form.value.contract_id = contractId;
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
  saving.value = true;
  formError.value = null;
  try {
    const created = await ticketsStore.createTicket({
      client_id: form.value.client_id,
      contract_id: form.value.contract_id || null,
      title: form.value.title,
      description: form.value.description || null,
      category: form.value.category,
      priority: form.value.priority,
      motivo_preliminar: AVERIA_TICKET_CATEGORIES.includes(form.value.category) ? form.value.motivo_preliminar || null : null,
    });
    showModal.value = false;
    router.push(`/soporte/${created.id}`);
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al crear el ticket');
  } finally {
    saving.value = false;
  }
}

function goToDetail(ticket: Ticket) {
  router.push(`/soporte/${ticket.id}`);
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
    <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <h1 class="text-2xl font-semibold">Soporte</h1>
        <p class="text-slate-600 text-sm mt-1">{{ ticketsStore.tickets.length }} tickets registrados</p>
        <SoporteModeTabs active="tickets" class="mt-3" />
      </div>
      <div class="flex gap-2">
        <button v-if="canOpenCampo" class="btn-ghost" @click="router.push('/campo')">📱 App de Campo</button>
        <button v-if="auth.role !== 'TECNICO_RED'" class="btn-ghost" @click="router.push('/soporte/agenda')">📅 Agenda</button>
        <button class="btn-ghost" @click="router.push('/soporte/ranking')">🏆 Ranking técnicos</button>
        <button v-if="canCreateTickets" class="btn-primary" @click="openCreate">
          + Nuevo ticket
        </button>
      </div>
    </div>

    <TicketFlowGuide />

    <TechnicianStatusBar :technicians="technicians" :tickets="ticketsStore.tickets" :now="now" />

    <div class="surface flex flex-col gap-3 p-3 mb-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          v-model="searchQuery"
          placeholder="Buscar por titulo, numero de ticket o cliente..."
          class="field-input sm:max-w-xs"
        />
        <div class="flex flex-wrap gap-2">
          <button
            v-for="tab in STATUS_TABS"
            :key="tab.value"
            class="px-3 py-1.5 rounded-lg text-xs font-medium"
            :class="statusFilter === tab.value ? 'bg-sky-500 text-slate-950' : 'bg-slate-100 text-slate-600 hover:text-slate-900'"
            @click="statusFilter = tab.value"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>
      <DateRangeFilter @change="dateRange = $event" />
    </div>

    <p v-if="ticketsStore.error" class="mb-4 text-sm text-red-600">{{ ticketsStore.error }}</p>

    <p v-if="ticketsStore.loading" class="text-center text-slate-500 py-6">Cargando...</p>
    <p v-else-if="!filteredTickets.length" class="text-center text-slate-500 py-6">No hay tickets en este filtro.</p>

    <template v-else>
      <!-- Movil: cards (asi operan los tecnicos en campo) -->
      <div class="flex flex-col gap-3 sm:hidden">
        <div
          v-for="t in filteredTickets"
          :key="t.id"
          class="surface p-3 cursor-pointer"
          :class="isDueReschedule(t, now) ? 'ring-2 ring-red-500' : ''"
          @click="goToDetail(t)"
        >
          <p v-if="isDueReschedule(t, now)" class="text-[11px] font-bold text-red-600 mb-1.5">
            🔴 REPROGRAMADO - ATENDER PRIMERO
          </p>
          <div class="flex items-start justify-between gap-2 mb-1.5">
            <span class="font-mono text-xs text-slate-500" :title="formatDate(t.created_at)">{{ t.ticket_number }}</span>
            <div class="flex gap-1.5 shrink-0">
              <span class="badge text-[10px]" :class="STATUS_CLASS[t.status]">{{ STATUS_LABEL[t.status] }}</span>
              <span class="badge text-[10px]" :class="PRIORITY_CLASS[t.priority]">{{ PRIORITY_LABEL[t.priority] }}</span>
            </div>
          </div>
          <div class="text-slate-900 font-medium mb-1">
            {{ t.clients ? `${t.clients.first_name} ${t.clients.last_name}` : t.title }}
          </div>
          <div class="text-xs text-slate-500 mb-3">
            {{ CATEGORY_LABEL[t.category] }} · {{ t.assigned_profile?.full_name || t.assigned_profile?.email || 'Sin asignar' }}
          </div>

          <div class="flex items-center justify-between gap-2" @click.stop>
            <button
              v-if="t.status === 'open' && t.assigned_to && canActOn(t)"
              class="btn-primary flex-1 text-sm py-2"
              :disabled="startingId === t.id"
              @click="handleQuickStart(t)"
            >
              {{ startingId === t.id ? 'Iniciando...' : '▶ Iniciar orden' }}
            </button>
            <button
              v-else-if="t.status === 'in_progress'"
              class="btn-secondary flex-1 text-sm py-2"
              @click="goToDetail(t)"
            >
              ⏱️ {{ formatElapsedTime(t.updated_at, now) }} · Finalizar
            </button>
            <button v-else class="btn-ghost flex-1 text-sm py-2" @click="goToDetail(t)">Ver detalle</button>
            <button
              v-if="canCreateTickets"
              class="text-xs text-red-500/80 hover:text-red-600 shrink-0"
              :disabled="deletingId === t.id"
              @click="handleDelete(t)"
            >
              {{ deletingId === t.id ? '...' : 'Eliminar' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Desktop: tabla compacta (Puntos/fecha completa viven en el detalle) -->
      <div class="table-shell hidden sm:block">
        <table class="w-full text-sm min-w-[720px]">
          <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
            <tr>
              <th class="text-left px-4 py-3">Ticket</th>
              <th class="text-left px-4 py-3">Cliente</th>
              <th class="text-left px-4 py-3">Categoría</th>
              <th class="text-left px-4 py-3">Prioridad</th>
              <th class="text-left px-4 py-3">Estado</th>
              <th class="text-left px-4 py-3">Asignado</th>
              <th class="text-right px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="t in filteredTickets"
              :key="t.id"
              class="border-t border-slate-200 hover:bg-slate-50 cursor-pointer"
              :class="isDueReschedule(t, now) ? 'bg-red-50' : ''"
              @click="goToDetail(t)"
            >
              <td class="px-4 py-3">
                <div class="font-mono text-xs text-slate-500" :title="formatDate(t.created_at)">{{ t.ticket_number }}</div>
                <div class="text-slate-900">{{ t.title }}</div>
                <p v-if="isDueReschedule(t, now)" class="text-[11px] font-bold text-red-600 mt-0.5">
                  🔴 REPROGRAMADO - ATENDER PRIMERO
                </p>
              </td>
              <td class="px-4 py-3 text-slate-600">
                {{ t.clients ? `${t.clients.first_name} ${t.clients.last_name}` : '—' }}
              </td>
              <td class="px-4 py-3 text-slate-600">{{ CATEGORY_LABEL[t.category] }}</td>
              <td class="px-4 py-3">
                <span class="badge" :class="PRIORITY_CLASS[t.priority]">
                  {{ PRIORITY_LABEL[t.priority] }}
                </span>
              </td>
              <td class="px-4 py-3">
                <span class="badge" :class="STATUS_CLASS[t.status]">
                  {{ STATUS_LABEL[t.status] }}
                </span>
              </td>
              <td class="px-4 py-3 text-slate-600">{{ t.assigned_profile?.full_name || t.assigned_profile?.email || 'Sin asignar' }}</td>
              <td class="px-4 py-3 text-right whitespace-nowrap" @click.stop>
                <button
                  v-if="t.status === 'open' && t.assigned_to && canActOn(t)"
                  class="text-xs text-sky-700 hover:text-sky-800 font-medium mr-3"
                  :disabled="startingId === t.id"
                  @click="handleQuickStart(t)"
                >
                  {{ startingId === t.id ? 'Iniciando...' : '▶ Iniciar' }}
                </button>
                <span v-else-if="t.status === 'in_progress'" class="text-xs text-sky-700 mr-3">
                  ⏱️ {{ formatElapsedTime(t.updated_at, now) }}
                </span>
                <button
                  v-if="canCreateTickets"
                  class="text-xs text-red-500/80 hover:text-red-600"
                  :disabled="deletingId === t.id"
                  @click="handleDelete(t)"
                >
                  {{ deletingId === t.id ? 'Eliminando...' : 'Eliminar' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay">
        <form
          class="w-full max-w-lg modal-panel max-h-[90vh] overflow-y-auto"
          @submit.prevent="handleSubmit"
        >
          <h2 class="text-lg font-semibold mb-4">Nuevo ticket</h2>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Cliente</label>
            <input
              v-model="clientFilter"
              placeholder="Buscar por nombre o documento..."
              class="field-input mb-2"
            />
            <select
              v-model="form.client_id"
              required
              size="5"
              class="field-input"
              @change="onTicketClientChange"
            >
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
            <textarea
              v-model="form.description"
              rows="3"
              class="field-input"
            ></textarea>
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

          <p v-if="formError" class="text-sm text-red-600 mb-3">{{ formError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showModal = false">
              Cancelar
            </button>
            <button type="submit" :disabled="saving" class="btn-primary">
              {{ saving ? 'Creando...' : 'Crear ticket' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
