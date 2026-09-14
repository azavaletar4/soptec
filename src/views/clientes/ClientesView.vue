<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useClientsStore } from '@/stores/clients';
import { useCatalogsStore } from '@/stores/catalogs';
import { useContractsStore } from '@/stores/contracts';
import { useMikrotikStore, type PppSecret } from '@/stores/mikrotik';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/lib/errors';
import type { Client, ClientStatus, DocumentType } from '@/types/domain';

const router = useRouter();
const clientsStore = useClientsStore();
const catalogs = useCatalogsStore();
const contractsStore = useContractsStore();
const mikrotikStore = useMikrotikStore();
const auth = useAuthStore();

// TECNICO_RED puede ver/editar clientes (GPS, fotos), pero no crearlos ni
// eliminarlos — eso queda para SOPORTE/ADMIN/FACTURACION.
const canManageClients = computed(() => auth.role !== 'TECNICO_RED');

const showModal = ref(false);
const editing = ref<Client | null>(null);
const saving = ref(false);
const showNewZone = ref(false);
const newZoneName = ref('');
const savingZone = ref(false);
const formError = ref<string | null>(null);
const pendingPppoeHint = ref<string | null>(null);
const searchQuery = ref('');

const filteredClientsList = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return clientsStore.clients;
  return clientsStore.clients.filter((c) =>
    `${c.first_name} ${c.last_name} ${c.document_number} ${c.phone ?? ''} ${c.email ?? ''}`.toLowerCase().includes(q),
  );
});

// Usuarios PPPoE (del router elegido) que no tienen NINGUN contrato en
// SmartRayco todavia, leido en vivo de la tabla service_contracts.
const unlinkedDeviceId = ref('');
const unlinkedSecrets = ref<PppSecret[]>([]);
const loadingUnlinked = ref(false);

async function loadUnlinked() {
  if (!unlinkedDeviceId.value) {
    unlinkedSecrets.value = [];
    return;
  }
  loadingUnlinked.value = true;
  try {
    const secrets = await mikrotikStore.fetchPppSecrets(unlinkedDeviceId.value);
    const linked = new Set(
      contractsStore.contracts.filter((c) => c.mikrotik_device_id === unlinkedDeviceId.value).map((c) => c.pppoe_username),
    );
    unlinkedSecrets.value = secrets.filter((s) => !linked.has(s.name));
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al leer usuarios PPPoE del router');
  } finally {
    loadingUnlinked.value = false;
  }
}

watch(unlinkedDeviceId, () => loadUnlinked());

const emptyForm = () => ({
  document_type: 'cedula' as DocumentType,
  document_number: '',
  first_name: '',
  last_name: '',
  phone: '',
  email: '',
  address: '',
  zone_id: '',
  status: 'prospect' as ClientStatus,
});

const form = ref(emptyForm());

const STATUS_LABEL: Record<ClientStatus, string> = {
  prospect: 'Prospecto',
  active: 'Activo',
  suspended: 'Suspendido',
  retired: 'Baja',
};
const STATUS_CLASS: Record<ClientStatus, string> = {
  prospect: 'bg-yellow-500/15 text-yellow-600',
  active: 'bg-green-500/15 text-green-600',
  suspended: 'bg-red-500/15 text-red-600',
  retired: 'bg-slate-500/15 text-slate-600',
};

onMounted(async () => {
  await Promise.all([clientsStore.fetchClients(), catalogs.fetchZones(), contractsStore.fetchContracts(), mikrotikStore.fetchDevices()]);
  if (mikrotikStore.devices.length === 1) {
    unlinkedDeviceId.value = mikrotikStore.devices[0].id;
  }
});

function openCreate(fromSecret?: PppSecret) {
  editing.value = null;
  form.value = emptyForm();
  pendingPppoeHint.value = fromSecret ? fromSecret.name : null;
  formError.value = null;
  showNewZone.value = false;
  newZoneName.value = '';
  showModal.value = true;
}

function openEdit(client: Client) {
  editing.value = client;
  form.value = {
    document_type: client.document_type,
    document_number: client.document_number,
    first_name: client.first_name,
    last_name: client.last_name,
    phone: client.phone ?? '',
    email: client.email ?? '',
    address: client.address ?? '',
    zone_id: client.zone_id ?? '',
    status: client.status,
  };
  formError.value = null;
  showNewZone.value = false;
  newZoneName.value = '';
  showModal.value = true;
}

