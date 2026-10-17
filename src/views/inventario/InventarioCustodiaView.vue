<script setup lang="ts">
// Fase 164: control de equipos/materiales entregados a tecnicos — entrega,
// recepcion de devoluciones y conciliacion (almacen vs custodia vs
// instalado). Rediseño visual (sin tocar RPC/migraciones/RLS): mismos
// stores/llamadas que antes, solo se reorganiza la presentacion en
// pestañas y se agregan dos lecturas directas de solo lectura
// (fetchUnitsByStatus ya existente + fetchAllMaterialCustody nuevo) para
// poder mostrar el detalle por tecnico sin pedirlo producto por producto.
//
// Los conteos de "Conciliación" son los REALES del sistema — una
// diferencia fisica (ej. menos TV Box de los que el sistema muestra en
// almacen) no se corrige aqui, requiere un ajuste administrativo aparte
// (ver inventory_custody_summary()).
import { computed, onMounted, ref } from 'vue';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useInventoryStore } from '@/stores/inventory';
import { useInventoryUnitsStore } from '@/stores/inventoryUnits';
import { useCatalogsStore } from '@/stores/catalogs';
import { useTechnicianCustodyStore } from '@/stores/technicianCustody';
import { useToast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';
import { getErrorMessage } from '@/lib/errors';
import type { InventoryCustodySummaryRow, InventoryUnit, TechnicianMaterialReturnRequest } from '@/types/domain';

const inventoryStore = useInventoryStore();
const inventoryUnitsStore = useInventoryUnitsStore();
const catalogsStore = useCatalogsStore();
const custodyStore = useTechnicianCustodyStore();
const toast = useToast();
const { confirmDialog } = useConfirm();

const loading = ref(true);
const loadError = ref<string | null>(null);
const summary = ref<InventoryCustodySummaryRow[]>([]);
const pendingMaterialRequests = ref<TechnicianMaterialReturnRequest[]>([]);
const custodyUnits = ref<InventoryUnit[]>([]); // status with_technician O pending_return, de TODOS los tecnicos
type MaterialCustodyRow = { technician_id: string; product_id: string; quantity: number; product: { id: string; name: string; unit: string } | null; technician: { id: string; full_name: string | null; email: string | null } | null };
const materialCustody = ref<MaterialCustodyRow[]>([]);

const technicians = computed(() => catalogsStore.staff.filter((s) => s.role === 'TECNICO_RED'));
const pendingUnitReturns = computed(() => custodyUnits.value.filter((u) => u.status === 'pending_return'));

async function loadAll() {
  loading.value = true;
  loadError.value = null;
  try {
    await Promise.all([inventoryStore.fetchProducts(), catalogsStore.fetchStaff()]);
    const [summaryResult, materialRequests, units, materials] = await Promise.all([
      custodyStore.fetchCustodySummary(),
      custodyStore.fetchPendingMaterialReturnRequests(),
      inventoryUnitsStore.fetchUnitsByStatus(['with_technician', 'pending_return']),
      custodyStore.fetchAllMaterialCustody(),
    ]);
    summary.value = summaryResult;
    pendingMaterialRequests.value = materialRequests;
    custodyUnits.value = units;
    materialCustody.value = materials;
  } catch (e) {
    loadError.value = getErrorMessage(e, 'No se pudo cargar la custodia de técnicos');
  } finally {
    loading.value = false;
  }
}

// ---- Indicadores superiores — nunca se suman cantidades de distintas
// unidades (metros + unidades) como si fueran equivalentes: el indicador
// de materiales cuenta PRODUCTOS en custodia, no una cantidad combinada. ----
const kpis = computed(() => ({
  equiposEnCustodia: custodyUnits.value.length,
  productosEnCustodiaMaterial: materialCustody.value.length,
  devolucionesPendientes: pendingUnitReturns.value.length + pendingMaterialRequests.value.length,
}));

// ---- Pestaña Técnicos ----
type Tab = 'tecnicos' | 'entregas' | 'devoluciones' | 'conciliacion';
const activeTab = ref<Tab>('tecnicos');
const TABS: { value: Tab; label: string }[] = [
  { value: 'tecnicos', label: 'Técnicos' },
  { value: 'entregas', label: 'Entregas' },
  { value: 'devoluciones', label: 'Devoluciones' },
  { value: 'conciliacion', label: 'Conciliación' },
];

const technicianRows = computed(() =>
  technicians.value
    .map((t) => ({
      id: t.id,
      full_name: t.full_name,
      email: t.email,
      units: custodyUnits.value.filter((u) => u.custody_technician_id === t.id),
      materials: materialCustody.value.filter((m) => m.technician_id === t.id),
    }))
    .sort((a, b) => b.units.length + b.materials.length - (a.units.length + a.materials.length)),
);

const selectedTechnicianId = ref<string | null>(null);
const selectedTechnician = computed(() => technicianRows.value.find((t) => t.id === selectedTechnicianId.value) ?? null);
function selectTechnician(id: string) {
  selectedTechnicianId.value = selectedTechnicianId.value === id ? null : id;
}

// ---- Pestaña Entregas: equipo serializado ----
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
  const unit = deliverUnitAvailable.value.find((u) => u.id === deliverUnitId.value);
  const technician = technicians.value.find((t) => t.id === deliverUnitTechnicianId.value);
  const ok = await confirmDialog({
    title: 'Confirmar entrega de equipo',
    message: `Se entregará el equipo ${unit?.serial_number || unit?.mac_address || ''} a ${technician?.full_name || technician?.email || 'el técnico seleccionado'}. Quedará en su custodia hasta que lo instale o lo devuelva.`,
  });
  if (!ok) return;
  savingDeliverUnit.value = true;
  try {
    await custodyStore.deliverUnitToTechnician(deliverUnitId.value, deliverUnitTechnicianId.value, deliverUnitReason.value.trim() || undefined);
    toast.success('Equipo entregado al técnico.');
    deliverUnitId.value = '';
    deliverUnitReason.value = '';
    await onDeliverUnitProductChange();
    await loadAll();
  } catch (e) {
    toast.error(getErrorMessage(e, 'No se pudo entregar el equipo'));
  } finally {
    savingDeliverUnit.value = false;
  }
}

