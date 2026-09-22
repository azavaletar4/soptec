<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppLayout from '@/components/layout/AppLayout.vue';
import { usePlansStore } from '@/stores/plans';
import { useAuthStore } from '@/stores/auth';
import { useOltStore } from '@/stores/olt';
import { getErrorMessage } from '@/lib/errors';
import type { ConnectionTechnology, Plan } from '@/types/domain';

const plansStore = usePlansStore();
const auth = useAuthStore();
const oltStore = useOltStore();

// La escritura ya esta restringida por RLS a ADMIN/SUPERADMIN/FACTURACION;
// ocultamos los controles de edicion al resto para no mostrar acciones que fallarian.
const canManagePlans = computed(() => ['SUPERADMIN', 'ADMIN', 'FACTURACION'].includes(auth.role ?? ''));

// El ancho de banda real lo aplica la OLT (tcont = subida, traffic =
// bajada); se leen los perfiles ya existentes en el equipo elegido para que
// el plan quede vinculado a un perfil real (evita typos que fallarian
// silenciosamente al aplicar el plan en una ONT).
const oltDeviceId = ref('');
const oltProfiles = ref<{ tcontProfiles: string[]; trafficProfiles: string[] }>({ tcontProfiles: [], trafficProfiles: [] });
const loadingOltProfiles = ref(false);
const oltProfilesError = ref<string | null>(null);

async function loadOltProfiles() {
  if (!oltDeviceId.value) {
    oltProfiles.value = { tcontProfiles: [], trafficProfiles: [] };
    return;
  }
  loadingOltProfiles.value = true;
  oltProfilesError.value = null;
  try {
    oltProfiles.value = await oltStore.fetchProfiles(oltDeviceId.value);
  } catch (e) {
    oltProfilesError.value = getErrorMessage(e, 'No se pudo leer los perfiles de la OLT');
    oltProfiles.value = { tcontProfiles: [], trafficProfiles: [] };
  } finally {
    loadingOltProfiles.value = false;
  }
}

// Asegura que el perfil ya guardado en el plan siga apareciendo en el
// select aunque no venga en el ultimo listado leido de la OLT (equipo
// distinto, offline al sincronizar, etc.).
function withCurrent(list: string[], current: string | null) {
  return current && !list.includes(current) ? [...list, current] : list;
}

const TECH_LABEL: Record<ConnectionTechnology, string> = {
  fiber: 'Fibra',
  radio: 'Radio',
  cable: 'Cable',
  dsl: 'DSL',
};

const showModal = ref(false);
const editing = ref<Plan | null>(null);
const saving = ref(false);
const formError = ref<string | null>(null);

const emptyForm = () => ({
  name: '',
  description: '',
  download_speed: 0,
  upload_speed: 0,
  price: 0,
  technology: 'fiber' as ConnectionTechnology,
  burst_download: null as number | null,
  burst_upload: null as number | null,
  olt_tcont_profile: '',
  olt_traffic_profile: '',
  is_active: true,
  is_debt_suspension_plan: false,
  mikrotik_profile: '',
});

const form = ref(emptyForm());

const tcontOptions = computed(() => withCurrent(oltProfiles.value.tcontProfiles, form.value.olt_tcont_profile || null));
const trafficOptions = computed(() => withCurrent(oltProfiles.value.trafficProfiles, form.value.olt_traffic_profile || null));

onMounted(async () => {
  await plansStore.fetchPlans();
  try {
    await oltStore.fetchDevices();
    oltDeviceId.value = oltStore.devices[0]?.id ?? '';
    await loadOltProfiles();
  } catch {
    // Sin acceso a la OLT desde este rol o sin equipos configurados: los
    // selects de perfil quedan vacios (o solo con el valor ya guardado).
  }
});

function openCreate() {
  editing.value = null;
  form.value = emptyForm();
  formError.value = null;
  showModal.value = true;
}

