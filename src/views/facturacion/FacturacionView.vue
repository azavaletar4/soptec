<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import FacturacionZoneAccordion, { type ZoneGroup } from '@/components/facturacion/FacturacionZoneAccordion.vue';
import { useInvoicesStore } from '@/stores/invoices';
import { useContractsStore } from '@/stores/contracts';
import { useAuthStore } from '@/stores/auth';
import { useCatalogsStore } from '@/stores/catalogs';
import { useOltStore } from '@/stores/olt';
import { useInfraElementosStore } from '@/stores/infraElementos';
import { useDescuentosCompensacionStore } from '@/stores/descuentosCompensacion';
import { getErrorMessage } from '@/lib/errors';
import type { DescuentoCompensacionCriterio, Invoice, InvoiceAdjustment, InvoiceStatus } from '@/types/domain';

const router = useRouter();
const invoicesStore = useInvoicesStore();
const contractsStore = useContractsStore();
const auth = useAuthStore();
const catalogs = useCatalogsStore();
const oltStore = useOltStore();
const infraStore = useInfraElementosStore();
const descuentosStore = useDescuentosCompensacionStore();

// Edicion completa de una factura ya creada (corregir monto, fechas,
// contrato, notas) es solo para SUPERADMIN — crear/marcar pagada/cancelar
// sigue disponible para todo el staff de facturacion.
const isSuperadmin = computed(() => auth.role === 'SUPERADMIN');
// Descuento por averia (Fase 34) — pedido explicito: solo ADMIN/SUPERADMIN.
const canApplyAveria = computed(() => auth.role === 'SUPERADMIN' || auth.role === 'ADMIN');
const napBoxes = computed(() => infraStore.elementos.filter((e) => e.tipo === 'caja_nap'));

const showModal = ref(false);
const editingInvoice = ref<Invoice | null>(null);
const saving = ref(false);
const formError = ref<string | null>(null);
const contractFilter = ref('');
const statusFilter = ref<InvoiceStatus | 'overdue' | 'all'>('all');
const searchQuery = ref('');

const payModal = ref<Invoice | null>(null);
const payMethod = ref('cash');
const payAmount = ref(0);
const payAdjustments = ref<InvoiceAdjustment[]>([]);
const loadingPayAdjustments = ref(false);
const paying = ref(false);
const payError = ref<string | null>(null);

// amount_due ya viene neto de descuentos de referido/saldo a favor (lo
// mantiene un trigger, Fase 33b) — payAdjustments solo es para mostrar el
// desglose, no para recalcular el monto.
const payDueAmount = computed(() => (payModal.value ? Number(payModal.value.amount_due) : 0));
const payExcedente = computed(() => Math.max(0, payAmount.value - payDueAmount.value));

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function addDaysIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function firstOfMonthIso() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function lastOfMonthIso() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

const emptyForm = () => ({
  contract_id: '',
  amount: 0,
  period_start: firstOfMonthIso(),
  period_end: lastOfMonthIso(),
  due_date: addDaysIso(7),
  notes: '',
  status: 'pending' as InvoiceStatus,
  payment_method: 'cash',
});
const form = ref(emptyForm());

function isOverdue(inv: Invoice) {
  return inv.status === 'pending' && inv.due_date < todayIso();
}

const activeContracts = computed(() => contractsStore.contracts.filter((c) => c.status === 'active'));

// Al editar una factura de un contrato ya no activo (cancelado, etc.), el
// select igual debe poder mostrarlo — si no, "Guardar" pareceria no tener
// nada seleccionado aunque el form.contract_id siga siendo correcto.
const selectableContracts = computed(() => {
  if (!editingInvoice.value) return activeContracts.value;
  if (activeContracts.value.some((c) => c.id === editingInvoice.value!.contract_id)) return activeContracts.value;
  const current = contractsStore.contracts.find((c) => c.id === editingInvoice.value!.contract_id);
  return current ? [current, ...activeContracts.value] : activeContracts.value;
});

const filteredContracts = computed(() => {
  const q = contractFilter.value.trim().toLowerCase();
  const list = selectableContracts.value;
  if (!q) return list.slice(0, 30);
  return list
    .filter((c) =>
      `${c.clients?.first_name ?? ''} ${c.clients?.last_name ?? ''} ${c.contract_number ?? ''}`.toLowerCase().includes(q),
    )
    .slice(0, 30);
});

