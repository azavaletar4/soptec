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
import { computed, onMounted, ref, watch } from 'vue';
import { chooseCustodyTechnician, currentCustodyDelivery, custodyEquipmentLocation, shortfallReasonLabel } from '@/lib/technicianCustodyPresentation';
import { classifyShortfallRecency } from '@/lib/materialCustodyShortfall';
import { formatPeruDateTime } from '@/lib/oltAlertPresentation';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useInventoryStore } from '@/stores/inventory';
import { useInventoryUnitsStore } from '@/stores/inventoryUnits';
import { useCatalogsStore } from '@/stores/catalogs';
import { useTechnicianCustodyStore } from '@/stores/technicianCustody';
import { useToast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';
import { getErrorMessage } from '@/lib/errors';
import type { InventoryCustodySummaryRow, InventoryUnit, InventoryUnitEvent, TechnicianMaterialReturnRequest } from '@/types/domain';

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
    selectedTechnicianId.value = chooseCustodyTechnician(selectedTechnicianId.value, technicianRows.value);
    await loadTechnicianHistory();
  } catch (e) {
    loadError.value = getErrorMessage(e, 'No se pudo cargar la custodia de técnicos');
  } finally {
    loading.value = false;
  }
  // Independiente del resto (su propio loading/error) -- un fallo aqui no debe
  // tapar el resto de la pantalla, y el conteo debe verse en el resumen
  // superior sin obligar a entrar a la pestaña Conciliación.
  void loadShortfalls();
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
  selectedTechnicianId.value = id;
}

const unitEvents = ref<Record<string, InventoryUnitEvent[]>>({});
const history = ref<Awaited<ReturnType<typeof custodyStore.fetchTechnicianHistory>> | null>(null);
const historyLoading = ref(false);
const historyError = ref<string | null>(null);
let historyRequest = 0;
async function loadTechnicianHistory() {
  const request = ++historyRequest;
  const technician = selectedTechnician.value;
  history.value = null;
  unitEvents.value = {};
  historyError.value = null;
  historyLoading.value = !!technician;
  if (!technician) return;
  try {
    const [result, events] = await Promise.all([
      custodyStore.fetchTechnicianHistory(technician.id),
      Promise.all(technician.units.map(async unit => [unit.id, await inventoryUnitsStore.fetchEvents(unit.id)] as const)),
    ]);
    if (request !== historyRequest) return;
    history.value = result;
    unitEvents.value = Object.fromEntries(events);
  } catch (e) {
    if (request === historyRequest) historyError.value = getErrorMessage(e, 'No se pudo cargar el historial');
  } finally {
    if (request === historyRequest) historyLoading.value = false;
  }
}
watch(selectedTechnicianId, () => { if (!loading.value) void loadTechnicianHistory(); });
function deliveryFor(unit: InventoryUnit) { return currentCustodyDelivery(unit, unitEvents.value[unit.id] ?? []); }
function eventLabel(event: InventoryUnitEvent) {
  if (event.to_status === 'with_technician') return 'Entrega a técnico';
  if (event.to_status === 'pending_return') return 'Solicitud de devolución';
  if (['in_stock', 'damaged', 'in_repair'].includes(event.to_status)) return 'Devolución recibida';
  return `Cambio de custodia: ${event.from_status ?? 'sin estado previo'} → ${event.to_status}`;
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

// ---- Pestaña Conciliación: tabla "Almacen vs. custodia vs. instalado" —
// busqueda + filtro + orden + paginacion, todo local (los datos ya estan
// cargados por inventory_custody_summary(), sin consulta nueva). ----
const reconciliationQuery = ref('');
type ReconciliationFilter = 'todos' | 'con_custodia' | 'sin_almacen';
const RECONCILIATION_FILTERS: { value: ReconciliationFilter; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'con_custodia', label: 'Con custodia asignada' },
  { value: 'sin_almacen', label: 'Sin existencias en almacén' },
];
const reconciliationFilter = ref<ReconciliationFilter>('todos');
type ReconciliationSortKey = 'product_name' | 'warehouse_qty' | 'custody_qty' | 'installed_qty';
const reconciliationSort = ref<{ key: ReconciliationSortKey; dir: 'asc' | 'desc' }>({ key: 'product_name', dir: 'asc' });
function toggleReconciliationSort(key: ReconciliationSortKey) {
  reconciliationSort.value = reconciliationSort.value.key === key
    ? { key, dir: reconciliationSort.value.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: key === 'product_name' ? 'asc' : 'desc' }; // numericas: lo mas grande primero por defecto, mas util para encontrar algo
  resetReconciliationPage();
}
const filteredSummary = computed(() => {
  const q = reconciliationQuery.value.trim().toLowerCase();
  let rows = summary.value;
  if (q) rows = rows.filter((row) => row.product_name.toLowerCase().includes(q));
  if (reconciliationFilter.value === 'con_custodia') rows = rows.filter((row) => row.custody_qty > 0);
  else if (reconciliationFilter.value === 'sin_almacen') rows = rows.filter((row) => row.warehouse_qty <= 0);
  const { key, dir } = reconciliationSort.value;
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key]; const bv = b[key];
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return cmp * sign;
  });
});
const reconciliationPage = ref(1);
const reconciliationPageSize = ref(10);
const reconciliationPageCount = computed(() => Math.max(1, Math.ceil(filteredSummary.value.length / reconciliationPageSize.value)));
const pagedSummary = computed(() => {
  const start = (reconciliationPage.value - 1) * reconciliationPageSize.value;
  return filteredSummary.value.slice(start, start + reconciliationPageSize.value);
});
function resetReconciliationPage() { reconciliationPage.value = 1; }

