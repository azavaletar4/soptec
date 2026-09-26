<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useClientsStore } from '@/stores/clients';
import { useContractsStore } from '@/stores/contracts';
import { useMikrotikStore, type PppSecret } from '@/stores/mikrotik';
import { useAuthStore } from '@/stores/auth';
import { useReferidosStore } from '@/stores/referidos';
import { getErrorMessage } from '@/lib/errors';
import type { Client, ClientStatus, ContractPriority, DocumentType } from '@/types/domain';

const router = useRouter();
const clientsStore = useClientsStore();
const contractsStore = useContractsStore();
const mikrotikStore = useMikrotikStore();
const auth = useAuthStore();
const referidosStore = useReferidosStore();

// TECNICO_RED puede ver/editar clientes (GPS, fotos), pero no crearlos ni
// eliminarlos — eso queda para SOPORTE/ADMIN/FACTURACION.
const canManageClients = computed(() => auth.role !== 'TECNICO_RED');

const showModal = ref(false);
const editing = ref<Client | null>(null);
const saving = ref(false);
const formError = ref<string | null>(null);
const pendingPppoeHint = ref<string | null>(null);
const searchQuery = ref('');

// Referido (Fase 33): solo aplica al ALTA de un cliente nuevo — vincula
// quien lo recomendo para que le llegue el descuento de S/25 en su
// siguiente factura (lo aplica el trigger de la BD, no aqui).
const referenteId = ref('');
const referenteFilter = ref('');
const filteredReferentes = computed(() => {
  const q = referenteFilter.value.trim().toLowerCase();
  const list = clientsStore.clients;
  if (!q) return list.slice(0, 30);
  return list
    .filter((c) => `${c.first_name} ${c.last_name} ${c.document_number}`.toLowerCase().includes(q))
    .slice(0, 30);
});

// Un DNI/RUC/pasaporte es unico por cliente (constraint en BD): si ya existe,
// no hay que crear un cliente nuevo, sino agregarle un contrato (linea) desde
// su ficha. Sin este chequeo, el intento de alta falla recien al guardar con
// el error crudo de Postgres (unique constraint), sin decir que hacer.
const duplicateClient = computed<Client | null>(() => {
  const doc = form.value.document_number.trim();
  if (!doc) return null;
  return (
    clientsStore.clients.find(
      (c) => c.document_number.trim().toLowerCase() === doc.toLowerCase() && c.id !== editing.value?.id,
    ) ?? null
  );
});

// El codigo de cliente ahora es por servicio (Fase 39, se edita desde la
// pestaña "Contrato" de cada linea) — ya no se muestra aca, pero se sigue
// pudiendo buscar por el.
function clientCodesOf(clientId: string) {
  return contractsStore.contracts
    .filter((ct) => ct.client_id === clientId && ct.client_code)
    .map((ct) => ct.client_code)
    .join(' ');
}

// Prioridad (Fase 41): tambien es por servicio, reemplaza al codigo en esta
// columna de la lista general de clientes.
const PRIORITY_LABEL: Record<ContractPriority, string> = {
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};
const PRIORITY_CLASS: Record<ContractPriority, string> = {
  high: 'bg-red-500/15 text-red-600',
  medium: 'bg-yellow-500/15 text-yellow-600',
  low: 'bg-slate-500/15 text-slate-600',
};
function clientPrioritiesOf(clientId: string): ContractPriority[] {
  return contractsStore.contracts.filter((ct) => ct.client_id === clientId).map((ct) => ct.priority);
}

const filteredClientsList = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return clientsStore.clients;
  return clientsStore.clients.filter((c) =>
    `${c.first_name} ${c.last_name} ${clientCodesOf(c.id)} ${c.document_number} ${c.phone ?? ''} ${c.phone_2 ?? ''} ${c.email ?? ''}`
      .toLowerCase()
      .includes(q),
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
  phone_2: '',
  email: '',
  address: '',
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
  await Promise.all([clientsStore.fetchClients(), contractsStore.fetchContracts(), mikrotikStore.fetchDevices()]);
  if (mikrotikStore.devices.length === 1) {
    unlinkedDeviceId.value = mikrotikStore.devices[0].id;
  }
});

function openCreate(fromSecret?: PppSecret) {
  editing.value = null;
  form.value = emptyForm();
  pendingPppoeHint.value = fromSecret ? fromSecret.name : null;
  formError.value = null;
  referenteId.value = '';
  referenteFilter.value = '';
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
    phone_2: client.phone_2 ?? '',
    email: client.email ?? '',
    address: client.address ?? '',
    status: client.status,
  };
  formError.value = null;
  showModal.value = true;
}