function openEdit(plan: Plan) {
  editing.value = plan;
  form.value = {
    name: plan.name,
    description: plan.description ?? '',
    download_speed: plan.download_speed,
    upload_speed: plan.upload_speed,
    price: plan.price,
    technology: plan.technology,
    burst_download: plan.burst_download,
    burst_upload: plan.burst_upload,
    olt_tcont_profile: plan.olt_tcont_profile ?? '',
    olt_traffic_profile: plan.olt_traffic_profile ?? '',
    is_active: plan.is_active,
    is_debt_suspension_plan: plan.is_debt_suspension_plan,
    mikrotik_profile: plan.mikrotik_profile ?? '',
  };
  formError.value = null;
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
}

async function handleSubmit() {
  saving.value = true;
  formError.value = null;
  try {
    const payload = {
      ...form.value,
      description: form.value.description || null,
      olt_tcont_profile: form.value.olt_tcont_profile || null,
      olt_traffic_profile: form.value.olt_traffic_profile || null,
      mikrotik_profile: form.value.mikrotik_profile || null,
    };
    if (editing.value) {
      await plansStore.updatePlan(editing.value.id, payload);
    } else {
      await plansStore.createPlan(payload);
    }
    showModal.value = false;
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al guardar el plan');
  } finally {
    saving.value = false;
  }
}

