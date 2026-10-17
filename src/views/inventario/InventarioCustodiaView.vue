<script setup lang="ts">
// Fase 164: control de equipos/materiales entregados a tecnicos — entrega,
// recepcion de devoluciones y conciliacion (almacen vs custodia vs
// instalado). Los conteos de la seccion de conciliacion son los REALES del
// sistema; una diferencia fisica (ej. menos TV Box de los que el sistema
// muestra en almacen) no se corrige aqui — requiere un ajuste
// administrativo aparte, a proposito (ver inventory_custody_summary()).
import { computed, onMounted, ref } from 'vue';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useInventoryStore } from '@/stores/inventory';
import { useInventoryUnitsStore } from '@/stores/inventoryUnits';
import { useCatalogsStore } from '@/stores/catalogs';
import { useTechnicianCustodyStore } from '@/stores/technicianCustody';
import { useToast } from '@/composables/useToast';
import { getErrorMessage } from '@/lib/errors';
import type { InventoryCustodySummaryRow, InventoryUnit, TechnicianMaterialReturnRequest } from '@/types/domain';

const inventoryStore = useInventoryStore();
const inventoryUnitsStore = useInventoryUnitsStore();
const catalogsStore = useCatalogsStore();
const custodyStore = useTechnicianCustodyStore();
const toast = useToast();

const loading = ref(true);
const summary = ref<InventoryCustodySummaryRow[]>([]);
const pendingMaterialRequests = ref<TechnicianMaterialReturnRequest[]>([]);
const pendingUnitReturns = ref<InventoryUnit[]>([]);

const technicians = computed(() => catalogsStore.staff.filter((s) => s.role === 'TECNICO_RED'));

async function loadAll() {
  loading.value = true;
  try {
    await Promise.all([inventoryStore.fetchProducts(), catalogsStore.fetchStaff()]);
    summary.value = await custodyStore.fetchCustodySummary();
    pendingMaterialRequests.value = await custodyStore.fetchPendingMaterialReturnRequests();
    pendingUnitReturns.value = [];
    for (const row of summary.value.filter((r) => r.is_serialized)) {
      const units = await inventoryUnitsStore.fetchUnitsByProduct(row.product_id);
      pendingUnitReturns.value.push(...units.filter((u) => u.status === 'pending_return'));
    }
  } catch (e) {
    toast.error(getErrorMessage(e, 'No se pudo cargar la custodia de técnicos'));
  } finally {
    loading.value = false;
  }
}

// ---- Entregar equipo serializado ----
const deliverUnitProductId = ref('');
const deliverUnitAvailable = ref<InventoryUnit[]>([]);
const deliverUnitId = ref('');
const deliverUnitTechnicianId = ref('');
const deliverUnitReason = ref('');
const savingDeliverUnit = ref(false);

async function onDeliverUnitProductChange() {
  deliverUnitId.value = '';
  if (!deliverUnitProductId.value) { deliverUnitAvailable.value = []; return; }
  const units = await inventoryUnitsStore.fetchUnitsByProduct(deliverUnitProductId.value);
  deliverUnitAvailable.value = units.filter((u) => u.status === 'in_stock');
}

async function handleDeliverUnit() {
  if (!deliverUnitId.value || !deliverUnitTechnicianId.value) {
    toast.error('Elige el equipo y el técnico.');
    return;
  }
  savingDeliverUnit.value = true;
  try {
    await custodyStore.deliverUnitToTechnician(deliverUnitId.value, deliverUnitTechnicianId.value, deliverUnitReason.value.trim() || undefined);
    toast.success('Equipo entregado al técnico.');
    deliverUnitId.value = '';
    deliverUnitReason.value = '';
    await onDeliverUnitProductChange();
    summary.value = await custodyStore.fetchCustodySummary();
  } catch (e) {
    toast.error(getErrorMessage(e, 'No se pudo entregar el equipo'));
  } finally {
    savingDeliverUnit.value = false;
  }
}

async function handleReceiveUnit(unit: InventoryUnit, condition: 'in_stock' | 'damaged' | 'in_repair') {
  try {
    await custodyStore.receiveUnitReturn(unit.id, condition);
    toast.success('Devolución recibida.');
    await loadAll();
  } catch (e) {
    toast.error(getErrorMessage(e, 'No se pudo confirmar la recepción'));
  }
}

// ---- Entregar material (consumible) ----
const deliverMaterialProductId = ref('');
const deliverMaterialTechnicianId = ref('');
const deliverMaterialQty = ref<number | null>(null);
const deliverMaterialReason = ref('');
const savingDeliverMaterial = ref(false);

