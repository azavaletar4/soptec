<script setup lang="ts">
// Fase 164: el tecnico ve SOLO lo que administracion le entrego (equipos
// serializados + saldo de materiales), puede solicitar devolucion (sujeta
// a recepcion administrativa) y ve el estado de sus solicitudes previas.
// No tiene acceso al inventario administrativo general (ver
// inventory_admin_only en Cloud): todo pasa por my_inventory_custody()/
// request_unit_return()/request_material_return(), igual arquitectura que
// el resto de Campo (RPC SECURITY DEFINER, nunca tablas directas).
import { onMounted, ref } from 'vue';
import CampoLayout from '@/components/campo/CampoLayout.vue';
import { useTechnicianCustodyStore } from '@/stores/technicianCustody';
import { useToast } from '@/composables/useToast';
import { getErrorMessage } from '@/lib/errors';
import type { MyInventoryCustody } from '@/types/domain';

const store = useTechnicianCustodyStore();
const toast = useToast();

const loading = ref(true);
const loadError = ref<string | null>(null);
const data = ref<MyInventoryCustody>({ units: [], materials: [], pendingReturnRequests: [] });

async function load() {
  loading.value = true;
  loadError.value = null;
  try {
    data.value = await store.fetchMyCustody();
  } catch (e) {
    loadError.value = getErrorMessage(e, 'No se pudo cargar tu custodia de equipos y materiales.');
  } finally {
    loading.value = false;
  }
}

const unitReturnFormFor = ref<string | null>(null);
const unitReturnReason = ref('');
const savingUnitReturn = ref(false);

function toggleUnitReturnForm(unitId: string) {
  unitReturnFormFor.value = unitReturnFormFor.value === unitId ? null : unitId;
  unitReturnReason.value = '';
}

async function handleUnitReturn(unitId: string) {
  if (!unitReturnReason.value.trim()) {
    toast.error('Escribe el motivo de la devolución.');
    return;
  }
  savingUnitReturn.value = true;
  try {
    await store.requestUnitReturn(unitId, unitReturnReason.value.trim());
    toast.success('Devolución solicitada — queda a la espera de que administración la reciba.');
    unitReturnFormFor.value = null;
    await load();
  } catch (e) {
    toast.error(getErrorMessage(e, 'No se pudo solicitar la devolución'));
  } finally {
    savingUnitReturn.value = false;
  }
}

const materialReturnFormFor = ref<string | null>(null);
const materialReturnQty = ref<number | null>(null);
const materialReturnReason = ref('');
const savingMaterialReturn = ref(false);

function toggleMaterialReturnForm(productId: string) {
  materialReturnFormFor.value = materialReturnFormFor.value === productId ? null : productId;
  materialReturnQty.value = null;
  materialReturnReason.value = '';
}

async function handleMaterialReturn(productId: string) {
  if (!materialReturnQty.value || materialReturnQty.value <= 0) {
    toast.error('Indica la cantidad a devolver.');
    return;
  }
  if (!materialReturnReason.value.trim()) {
    toast.error('Escribe el motivo de la devolución.');
    return;
  }
  savingMaterialReturn.value = true;
  try {
    await store.requestMaterialReturn(productId, materialReturnQty.value, materialReturnReason.value.trim());
    toast.success('Devolución de material solicitada — queda a la espera de que administración la confirme.');
    materialReturnFormFor.value = null;
    await load();
  } catch (e) {
    toast.error(getErrorMessage(e, 'No se pudo solicitar la devolución'));
  } finally {
    savingMaterialReturn.value = false;
  }
}

const STATUS_LABEL: Record<string, string> = {
  with_technician: 'En tu custodia',
  pending_return: 'Devolución en espera de recepción',
};

onMounted(load);
</script>

<template>
  <CampoLayout title="Mis equipos y materiales" show-back>
    <p v-if="loading" class="text-center text-slate-500 py-6">Cargando...</p>
    <p v-else-if="loadError" class="text-sm text-red-600">{{ loadError }}</p>
    <template v-else>
      <section class="surface p-3.5 mb-3">
        <h2 class="text-sm font-semibold mb-2">Equipos en tu custodia</h2>
        <p v-if="!data.units.length" class="text-xs text-slate-500">No tienes equipos entregados por administración.</p>
        <div v-for="u in data.units" :key="u.id" class="border-t border-slate-100 pt-2 mt-2 first:border-t-0 first:pt-0 first:mt-0">
          <div class="flex items-center justify-between gap-2">
            <div>
              <p class="text-sm font-medium">{{ u.product.name }}</p>
              <p class="text-xs text-slate-500">{{ u.serial_number || u.mac_address || '—' }} · {{ STATUS_LABEL[u.status] || u.status }}</p>
            </div>
            <button
              v-if="u.status === 'with_technician'"
              type="button"
              class="btn-secondary text-xs"
              @click="toggleUnitReturnForm(u.id)"
            >
              {{ unitReturnFormFor === u.id ? 'Cancelar' : 'Devolver' }}
            </button>
          </div>
          <div v-if="unitReturnFormFor === u.id" class="mt-2 space-y-2">
            <textarea v-model="unitReturnReason" rows="2" placeholder="Motivo (ej. no se usó, cliente canceló...)" class="field-input text-sm"></textarea>
            <button type="button" class="btn-primary text-xs" :disabled="savingUnitReturn" @click="handleUnitReturn(u.id)">
              {{ savingUnitReturn ? 'Enviando...' : 'Confirmar solicitud de devolución' }}
            </button>
          </div>
        </div>
      </section>

      <section class="surface p-3.5 mb-3">
        <h2 class="text-sm font-semibold mb-2">Materiales en tu custodia</h2>
        <p v-if="!data.materials.length" class="text-xs text-slate-500">No tienes materiales entregados por administración.</p>
        <div v-for="m in data.materials" :key="m.product.id" class="border-t border-slate-100 pt-2 mt-2 first:border-t-0 first:pt-0 first:mt-0">
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm font-medium">{{ m.product.name }} — {{ m.quantity }} {{ m.product.unit }}</p>
            <button type="button" class="btn-secondary text-xs" @click="toggleMaterialReturnForm(m.product.id)">
              {{ materialReturnFormFor === m.product.id ? 'Cancelar' : 'Devolver' }}
            </button>
          </div>
          <div v-if="materialReturnFormFor === m.product.id" class="mt-2 space-y-2">
            <input v-model.number="materialReturnQty" type="number" min="0" step="0.01" :max="m.quantity" :placeholder="`Cantidad (máx. ${m.quantity})`" class="field-input text-sm" />
            <textarea v-model="materialReturnReason" rows="2" placeholder="Motivo (ej. sobró de la orden...)" class="field-input text-sm"></textarea>
            <button type="button" class="btn-primary text-xs" :disabled="savingMaterialReturn" @click="handleMaterialReturn(m.product.id)">
              {{ savingMaterialReturn ? 'Enviando...' : 'Confirmar solicitud de devolución' }}
            </button>
          </div>
        </div>
      </section>

      <section v-if="data.pendingReturnRequests.length" class="surface p-3.5 mb-3">
        <h2 class="text-sm font-semibold mb-2">Devoluciones de material en espera</h2>
        <div v-for="r in data.pendingReturnRequests" :key="r.id" class="border-t border-slate-100 pt-2 mt-2 first:border-t-0 first:pt-0 first:mt-0">
          <p class="text-sm">{{ r.product.name }} — {{ r.quantity }}</p>
          <p class="text-xs text-amber-700">Pendiente de recepción administrativa</p>
        </div>
      </section>
    </template>
  </CampoLayout>
</template>