async function handleDelete(plan: Plan) {
  const ok = confirm(`¿Eliminar el plan "${plan.name}"? Esta acción no se puede deshacer.`);
  if (!ok) return;
  try {
    await plansStore.deletePlan(plan.id);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al eliminar el plan'));
  }
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Planes</h1>
        <p class="text-slate-600 text-sm mt-1">{{ plansStore.plans.length }} planes registrados</p>
      </div>
      <button v-if="canManagePlans" class="btn-primary" @click="openCreate()">+ Nuevo plan</button>
    </div>

    <p v-if="plansStore.error" class="mb-4 text-sm text-red-600">{{ plansStore.error }}</p>

    <div class="table-shell mb-6">
      <table class="w-full text-sm min-w-[760px]">
        <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-3">Nombre</th>
            <th class="text-left px-4 py-3">Bajada (Mbps)</th>
            <th class="text-left px-4 py-3">Subida (Mbps)</th>
            <th class="text-left px-4 py-3">Precio</th>
            <th class="text-left px-4 py-3">Tecnología</th>
            <th class="text-left px-4 py-3">Perfil OLT</th>
            <th class="text-left px-4 py-3">Estado</th>
            <th class="text-right px-4 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="plansStore.loading">
            <td colspan="8" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
          </tr>
          <tr v-else-if="!plansStore.plans.length">
            <td colspan="8" class="px-4 py-6 text-center text-slate-500">No hay planes. Crea el primero.</td>
          </tr>
          <tr v-for="p in plansStore.plans" :key="p.id" class="border-t border-slate-200 hover:bg-slate-50">
            <td class="px-4 py-3 font-medium text-slate-900">{{ p.name }}</td>
            <td class="px-4 py-3 text-slate-600">{{ p.download_speed }}</td>
            <td class="px-4 py-3 text-slate-600">{{ p.upload_speed }}</td>
            <td class="px-4 py-3 text-slate-600">S/ {{ p.price.toFixed(2) }}</td>
            <td class="px-4 py-3 text-slate-600">{{ TECH_LABEL[p.technology] }}</td>
            <td class="px-4 py-3 text-slate-600 font-mono text-xs">
              <span v-if="p.olt_tcont_profile || p.olt_traffic_profile">↑{{ p.olt_tcont_profile || '—' }} / ↓{{ p.olt_traffic_profile || '—' }}</span>
              <span v-else>—</span>
            </td>
            <td class="px-4 py-3">
              <span class="badge" :class="p.is_active ? 'bg-green-500/15 text-green-600' : 'bg-slate-500/15 text-slate-600'">
                {{ p.is_active ? 'Activo' : 'Inactivo' }}
              </span>
              <span v-if="p.is_debt_suspension_plan" class="badge bg-amber-500/15 text-amber-600 ml-1">Corte por deuda</span>
            </td>
            <td class="px-4 py-3 text-right space-x-3 whitespace-nowrap">
              <button v-if="canManagePlans" class="text-slate-600 hover:text-slate-900 text-xs" @click="openEdit(p)">Editar</button>
              <button v-if="canManagePlans" class="text-red-500/80 hover:text-red-600 text-xs" @click="handleDelete(p)">Eliminar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay">
        <form class="w-full max-w-lg modal-panel max-h-[90vh] overflow-y-auto" @submit.prevent="handleSubmit">
          <h2 class="text-lg font-semibold mb-3">{{ editing ? 'Editar plan' : 'Nuevo plan' }}</h2>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Nombre</label>
            <input v-model="form.name" required class="field-input" placeholder="Ej. Hogar 20 Megas" />
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Bajada (Mbps)</label>
              <input v-model.number="form.download_speed" type="number" min="0" required class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Subida (Mbps)</label>
              <input v-model.number="form.upload_speed" type="number" min="0" required class="field-input" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Precio</label>
              <input v-model.number="form.price" type="number" min="0" step="0.01" required class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Tecnología</label>
              <select v-model="form.technology" class="field-input">
                <option value="fiber">Fibra</option>
                <option value="radio">Radio</option>
                <option value="cable">Cable</option>
                <option value="dsl">DSL</option>
              </select>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Burst bajada (opcional)</label>
              <input v-model.number="form.burst_download" type="number" min="0" class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Burst subida (opcional)</label>
              <input v-model.number="form.burst_upload" type="number" min="0" class="field-input" />
            </div>
          </div>

          <div class="mb-3">
            <div class="flex items-center justify-between mb-1">
              <label class="block text-xs text-slate-600">Perfiles de ancho de banda (OLT)</label>
              <div v-if="oltStore.devices.length" class="flex items-center gap-2">
                <select v-model="oltDeviceId" class="field-input !py-1 !text-xs w-auto" @change="loadOltProfiles">
                  <option v-for="d in oltStore.devices" :key="d.id" :value="d.id">{{ d.name }}</option>
                </select>
                <button type="button" class="text-xs text-sky-600 hover:underline whitespace-nowrap" :disabled="loadingOltProfiles" @click="loadOltProfiles">
                  {{ loadingOltProfiles ? 'Sincronizando...' : 'Sincronizar' }}
                </button>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs text-slate-500 mb-1">Subida (tcont)</label>
                <select v-model="form.olt_tcont_profile" class="field-input">
                  <option value="">Sin perfil</option>
                  <option v-for="name in tcontOptions" :key="name" :value="name">{{ name }}</option>
                </select>
              </div>
              <div>
                <label class="block text-xs text-slate-500 mb-1">Bajada (traffic)</label>
                <select v-model="form.olt_traffic_profile" class="field-input">
                  <option value="">Sin perfil</option>
                  <option v-for="name in trafficOptions" :key="name" :value="name">{{ name }}</option>
                </select>
              </div>
            </div>
            <p class="text-xs text-slate-500 mt-1">
              El ancho de banda real lo aplica la OLT con estos perfiles al elegir este plan en un cliente.
            </p>
            <p v-if="oltProfilesError" class="text-xs text-amber-600 mt-1">{{ oltProfilesError }}</p>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Descripción</label>
            <textarea v-model="form.description" rows="2" class="field-input" />
          </div>

          <label class="flex items-center gap-2 text-sm mb-3">
            <input v-model="form.is_active" type="checkbox" class="rounded border-slate-300" />
            Plan activo (visible al crear contratos)
          </label>

          <label class="flex items-center gap-2 text-sm mb-3">
            <input v-model="form.is_debt_suspension_plan" type="checkbox" class="rounded border-slate-300" />
            Es el plan de "corte por deuda"
          </label>
          <div v-if="form.is_debt_suspension_plan" class="mb-4 pl-6">
            <p class="text-xs text-amber-600 mb-2">
              Solo puede haber un plan asi a la vez — marcarlo aca desmarca automaticamente cualquier otro. Se usa para
              el corte automatico por deuda (Cortes por deuda): los perfiles OLT de arriba deben apuntar a un plan
              reducido/walled-garden real.
            </p>
            <label class="block text-xs text-slate-600 mb-1">Perfil PPPoE (MikroTik) para el corte</label>
            <input v-model="form.mikrotik_profile" class="field-input" placeholder="Ej. Profile_Morosos" />
          </div>

          <p v-if="formError" class="text-sm text-red-600 mb-3">{{ formError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-secondary" @click="closeModal">Cancelar</button>
            <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? 'Guardando...' : 'Guardar' }}</button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