async function handleSubmit() {
  if (duplicateClient.value) {
    formError.value = `Ya existe un cliente con ese documento (${duplicateClient.value.first_name} ${duplicateClient.value.last_name}). Ve a su ficha y usa "+ Nuevo contrato" para agregarle otro servicio.`;
    return;
  }
  saving.value = true;
  formError.value = null;
  try {
    const payload = {
      ...form.value,
      phone: form.value.phone || null,
      phone_2: form.value.phone_2 || null,
      email: form.value.email || null,
      address: form.value.address || null,
    };
    let savedId: string;
    if (editing.value) {
      const saved = await clientsStore.updateClient(editing.value.id, payload);
      savedId = saved.id;
    } else {
      const created = await clientsStore.createClient(payload);
      savedId = created.id;

      // Referido (Fase 33): solo en el alta. El cliente ya quedo guardado,
      // asi que un fallo aca no debe perder los demas datos.
      if (referenteId.value) {
        try {
          await referidosStore.create(referenteId.value, savedId);
        } catch (e) {
          alert(getErrorMessage(e, 'El cliente se guardó, pero no se pudo registrar el referido'));
        }
      }
    }

    showModal.value = false;
    if (!editing.value && pendingPppoeHint.value) {
      // El cliente viene de un usuario PPPoE sin contrato: seguimos directo
      // a su ficha para crear el contrato y terminar de vincularlo ahi.
      router.push(`/clientes/${savedId}`);
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
            <th class="text-left px-4 py-3">Prioridad</th>
            <th class="text-left px-4 py-3">Nombre</th>
            <th class="text-left px-4 py-3">Documento</th>
            <th class="text-left px-4 py-3">Telefono</th>
            <th class="text-left px-4 py-3">Servicios</th>
            <th class="text-left px-4 py-3">Estado</th>
            <th class="text-right px-4 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="clientsStore.loading">
            <td colspan="7" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
          </tr>
          <tr v-else-if="!filteredClientsList.length">
            <td colspan="7" class="px-4 py-6 text-center text-slate-500">
              {{ searchQuery ? 'Sin resultados para esa busqueda.' : 'No hay clientes. Crea el primero.' }}
            </td>
          </tr>
          <tr v-for="c in filteredClientsList" :key="c.id" class="border-t border-slate-200 hover:bg-slate-50">
            <td class="px-4 py-3">
              <span v-if="!clientPrioritiesOf(c.id).length" class="text-slate-400 text-xs">—</span>
              <span
                v-for="(p, idx) in clientPrioritiesOf(c.id)"
                :key="idx"
                class="badge mr-1"
                :class="PRIORITY_CLASS[p]"
              >
                {{ PRIORITY_LABEL[p] }}
              </span>
            </td>
            <td class="px-4 py-3">
              <button class="text-slate-900 hover:text-sky-600 font-medium" @click="goToDetail(c)">
                {{ c.first_name }} {{ c.last_name }}
              </button>
            </td>
            <td class="px-4 py-3 text-slate-600">{{ c.document_number }}</td>
            <td class="px-4 py-3 text-slate-600">{{ c.phone || '—' }}</td>
            <td class="px-4 py-3 text-slate-600">{{ contractsStore.contracts.filter((ct) => ct.client_id === c.id).length }}</td>
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
          <p class="text-xs text-slate-400 mb-3">
            El código de cliente ahora se asigna por servicio, desde la ficha de cada línea.
          </p>

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

          <div v-if="duplicateClient" class="mb-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            Ya existe un cliente con este documento:
            <span class="font-medium">{{ duplicateClient.first_name }} {{ duplicateClient.last_name }}</span>.
            Un mismo cliente puede tener varias lineas — no crees otro cliente, agrega el contrato desde su ficha.
            <button
              type="button"
              class="block mt-1 font-medium text-sky-700 hover:text-sky-800 underline"
              @click="showModal = false; router.push(`/clientes/${duplicateClient.id}`)"
            >
              Ir a la ficha y agregar "+ Nuevo contrato"
            </button>
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
              <label class="block text-xs text-slate-600 mb-1">Telefono alterno</label>
              <input v-model="form.phone_2" class="field-input" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Correo</label>
              <input v-model="form.email" type="email" class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Direccion</label>
              <input v-model="form.address" class="field-input" />
            </div>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Estado</label>
            <select v-model="form.status" class="field-input">
              <option value="prospect">Prospecto</option>
              <option value="active">Activo</option>
              <option value="suspended">Suspendido</option>
              <option value="retired">Baja</option>
            </select>
          </div>
          <p class="text-xs text-slate-400 mb-3">
            La zona y la caja NAP ahora se asignan por servicio, desde la ficha de cada línea del cliente.
          </p>

          <div v-if="!editing" class="mb-4">
            <label class="block text-xs text-slate-600 mb-1">Cliente que lo recomendó (opcional)</label>
            <p class="text-[11px] text-slate-400 mb-1.5">Si aplica, el referente recibe un descuento de S/25 en su siguiente factura.</p>
            <input v-model="referenteFilter" placeholder="Buscar por nombre o documento..." class="field-input mb-2" />
            <select v-model="referenteId" class="field-input" size="4">
              <option value="">Sin referido</option>
              <option v-for="c in filteredReferentes" :key="c.id" :value="c.id">{{ c.first_name }} {{ c.last_name }} — {{ c.document_number }}</option>
            </select>
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