// ---- Pestaña Entregas: material consumible ----
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
  const product = inventoryStore.products.find((p) => p.id === deliverMaterialProductId.value);
  const technician = technicians.value.find((t) => t.id === deliverMaterialTechnicianId.value);
  const ok = await confirmDialog({
    title: 'Confirmar entrega de material',
    message: `Se entregarán ${deliverMaterialQty.value} ${product?.unit ?? ''} de ${product?.name ?? ''} a ${technician?.full_name || technician?.email || 'el técnico seleccionado'}. Esto no descuenta el almacén central — solo se descuenta cuando el técnico lo use en una orden real.`,
  });
  if (!ok) return;
  savingDeliverMaterial.value = true;
  try {
    await custodyStore.deliverMaterialToTechnician(deliverMaterialTechnicianId.value, deliverMaterialProductId.value, deliverMaterialQty.value, deliverMaterialReason.value.trim() || undefined);
    toast.success('Material entregado al técnico.');
    deliverMaterialQty.value = null;
    deliverMaterialReason.value = '';
    await loadAll();
  } catch (e) {
    toast.error(getErrorMessage(e, 'No se pudo entregar el material'));
  } finally {
    savingDeliverMaterial.value = false;
  }
}

const serializedProducts = computed(() => inventoryStore.products.filter((p) => p.is_serialized));
const consumableProducts = computed(() => inventoryStore.products.filter((p) => !p.is_serialized));

