<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useOltStore, type OltDevice } from '@/stores/olt';
import { useCatalogsStore } from '@/stores/catalogs';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/lib/errors';

const router = useRouter();
const oltStore = useOltStore();
const catalogs = useCatalogsStore();
const auth = useAuthStore();

// Dar de alta/editar/eliminar el registro de la OLT es tarea de
// administracion; el tecnico de campo solo gestiona ONTs (ver OltDetailView).
const canManageDevices = computed(() => auth.role !== 'TECNICO_RED');

const showModal = ref(false);
const editingId = ref<string | null>(null);
const saving = ref(false);
const formError = ref<string | null>(null);
const testResults = reactive<Record<string, string>>({});
const searchQuery = ref('');

const filteredDevices = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return oltStore.devices;
  return oltStore.devices.filter((d) => `${d.name} ${d.host} ${d.brand}`.toLowerCase().includes(q));
});

const emptyForm = () => ({
  name: '',
  host: '',
  brand: 'zte' as 'zte' | 'huawei' | 'vsol',
  telnet_port: 23,
  username: '',
  password: '',
  zone_id: '',
});
const form = ref(emptyForm());

onMounted(async () => {
  await Promise.all([oltStore.fetchDevices(), catalogs.fetchZones()]);
});

function openCreate() {
  editingId.value = null;
  form.value = emptyForm();
  formError.value = null;
  showModal.value = true;
}

function openEdit(device: OltDevice) {
  editingId.value = device.id;
  form.value = {
    name: device.name,
    host: device.host,
    brand: device.brand,
    telnet_port: device.telnet_port,
    username: device.username,
    password: '',
    zone_id: device.zone_id ?? '',
  };
  formError.value = null;
  showModal.value = true;
}

async function handleSubmit() {
  saving.value = true;
  formError.value = null;
  try {
    const payload: Record<string, unknown> = { ...form.value, zone_id: form.value.zone_id || null };
    if (editingId.value && !payload.password) delete payload.password;

    if (editingId.value) await oltStore.updateDevice(editingId.value, payload);
    else await oltStore.createDevice(payload);
    showModal.value = false;
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al guardar la OLT');
  } finally {
    saving.value = false;
  }
}

async function handleDelete(device: OltDevice) {
  const ok = confirm(`¿Eliminar la OLT "${device.name}"? Esto no borra nada en el equipo fisico, solo el registro local.`);
  if (!ok) return;
  try {
    await oltStore.deleteDevice(device.id);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al eliminar la OLT'));
  }
}

async function handleTest(device: OltDevice) {
  testResults[device.id] = 'Probando...';
  try {
    const res = await oltStore.testDevice(device.id);
    testResults[device.id] = res.status === 'ok' ? `OK (${res.ms} ms)` : `Error: ${res.message}`;
  } catch (e) {
    testResults[device.id] = `Error: ${getErrorMessage(e)}`;
  }
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Red & OLTs</h1>
        <p class="text-slate-600 text-sm mt-1">{{ oltStore.devices.length }} OLT(s) registradas</p>
      </div>
      <button
        v-if="canManageDevices"
        class="btn-primary"
        @click="openCreate"
      >
        + Nueva OLT
      </button>
    </div>

    <p v-if="oltStore.error" class="mb-4 text-sm text-red-600">{{ oltStore.error }}</p>

    <input
      v-model="searchQuery"
      placeholder="Buscar por nombre, host o marca..."
      class="field-input mb-6"
    />

    <div class="table-shell">
      <table class="w-full text-sm min-w-[720px]">
        <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-3">Nombre</th>
            <th class="text-left px-4 py-3">Host</th>
            <th class="text-left px-4 py-3">Marca</th>
            <th class="text-left px-4 py-3">Conexion</th>
            <th class="text-right px-4 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="oltStore.loading">
            <td colspan="5" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
          </tr>
          <tr v-else-if="!filteredDevices.length">
            <td colspan="5" class="px-4 py-6 text-center text-slate-500">
              {{ searchQuery ? 'Sin resultados para esa busqueda.' : 'No hay OLTs. Registra la primera.' }}
            </td>
          </tr>
          <tr v-for="d in filteredDevices" :key="d.id" class="border-t border-slate-200 hover:bg-slate-50">
            <td class="px-4 py-3">
              <button class="text-slate-900 hover:text-sky-600 font-medium" @click="router.push(`/olt/${d.id}`)">
                {{ d.name }}
              </button>
            </td>
            <td class="px-4 py-3 text-slate-600 font-mono text-xs">{{ d.host }}:{{ d.telnet_port }}</td>
            <td class="px-4 py-3 text-slate-600 uppercase">{{ d.brand }}</td>
            <td class="px-4 py-3 text-xs">
              <button class="text-sky-600 hover:underline" @click="handleTest(d)">Probar conexion</button>
              <span v-if="testResults[d.id]" class="block text-slate-500 mt-1">{{ testResults[d.id] }}</span>
            </td>
            <td class="px-4 py-3 text-right space-x-3 whitespace-nowrap">
              <template v-if="canManageDevices">
                <button class="text-slate-600 hover:text-slate-900 text-xs" @click="openEdit(d)">Editar</button>
                <button class="text-red-500/80 hover:text-red-600 text-xs" @click="handleDelete(d)">Eliminar</button>
              </template>
              <span v-else class="text-xs text-slate-400">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay">
        <form
          class="w-full max-w-md modal-panel max-h-[90vh] overflow-y-auto"
          @submit.prevent="handleSubmit"
        >
          <h2 class="text-lg font-semibold mb-4">{{ editingId ? 'Editar OLT' : 'Nueva OLT' }}</h2>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Nombre</label>
            <input
              v-model="form.name"
              required
              placeholder="OLT-Principal"
              class="field-input"
            />
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Host (IP)</label>
              <input v-model="form.host" required class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Puerto Telnet</label>
              <input v-model.number="form.telnet_port" type="number" class="field-input" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Marca</label>
              <select v-model="form.brand" class="field-input">
                <option value="zte">ZTE (C300)</option>
                <option value="huawei" disabled>Huawei (no implementado)</option>
                <option value="vsol" disabled>V-SOL (no implementado)</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Zona</label>
              <select v-model="form.zone_id" class="field-input">
                <option value="">Sin asignar</option>
                <option v-for="z in catalogs.zones" :key="z.id" :value="z.id">{{ z.name }}</option>
              </select>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Usuario Telnet</label>
              <input v-model="form.username" required class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Contrasena Telnet</label>
              <input
                v-model="form.password"
                type="password"
                :required="!editingId"
                :placeholder="editingId ? 'Dejar vacio para no cambiar' : ''"
                class="field-input"
              />
            </div>
          </div>

          <p class="text-xs text-slate-500 mb-4">
            La contrasena solo la usa el backend para conectarse por Telnet; nunca se muestra de vuelta al frontend.
          </p>

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
