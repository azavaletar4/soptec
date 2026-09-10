<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useMikrotikStore, type MikrotikDevice } from '@/stores/mikrotik';
import { useCatalogsStore } from '@/stores/catalogs';
import { getErrorMessage } from '@/lib/errors';

const router = useRouter();
const mikrotikStore = useMikrotikStore();
const catalogs = useCatalogsStore();

const showModal = ref(false);
const editingId = ref<string | null>(null);
const saving = ref(false);
const formError = ref<string | null>(null);
const testResults = reactive<Record<string, string>>({});

const emptyForm = () => ({
  name: '',
  host: '',
  port: 443,
  use_tls: true,
  username: 'admin',
  password: '',
  zone_id: '',
});
const form = ref(emptyForm());

onMounted(async () => {
  await Promise.all([mikrotikStore.fetchDevices(), catalogs.fetchZones()]);
});

function openCreate() {
  editingId.value = null;
  form.value = emptyForm();
  formError.value = null;
  showModal.value = true;
}

function openEdit(device: MikrotikDevice) {
  editingId.value = device.id;
  form.value = {
    name: device.name,
    host: device.host,
    port: device.port,
    use_tls: device.use_tls,
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

    if (editingId.value) await mikrotikStore.updateDevice(editingId.value, payload);
    else await mikrotikStore.createDevice(payload);
    showModal.value = false;
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al guardar el router');
  } finally {
    saving.value = false;
  }
}

async function handleDelete(device: MikrotikDevice) {
  const ok = confirm(`¿Eliminar el router "${device.name}"? Esto no borra nada en el equipo fisico, solo el registro local.`);
  if (!ok) return;
  try {
    await mikrotikStore.deleteDevice(device.id);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al eliminar el router'));
  }
}

async function handleTest(device: MikrotikDevice) {
  testResults[device.id] = 'Probando...';
  try {
    const res = await mikrotikStore.testDevice(device.id);
    testResults[device.id] =
      res.status === 'ok' ? `OK (${res.ms} ms) — RouterOS ${res.resource?.version ?? '?'}` : `Error: ${res.message}`;
  } catch (e) {
    testResults[device.id] = `Error: ${getErrorMessage(e)}`;
  }
}
</script>

<template>
  <AppLayout>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold">MikroTik</h1>
        <p class="text-slate-400 text-sm mt-1">{{ mikrotikStore.devices.length }} router(s) registrados</p>
      </div>
      <button class="px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold text-sm" @click="openCreate">
        + Nuevo router
      </button>
    </div>

    <p v-if="mikrotikStore.error" class="mb-4 text-sm text-red-400">{{ mikrotikStore.error }}</p>

    <div class="rounded-xl border border-slate-800 overflow-hidden overflow-x-auto">
      <table class="w-full text-sm min-w-[720px]">
        <thead class="bg-slate-900 text-slate-400 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-3">Nombre</th>
            <th class="text-left px-4 py-3">Host</th>
            <th class="text-left px-4 py-3">TLS</th>
            <th class="text-left px-4 py-3">Conexion</th>
            <th class="text-right px-4 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="mikrotikStore.loading">
            <td colspan="5" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
          </tr>
          <tr v-else-if="!mikrotikStore.devices.length">
            <td colspan="5" class="px-4 py-6 text-center text-slate-500">No hay routers. Registra el primero.</td>
          </tr>
          <tr v-for="d in mikrotikStore.devices" :key="d.id" class="border-t border-slate-800 hover:bg-slate-900/50">
            <td class="px-4 py-3">
              <button class="text-slate-100 hover:text-sky-400 font-medium" @click="router.push(`/mikrotik/${d.id}`)">
                {{ d.name }}
              </button>
            </td>
            <td class="px-4 py-3 text-slate-400 font-mono text-xs">{{ d.host }}:{{ d.port }}</td>
            <td class="px-4 py-3 text-slate-400">{{ d.use_tls ? 'Si' : 'No' }}</td>
            <td class="px-4 py-3 text-xs">
              <button class="text-sky-400 hover:underline" @click="handleTest(d)">Probar conexion</button>
              <span v-if="testResults[d.id]" class="block text-slate-500 mt-1">{{ testResults[d.id] }}</span>
            </td>
            <td class="px-4 py-3 text-right space-x-3 whitespace-nowrap">
              <button class="text-slate-400 hover:text-slate-100 text-xs" @click="openEdit(d)">Editar</button>
              <button class="text-red-500/80 hover:text-red-400 text-xs" @click="handleDelete(d)">Eliminar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div v-if="showModal" class="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
        <form
          class="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 max-h-[90vh] overflow-y-auto"
          @submit.prevent="handleSubmit"
        >
          <h2 class="text-lg font-semibold mb-4">{{ editingId ? 'Editar router' : 'Nuevo router' }}</h2>

          <div class="mb-3">
            <label class="block text-xs text-slate-400 mb-1">Nombre</label>
            <input
              v-model="form.name"
              required
              placeholder="Router-Principal"
              class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm"
            />
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Host (IP)</label>
              <input v-model="form.host" required class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Puerto REST</label>
              <input v-model.number="form.port" type="number" class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Zona</label>
              <select v-model="form.zone_id" class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm">
                <option value="">Sin asignar</option>
                <option v-for="z in catalogs.zones" :key="z.id" :value="z.id">{{ z.name }}</option>
              </select>
            </div>
            <div class="flex items-end pb-2">
              <label class="flex items-center gap-2 text-sm text-slate-300">
                <input v-model="form.use_tls" type="checkbox" class="rounded border-slate-700 bg-slate-950" />
                Usar HTTPS (TLS)
              </label>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Usuario</label>
              <input v-model="form.username" required class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Contrasena</label>
              <input
                v-model="form.password"
                type="password"
                :required="!editingId"
                :placeholder="editingId ? 'Dejar vacio para no cambiar' : ''"
                class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm"
              />
            </div>
          </div>

          <p class="text-xs text-slate-500 mb-4">
            Requiere la REST API habilitada en RouterOS v7+ (servicio www-ssl o www). La contrasena
            solo la usa el backend; nunca se muestra de vuelta al frontend.
          </p>

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