const filteredInvoices = computed(() => {
  let list = invoicesStore.invoices;
  if (statusFilter.value === 'overdue') list = list.filter(isOverdue);
  else if (statusFilter.value !== 'all') list = list.filter((i) => i.status === statusFilter.value);
  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    list = list.filter((i) =>
      `${i.invoice_number ?? ''} ${i.clients?.first_name ?? ''} ${i.clients?.last_name ?? ''} ${i.service_contracts?.contract_number ?? ''}`
        .toLowerCase()
        .includes(q),
    );
  }
  return list;
});

const kpis = computed(() => {
  const pending = invoicesStore.invoices.filter((i) => i.status === 'pending');
  const overdue = pending.filter(isOverdue);
  const now = new Date();
  const collectedThisMonth = invoicesStore.invoices
    .filter((i) => i.status === 'paid' && i.paid_at && new Date(i.paid_at).getMonth() === now.getMonth() && new Date(i.paid_at).getFullYear() === now.getFullYear())
    // amount_paid es lo que realmente entro (ya neto de descuentos de
    // referido/saldo a favor, Fase 33) — amount es el bruto y solo se usa
    // como respaldo en facturas de antes de esa fase (amount_paid nulo).
    .reduce((sum, i) => sum + Number(i.amount_paid ?? i.amount), 0);
  // amount_due tambien ya viene neto de descuentos (Fase 33b).
  const pendingTotal = pending.reduce((sum, i) => sum + Number(i.amount_due), 0);
  return { pendingTotal, pendingCount: pending.length, overdueCount: overdue.length, collectedThisMonth };
});

const STATUS_TABS: { value: InvoiceStatus | 'overdue' | 'all'; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'overdue', label: 'Vencidas' },
  { value: 'paid', label: 'Pagadas' },
  { value: 'cancelled', label: 'Canceladas' },
];

// ---- Agrupacion por zona ----
// La zona de una factura se resuelve por su contrato (service_contracts.zone_id/zones),
// ya cargado en contractsStore — no hace falta tocar el store de facturas.
const SIN_ZONA_KEY = '__sin_zona__';
const contractZoneById = computed(() => {
  const map = new Map<string, { zoneKey: string; zoneName: string }>();
  for (const c of contractsStore.contracts) {
    map.set(c.id, {
      zoneKey: c.zone_id ?? SIN_ZONA_KEY,
      zoneName: c.zones?.name ?? 'Sin zona asignada',
    });
  }
  return map;
});

// Se arma sobre filteredInvoices (ya respeta buscador + tab de estado) —
// una zona sin ninguna factura que matchee el filtro activo simplemente no
// aparece, y las 3 zonas mas urgentes (mas vencidas/pendientes) quedan arriba.
const zoneGroups = computed<ZoneGroup[]>(() => {
  const map = new Map<string, ZoneGroup>();
  for (const inv of filteredInvoices.value) {
    const info = contractZoneById.value.get(inv.contract_id) ?? { zoneKey: SIN_ZONA_KEY, zoneName: 'Sin zona asignada' };
    let group = map.get(info.zoneKey);
    if (!group) {
      group = {
        zoneKey: info.zoneKey,
        zoneName: info.zoneName,
        rows: [],
        pendingCount: 0,
        overdueCount: 0,
        collectedTotal: 0,
        pendingTotal: 0,
      };
      map.set(info.zoneKey, group);
    }
    const overdue = isOverdue(inv);
    group.rows.push({ invoice: inv, overdue });
    if (inv.status === 'pending') {
      group.pendingCount += 1;
      group.pendingTotal += Number(inv.amount_due);
      if (overdue) group.overdueCount += 1;
    } else if (inv.status === 'paid') {
      group.collectedTotal += Number(inv.amount_paid ?? inv.amount);
    }
  }
  return [...map.values()].sort(
    (a, b) => b.overdueCount - a.overdueCount || b.pendingCount - a.pendingCount || a.zoneName.localeCompare(b.zoneName),
  );
});

const criticalZonesCount = computed(() => zoneGroups.value.filter((g) => g.overdueCount > 0).length);

