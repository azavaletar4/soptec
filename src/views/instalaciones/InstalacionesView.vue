<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useInstallationsStore } from '@/stores/installations';
import { useClientsStore } from '@/stores/clients';
import { useContractsStore } from '@/stores/contracts';
import { useCatalogsStore } from '@/stores/catalogs';
import { getErrorMessage } from '@/lib/errors';
import type { Installation, InstallationStatus, ServiceContract } from '@/types/domain';

const router = useRouter();
const installationsStore = useInstallationsStore();
const clientsStore = useClientsStore();
const contractsStore = useContractsStore();
const catalogsStore = useCatalogsStore();

const showModal = ref(false);
const saving = ref(false);
const formError = ref<string | null>(null);
const clientFilter = ref('');
const statusFilter = ref<InstallationStatus | 'all'>('all');
const searchQuery = ref('');
const clientContracts = ref<ServiceContract[]>([]);
const loadingContracts = ref(false);

const emptyForm = () => ({
  client_id: '',
  contract_id: '',
  scheduled_date: '',
  scheduled_time: '',
  assigned_to: '',
  notes: '',
});
const form = ref(emptyForm());

const STATUS_LABEL: Record<InstallationStatus, string> = {
  pending: 'Pendiente',
  scheduled: 'Programada',
  completed: 'Completada',
  cancelled: 'Cancelada',
};
const STATUS_CLASS: Record<InstallationStatus, string> = {
  pending: 'bg-yellow-500/15 text-yellow-400',
  scheduled: 'bg-sky-500/15 text-sky-400',
  completed: 'bg-green-500/15 text-green-400',
  cancelled: 'bg-slate-500/15 text-slate-400',
};

const STATUS_TABS: { value: InstallationStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'scheduled', label: 'Programadas' },
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

const filteredInstallations = computed(() => {
  let list = installationsStore.installations;
  if (statusFilter.value !== 'all') list = list.filter((i) => i.status === statusFilter.value);
  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    list = list.filter((i) =>
      `${i.clients?.first_name ?? ''} ${i.clients?.last_name ?? ''} ${i.contracts?.contract_number ?? ''}`
        .toLowerCase()
        .includes(q),
    );
  }
  return list;
});

onMounted(async () => {
  await Promise.all([
    installationsStore.fetchInstallations(),
    clientsStore.fetchClients(),
    contractsStore.fetchContracts(),
    catalogsStore.fetchStaff(),
  ]);
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
    await installationsStore.createInstallation({
      client_id: form.value.client_id,
      contract_id: form.value.contract_id || null,
      scheduled_date: form.value.scheduled_date || null,
      scheduled_time: form.value.scheduled_time || null,
      assigned_to: form.value.assigned_to || null,
      notes: form.value.notes || null,
      status: form.value.scheduled_date ? 'scheduled' : 'pending',
    });
    showModal.value = false;
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al crear la instalación');
  } finally {
    saving.value = false;
  }
}

async function handleAssign(inst: Installation, technicianId: string) {
  try {
    await installationsStore.updateInstallation(inst.id, { assigned_to: technicianId || null });
  } catch (e) {
    alert(getErrorMessage(e, 'Error al asignar el técnico'));
  }
}

async function handleComplete(inst: Installation) {
  const ok = confirm(`¿Marcar como completada la instalación de ${inst.clients?.first_name} ${inst.clients?.last_name}?`);
  if (!ok) return;
  try {
    await installationsStore.updateStatus(inst.id, 'completed');
  } catch (e) {
    alert(getErrorMessage(e, 'Error al completar la instalación'));
  }
}

async function handleCancel(inst: Installation) {
  const ok = confirm(`¿Cancelar la instalación de ${inst.clients?.first_name} ${inst.clients?.last_name}?`);
  if (!ok) return;
  try {
    await installationsStore.updateStatus(inst.id, 'cancelled');
  } catch (e) {
    alert(getErrorMessage(e, 'Error al cancelar la instalación'));
  }
}

