<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import DateRangeFilter, { type DateRange } from '@/components/soporte/DateRangeFilter.vue';
import { useInstallationsStore } from '@/stores/installations';
import { useJobAssigneesStore } from '@/stores/jobAssignees';
import { useClientsStore } from '@/stores/clients';
import { useContractsStore } from '@/stores/contracts';
import { useCatalogsStore } from '@/stores/catalogs';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/lib/errors';
import { PRIORITY_CLASS, PRIORITY_LABEL } from '@/lib/ticketPriority';
import type { Installation, InstallationStatus, ServiceContract, TicketPriority } from '@/types/domain';

const route = useRoute();
const router = useRouter();
const installationsStore = useInstallationsStore();
const jobAssigneesStore = useJobAssigneesStore();
const clientsStore = useClientsStore();
const contractsStore = useContractsStore();
const catalogsStore = useCatalogsStore();
const auth = useAuthStore();

const showModal = ref(false);
const saving = ref(false);
const formError = ref<string | null>(null);
const clientFilter = ref('');
const statusFilter = ref<InstallationStatus | 'all'>('all');
const searchQuery = ref('');
const clientContracts = ref<ServiceContract[]>([]);
const loadingContracts = ref(false);
// Filtro de fecha (Fase 101) — contra scheduled_date (si no tiene, created_at).
const dateRange = ref<DateRange | null>(null);

const emptyForm = () => ({
  client_id: '',
  contract_id: '',
  priority: 'medium' as TicketPriority,
  scheduled_date: '',
  scheduled_time: '',
  assigned_to: '',
  notes: '',
});
const form = ref(emptyForm());

const STATUS_LABEL: Record<InstallationStatus, string> = {
  pending: 'Pendiente',
  scheduled: 'Programada',
  in_progress: 'En curso',
  completed: 'Completada',
  cancelled: 'Cancelada',
};
const STATUS_CLASS: Record<InstallationStatus, string> = {
  pending: 'bg-yellow-500/15 text-yellow-600',
  scheduled: 'bg-sky-500/15 text-sky-700',
  in_progress: 'bg-sky-500/15 text-sky-700',
  completed: 'bg-green-500/15 text-green-600',
  cancelled: 'bg-slate-500/15 text-slate-600',
};

const STATUS_TABS: { value: InstallationStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'scheduled', label: 'Programadas' },
  { value: 'in_progress', label: 'En curso' },
  { value: 'completed', label: 'Completadas' },
  { value: 'cancelled', label: 'Canceladas' },
];

const technicians = computed(() => catalogsStore.staff.filter((s) => s.role === 'TECNICO_RED'));

const filteredClients = computed(() => {
  const q = clientFilter.value.trim().toLowerCase();
  const list = clientsStore.clients;
  if (!q) return list.slice(0, 30);
  return list
    .filter((c) => `${c.first_name} ${c.last_name} ${c.document_number}`.toLowerCase().includes(q))
    .slice(0, 30);
});

// Orden automatico (Fase 90): pendientes/programadas siempre arriba,
// completadas/canceladas al fondo; como ultimo criterio, las mas recientes
// primero. Instalaciones no tiene prioridad (a diferencia de Tickets), asi
// que solo son 2 niveles. Reactivo: updateStatus reemplaza la instalacion en
// el store, asi que este computed se reordena solo, sin recargar la pagina.
const STATUS_SORT_TIER: Record<InstallationStatus, number> = {
  pending: 0,
  scheduled: 0,
  in_progress: 0,
  completed: 1,
  cancelled: 1,
};