const expandedZones = ref<Record<string, boolean>>({});
function toggleZone(zoneKey: string) {
  expandedZones.value[zoneKey] = !expandedZones.value[zoneKey];
}
// Con busqueda activa o un filtro de estado distinto de "Todas", las zonas
// visibles ya son justo las que matchean — no tiene sentido dejarlas
// colapsadas y obligar a un clic mas para ver el resultado.
function isZoneExpanded(zoneKey: string) {
  if (searchQuery.value.trim() || statusFilter.value !== 'all') return true;
  return !!expandedZones.value[zoneKey];
}

onMounted(async () => {
  await Promise.all([invoicesStore.fetchInvoices(), contractsStore.fetchContracts()]);
  if (canApplyAveria.value) {
    catalogs.fetchZones().catch(() => {});
    oltStore.fetchDevices().catch(() => {});
    infraStore.fetchElementos().catch(() => {});
  }
});

function openCreate() {
  editingInvoice.value = null;
  form.value = emptyForm();
  contractFilter.value = '';
  formError.value = null;
  showModal.value = true;
}

// Solo SUPERADMIN (ver isSuperadmin) — permite corregir una factura ya
// creada, en cualquier estado (incluida pagada/cancelada, para arreglar
// datos mal cargados despues).
function openEdit(inv: Invoice) {
  editingInvoice.value = inv;
  form.value = {
    contract_id: inv.contract_id,
    amount: Number(inv.amount),
    period_start: inv.period_start,
    period_end: inv.period_end,
    due_date: inv.due_date,
    notes: inv.notes ?? '',
    status: inv.status,
    payment_method: inv.payment_method || 'cash',
  };
  contractFilter.value = '';
  formError.value = null;
  showModal.value = true;
}

function onContractChange() {
  const contract = activeContracts.value.find((c) => c.id === form.value.contract_id);
  if (contract && !editingInvoice.value) form.value.amount = Number(contract.monthly_fee);
}

async function handleSubmit() {
  const contract = [...activeContracts.value, ...contractsStore.contracts].find((c) => c.id === form.value.contract_id);
  if (!contract) {
    formError.value = 'Selecciona un contrato';
    return;
  }
  saving.value = true;
  formError.value = null;
  try {
    if (editingInvoice.value) {
      const becamePaid = form.value.status === 'paid' && editingInvoice.value.status !== 'paid';
      // Si el nuevo estado es "pagada" y antes no lo era, pasa por markPaid
      // (mismo camino que "Marcar pagada") para que tambien intente
      // reactivar el servicio si el contrato estaba en corte por deuda —
      // un update directo del status se saltearia esa logica.
      if (becamePaid) {
        const { reactivation } = await invoicesStore.markPaid(editingInvoice.value.id, form.value.payment_method);
        if (reactivation.attempted && !reactivation.ok) {
          alert(`La factura se marco pagada, pero no se pudo reactivar el servicio automaticamente: ${reactivation.error}. Reactivalo manualmente desde Cortes por deuda.`);
        }
      }
      // Revertir una factura de 'paid' a otro estado (correccion manual) deja
      // amount_paid/amount_due desactualizados si no se recalculan aqui —
      // amount_due debe volver a reflejar lo que falta por cobrar (bruto
      // menos los ajustes de referido/saldo a favor ya aplicados, que NO se
      // deshacen al revertir el estado).
      const revertingFromPaid = !becamePaid && editingInvoice.value.status === 'paid' && form.value.status !== 'paid';
      const adjustmentsTotal = revertingFromPaid
        ? (await invoicesStore.fetchAdjustments(editingInvoice.value.id)).reduce((sum, a) => sum + Number(a.monto), 0)
        : 0;

      await invoicesStore.updateInvoice(editingInvoice.value.id, {
        contract_id: contract.id,
        client_id: contract.client_id,
        amount: form.value.amount,
        period_start: form.value.period_start,
        period_end: form.value.period_end,
        due_date: form.value.due_date,
        notes: form.value.notes || null,
        // Si ya paso por markPaid arriba, el status/paid_at/payment_method
        // quedan tal cual quedaron ahi — no los pisa este update.
        ...(becamePaid
          ? {}
          : {
              status: form.value.status,
              payment_method: form.value.status === 'paid' ? form.value.payment_method : null,
              paid_at: form.value.status === 'paid' ? (editingInvoice.value.paid_at ?? new Date().toISOString()) : null,
              ...(revertingFromPaid
                ? { amount_paid: null, amount_due: Math.max(0, form.value.amount - adjustmentsTotal) }
                : {}),
            }),
      });
    } else {
      await invoicesStore.createInvoice({
        contract_id: contract.id,
        client_id: contract.client_id,
        amount: form.value.amount,
        period_start: form.value.period_start,
        period_end: form.value.period_end,
        due_date: form.value.due_date,
        notes: form.value.notes || null,
      });
    }
    showModal.value = false;
  } catch (e) {
    formError.value = getErrorMessage(e, editingInvoice.value ? 'Error al guardar la factura' : 'Error al crear la factura');
  } finally {
    saving.value = false;
  }
}