async function handleCreateZone() {
  const name = newZoneName.value.trim();
  if (!name) return;
  savingZone.value = true;
  formError.value = null;
  try {
    const zone = await catalogs.createZone(name);
    form.value.zone_id = zone.id;
    showNewZone.value = false;
    newZoneName.value = '';
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al crear la zona');
  } finally {
    savingZone.value = false;
  }
}

async function handleSubmit() {
  saving.value = true;
  formError.value = null;
  try {
    const payload = {
      ...form.value,
      zone_id: form.value.zone_id || null,
      phone: form.value.phone || null,
      email: form.value.email || null,
      address: form.value.address || null,
    };
    if (editing.value) {
      await clientsStore.updateClient(editing.value.id, payload);
      showModal.value = false;
    } else {
      const created = await clientsStore.createClient(payload);
      showModal.value = false;
      if (pendingPppoeHint.value) {
        // El cliente viene de un usuario PPPoE sin contrato: seguimos directo
        // a su ficha para crear el contrato y terminar de vincularlo ahi.
        router.push(`/clientes/${created.id}`);
      }
    }
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al guardar el cliente');
  } finally {
    saving.value = false;
  }
}

async function handleDelete(client: Client) {
  const ok = confirm(`¿Eliminar a ${client.first_name} ${client.last_name}? Esta accion no se puede deshacer.`);
  if (!ok) return;
  try {
    await clientsStore.deleteClient(client.id);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al eliminar el cliente'));
  }
}