async function handleDeliverMaterial() {
  if (!deliverMaterialProductId.value || !deliverMaterialTechnicianId.value || !deliverMaterialQty.value || deliverMaterialQty.value <= 0) {
    toast.error('Completa producto, técnico y cantidad.');
    return;
  }
  savingDeliverMaterial.value = true;
  try {
    await custodyStore.deliverMaterialToTechnician(deliverMaterialTechnicianId.value, deliverMaterialProductId.value, deliverMaterialQty.value, deliverMaterialReason.value.trim() || undefined);
    toast.success('Material entregado al técnico.');
    deliverMaterialQty.value = null;
    deliverMaterialReason.value = '';
    summary.value = await custodyStore.fetchCustodySummary();
  } catch (e) {
    toast.error(getErrorMessage(e, 'No se pudo entregar el material'));
  } finally {
    savingDeliverMaterial.value = false;
  }
}

async function handleMaterialReturnDecision(request: TechnicianMaterialReturnRequest, approved: boolean) {
  try {
    await custodyStore.confirmMaterialReturn(request.id, approved);
    toast.success(approved ? 'Devolución confirmada.' : 'Devolución rechazada.');
    await loadAll();
  } catch (e) {
    toast.error(getErrorMessage(e, 'No se pudo resolver la solicitud'));
  }
}

const serializedProducts = computed(() => inventoryStore.products.filter((p) => p.is_serialized));
const consumableProducts = computed(() => inventoryStore.products.filter((p) => !p.is_serialized));

onMounted(loadAll);
</script>