async function openPay(inv: Invoice) {
  payModal.value = inv;
  payMethod.value = 'cash';
  payError.value = null;
  // Precargado con lo realmente adeudado (amount_due ya viene neto de
  // descuentos, Fase 33b) — el cajero puede subirlo si el cliente paga de
  // mas (sobrepago -> saldo a favor).
  payAmount.value = Number(inv.amount_due);
  payAdjustments.value = [];
  loadingPayAdjustments.value = true;
  try {
    payAdjustments.value = await invoicesStore.fetchAdjustments(inv.id);
  } finally {
    loadingPayAdjustments.value = false;
  }
}

async function handlePay() {
  if (!payModal.value) return;
  paying.value = true;
  payError.value = null;
  try {
    const { reactivation } = await invoicesStore.markPaid(payModal.value.id, payMethod.value, payAmount.value);
    payModal.value = null;
    if (reactivation.attempted && !reactivation.ok) {
      alert(`La factura se marco pagada, pero no se pudo reactivar el servicio automaticamente: ${reactivation.error}. Reactivalo manualmente desde Cortes por deuda.`);
    }
  } catch (e) {
    payError.value = getErrorMessage(e, 'Error al registrar el pago');
  } finally {
    paying.value = false;
  }
}

// ---- Recibo de pago (documento INTERNO, no un comprobante electronico
// SUNAT/SRI — SmartRayco no esta integrado con ningun sistema tributario,
// ver comentario en la migracion Fase 7). Solo constancia de cobro para
// entregar al cliente. ----
const reciboInvoice = ref<Invoice | null>(null);
const reciboAdjustments = ref<InvoiceAdjustment[]>([]);

async function openRecibo(inv: Invoice) {
  reciboInvoice.value = inv;
  reciboAdjustments.value = await invoicesStore.fetchAdjustments(inv.id);
}

function printRecibo() {
  window.print();
}

// ---- Facturacion recurrente (Fase 33b): boton manual ----
const generatingDue = ref(false);
const generateDueResult = ref<{ scanned: number; generated: number; errors: { contractId: string; message: string }[] } | null>(null);

async function handleGenerateDue() {
  generatingDue.value = true;
  generateDueResult.value = null;
  try {
    generateDueResult.value = await invoicesStore.generateDue();
    await invoicesStore.fetchInvoices();
  } catch (e) {
    alert(getErrorMessage(e, 'Error al generar las facturas'));
  } finally {
    generatingDue.value = false;
  }
}

// ---- Descuento por averia masiva (Fase 34) ----
const showAveriaModal = ref(false);
const averiaForm = ref({
  criterio: 'zona' as DescuentoCompensacionCriterio,
  criterioId: '',
  motivo: '',
  modo: 'monto' as 'monto' | 'porcentaje',
  monto: 0,
  porcentaje: 0,
});
const savingAveria = ref(false);
const averiaError = ref<string | null>(null);
const averiaResult = ref<{ lote_id: string; clientes_afectados: number } | null>(null);

function openAveriaModal() {
  averiaForm.value = { criterio: 'zona', criterioId: '', motivo: '', modo: 'monto', monto: 0, porcentaje: 0 };
  averiaError.value = null;
  averiaResult.value = null;
  showAveriaModal.value = true;
}

