<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useClientsStore } from '@/stores/clients';
import { useCatalogsStore } from '@/stores/catalogs';
import { getErrorMessage } from '@/lib/errors';
import type { Client, ClientStatus, DocumentType } from '@/types/domain';

const router = useRouter();
const clientsStore = useClientsStore();
const catalogs = useCatalogsStore();

const showModal = ref(false);
const editing = ref<Client | null>(null);
const saving = ref(false);
const formError = ref<string | null>(null);

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
  retired: 'Retirado',
};
const STATUS_CLASS: Record<ClientStatus, string> = {
  prospect: 'bg-yellow-500/15 text-yellow-400',
  active: 'bg-green-500/15 text-green-400',
  suspended: 'bg-red-500/15 text-red-400',
  retired: 'bg-slate-500/15 text-slate-400',
};

onMounted(async () => {
  await Promise.all([clientsStore.fetchClients(), catalogs.fetchZones()]);
});

function openCreate() {
  editing.value = null;
  form.value = emptyForm();
  formError.value = null;
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
  showModal.value = true;
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
    } else {
      await clientsStore.createClient(payload);
    }
    showModal.value = false;
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
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Clientes</h1>
        <p class="text-slate-400 text-sm mt-1">{{ clientsStore.clients.length }} registrados</p>
      </div>
      <button class="px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold text-sm" @click="openCreate">
        + Nuevo cliente
      </button>
    </div>

    <p v-if="clientsStore.error" class="mb-4 text-sm text-red-400">{{ clientsStore.error }}</p>

    <div class="rounded-xl border border-slate-800 overflow-hidden overflow-x-auto">
      <table class="w-full text-sm min-w-[720px]">
        <thead class="bg-slate-900 text-slate-400 text-xs uppercase">
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
          <tr v-else-if="!clientsStore.clients.length">
            <td colspan="6" class="px-4 py-6 text-center text-slate-500">No hay clientes. Crea el primero.</td>
          </tr>
          <tr v-for="c in clientsStore.clients" :key="c.id" class="border-t border-slate-800 hover:bg-slate-900/50">
            <td class="px-4 py-3">
              <button class="text-slate-100 hover:text-sky-400 font-medium" @click="goToDetail(c)">
                {{ c.first_name }} {{ c.last_name }}
              </button>
            </td>
            <td class="px-4 py-3 text-slate-400">{{ c.document_number }}</td>
            <td class="px-4 py-3 text-slate-400">{{ c.phone || '—' }}</td>
            <td class="px-4 py-3 text-slate-400">{{ c.zones?.name || '—' }}</td>
            <td class="px-4 py-3">
              <span class="px-2 py-1 rounded-md text-xs font-medium" :class="STATUS_CLASS[c.status]">
                {{ STATUS_LABEL[c.status] }}
              </span>
            </td>
            <td class="px-4 py-3 text-right space-x-3 whitespace-nowrap">
              <button class="text-slate-400 hover:text-slate-100 text-xs" @click="openEdit(c)">Editar</button>
              <button class="text-red-500/80 hover:text-red-400 text-xs" @click="handleDelete(c)">Eliminar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div v-if="showModal" class="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
        <form
          class="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6 max-h-[90vh] overflow-y-auto"
          @submit.prevent="handleSubmit"
        >
          <h2 class="text-lg font-semibold mb-4">{{ editing ? 'Editar cliente' : 'Nuevo cliente' }}</h2>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Tipo de documento</label>
              <select v-model="form.document_type" class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm">
                <option value="cedula">Cedula</option>
                <option value="ruc">RUC</option>
                <option value="pasaporte">Pasaporte</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Numero de documento</label>
              <input v-model="form.document_number" required class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Nombres</label>
              <input v-model="form.first_name" required class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Apellidos</label>
              <input v-model="form.last_name" required class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Telefono</label>
              <input v-model="form.phone" class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Correo</label>
              <input v-model="form.email" type="email" class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm" />
            </div>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-400 mb-1">Direccion</label>
            <input v-model="form.address" class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm" />
          </div>

          <div class="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Zona</label>
              <select v-model="form.zone_id" class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm">
                <option value="">Sin asignar</option>
                <option v-for="z in catalogs.zones" :key="z.id" :value="z.id">{{ z.name }}</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Estado</label>
              <select v-model="form.status" class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm">
                <option value="prospect">Prospecto</option>
                <option value="active">Activo</option>
                <option value="suspended">Suspendido</option>
                <option value="retired">Retirado</option>
              </select>
            </div>
          </div>

          <p v-if="formError" class="text-sm text-red-400 mb-3">{{ formError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-100" @click="showModal = false">
              Cancelar
            </button>
            <button type="submit" :disabled="saving" class="px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold text-sm disabled:opacity-60">
              {{ saving ? 'Guardando...' : 'Guardar' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
