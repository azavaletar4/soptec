<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useTicketsStore } from '@/stores/tickets';
import { useClientsStore } from '@/stores/clients';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/lib/errors';
import type { Ticket, TicketCategory, TicketPriority, TicketStatus } from '@/types/domain';

const router = useRouter();
const ticketsStore = useTicketsStore();
const clientsStore = useClientsStore();
const auth = useAuthStore();

// Crear tickets es solo para ADMIN/SUPERADMIN; TECNICO_RED y SOPORTE
// pueden ver/atender los que ya existen.
const canCreateTickets = computed(() => auth.role === 'SUPERADMIN' || auth.role === 'ADMIN');

const showModal = ref(false);
const saving = ref(false);
const formError = ref<string | null>(null);
const clientFilter = ref('');
const statusFilter = ref<TicketStatus | 'all'>('all');
const searchQuery = ref('');

const emptyForm = () => ({
  client_id: '',
  title: '',
  description: '',
  category: 'other' as TicketCategory,
  priority: 'medium' as TicketPriority,
});
const form = ref(emptyForm());

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Abierto',
  in_progress: 'En progreso',
  resolved: 'Resuelto',
  closed: 'Cerrado',
};
const STATUS_CLASS: Record<TicketStatus, string> = {
  open: 'bg-yellow-500/15 text-yellow-400',
  in_progress: 'bg-sky-500/15 text-sky-400',
  resolved: 'bg-green-500/15 text-green-400',
  closed: 'bg-slate-500/15 text-slate-400',
};
const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  urgent: 'Urgente',
};
const PRIORITY_CLASS: Record<TicketPriority, string> = {
  low: 'bg-slate-500/15 text-slate-400',
  medium: 'bg-sky-500/15 text-sky-400',
  high: 'bg-orange-500/15 text-orange-400',
  urgent: 'bg-red-500/15 text-red-400',
};
const CATEGORY_LABEL: Record<TicketCategory, string> = {
  no_service: 'Sin servicio',
  slow_speed: 'Lentitud',
  billing: 'Facturación',
  installation: 'Instalación',
  equipment: 'Equipo',
  other: 'Otro',
};

const STATUS_TABS: { value: TicketStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'open', label: 'Abiertos' },
  { value: 'in_progress', label: 'En progreso' },
  { value: 'resolved', label: 'Resueltos' },
  { value: 'closed', label: 'Cerrados' },
];

const filteredTickets = computed(() => {
  let list = ticketsStore.tickets;
  if (statusFilter.value !== 'all') list = list.filter((t) => t.status === statusFilter.value);
  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    list = list.filter((t) =>
      `${t.title} ${t.ticket_number ?? ''} ${t.clients?.first_name ?? ''} ${t.clients?.last_name ?? ''}`
        .toLowerCase()
        .includes(q),
    );
  }
  return list;
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
  await Promise.all([ticketsStore.fetchTickets(), clientsStore.fetchClients()]);
});

function openCreate() {
  form.value = emptyForm();
  clientFilter.value = '';
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
      title: form.value.title,
      description: form.value.description || null,
      category: form.value.category,
      priority: form.value.priority,
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

function formatDate(value: string) {
  return new Date(value).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' });
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Soporte</h1>
        <p class="text-slate-400 text-sm mt-1">{{ ticketsStore.tickets.length }} tickets registrados</p>
      </div>
      <button v-if="canCreateTickets" class="btn-primary" @click="openCreate">
        + Nuevo ticket
      </button>
    </div>

    <input
      v-model="searchQuery"
      placeholder="Buscar por titulo, numero de ticket o cliente..."
      class="field-input mb-4"
    />

    <div class="flex flex-wrap gap-2 mb-4">
      <button
        v-for="tab in STATUS_TABS"
        :key="tab.value"
        class="px-3 py-1.5 rounded-lg text-xs font-medium"
        :class="statusFilter === tab.value ? 'bg-sky-500 text-slate-950' : 'bg-slate-900 text-slate-400 hover:text-slate-100'"
        @click="statusFilter = tab.value"
      >
        {{ tab.label }}
      </button>
    </div>

    <p v-if="ticketsStore.error" class="mb-4 text-sm text-red-400">{{ ticketsStore.error }}</p>

    <div class="table-shell">
      <table class="w-full text-sm min-w-[820px]">
        <thead class="bg-slate-900 text-slate-400 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-3">Ticket</th>
            <th class="text-left px-4 py-3">Cliente</th>
            <th class="text-left px-4 py-3">Categoría</th>
            <th class="text-left px-4 py-3">Prioridad</th>
            <th class="text-left px-4 py-3">Estado</th>
            <th class="text-left px-4 py-3">Asignado</th>
            <th class="text-left px-4 py-3">Puntos</th>
            <th class="text-left px-4 py-3">Creado</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="ticketsStore.loading">
            <td colspan="8" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
          </tr>
          <tr v-else-if="!filteredTickets.length">
            <td colspan="8" class="px-4 py-6 text-center text-slate-500">No hay tickets en este filtro.</td>
          </tr>
          <tr
            v-for="t in filteredTickets"
            :key="t.id"
            class="border-t border-slate-800 hover:bg-slate-900/50 cursor-pointer"
            @click="goToDetail(t)"
          >
            <td class="px-4 py-3">
              <div class="font-mono text-xs text-slate-500">{{ t.ticket_number }}</div>
              <div class="text-slate-100">{{ t.title }}</div>
            </td>
            <td class="px-4 py-3 text-slate-400">
              {{ t.clients ? `${t.clients.first_name} ${t.clients.last_name}` : '—' }}
            </td>
            <td class="px-4 py-3 text-slate-400">{{ CATEGORY_LABEL[t.category] }}</td>
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
            <td class="px-4 py-3 text-slate-400">{{ t.assigned_profile?.full_name || t.assigned_profile?.email || 'Sin asignar' }}</td>
            <td class="px-4 py-3 text-slate-400">{{ t.points != null ? t.points : '—' }}</td>
            <td class="px-4 py-3 text-slate-500 text-xs">{{ formatDate(t.created_at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay">
        <form
          class="w-full max-w-lg modal-panel max-h-[90vh] overflow-y-auto"
          @submit.prevent="handleSubmit"
        >
          <h2 class="text-lg font-semibold mb-4">Nuevo ticket</h2>

          <div class="mb-3">
            <label class="block text-xs text-slate-400 mb-1">Cliente</label>
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
            >
              <option v-for="c in filteredClients" :key="c.id" :value="c.id">
                {{ c.first_name }} {{ c.last_name }} — {{ c.document_number }}
              </option>
            </select>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-400 mb-1">Título</label>
            <input v-model="form.title" required class="field-input" />
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-400 mb-1">Descripción</label>
            <textarea
              v-model="form.description"
              rows="3"
              class="field-input"
            ></textarea>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Categoría</label>
              <select v-model="form.category" class="field-input">
                <option v-for="(label, value) in CATEGORY_LABEL" :key="value" :value="value">{{ label }}</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Prioridad</label>
              <select v-model="form.priority" class="field-input">
                <option v-for="(label, value) in PRIORITY_LABEL" :key="value" :value="value">{{ label }}</option>
              </select>
            </div>
          </div>

          <p v-if="formError" class="text-sm text-red-400 mb-3">{{ formError }}</p>

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