const filteredInstallations = computed(() => {
  let list = installationsStore.installations;
  if (statusFilter.value !== 'all') list = list.filter((i) => i.status === statusFilter.value);
  const q = searchQuery.value.trim().toLowerCase();
  // Buscar por nombre/contrato consulta TODA la base, no solo el rango de
  // fecha activo — si hay texto en el buscador, el filtro de fecha se
  // ignora (el usuario quiere ESE registro, sin tener que acordarse en que
  // rango cae para verlo).
  if (dateRange.value && !q) {
    const { start, end } = dateRange.value;
    list = list.filter((i) => {
      const ref = i.scheduled_date ? new Date(`${i.scheduled_date}T12:00:00`) : new Date(i.created_at);
      const t = ref.getTime();
      return t >= start.getTime() && t <= end.getTime();
    });
  }
  if (q) {
    list = list.filter((i) =>
      `${i.clients?.first_name ?? ''} ${i.clients?.last_name ?? ''} ${i.contracts?.contract_number ?? ''}`
        .toLowerCase()
        .includes(q),
    );
  }
  return [...list].sort((a, b) => {
    const tierDiff = STATUS_SORT_TIER[a.status] - STATUS_SORT_TIER[b.status];
    if (tierDiff !== 0) return tierDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
});

onMounted(async () => {
  await Promise.all([installationsStore.fetchInstallations(), clientsStore.fetchClients(), catalogsStore.fetchStaff()]);
  // Deep link desde "Operaciones de Hoy" (Fase 107): ?q= precarga el
  // buscador (click en una fila de Alta), ?create=1 abre el modal de
  // creación directo (botón "+ Alta").
  const q = route.query.q as string | undefined;
  if (q) searchQuery.value = q;
  if (route.query.create) openCreate();
});

function openCreate() {
  form.value = emptyForm();
  clientFilter.value = '';
  clientContracts.value = [];
  formError.value = null;
  showModal.value = true;
}

async function onClientChange() {
  form.value.contract_id = '';
  clientContracts.value = [];
  if (!form.value.client_id) return;
  loadingContracts.value = true;
  try {
    clientContracts.value = await contractsStore.fetchContractsByClient(form.value.client_id);
  } finally {
    loadingContracts.value = false;
  }
}

async function handleSubmit() {
  if (!form.value.client_id) {
    formError.value = 'Selecciona un cliente';
    return;
  }
  saving.value = true;
  formError.value = null;
  try {
    const created = await installationsStore.createInstallation({
      client_id: form.value.client_id,
      contract_id: form.value.contract_id || null,
      priority: form.value.priority,
      scheduled_date: form.value.scheduled_date || null,
      scheduled_time: form.value.scheduled_time || null,
      assigned_to: form.value.assigned_to || null,
      notes: form.value.notes || null,
      status: form.value.scheduled_date ? 'scheduled' : 'pending',
    });
    // job_assignees es la fuente de verdad de la cuadrilla (Fase 94) — el
    // insert de arriba solo deja el "espejo" assigned_to, asi que si se
    // eligio tecnico al crear, se registra aqui como lider de su cuadrilla.
    if (form.value.assigned_to) {
      await jobAssigneesStore.addAssignee('installation', created.id, form.value.assigned_to, []);
    }
    showModal.value = false;
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al crear la instalación');
  } finally {
    saving.value = false;
  }
}

// Edicion directa del estado (correccion administrativa) — solo
// SUPERADMIN/ADMIN. El tecnico sigue con el flujo guiado "Completar" (con
// GPS/fotos) desde el detalle de la orden, no este selector libre.
const canEditStatus = computed(() => auth.role === 'SUPERADMIN' || auth.role === 'ADMIN');

// Reabrir una instalacion ya completada (Fase 112): NINGUN trigger de BD
// borra/limpia equipos o materiales al bajar el estado — reverse_inventory_*
// (Fase 59) solo revierte al ELIMINAR o CANCELAR, nunca al volver a
// pending/scheduled — pero igual se pide confirmacion explicita porque es
// una correccion administrativa poco comun y facil de tocar por error desde
// el selector libre.
const showReopenConfirm = ref(false);
const reopenTarget = ref<{ inst: Installation; status: InstallationStatus } | null>(null);

async function handleStatusChange(inst: Installation, status: InstallationStatus) {
  if (inst.status === 'completed' && (status === 'pending' || status === 'scheduled')) {
    reopenTarget.value = { inst, status };
    showReopenConfirm.value = true;
    return;
  }
  await applyStatusChange(inst, status);
}

async function applyStatusChange(inst: Installation, status: InstallationStatus) {
  try {
    await installationsStore.updateStatus(inst.id, status);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al cambiar el estado'));
  }
}

async function confirmReopen() {
  if (!reopenTarget.value) return;
  const { inst, status } = reopenTarget.value;
  showReopenConfirm.value = false;
  reopenTarget.value = null;
  await applyStatusChange(inst, status);
}

function cancelReopen() {
  showReopenConfirm.value = false;
  reopenTarget.value = null;
}

// Prioridad (Fase 108): es una decision de despacho, igual que en Tickets
// (ver TicketDetailView.vue:handlePriorityChange) — el tecnico asignado NO
// la cambia, solo ve la que ya le pusieron.
const canEditPriority = computed(() => auth.role !== 'TECNICO_RED');

async function handlePriorityChange(inst: Installation, priority: TicketPriority) {
  try {
    await installationsStore.updateInstallation(inst.id, { priority });
  } catch (e) {
    alert(getErrorMessage(e, 'Error al cambiar la prioridad'));
  }
}

function goToClient(inst: Installation) {
  router.push(`/clientes/${inst.client_id}`);
}

function goToDetail(inst: Installation) {
  router.push(`/soporte/instalaciones/${inst.id}`);
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <h1 class="text-2xl font-semibold">Instalaciones</h1>
        <p class="text-slate-600 text-sm mt-1">{{ installationsStore.installations.length }} órdenes registradas</p>
        <button class="text-xs text-sky-700 hover:underline mt-1" @click="router.push('/soporte')">
          ← Volver a Operaciones de Hoy
        </button>
      </div>
      <div class="flex gap-2">
        <button v-if="auth.role !== 'TECNICO_RED'" class="btn-ghost" @click="router.push('/soporte/agenda')">📅 Agenda</button>
        <button v-if="auth.role !== 'TECNICO_RED'" class="btn-primary" @click="openCreate">+ Nueva instalación</button>
      </div>
    </div>

    <div class="surface flex flex-col gap-3 p-3 mb-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          v-model="searchQuery"
          placeholder="Buscar por cliente o número de contrato..."
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

    <p v-if="installationsStore.error" class="mb-4 text-sm text-red-600">{{ installationsStore.error }}</p>

    <div class="table-shell">
      <table class="w-full text-sm min-w-[980px]">
        <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-3">Cliente</th>
            <th class="text-left px-4 py-3">Contrato</th>
            <th class="text-left px-4 py-3">Fecha programada</th>
            <th class="text-left px-4 py-3">Prioridad</th>
            <th class="text-left px-4 py-3">Estado</th>
            <th class="text-left px-4 py-3">Técnico</th>
            <th class="text-right px-4 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="installationsStore.loading">
            <td colspan="7" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
          </tr>
          <tr v-else-if="!filteredInstallations.length">
            <td colspan="7" class="px-4 py-6 text-center text-slate-500">No hay instalaciones en este filtro.</td>
          </tr>
          <tr v-for="inst in filteredInstallations" :key="inst.id" class="border-t border-slate-200">
            <td class="px-4 py-3 cursor-pointer hover:text-sky-600" @click="goToClient(inst)">
              {{ inst.clients ? `${inst.clients.first_name} ${inst.clients.last_name}` : '—' }}
              <span v-if="!inst.clients?.latitude" class="block text-[10px] text-amber-600/80">Sin GPS registrado</span>
            </td>
            <td class="px-4 py-3 font-mono text-xs text-slate-600">{{ inst.contracts?.contract_number ?? '—' }}</td>
            <td class="px-4 py-3 text-slate-600">
              {{ formatDate(inst.scheduled_date) }}
              <span v-if="inst.scheduled_time" class="text-xs text-slate-500"> · {{ inst.scheduled_time.slice(0, 5) }}</span>
            </td>
            <td class="px-4 py-3">
              <select
                v-if="canEditPriority"
                class="field-input py-1.5 text-xs"
                :value="inst.priority"
                @change="handlePriorityChange(inst, ($event.target as HTMLSelectElement).value as TicketPriority)"
              >
                <option v-for="(label, value) in PRIORITY_LABEL" :key="value" :value="value">{{ label }}</option>
              </select>
              <span v-else class="badge" :class="PRIORITY_CLASS[inst.priority]">{{ PRIORITY_LABEL[inst.priority] }}</span>
            </td>
            <td class="px-4 py-3">
              <select
                v-if="canEditStatus"
                class="field-input py-1.5 text-xs"
                :value="inst.status"
                @change="handleStatusChange(inst, ($event.target as HTMLSelectElement).value as InstallationStatus)"
              >
                <option v-for="(label, value) in STATUS_LABEL" :key="value" :value="value">{{ label }}</option>
              </select>
              <span v-else class="badge" :class="STATUS_CLASS[inst.status]">{{ STATUS_LABEL[inst.status] }}</span>
            </td>
            <td class="px-4 py-3 text-xs text-slate-600">
              {{ technicians.find((t) => t.id === inst.assigned_to)?.full_name || (inst.assigned_to ? 'Técnico' : 'Sin asignar') }}
            </td>
            <td class="px-4 py-3 text-right">
              <button type="button" class="btn-secondary text-xs" @click="goToDetail(inst)">Ver orden →</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay">
        <form class="w-full max-w-lg modal-panel max-h-[90vh] overflow-y-auto" @submit.prevent="handleSubmit">
          <h2 class="text-lg font-semibold mb-4">Nueva instalación</h2>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Cliente</label>
            <input v-model="clientFilter" placeholder="Buscar por nombre o documento..." class="field-input mb-2" />
            <select v-model="form.client_id" required size="5" class="field-input" @change="onClientChange">
              <option v-for="c in filteredClients" :key="c.id" :value="c.id">
                {{ c.first_name }} {{ c.last_name }} — {{ c.document_number }}
              </option>
            </select>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Contrato (opcional)</label>
            <select v-model="form.contract_id" class="field-input" :disabled="!form.client_id || loadingContracts">
              <option value="">{{ loadingContracts ? 'Cargando...' : 'Sin contrato asociado' }}</option>
              <option v-for="c in clientContracts" :key="c.id" :value="c.id">{{ c.contract_number }}</option>
            </select>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Fecha programada</label>
              <input v-model="form.scheduled_date" type="date" class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Hora</label>
              <input v-model="form.scheduled_time" type="time" class="field-input" />
            </div>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Prioridad</label>
            <select v-model="form.priority" class="field-input">
              <option v-for="(label, value) in PRIORITY_LABEL" :key="value" :value="value">{{ label }}</option>
            </select>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Técnico asignado</label>
            <select v-model="form.assigned_to" class="field-input">
              <option value="">Sin asignar</option>
              <option v-for="t in technicians" :key="t.id" :value="t.id">{{ t.full_name || t.email }}</option>
            </select>
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-600 mb-1">Notas</label>
            <textarea v-model="form.notes" rows="3" class="field-input"></textarea>
          </div>

          <p v-if="formError" class="text-sm text-red-600 mb-3">{{ formError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showModal = false">Cancelar</button>
            <button type="submit" :disabled="saving" class="btn-primary">
              {{ saving ? 'Creando...' : 'Crear instalación' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showReopenConfirm" class="modal-overlay" @click.self="cancelReopen">
        <div class="w-full max-w-sm modal-panel">
          <p class="text-sm mb-4">
            ⚠️ ¿Estás seguro de reabrir esta orden? Se mantendrán guardados los equipos y materiales previamente asignados.
          </p>
          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="cancelReopen">Cancelar</button>
            <button type="button" class="btn-primary" @click="confirmReopen">Sí, reabrir</button>
          </div>
        </div>
      </div>
    </Teleport>
  </AppLayout>
</template>