function goToClient(inst: Installation) {
  router.push(`/clientes/${inst.client_id}`);
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' });
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Instalaciones</h1>
        <p class="text-slate-400 text-sm mt-1">{{ installationsStore.installations.length }} órdenes registradas</p>
      </div>
      <button class="btn-primary" @click="openCreate">+ Nueva instalación</button>
    </div>

    <input
      v-model="searchQuery"
      placeholder="Buscar por cliente o número de contrato..."
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

    <p v-if="installationsStore.error" class="mb-4 text-sm text-red-400">{{ installationsStore.error }}</p>

    <div class="table-shell">
      <table class="w-full text-sm min-w-[900px]">
        <thead class="bg-slate-900 text-slate-400 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-3">Cliente</th>
            <th class="text-left px-4 py-3">Contrato</th>
            <th class="text-left px-4 py-3">Fecha programada</th>
            <th class="text-left px-4 py-3">Estado</th>
            <th class="text-left px-4 py-3">Técnico</th>
            <th class="text-right px-4 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="installationsStore.loading">
            <td colspan="6" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
          </tr>
          <tr v-else-if="!filteredInstallations.length">
            <td colspan="6" class="px-4 py-6 text-center text-slate-500">No hay instalaciones en este filtro.</td>
          </tr>
          <tr v-for="inst in filteredInstallations" :key="inst.id" class="border-t border-slate-800">
            <td class="px-4 py-3 cursor-pointer hover:text-sky-400" @click="goToClient(inst)">
              {{ inst.clients ? `${inst.clients.first_name} ${inst.clients.last_name}` : '—' }}
              <span v-if="!inst.clients?.latitude" class="block text-[10px] text-amber-400/80">Sin GPS registrado</span>
            </td>
            <td class="px-4 py-3 font-mono text-xs text-slate-400">{{ inst.contracts?.contract_number ?? '—' }}</td>
            <td class="px-4 py-3 text-slate-400">
              {{ formatDate(inst.scheduled_date) }}
              <span v-if="inst.scheduled_time" class="text-xs text-slate-500"> · {{ inst.scheduled_time.slice(0, 5) }}</span>
            </td>
            <td class="px-4 py-3">
              <span class="badge" :class="STATUS_CLASS[inst.status]">{{ STATUS_LABEL[inst.status] }}</span>
            </td>
            <td class="px-4 py-3">
              <select
                class="field-input py-1.5 text-xs"
                :value="inst.assigned_to ?? ''"
                @change="handleAssign(inst, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">Sin asignar</option>
                <option v-for="t in technicians" :key="t.id" :value="t.id">{{ t.full_name || t.email }}</option>
              </select>
            </td>
            <td class="px-4 py-3 text-right space-x-3 whitespace-nowrap text-xs">
              <button
                v-if="inst.status !== 'completed' && inst.status !== 'cancelled'"
                class="text-green-400 hover:underline"
                @click="handleComplete(inst)"
              >
                Completar
              </button>
              <button
                v-if="inst.status !== 'completed' && inst.status !== 'cancelled'"
                class="text-red-500/80 hover:text-red-400"
                @click="handleCancel(inst)"
              >
                Cancelar
              </button>
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
            <label class="block text-xs text-slate-400 mb-1">Cliente</label>
            <input v-model="clientFilter" placeholder="Buscar por nombre o documento..." class="field-input mb-2" />
            <select v-model="form.client_id" required size="5" class="field-input" @change="onClientChange">
              <option v-for="c in filteredClients" :key="c.id" :value="c.id">
                {{ c.first_name }} {{ c.last_name }} — {{ c.document_number }}
              </option>
            </select>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-400 mb-1">Contrato (opcional)</label>
            <select v-model="form.contract_id" class="field-input" :disabled="!form.client_id || loadingContracts">
              <option value="">{{ loadingContracts ? 'Cargando...' : 'Sin contrato asociado' }}</option>
              <option v-for="c in clientContracts" :key="c.id" :value="c.id">{{ c.contract_number }}</option>
            </select>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Fecha programada</label>
              <input v-model="form.scheduled_date" type="date" class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Hora</label>
              <input v-model="form.scheduled_time" type="time" class="field-input" />
            </div>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-400 mb-1">Técnico asignado</label>
            <select v-model="form.assigned_to" class="field-input">
              <option value="">Sin asignar</option>
              <option v-for="t in technicians" :key="t.id" :value="t.id">{{ t.full_name || t.email }}</option>
            </select>
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-400 mb-1">Notas</label>
            <textarea v-model="form.notes" rows="3" class="field-input"></textarea>
          </div>

          <p v-if="formError" class="text-sm text-red-400 mb-3">{{ formError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showModal = false">Cancelar</button>
            <button type="submit" :disabled="saving" class="btn-primary">
              {{ saving ? 'Creando...' : 'Crear instalación' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