// ---- Pestaña Conciliación: advertencias de consumo sin custodia (Fase 165,
// etapa 1 — solo lectura, nunca bloquea). Se carga junto al resto en loadAll
// (dataset chico, confirmado: <300 movimientos en produccion) para que el
// resumen superior muestre el conteo real sin obligar a entrar a la pestaña. ----
type MaterialShortfallRow = Awaited<ReturnType<typeof custodyStore.fetchMaterialCustodyShortfalls>>[number];
const materialShortfalls = ref<MaterialShortfallRow[]>([]);
const shortfallsLoading = ref(false);
const shortfallsError = ref<string | null>(null);
const showShortfallInfo = ref(false);
async function loadShortfalls() {
  shortfallsLoading.value = true;
  shortfallsError.value = null;
  try {
    materialShortfalls.value = await custodyStore.fetchMaterialCustodyShortfalls();
  } catch (e) {
    shortfallsError.value = getErrorMessage(e, 'No se pudo calcular la conciliación de consumo de material');
  } finally {
    shortfallsLoading.value = false;
  }
}
// Prioridad visual (punto 2): separados siempre, "Nuevos" primero y nunca
// paginado (si aparece uno, se espera que se revise ya); "Históricos" es un
// backlog que puede ser grande (158 casos reales confirmados) y se pagina.
const shortfallsNuevos = computed(() => materialShortfalls.value.filter((s) => classifyShortfallRecency(s.consumedAt) === 'nuevo'));
const shortfallsHistoricos = computed(() => materialShortfalls.value.filter((s) => classifyShortfallRecency(s.consumedAt) === 'historico'));
const historicosPage = ref(1);
const HISTORICOS_PAGE_SIZE = 10;
const historicosPageCount = computed(() => Math.max(1, Math.ceil(shortfallsHistoricos.value.length / HISTORICOS_PAGE_SIZE)));
const pagedHistoricos = computed(() => {
  const start = (historicosPage.value - 1) * HISTORICOS_PAGE_SIZE;
  return shortfallsHistoricos.value.slice(start, start + HISTORICOS_PAGE_SIZE);
});
function shortfallMotivo(row: MaterialShortfallRow) { return shortfallReasonLabel(row); }

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
        <button
          type="button"
          class="surface p-4 text-left transition-colors hover:bg-slate-50"
          :class="shortfallsNuevos.length ? 'ring-1 ring-red-200' : ''"
          @click="activeTab = 'conciliacion'"
        >
          <div class="flex items-baseline gap-2">
            <span class="text-2xl font-semibold" :class="shortfallsNuevos.length ? 'text-red-600' : 'text-slate-900'">
              {{ shortfallsLoading ? '…' : shortfallsNuevos.length }}
            </span>
            <span v-if="!shortfallsLoading && shortfallsHistoricos.length" class="text-xs text-slate-400">+ {{ shortfallsHistoricos.length }} históricos</span>
          </div>
          <div class="text-xs text-slate-500 mt-1">Consumos sin custodia suficiente</div>
        </button>
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
                    <td class="px-3 py-2 text-xs">
                      <router-link :to="custodyEquipmentLocation(u.product_id, u.id)" class="font-mono text-sky-700 underline">{{ u.serial_number || u.mac_address || 'Ver equipo' }}</router-link>
                      <p class="text-slate-500 mt-1">Entrega: {{ historyLoading ? 'Cargando...' : deliveryFor(u) ? formatPeruDateTime(deliveryFor(u)!.created_at) + ' (Perú)' : 'Fecha no disponible' }}</p>
                      <p class="text-slate-500">Por: {{ deliveryFor(u)?.author?.full_name || deliveryFor(u)?.author?.email || 'Responsable no disponible' }}</p>
                    </td>
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
            <details class="mt-5 border-t pt-3">
              <summary class="cursor-pointer text-sm font-semibold">Historial de custodia de este técnico</summary>
              <p class="text-xs text-slate-500 my-2">Últimos 100 registros de equipos y 100 de materiales. Son movimientos históricos; la custodia vigente se muestra arriba. Horario de Perú.</p>
              <p v-if="historyLoading" class="text-sm">Cargando historial...</p>
              <p v-else-if="historyError" class="text-sm text-red-600">{{ historyError }} <button class="underline" @click="loadTechnicianHistory">Reintentar</button></p>
              <template v-else-if="history">
                <p v-if="!history.units.length && !history.materials.length" class="text-sm text-slate-500">Sin movimientos de custodia registrados.</p>
                <ul class="space-y-3 text-xs">
                  <li v-for="event in history.units" :key="event.id" class="border-l-2 pl-3">
                    <strong>{{ eventLabel(event) }}</strong> · {{ formatPeruDateTime(event.created_at) }} (Perú)
                    <router-link v-if="event.equipment" :to="custodyEquipmentLocation(event.equipment.product_id, event.equipment.id)" class="block text-sky-700 underline">{{ event.equipment.serial_number || event.equipment.mac_address || 'Ver equipo' }}</router-link>
                    <p>Registrado por: {{ event.author?.full_name || event.author?.email || 'Responsable no disponible' }}</p>
                    <p v-if="event.reason">{{ event.reason }}</p>
                  </li>
                  <li v-for="event in history.materials" :key="event.id" class="border-l-2 pl-3">
                    <strong>{{ event.event_type === 'delivery' ? 'Entrega de material' : 'Devolución de material' }}</strong> · {{ formatPeruDateTime(event.created_at) }} (Perú)
                    <p>{{ event.product?.name || 'Producto no disponible' }}: {{ event.quantity }} {{ event.product?.unit }}</p>
                    <p>Registrado por: {{ event.author?.full_name || event.author?.email || 'Responsable no disponible' }}</p>
                    <p v-if="event.reason">{{ event.reason }}</p>
                  </li>
                </ul>
              </template>
            </details>
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
      <section v-else class="flex flex-col gap-4">
        <div class="surface p-4">
          <div class="flex items-start justify-between gap-2 mb-2">
            <h2 class="text-base font-semibold">⚠️ Consumo sin custodia suficiente</h2>
          </div>
          <p class="text-xs text-slate-500 mb-1">
            Solo lectura, no bloquea ni corrige nada —
            <button type="button" class="text-sky-700 underline" @click="showShortfallInfo = !showShortfallInfo">{{ showShortfallInfo ? 'ocultar' : 'qué significa' }}</button>
          </p>
          <p v-if="showShortfallInfo" class="text-xs text-slate-500 mb-3 max-w-2xl">
            Señala consumos donde el sistema nunca registró una entrega formal suficiente a ese técnico antes de
            liquidarlo. <strong>No es prueba de pérdida física</strong> — lo más frecuente es que la entrega nunca
            se formalizó en este panel.
          </p>

          <p v-if="shortfallsLoading" class="text-sm text-slate-500 py-4 text-center">Calculando...</p>
          <p v-else-if="shortfallsError" class="text-sm text-red-600">{{ shortfallsError }} <button class="underline" @click="loadShortfalls">Reintentar</button></p>

          <template v-else>
            <!-- Nuevos: prioridad visual, siempre a la vista, nunca paginado -->
            <div class="mb-4">
              <h3 class="text-xs font-semibold uppercase mb-2" :class="shortfallsNuevos.length ? 'text-red-700' : 'text-slate-400'">
                Nuevos ({{ shortfallsNuevos.length }})
              </h3>
              <p v-if="!shortfallsNuevos.length" class="text-xs text-slate-500">Sin consumos nuevos sin custodia desde que se activó esta detección.</p>
              <template v-else>
                <div class="flex flex-col gap-2 sm:hidden">
                  <div v-for="row in shortfallsNuevos" :key="row.movementId" class="rounded-lg border border-red-200 bg-red-50/50 p-3">
                    <div class="flex items-start justify-between gap-2 mb-1">
                      <span class="font-medium text-slate-900">{{ row.technicianName }}</span>
                      <span class="text-xs text-slate-500 whitespace-nowrap">{{ formatPeruDateTime(row.consumedAt) }}</span>
                    </div>
                    <div class="text-sm text-slate-700">{{ row.quantity }} {{ row.unit }} de {{ row.productName }}</div>
                    <div class="text-xs text-slate-600 mt-1">{{ row.reason || 'Sin motivo registrado' }}</div>
                    <div class="text-xs text-slate-400">{{ shortfallMotivo(row) }}</div>
                    <router-link v-if="row.jobPath" :to="row.jobPath" class="text-xs text-sky-700 underline">{{ row.jobLabel }}</router-link>
                    <span v-else class="text-xs text-slate-500">{{ row.jobLabel }}</span>
                  </div>
                </div>
                <div class="table-shell overflow-x-auto hidden sm:block">
                  <table class="w-full text-sm min-w-[720px]">
                    <thead class="bg-red-50 text-red-700 text-xs uppercase">
                      <tr>
                        <th class="text-left px-3 py-2">Técnico</th>
                        <th class="text-left px-3 py-2">Material</th>
                        <th class="text-left px-3 py-2">Motivo</th>
                        <th class="text-left px-3 py-2">Orden</th>
                        <th class="text-left px-3 py-2">Fecha (Perú)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="row in shortfallsNuevos" :key="row.movementId" class="border-t border-red-100">
                        <td class="px-3 py-2">{{ row.technicianName }}</td>
                        <td class="px-3 py-2 whitespace-nowrap">{{ row.quantity }} {{ row.unit }} <span class="text-slate-400">de {{ row.productName }}</span></td>
                        <td class="px-3 py-2 text-xs">
                          <div>{{ row.reason || 'Sin motivo registrado' }}</div>
                          <div class="text-slate-400">{{ shortfallMotivo(row) }}</div>
                        </td>
                        <td class="px-3 py-2 text-xs">
                          <router-link v-if="row.jobPath" :to="row.jobPath" class="text-sky-700 underline">{{ row.jobLabel }}</router-link>
                          <span v-else>{{ row.jobLabel }}</span>
                        </td>
                        <td class="px-3 py-2 text-xs whitespace-nowrap">{{ formatPeruDateTime(row.consumedAt) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </template>
            </div>

            <!-- Históricos: backlog grande (158 casos reales confirmados), colapsado y paginado -->
            <details class="border-t border-slate-100 pt-3">
              <summary class="cursor-pointer text-xs font-semibold uppercase text-slate-500">
                Históricos ({{ shortfallsHistoricos.length }})
              </summary>
              <p class="text-xs text-slate-500 my-2">Ocurrieron antes de activar esta detección — quedan de referencia, no requieren acción inmediata.</p>
              <p v-if="!shortfallsHistoricos.length" class="text-xs text-slate-500">Sin hallazgos históricos.</p>
              <template v-else>
                <div class="flex flex-col gap-2 sm:hidden">
                  <div v-for="row in pagedHistoricos" :key="row.movementId" class="rounded-lg border border-slate-200 p-3">
                    <div class="flex items-start justify-between gap-2 mb-1">
                      <span class="font-medium text-slate-900">{{ row.technicianName }}</span>
                      <span class="text-xs text-slate-500 whitespace-nowrap">{{ formatPeruDateTime(row.consumedAt) }}</span>
                    </div>
                    <div class="text-sm text-slate-700">{{ row.quantity }} {{ row.unit }} de {{ row.productName }}</div>
                    <div class="text-xs text-slate-600 mt-1">{{ row.reason || 'Sin motivo registrado' }}</div>
                    <div class="text-xs text-slate-400">{{ shortfallMotivo(row) }}</div>
                    <router-link v-if="row.jobPath" :to="row.jobPath" class="text-xs text-sky-700 underline">{{ row.jobLabel }}</router-link>
                    <span v-else class="text-xs text-slate-500">{{ row.jobLabel }}</span>
                  </div>
                </div>
                <div class="table-shell overflow-x-auto hidden sm:block">
                  <table class="w-full text-sm min-w-[720px]">
                    <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
                      <tr>
                        <th class="text-left px-3 py-2">Técnico</th>
                        <th class="text-left px-3 py-2">Material</th>
                        <th class="text-left px-3 py-2">Motivo</th>
                        <th class="text-left px-3 py-2">Orden</th>
                        <th class="text-left px-3 py-2">Fecha (Perú)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="row in pagedHistoricos" :key="row.movementId" class="border-t border-slate-200">
                        <td class="px-3 py-2">{{ row.technicianName }}</td>
                        <td class="px-3 py-2 whitespace-nowrap">{{ row.quantity }} {{ row.unit }} <span class="text-slate-400">de {{ row.productName }}</span></td>
                        <td class="px-3 py-2 text-xs">
                          <div>{{ row.reason || 'Sin motivo registrado' }}</div>
                          <div class="text-slate-400">{{ shortfallMotivo(row) }}</div>
                        </td>
                        <td class="px-3 py-2 text-xs">
                          <router-link v-if="row.jobPath" :to="row.jobPath" class="text-sky-700 underline">{{ row.jobLabel }}</router-link>
                          <span v-else>{{ row.jobLabel }}</span>
                        </td>
                        <td class="px-3 py-2 text-xs whitespace-nowrap">{{ formatPeruDateTime(row.consumedAt) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div v-if="historicosPageCount > 1" class="flex flex-wrap items-center justify-between gap-2 mt-2 text-xs text-slate-600">
                  <span>{{ (historicosPage - 1) * HISTORICOS_PAGE_SIZE + 1 }}–{{ Math.min(historicosPage * HISTORICOS_PAGE_SIZE, shortfallsHistoricos.length) }} de {{ shortfallsHistoricos.length }}</span>
                  <div class="flex gap-1.5">
                    <button type="button" class="btn-secondary text-xs" :disabled="historicosPage <= 1" @click="historicosPage--">← Anterior</button>
                    <button type="button" class="btn-secondary text-xs" :disabled="historicosPage >= historicosPageCount" @click="historicosPage++">Siguiente →</button>
                  </div>
                </div>
              </template>
            </details>
          </template>
        </div>

        <div class="surface p-4">
          <h2 class="text-base font-semibold mb-2">Almacén vs. custodia vs. instalado</h2>
          <div class="flex flex-wrap items-end gap-2 mb-3">
            <input
              v-model="reconciliationQuery"
              placeholder="Buscar producto..."
              class="field-input max-w-[220px]"
              @input="resetReconciliationPage"
            />
            <select v-model="reconciliationFilter" class="field-input max-w-[200px]" @change="resetReconciliationPage">
              <option v-for="f in RECONCILIATION_FILTERS" :key="f.value" :value="f.value">{{ f.label }}</option>
            </select>
            <select v-model.number="reconciliationPageSize" class="field-input max-w-[110px]" @change="resetReconciliationPage">
              <option :value="10">10 / pág.</option>
              <option :value="25">25 / pág.</option>
              <option :value="50">50 / pág.</option>
            </select>
          </div>

          <div class="flex flex-col gap-2 sm:hidden">
            <p v-if="!pagedSummary.length" class="text-sm text-slate-500 text-center py-4">Sin productos que coincidan.</p>
            <div v-for="row in pagedSummary" :key="row.product_id" class="rounded-lg border border-slate-200 p-3">
              <div class="font-medium text-slate-900 mb-1.5">{{ row.product_name }} <span class="text-slate-400 text-xs">({{ row.unit }})</span></div>
              <div class="grid grid-cols-3 gap-2 text-xs text-slate-600 mb-1.5">
                <div><span class="text-slate-400 block">Almacén</span>{{ row.warehouse_qty }}</div>
                <div><span class="text-slate-400 block">Custodia</span>{{ row.custody_qty }}</div>
                <div><span class="text-slate-400 block">Instalado</span>{{ row.installed_qty ?? '—' }}</div>
              </div>
              <div v-if="Object.keys(row.custody_by_technician).length" class="text-xs text-slate-500">
                <span v-for="(qty, name) in row.custody_by_technician" :key="name" class="mr-2">{{ name }}: {{ qty }}</span>
              </div>
            </div>
          </div>

          <div class="table-shell overflow-x-auto hidden sm:block">
            <table class="w-full text-sm min-w-[720px]">
              <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
                <tr>
                  <th class="text-left px-3 py-2">
                    <button type="button" class="inline-flex items-center gap-1" @click="toggleReconciliationSort('product_name')">
                      Producto <span v-if="reconciliationSort.key === 'product_name'">{{ reconciliationSort.dir === 'asc' ? '↑' : '↓' }}</span>
                    </button>
                  </th>
                  <th class="text-right px-3 py-2">
                    <button type="button" class="inline-flex items-center gap-1" @click="toggleReconciliationSort('warehouse_qty')">
                      En almacén <span v-if="reconciliationSort.key === 'warehouse_qty'">{{ reconciliationSort.dir === 'asc' ? '↑' : '↓' }}</span>
                    </button>
                  </th>
                  <th class="text-right px-3 py-2">
                    <button type="button" class="inline-flex items-center gap-1" @click="toggleReconciliationSort('custody_qty')">
                      En custodia <span v-if="reconciliationSort.key === 'custody_qty'">{{ reconciliationSort.dir === 'asc' ? '↑' : '↓' }}</span>
                    </button>
                  </th>
                  <th class="text-right px-3 py-2">
                    <button type="button" class="inline-flex items-center gap-1" @click="toggleReconciliationSort('installed_qty')">
                      Instalado <span v-if="reconciliationSort.key === 'installed_qty'">{{ reconciliationSort.dir === 'asc' ? '↑' : '↓' }}</span>
                    </button>
                  </th>
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
                  <td class="px-3 py-2 text-right" :class="row.custody_qty > 0 ? 'font-medium text-indigo-700' : ''">{{ row.custody_qty }}</td>
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
          <div class="flex flex-wrap items-center justify-between gap-2 mt-3 text-xs text-slate-600">
            <span>{{ filteredSummary.length ? ((reconciliationPage - 1) * reconciliationPageSize + 1) : 0 }}–{{ Math.min(reconciliationPage * reconciliationPageSize, filteredSummary.length) }} de {{ filteredSummary.length }}</span>
            <div class="flex items-center gap-1.5">
              <button type="button" class="btn-secondary text-xs" :disabled="reconciliationPage <= 1" @click="reconciliationPage--">← Anterior</button>
              <span>{{ reconciliationPage }}/{{ reconciliationPageCount }}</span>
              <button type="button" class="btn-secondary text-xs" :disabled="reconciliationPage >= reconciliationPageCount" @click="reconciliationPage++">Siguiente →</button>
            </div>
          </div>
        </div>
      </section>
    </template>
  </AppLayout>
</template>