<template>
  <AppLayout>
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-2xl font-semibold">Custodia de técnicos</h1>
      <router-link to="/inventario" class="text-sm text-slate-600 hover:text-slate-900">← Volver a inventario</router-link>
    </div>

    <p v-if="loading" class="text-center text-slate-500 py-6">Cargando...</p>
    <template v-else>
      <!-- Fase C: conciliacion -->
      <section class="surface p-4 mb-4">
        <h2 class="text-base font-semibold mb-1">Conciliación: almacén vs. custodia vs. instalado</h2>
        <p class="text-xs text-slate-500 mb-3">
          Conteos reales del sistema. Si el físico no coincide con "En almacén", corrígelo con un ajuste administrativo aparte —
          esta tabla no inventa ni descuenta diferencias automáticamente.
        </p>
        <div class="table-shell overflow-x-auto">
          <table class="w-full text-sm min-w-[720px]">
            <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
              <tr>
                <th class="text-left px-3 py-2">Producto</th>
                <th class="text-right px-3 py-2">En almacén</th>
                <th class="text-right px-3 py-2">En custodia de técnicos</th>
                <th class="text-right px-3 py-2">Instalado</th>
                <th class="text-left px-3 py-2">Custodia por técnico</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in summary" :key="row.product_id" class="border-t border-slate-200">
                <td class="px-3 py-2">{{ row.product_name }} <span class="text-slate-400">({{ row.unit }})</span></td>
                <td class="px-3 py-2 text-right">{{ row.warehouse_qty }}</td>
                <td class="px-3 py-2 text-right">{{ row.custody_qty }}</td>
                <td class="px-3 py-2 text-right">{{ row.installed_qty ?? '—' }}</td>
                <td class="px-3 py-2 text-xs text-slate-600">
                  <span v-if="!Object.keys(row.custody_by_technician).length">—</span>
                  <span v-else>
                    <span v-for="(qty, name) in row.custody_by_technician" :key="name" class="mr-2">{{ name }}: {{ qty }}</span>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <!-- Entregar equipo serializado -->
        <section class="surface p-4">
          <h2 class="text-sm font-semibold mb-2">Entregar equipo a un técnico</h2>
          <label class="block text-xs text-slate-600 mb-1">Producto</label>
          <select v-model="deliverUnitProductId" class="field-input mb-2" @change="onDeliverUnitProductChange">
            <option value="">Selecciona...</option>
            <option v-for="p in serializedProducts" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <template v-if="deliverUnitProductId">
            <label class="block text-xs text-slate-600 mb-1">Equipo (en almacén)</label>
            <select v-model="deliverUnitId" class="field-input mb-2">
              <option value="">Selecciona...</option>
              <option v-for="u in deliverUnitAvailable" :key="u.id" :value="u.id">{{ u.serial_number || u.mac_address }}</option>
            </select>
            <p v-if="deliverUnitProductId && !deliverUnitAvailable.length" class="text-xs text-amber-600 mb-2">No hay equipos en almacén de este producto.</p>
          </template>
          <label class="block text-xs text-slate-600 mb-1">Técnico</label>
          <select v-model="deliverUnitTechnicianId" class="field-input mb-2">
            <option value="">Selecciona...</option>
            <option v-for="t in technicians" :key="t.id" :value="t.id">{{ t.full_name || t.email }}</option>
          </select>
          <input v-model="deliverUnitReason" placeholder="Motivo (opcional)" class="field-input mb-2" />
          <button type="button" class="btn-primary text-sm" :disabled="savingDeliverUnit" @click="handleDeliverUnit">
            {{ savingDeliverUnit ? 'Entregando...' : 'Entregar equipo' }}
          </button>
        </section>

        <!-- Entregar material -->
        <section class="surface p-4">
          <h2 class="text-sm font-semibold mb-2">Entregar material a un técnico</h2>
          <label class="block text-xs text-slate-600 mb-1">Producto</label>
          <select v-model="deliverMaterialProductId" class="field-input mb-2">
            <option value="">Selecciona...</option>
            <option v-for="p in consumableProducts" :key="p.id" :value="p.id">{{ p.name }} ({{ p.unit }})</option>
          </select>
          <label class="block text-xs text-slate-600 mb-1">Técnico</label>
          <select v-model="deliverMaterialTechnicianId" class="field-input mb-2">
            <option value="">Selecciona...</option>
            <option v-for="t in technicians" :key="t.id" :value="t.id">{{ t.full_name || t.email }}</option>
          </select>
          <input v-model.number="deliverMaterialQty" type="number" min="0" step="0.01" placeholder="Cantidad" class="field-input mb-2" />
          <input v-model="deliverMaterialReason" placeholder="Motivo (opcional)" class="field-input mb-2" />
          <button type="button" class="btn-primary text-sm" :disabled="savingDeliverMaterial" @click="handleDeliverMaterial">
            {{ savingDeliverMaterial ? 'Entregando...' : 'Entregar material' }}
          </button>
        </section>
      </div>

      <!-- Devoluciones pendientes -->
      <section class="surface p-4 mb-4">
        <h2 class="text-sm font-semibold mb-2">Devoluciones de equipos — pendientes de recibir</h2>
        <p v-if="!pendingUnitReturns.length" class="text-xs text-slate-500">Sin solicitudes pendientes.</p>
        <div v-for="u in pendingUnitReturns" :key="u.id" class="flex items-center justify-between border-t border-slate-100 pt-2 mt-2 first:border-t-0 first:pt-0 first:mt-0">
          <p class="text-sm">{{ u.product?.name }} — {{ u.serial_number || u.mac_address }}</p>
          <div class="flex gap-1.5">
            <button type="button" class="btn-secondary text-xs" @click="handleReceiveUnit(u, 'in_stock')">Recibir OK</button>
            <button type="button" class="btn-secondary text-xs !text-amber-700" @click="handleReceiveUnit(u, 'in_repair')">En reparación</button>
            <button type="button" class="btn-secondary text-xs !text-red-700" @click="handleReceiveUnit(u, 'damaged')">Dañado</button>
          </div>
        </div>
      </section>

      <section class="surface p-4">
        <h2 class="text-sm font-semibold mb-2">Devoluciones de material — pendientes de confirmar</h2>
        <p v-if="!pendingMaterialRequests.length" class="text-xs text-slate-500">Sin solicitudes pendientes.</p>
        <div v-for="r in pendingMaterialRequests" :key="r.id" class="flex items-center justify-between border-t border-slate-100 pt-2 mt-2 first:border-t-0 first:pt-0 first:mt-0">
          <div>
            <p class="text-sm">{{ r.technician?.full_name || r.technician?.email }} — {{ r.product?.name }}: {{ r.quantity }} {{ r.product?.unit }}</p>
            <p class="text-xs text-slate-500">{{ r.reason }}</p>
          </div>
          <div class="flex gap-1.5">
            <button type="button" class="btn-secondary text-xs" @click="handleMaterialReturnDecision(r, true)">Confirmar</button>
            <button type="button" class="btn-secondary text-xs !text-red-700" @click="handleMaterialReturnDecision(r, false)">Rechazar</button>
          </div>
        </div>
      </section>
    </template>
  </AppLayout>
</template>