// ---- Pestaña Devoluciones ----
async function handleReceiveUnit(unit: InventoryUnit, condition: 'in_stock' | 'damaged' | 'in_repair') {
  const label = condition === 'in_stock' ? 'de vuelta al almacén (en buen estado)' : condition === 'in_repair' ? 'como pendiente de reparación' : 'como dañado';
  const ok = await confirmDialog({ title: 'Confirmar recepción', message: `¿Registrar este equipo ${label}?` });
  if (!ok) return;
  try {
    await custodyStore.receiveUnitReturn(unit.id, condition);
    toast.success('Devolución recibida.');
    await loadAll();
  } catch (e) {
    toast.error(getErrorMessage(e, 'No se pudo confirmar la recepción'));
  }
}

async function handleMaterialReturnDecision(request: TechnicianMaterialReturnRequest, approved: boolean) {
  const ok = await confirmDialog({
    title: approved ? 'Confirmar devolución' : 'Rechazar devolución',
    message: approved
      ? `¿Confirmar que se recibió ${request.quantity} ${request.product?.unit ?? ''} de ${request.product?.name ?? ''}?`
      : '¿Rechazar esta solicitud de devolución? El material seguirá en custodia del técnico.',
    danger: !approved,
  });
  if (!ok) return;
  try {
    await custodyStore.confirmMaterialReturn(request.id, approved);
    toast.success(approved ? 'Devolución confirmada.' : 'Devolución rechazada.');
    await loadAll();
  } catch (e) {
    toast.error(getErrorMessage(e, 'No se pudo resolver la solicitud'));
  }
}

// ---- Pestaña Conciliación: busqueda + paginacion local ----
const reconciliationQuery = ref('');
const reconciliationPage = ref(1);
const RECONCILIATION_PAGE_SIZE = 10;
const filteredSummary = computed(() => {
  const q = reconciliationQuery.value.trim().toLowerCase();
  if (!q) return summary.value;
  return summary.value.filter((row) => row.product_name.toLowerCase().includes(q));
});
const reconciliationPageCount = computed(() => Math.max(1, Math.ceil(filteredSummary.value.length / RECONCILIATION_PAGE_SIZE)));
const pagedSummary = computed(() => {
  const start = (reconciliationPage.value - 1) * RECONCILIATION_PAGE_SIZE;
  return filteredSummary.value.slice(start, start + RECONCILIATION_PAGE_SIZE);
});
function resetReconciliationPage() { reconciliationPage.value = 1; }

onMounted(loadAll);
</script>