async function handleAveriaSubmit() {
  if (!averiaForm.value.criterioId || !averiaForm.value.motivo.trim()) return;
  savingAveria.value = true;
  averiaError.value = null;
  try {
    averiaResult.value = await descuentosStore.createMasivo({
      criterio: averiaForm.value.criterio,
      criterioId: averiaForm.value.criterioId,
      motivo: averiaForm.value.motivo.trim(),
      monto: averiaForm.value.modo === 'monto' ? averiaForm.value.monto : undefined,
      porcentaje: averiaForm.value.modo === 'porcentaje' ? averiaForm.value.porcentaje : undefined,
    });
  } catch (e) {
    averiaError.value = getErrorMessage(e, 'Error al aplicar el descuento masivo');
  } finally {
    savingAveria.value = false;
  }
}

async function handleCancel(inv: Invoice) {
  const ok = confirm(`¿Cancelar la factura ${inv.invoice_number}?`);
  if (!ok) return;
  try {
    await invoicesStore.cancelInvoice(inv.id);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al cancelar la factura'));
  }
}

// Borrado definitivo — solo SUPERADMIN (ver isSuperadmin), para limpiar
// facturas de prueba. La RLS (Fase 35) tambien lo exige a nivel de base.
async function handleDelete(inv: Invoice) {
  const ok = confirm(`¿Eliminar definitivamente la factura ${inv.invoice_number}? Esta acción no se puede deshacer.`);
  if (!ok) return;
  try {
    await invoicesStore.deleteInvoice(inv.id);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al eliminar la factura'));
  }
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Facturación</h1>
        <p class="text-slate-600 text-sm mt-1">Control interno de cobros — {{ invoicesStore.invoices.length }} facturas</p>
      </div>
      <div class="flex gap-2">
        <button v-if="canApplyAveria" class="btn-ghost" @click="openAveriaModal">
          Descuento por avería masiva
        </button>
        <button class="btn-ghost" :disabled="generatingDue" @click="handleGenerateDue">
          {{ generatingDue ? 'Generando...' : 'Generar facturas del mes' }}
        </button>
        <button class="btn-primary" @click="openCreate">
          + Nueva factura
        </button>
      </div>
    </div>

    <p v-if="generateDueResult" class="mb-4 text-sm rounded-lg bg-sky-500/10 text-sky-700 px-3 py-2">
      {{ generateDueResult.generated }} facturas nuevas generadas de {{ generateDueResult.scanned }} contratos activos revisados.
      <span v-if="generateDueResult.errors.length" class="text-red-600"> {{ generateDueResult.errors.length }} con error — revisar consola.</span>
    </p>

    <div class="grid gap-4 mb-6" style="grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))">
      <div class="text-left rounded-xl p-5 flex items-start justify-between" style="background:#16a34a">
        <div>
          <div class="text-3xl font-bold text-white">S/ {{ kpis.collectedThisMonth.toFixed(2) }}</div>
          <div class="text-sm text-white/90 mt-1">Cobrado este mes</div>
        </div>
        <span class="text-2xl">💰</span>
      </div>
      <div class="text-left rounded-xl p-5 flex items-start justify-between" style="background:#d97706">
        <div>
          <div class="text-3xl font-bold text-white">S/ {{ kpis.pendingTotal.toFixed(2) }}</div>
          <div class="text-sm text-white/90 mt-1">{{ kpis.pendingCount }} pendientes</div>
        </div>
        <span class="text-2xl">⏳</span>
      </div>
      <div class="text-left rounded-xl p-5 flex items-start justify-between" style="background:#dc2626">
        <div>
          <div class="text-3xl font-bold text-white">{{ kpis.overdueCount }}</div>
          <div class="text-sm text-white/90 mt-1">Vencidas</div>
        </div>
        <span class="text-2xl">⚠</span>
      </div>
    </div>

    <input
      v-model="searchQuery"
      placeholder="Buscar por numero de factura, cliente o contrato..."
      class="field-input mb-2"
    />
    <p v-if="criticalZonesCount" class="text-xs text-red-600 mb-4">
      ⚠ {{ criticalZonesCount }} {{ criticalZonesCount === 1 ? 'zona tiene' : 'zonas tienen' }} facturas vencidas — revisadas primero abajo.
    </p>
    <div v-else class="mb-4"></div>

    <div class="flex flex-wrap gap-2 mb-4">
      <button
        v-for="tab in STATUS_TABS"
        :key="tab.value"
        class="px-3 py-1.5 rounded-lg text-xs font-medium"
        :class="statusFilter === tab.value ? 'bg-sky-500 text-slate-950' : 'bg-slate-100 text-slate-600 hover:text-slate-900'"
        @click="statusFilter = tab.value"
      >
        {{ tab.label }}
      </button>
    </div>

    <p v-if="invoicesStore.error" class="mb-4 text-sm text-red-600">{{ invoicesStore.error }}</p>

    <p v-if="invoicesStore.loading" class="text-slate-500 text-sm">Cargando...</p>
    <p v-else-if="!zoneGroups.length" class="text-slate-500 text-sm">No hay facturas en este filtro.</p>
    <template v-else>
      <FacturacionZoneAccordion
        v-for="group in zoneGroups"
        :key="group.zoneKey"
        :group="group"
        :expanded="isZoneExpanded(group.zoneKey)"
        :is-superadmin="isSuperadmin"
        @toggle="toggleZone(group.zoneKey)"
        @pay="openPay"
        @cancel="handleCancel"
        @recibo="openRecibo"
        @edit="openEdit"
        @delete="handleDelete"
        @go-client="(id) => router.push(`/clientes/${id}`)"
      />
    </template>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay">
        <form
          class="w-full max-w-lg modal-panel max-h-[90vh] overflow-y-auto"
          @submit.prevent="handleSubmit"
        >
          <h2 class="text-lg font-semibold mb-4">{{ editingInvoice ? `Editar factura ${editingInvoice.invoice_number}` : 'Nueva factura' }}</h2>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Contrato / cliente</label>
            <input
              v-model="contractFilter"
              placeholder="Buscar por nombre o numero de contrato..."
              class="field-input mb-2"
            />
            <select
              v-model="form.contract_id"
              required
              size="5"
              class="field-input"
              @change="onContractChange"
            >
              <option v-for="c in filteredContracts" :key="c.id" :value="c.id">
                {{ c.contract_number }} — {{ c.clients?.first_name }} {{ c.clients?.last_name }} — S/ {{ Number(c.monthly_fee).toFixed(2) }}
              </option>
            </select>
            <p v-if="!selectableContracts.length" class="text-xs text-amber-600 mt-1">No hay contratos activos.</p>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Periodo desde</label>
              <input v-model="form.period_start" type="date" required class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Periodo hasta</label>
              <input v-model="form.period_end" type="date" required class="field-input" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Monto (S/)</label>
              <input
                v-model.number="form.amount"
                type="number"
                step="0.01"
                min="0"
                required
                class="field-input"
              />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Fecha de vencimiento</label>
              <input v-model="form.due_date" type="date" required class="field-input" />
            </div>
          </div>

          <div v-if="editingInvoice" class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Estado</label>
              <select v-model="form.status" class="field-input">
                <option value="pending">Pendiente</option>
                <option value="paid">Pagada</option>
                <option value="cancelled">Cancelada</option>
              </select>
            </div>
            <div v-if="form.status === 'paid'">
              <label class="block text-xs text-slate-600 mb-1">Metodo de pago</label>
              <select v-model="form.payment_method" class="field-input">
                <option value="cash">Efectivo</option>
                <option value="transfer">Transferencia</option>
                <option value="card">Tarjeta</option>
              </select>
            </div>
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-600 mb-1">Notas</label>
            <textarea v-model="form.notes" rows="2" class="field-input"></textarea>
          </div>

          <p v-if="formError" class="text-sm text-red-600 mb-3">{{ formError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showModal = false">
              Cancelar
            </button>
            <button type="submit" :disabled="saving" class="btn-primary">
              {{ saving ? 'Guardando...' : editingInvoice ? 'Guardar cambios' : 'Crear factura' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="payModal" class="modal-overlay">
        <form class="w-full max-w-sm modal-panel" @submit.prevent="handlePay">
          <h2 class="text-lg font-semibold mb-1">Registrar pago</h2>
          <p class="text-xs text-slate-500 mb-3">{{ payModal.invoice_number }} — Monto de la factura: S/ {{ Number(payModal.amount).toFixed(2) }}</p>

          <p v-if="loadingPayAdjustments" class="text-xs text-slate-400 mb-3">Cargando descuentos aplicados...</p>
          <div v-else-if="payAdjustments.length" class="mb-3 rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-xs space-y-1">
            <div v-for="adj in payAdjustments" :key="adj.id" class="flex justify-between gap-2">
              <span class="text-slate-600">{{ adj.descripcion }}</span>
              <span class="text-green-600 font-medium whitespace-nowrap">- S/ {{ Number(adj.monto).toFixed(2) }}</span>
            </div>
            <div class="flex justify-between gap-2 pt-1 border-t border-slate-200 font-semibold">
              <span>Saldo pendiente</span>
              <span>S/ {{ payDueAmount.toFixed(2) }}</span>
            </div>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Monto recibido (S/)</label>
            <input v-model.number="payAmount" type="number" step="0.01" min="0" required class="field-input" />
            <p v-if="payExcedente > 0" class="text-xs text-sky-600 mt-1">
              Sobrepago de S/ {{ payExcedente.toFixed(2) }} — se guardará como saldo a favor del cliente.
            </p>
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-600 mb-1">Metodo de pago</label>
            <select v-model="payMethod" class="field-input">
              <option value="cash">Efectivo</option>
              <option value="transfer">Transferencia</option>
              <option value="card">Tarjeta</option>
            </select>
          </div>

          <p v-if="payError" class="text-sm text-red-600 mb-3">{{ payError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="payModal = null">
              Cancelar
            </button>
            <button type="submit" :disabled="paying" class="btn-primary">
              {{ paying ? 'Guardando...' : 'Confirmar pago' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="reciboInvoice" class="modal-overlay no-print" @click.self="reciboInvoice = null">
        <div class="w-full max-w-md modal-panel">
          <div id="recibo-print" class="text-sm">
            <div class="text-center mb-4">
              <div class="font-bold text-base">RAYCO NETWORKS E.I.R.L.</div>
              <div class="text-xs text-slate-600">RUC 20614647141</div>
              <div class="text-xs text-slate-600">AAHH Luis Santa Maria Cal Mza. 17 Lote. 3 Sec. Rio Seco, El Porvenir - Trujillo - La Libertad</div>
            </div>

            <div class="text-center font-semibold border-y border-slate-300 py-1.5 mb-3">RECIBO DE PAGO</div>

            <div class="grid grid-cols-2 gap-1.5 mb-3">
              <span class="text-slate-500">Nº de factura interna</span>
              <span class="text-right font-mono">{{ reciboInvoice.invoice_number }}</span>
              <span class="text-slate-500">Fecha de pago</span>
              <span class="text-right">{{ reciboInvoice.paid_at ? new Date(reciboInvoice.paid_at).toLocaleDateString('es-PE') : '—' }}</span>
              <span class="text-slate-500">Cliente</span>
              <span class="text-right">{{ reciboInvoice.clients ? `${reciboInvoice.clients.first_name} ${reciboInvoice.clients.last_name}` : '—' }}</span>
              <span class="text-slate-500">Documento</span>
              <span class="text-right font-mono">{{ reciboInvoice.clients?.document_number ?? '—' }}</span>
              <span class="text-slate-500">Contrato</span>
              <span class="text-right font-mono">{{ reciboInvoice.service_contracts?.contract_number ?? '—' }}</span>
              <span class="text-slate-500">Periodo</span>
              <span class="text-right">{{ reciboInvoice.period_start }} → {{ reciboInvoice.period_end }}</span>
            </div>

            <table class="w-full text-xs mb-3 border-t border-slate-300 pt-2">
              <tbody>
                <tr>
                  <td class="py-0.5">Servicio de internet — {{ reciboInvoice.period_start }} a {{ reciboInvoice.period_end }}</td>
                  <td class="py-0.5 text-right whitespace-nowrap">S/ {{ Number(reciboInvoice.amount).toFixed(2) }}</td>
                </tr>
                <tr v-for="adj in reciboAdjustments" :key="adj.id">
                  <td class="py-0.5 text-green-700">{{ adj.descripcion }}</td>
                  <td class="py-0.5 text-right text-green-700 whitespace-nowrap">- S/ {{ Number(adj.monto).toFixed(2) }}</td>
                </tr>
              </tbody>
            </table>

            <div class="flex justify-between font-bold text-base border-t border-slate-300 pt-2 mb-4">
              <span>Total pagado</span>
              <span>S/ {{ Number(reciboInvoice.amount_paid ?? (Number(reciboInvoice.amount) - reciboAdjustments.reduce((s, a) => s + Number(a.monto), 0))).toFixed(2) }}</span>
            </div>

            <p class="text-[10px] text-slate-400 text-center leading-snug">
              Este es un recibo interno de SmartRayco como constancia de pago. NO es un comprobante de pago electrónico
              autorizado por SUNAT y no tiene validez tributaria.
            </p>
          </div>

          <div class="flex justify-end gap-2 mt-4 no-print">
            <button type="button" class="btn-ghost" @click="reciboInvoice = null">Cerrar</button>
            <button type="button" class="btn-primary" @click="printRecibo">Imprimir / Guardar PDF</button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showAveriaModal" class="modal-overlay" @click.self="showAveriaModal = false">
        <form class="w-full max-w-md modal-panel" @submit.prevent="handleAveriaSubmit">
          <h2 class="text-lg font-semibold mb-1">Descuento por avería masiva</h2>
          <p class="text-xs text-slate-500 mb-4">
            Se registra como descuento pendiente y se aplicará solo en la siguiente factura de cada cliente afectado.
          </p>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Filtrar por</label>
            <select v-model="averiaForm.criterio" class="field-input" @change="averiaForm.criterioId = ''">
              <option value="zona">Zona</option>
              <option value="olt">OLT</option>
              <option value="nap">Caja NAP</option>
            </select>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">
              {{ averiaForm.criterio === 'zona' ? 'Zona afectada' : averiaForm.criterio === 'olt' ? 'OLT afectada' : 'Caja NAP afectada' }}
            </label>
            <select v-model="averiaForm.criterioId" required class="field-input">
              <option value="" disabled>Selecciona...</option>
              <template v-if="averiaForm.criterio === 'zona'">
                <option v-for="z in catalogs.zones" :key="z.id" :value="z.id">{{ z.name }}</option>
              </template>
              <template v-else-if="averiaForm.criterio === 'olt'">
                <option v-for="d in oltStore.devices" :key="d.id" :value="d.id">{{ d.name }}</option>
              </template>
              <template v-else>
                <option v-for="n in napBoxes" :key="n.id" :value="n.id">{{ n.name }}</option>
              </template>
            </select>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Motivo / Justificación</label>
            <textarea
              v-model="averiaForm.motivo"
              required
              rows="2"
              placeholder="ej. Compensación por avería masiva en sector Alto Trujillo del 12/10 - 18 hrs sin servicio"
              class="field-input"
            ></textarea>
          </div>

          <div class="mb-4">
            <div class="flex gap-4 mb-2 text-xs">
              <label class="flex items-center gap-1.5">
                <input v-model="averiaForm.modo" type="radio" value="monto" /> Monto fijo (S/)
              </label>
              <label class="flex items-center gap-1.5">
                <input v-model="averiaForm.modo" type="radio" value="porcentaje" /> % de la mensualidad
              </label>
            </div>
            <input
              v-if="averiaForm.modo === 'monto'"
              v-model.number="averiaForm.monto"
              type="number"
              step="0.01"
              min="0.01"
              required
              class="field-input"
            />
            <input
              v-else
              v-model.number="averiaForm.porcentaje"
              type="number"
              step="1"
              min="1"
              max="100"
              required
              class="field-input"
            />
          </div>

          <p v-if="averiaError" class="text-sm text-red-600 mb-3">{{ averiaError }}</p>
          <p v-if="averiaResult" class="text-sm text-green-600 mb-3">
            Listo: descuento pendiente registrado para {{ averiaResult.clientes_afectados }} cliente(s).
          </p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showAveriaModal = false">
              {{ averiaResult ? 'Cerrar' : 'Cancelar' }}
            </button>
            <button v-if="!averiaResult" type="submit" :disabled="savingAveria" class="btn-primary">
              {{ savingAveria ? 'Aplicando...' : 'Aplicar descuento' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>

<style>
@media print {
  body * {
    visibility: hidden;
  }
  #recibo-print,
  #recibo-print * {
    visibility: visible;
  }
  #recibo-print {
    position: fixed;
    inset: 0;
    padding: 24px;
  }
}
</style>