function goToDetail(client: Client) {
  router.push(`/clientes/${client.id}`);
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Clientes</h1>
        <p class="text-slate-600 text-sm mt-1">
          {{ searchQuery ? `${filteredClientsList.length} de ${clientsStore.clients.length}` : `${clientsStore.clients.length} registrados` }}
        </p>
      </div>
      <button
        v-if="canManageClients"
        class="btn-primary"
        @click="openCreate()"
      >
        + Nuevo cliente
      </button>
    </div>

    <p v-if="clientsStore.error" class="mb-4 text-sm text-red-600">{{ clientsStore.error }}</p>

    <input
      v-model="searchQuery"
      placeholder="Buscar por nombre, documento, telefono o correo..."
      class="field-input mb-6"
    />

    <div class="table-shell mb-6">
      <table class="w-full text-sm min-w-[720px]">
        <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-3">Nombre</th>
            <th class="text-left px-4 py-3">Documento</th>
            <th class="text-left px-4 py-3">Telefono</th>
            <th class="text-left px-4 py-3">Zona</th>
            <th class="text-left px-4 py-3">Estado</th>
            <th class="text-right px-4 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="clientsStore.loading">
            <td colspan="6" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
          </tr>
          <tr v-else-if="!filteredClientsList.length">
            <td colspan="6" class="px-4 py-6 text-center text-slate-500">
              {{ searchQuery ? 'Sin resultados para esa busqueda.' : 'No hay clientes. Crea el primero.' }}
            </td>
          </tr>
          <tr v-for="c in filteredClientsList" :key="c.id" class="border-t border-slate-200 hover:bg-slate-50">
            <td class="px-4 py-3">
              <button class="text-slate-900 hover:text-sky-600 font-medium" @click="goToDetail(c)">
                {{ c.first_name }} {{ c.last_name }}
              </button>
            </td>
            <td class="px-4 py-3 text-slate-600">{{ c.document_number }}</td>
            <td class="px-4 py-3 text-slate-600">{{ c.phone || '—' }}</td>
            <td class="px-4 py-3 text-slate-600">{{ c.zones?.name || '—' }}</td>
            <td class="px-4 py-3">
              <span class="badge" :class="STATUS_CLASS[c.status]">
                {{ STATUS_LABEL[c.status] }}
              </span>
            </td>
            <td class="px-4 py-3 text-right space-x-3 whitespace-nowrap">
              <button class="text-slate-600 hover:text-slate-900 text-xs" @click="openEdit(c)">Editar</button>
              <button v-if="canManageClients" class="text-red-500/80 hover:text-red-600 text-xs" @click="handleDelete(c)">Eliminar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="rounded-xl border border-slate-200 bg-slate-100 p-5 mb-6">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 class="text-sm font-semibold">Usuarios PPPoE sin contrato</h2>
        <select
          v-model="unlinkedDeviceId"
          class="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
        >
          <option value="">Selecciona un router MikroTik</option>
          <option v-for="d in mikrotikStore.devices" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
      </div>
      <p v-if="!unlinkedDeviceId" class="text-sm text-slate-500">Elige un router para ver sus usuarios PPPoE sin contrato.</p>
      <p v-else-if="loadingUnlinked" class="text-sm text-slate-500">Cargando...</p>
      <p v-else-if="!unlinkedSecrets.length" class="text-sm text-green-600">Todos los usuarios PPPoE de este router ya tienen contrato.</p>
      <div v-else class="rounded-lg border border-slate-200 overflow-hidden overflow-x-auto">
        <table class="w-full text-sm min-w-[560px]">
          <thead class="bg-white text-slate-600 text-xs uppercase">
            <tr>
              <th class="text-left px-4 py-2">Usuario</th>
              <th class="text-left px-4 py-2">Perfil</th>
              <th class="text-left px-4 py-2">Comentario</th>
              <th class="text-right px-4 py-2">Acción</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in unlinkedSecrets" :key="s['.id']" class="border-t border-slate-200">
              <td class="px-4 py-2 font-mono text-xs">{{ s.name }}</td>
              <td class="px-4 py-2 text-slate-600">{{ s.profile }}</td>
              <td class="px-4 py-2 text-slate-600">{{ s.comment || '—' }}</td>
              <td class="px-4 py-2 text-right">
                <button v-if="canManageClients" class="text-sky-600 hover:underline text-xs" @click="openCreate(s)">Crear cliente</button>
                <span v-else class="text-xs text-slate-400">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="text-xs text-slate-400 mt-2">
        Al crear el cliente pasas directo a su ficha para armar el contrato y terminar de vincularlo ahi.
      </p>
    </div>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay">
        <form
          class="w-full max-w-lg modal-panel max-h-[90vh] overflow-y-auto"
          @submit.prevent="handleSubmit"
        >
          <h2 class="text-lg font-semibold mb-1">{{ editing ? 'Editar cliente' : 'Nuevo cliente' }}</h2>
          <p v-if="pendingPppoeHint" class="text-xs text-sky-600/80 mb-3">
            Vinculado a partir del usuario PPPoE <span class="font-mono">{{ pendingPppoeHint }}</span> — el vinculo se completa al crear el contrato.
          </p>
          <div v-else class="mb-3"></div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Tipo de documento</label>
              <select v-model="form.document_type" class="field-input">
                <option value="cedula">DNI</option>
                <option value="ruc">RUC</option>
                <option value="pasaporte">Pasaporte</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Numero de documento</label>
              <input v-model="form.document_number" required class="field-input" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Nombres</label>
              <input v-model="form.first_name" required class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Apellidos</label>
              <input v-model="form.last_name" required class="field-input" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Telefono</label>
              <input v-model="form.phone" class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Correo</label>
              <input v-model="form.email" type="email" class="field-input" />
            </div>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Direccion</label>
            <input v-model="form.address" class="field-input" />
          </div>

          <div class="grid grid-cols-2 gap-3 mb-4">
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="block text-xs text-slate-600">Zona</label>
                <button type="button" class="text-xs text-sky-600 hover:text-sky-700" @click="showNewZone = !showNewZone">
                  {{ showNewZone ? 'Cancelar' : '+ Nueva zona' }}
                </button>
              </div>
              <select v-if="!showNewZone" v-model="form.zone_id" class="field-input">
                <option value="">Sin asignar</option>
                <option v-for="z in catalogs.zones" :key="z.id" :value="z.id">{{ z.name }}</option>
              </select>
              <div v-else class="flex gap-2">
                <input
                  v-model="newZoneName"
                  placeholder="Nombre de la zona"
                  class="flex-1 min-w-0 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                  @keydown.enter.prevent="handleCreateZone"
                />
                <button
                  type="button"
                  :disabled="savingZone || !newZoneName.trim()"
                  class="px-3 py-2 rounded-lg bg-sky-500 text-slate-950 text-sm font-semibold disabled:opacity-60"
                  @click="handleCreateZone"
                >
                  {{ savingZone ? '...' : 'Agregar' }}
                </button>
              </div>
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Estado</label>
              <select v-model="form.status" class="field-input">
                <option value="prospect">Prospecto</option>
                <option value="active">Activo</option>
                <option value="suspended">Suspendido</option>
                <option value="retired">Baja</option>
              </select>
            </div>
          </div>

          <p v-if="formError" class="text-sm text-red-600 mb-3">{{ formError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showModal = false">
              Cancelar
            </button>
            <button type="submit" :disabled="saving" class="btn-primary">
              {{ saving ? 'Guardando...' : 'Guardar' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