<template>
  <AppLayout>
    <!-- Encabezado compacto -->
    <div class="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div>
        <h1 class="text-2xl font-semibold">Custodia de técnicos</h1>
        <p class="text-sm text-slate-500 mt-0.5">Equipos y materiales entregados a técnicos, aún no instalados ni consumidos.</p>
      </div>
      <div class="flex gap-2">
        <button type="button" class="btn-secondary text-sm" :disabled="loading" @click="loadAll">
          {{ loading ? 'Actualizando...' : '↻ Actualizar' }}
        </button>
        <router-link to="/inventario" class="btn-secondary text-sm">← Inventario</router-link>
      </div>
    </div>

    <p v-if="loadError" class="mb-4 text-sm text-red-600">{{ loadError }}</p>
    <p v-if="loading" class="text-center text-slate-500 py-10">Cargando...</p>

    <template v-else>
      <!-- Indicadores superiores -->
      <div class="grid gap-4 mb-5" style="grid-template-columns: repeat(auto-fit, minmax(190px, 1fr))">
        <div class="surface p-4">
          <div class="text-2xl font-semibold">{{ kpis.equiposEnCustodia }}</div>
          <div class="text-xs text-slate-500 mt-1">Equipos en custodia</div>
        </div>
        <div class="surface p-4">
          <div class="text-2xl font-semibold">{{ kpis.productosEnCustodiaMaterial }}</div>
          <div class="text-xs text-slate-500 mt-1">Materiales bajo custodia <span class="text-slate-400">(productos distintos)</span></div>
        </div>
        <div class="surface p-4">
          <div class="text-2xl font-semibold" :class="kpis.devolucionesPendientes ? 'text-amber-600' : ''">{{ kpis.devolucionesPendientes }}</div>
          <div class="text-xs text-slate-500 mt-1">Devoluciones pendientes</div>
        </div>
      </div>

      <!-- Pestañas -->
      <div class="flex gap-1 border-b border-slate-200 mb-4 flex-wrap">
        <button
          v-for="tab in TABS"
          :key="tab.value"
          type="button"
          class="px-3 py-2 text-sm font-medium border-b-2 -mb-px"
          :class="activeTab === tab.value ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-700'"
          @click="activeTab = tab.value"
        >
          {{ tab.label }}
          <span v-if="tab.value === 'devoluciones' && kpis.devolucionesPendientes" class="badge bg-amber-500/15 text-amber-700 text-[10px] ml-1">{{ kpis.devolucionesPendientes }}</span>
        </button>
      </div>

      <!-- ===== Técnicos ===== -->
      <section v-if="activeTab === 'tecnicos'" class="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <div class="surface p-3">
          <h2 class="text-sm font-semibold mb-2 px-1">Técnicos con custodia</h2>
          <p v-if="!technicianRows.length" class="text-xs text-slate-500 px-1">No hay técnicos activos.</p>
          <div class="flex flex-col gap-1 max-h-[70vh] overflow-y-auto">
            <button
              v-for="t in technicianRows"
              :key="t.id"
              type="button"
              class="text-left rounded-lg px-3 py-2.5 transition-colors"
              :class="selectedTechnicianId === t.id ? 'bg-sky-50 border border-sky-200' : 'hover:bg-slate-50 border border-transparent'"
              @click="selectTechnician(t.id)"
            >
              <div class="text-sm font-medium text-slate-900">{{ t.full_name || t.email }}</div>
              <div class="text-xs text-slate-500 mt-0.5">
                {{ t.units.length }} equipo{{ t.units.length === 1 ? '' : 's' }} · {{ t.materials.length }} material{{ t.materials.length === 1 ? '' : 'es' }}
              </div>
            </button>
          </div>
        </div>

        <div class="surface p-4">
          <template v-if="!selectedTechnician">
            <p class="text-sm text-slate-500 py-8 text-center">Selecciona un técnico de la lista para ver el detalle de su custodia.</p>
          </template>
          <template v-else>
            <h2 class="text-base font-semibold mb-3">{{ selectedTechnician.full_name || selectedTechnician.email }}</h2>

            <h3 class="text-xs font-semibold text-slate-500 uppercase mb-2">Equipos serializados</h3>
            <p v-if="!selectedTechnician.units.length" class="text-xs text-slate-500 mb-4">Sin equipos en custodia.</p>
            <div v-else class="table-shell overflow-x-auto mb-4">
              <table class="w-full text-sm min-w-[480px]">
                <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
                  <tr>
                    <th class="text-left px-3 py-2">Equipo</th>
                    <th class="text-left px-3 py-2">Serie / MAC</th>
                    <th class="text-left px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="u in selectedTechnician.units" :key="u.id" class="border-t border-slate-200">
                    <td class="px-3 py-2">{{ u.product?.name }}</td>
                    <td class="px-3 py-2 font-mono text-xs">{{ u.serial_number || u.mac_address }}</td>
                    <td class="px-3 py-2">
                      <span class="badge text-[10px]" :class="u.status === 'pending_return' ? 'bg-amber-500/15 text-amber-700' : 'bg-indigo-500/15 text-indigo-700'">
                        {{ u.status === 'pending_return' ? 'Devolución en espera' : 'En custodia' }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 class="text-xs font-semibold text-slate-500 uppercase mb-2">Materiales</h3>
            <p v-if="!selectedTechnician.materials.length" class="text-xs text-slate-500">Sin materiales en custodia.</p>
            <div v-else class="table-shell overflow-x-auto">
              <table class="w-full text-sm min-w-[360px]">
                <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
                  <tr>
                    <th class="text-left px-3 py-2">Material</th>
                    <th class="text-right px-3 py-2">Cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="m in selectedTechnician.materials" :key="m.product_id" class="border-t border-slate-200">
                    <td class="px-3 py-2">{{ m.product?.name }}</td>
                    <td class="px-3 py-2 text-right">{{ m.quantity }} {{ m.product?.unit }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>
      </section>

      <!-- ===== Entregas ===== -->
      <section v-else-if="activeTab === 'entregas'" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="surface p-4">
          <h2 class="text-sm font-semibold mb-3">Entregar equipo a un técnico</h2>
          <div class="space-y-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Producto serializado</label>
              <select v-model="deliverUnitProductId" class="field-input" @change="onDeliverUnitProductChange">
                <option value="">Selecciona un producto...</option>
                <option v-for="p in serializedProducts" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
            </div>
            <div v-if="deliverUnitProductId">
              <label class="block text-xs text-slate-600 mb-1">Equipo disponible en almacén</label>
              <select v-model="deliverUnitId" class="field-input">
                <option value="">Selecciona un equipo...</option>
                <option v-for="u in deliverUnitAvailable" :key="u.id" :value="u.id">{{ u.serial_number || u.mac_address }}</option>
              </select>
              <p v-if="!deliverUnitAvailable.length" class="text-xs text-amber-600 mt-1">No hay equipos en almacén de este producto.</p>
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Técnico que recibe</label>
              <select v-model="deliverUnitTechnicianId" class="field-input">
                <option value="">Selecciona un técnico...</option>
                <option v-for="t in technicians" :key="t.id" :value="t.id">{{ t.full_name || t.email }}</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Motivo (opcional)</label>
              <input v-model="deliverUnitReason" placeholder="Ej. para instalación de esta semana" class="field-input" />
            </div>
            <button type="button" class="btn-primary text-sm w-full" :disabled="savingDeliverUnit" @click="handleDeliverUnit">
              {{ savingDeliverUnit ? 'Entregando...' : 'Entregar equipo' }}
            </button>
          </div>
        </div>

        <div class="surface p-4">
          <h2 class="text-sm font-semibold mb-3">Entregar material a un técnico</h2>
          <div class="space-y-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Material</label>
              <select v-model="deliverMaterialProductId" class="field-input">
                <option value="">Selecciona un material...</option>
                <option v-for="p in consumableProducts" :key="p.id" :value="p.id">{{ p.name }} ({{ p.unit }})</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Técnico que recibe</label>
              <select v-model="deliverMaterialTechnicianId" class="field-input">
                <option value="">Selecciona un técnico...</option>
                <option v-for="t in technicians" :key="t.id" :value="t.id">{{ t.full_name || t.email }}</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Cantidad</label>
              <input v-model.number="deliverMaterialQty" type="number" min="0" step="0.01" placeholder="0.00" class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Motivo (opcional)</label>
              <input v-model="deliverMaterialReason" placeholder="Ej. para la semana" class="field-input" />
            </div>
            <button type="button" class="btn-primary text-sm w-full" :disabled="savingDeliverMaterial" @click="handleDeliverMaterial">
              {{ savingDeliverMaterial ? 'Entregando...' : 'Entregar material' }}
            </button>
          </div>
        </div>
      </section>

      <!-- ===== Devoluciones ===== -->
      <section v-else-if="activeTab === 'devoluciones'" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="surface p-4">
          <h2 class="text-sm font-semibold mb-3">Equipos — pendientes de recibir</h2>
          <p v-if="!pendingUnitReturns.length" class="text-xs text-slate-500">Sin solicitudes pendientes.</p>
          <div v-for="u in pendingUnitReturns" :key="u.id" class="border-t border-slate-100 pt-3 mt-3 first:border-t-0 first:pt-0 first:mt-0">
            <p class="text-sm font-medium">{{ u.product?.name }}</p>
            <p class="text-xs text-slate-500 mb-2 font-mono">{{ u.serial_number || u.mac_address }}</p>
            <div class="flex gap-1.5 flex-wrap">
              <button type="button" class="btn-secondary text-xs" @click="handleReceiveUnit(u, 'in_stock')">Recibir OK</button>
              <button type="button" class="btn-secondary text-xs !text-amber-700" @click="handleReceiveUnit(u, 'in_repair')">En reparación</button>
              <button type="button" class="btn-secondary text-xs !text-red-700" @click="handleReceiveUnit(u, 'damaged')">Dañado</button>
            </div>
          </div>
        </div>

        <div class="surface p-4">
          <h2 class="text-sm font-semibold mb-3">Materiales — pendientes de confirmar</h2>
          <p v-if="!pendingMaterialRequests.length" class="text-xs text-slate-500">Sin solicitudes pendientes.</p>
          <div v-for="r in pendingMaterialRequests" :key="r.id" class="border-t border-slate-100 pt-3 mt-3 first:border-t-0 first:pt-0 first:mt-0">
            <p class="text-sm font-medium">{{ r.technician?.full_name || r.technician?.email }}</p>
            <p class="text-xs text-slate-500">{{ r.quantity }} {{ r.product?.unit }} de {{ r.product?.name }}</p>
            <p class="text-xs text-slate-400 mb-2">{{ r.reason }}</p>
            <div class="flex gap-1.5">
              <button type="button" class="btn-secondary text-xs" @click="handleMaterialReturnDecision(r, true)">Confirmar</button>
              <button type="button" class="btn-secondary text-xs !text-red-700" @click="handleMaterialReturnDecision(r, false)">Rechazar</button>
            </div>
          </div>
        </div>
      </section>

      <!-- ===== Conciliación ===== -->
      <section v-else class="surface p-4">
        <h2 class="text-base font-semibold mb-1">Almacén vs. custodia vs. instalado</h2>
        <p class="text-xs text-slate-500 mb-3">
          Conteos reales del sistema. Si el físico no coincide con "En almacén", corrígelo con un ajuste administrativo aparte —
          esta tabla no inventa ni descuenta diferencias automáticamente.
        </p>
        <input
          v-model="reconciliationQuery"
          placeholder="Buscar producto..."
          class="field-input mb-3 max-w-sm"
          @input="resetReconciliationPage"
        />
        <div class="table-shell overflow-x-auto">
          <table class="w-full text-sm min-w-[720px]">
            <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
              <tr>
                <th class="text-left px-3 py-2">Producto</th>
                <th class="text-right px-3 py-2">En almacén</th>
                <th class="text-right px-3 py-2">En custodia</th>
                <th class="text-right px-3 py-2">Instalado</th>
                <th class="text-left px-3 py-2">Custodia por técnico</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!pagedSummary.length">
                <td colspan="5" class="px-3 py-6 text-center text-slate-500">Sin productos que coincidan.</td>
              </tr>
              <tr v-for="row in pagedSummary" :key="row.product_id" class="border-t border-slate-200">
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
        <div v-if="reconciliationPageCount > 1" class="flex items-center justify-between mt-3 text-xs text-slate-600">
          <span>Página {{ reconciliationPage }} de {{ reconciliationPageCount }} · {{ filteredSummary.length }} productos</span>
          <div class="flex gap-1.5">
            <button type="button" class="btn-secondary text-xs" :disabled="reconciliationPage <= 1" @click="reconciliationPage--">← Anterior</button>
            <button type="button" class="btn-secondary text-xs" :disabled="reconciliationPage >= reconciliationPageCount" @click="reconciliationPage++">Siguiente →</button>
          </div>
        </div>
      </section>
    </template>
  </AppLayout>
</template>
