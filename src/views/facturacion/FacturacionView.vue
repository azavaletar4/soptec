<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useInvoicesStore } from '@/stores/invoices';
import { useContractsStore } from '@/stores/contracts';
import { getErrorMessage } from '@/lib/errors';
import type { Invoice, InvoiceStatus } from '@/types/domain';

const router = useRouter();
const invoicesStore = useInvoicesStore();
const contractsStore = useContractsStore();

const showModal = ref(false);
const saving = ref(false);
const formError = ref<string | null>(null);
const contractFilter = ref('');
const statusFilter = ref<InvoiceStatus | 'overdue' | 'all'>('all');
const searchQuery = ref('');

const payModal = ref<Invoice | null>(null);
const payMethod = ref('cash');
const paying = ref(false);
const payError = ref<string | null>(null);

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
});
const form = ref(emptyForm());

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  pending: 'Pendiente',
  paid: 'Pagada',
  cancelled: 'Cancelada',
};
const STATUS_CLASS: Record<InvoiceStatus, string> = {
  pending: 'bg-yellow-500/15 text-yellow-600',
  paid: 'bg-green-500/15 text-green-600',
  cancelled: 'bg-slate-500/15 text-slate-600',
};

function isOverdue(inv: Invoice) {
  return inv.status === 'pending' && inv.due_date < todayIso();
}

const activeContracts = computed(() => contractsStore.contracts.filter((c) => c.status === 'active'));

const filteredContracts = computed(() => {
  const q = contractFilter.value.trim().toLowerCase();
  const list = activeContracts.value;
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
    .reduce((sum, i) => sum + Number(i.amount), 0);
  const pendingTotal = pending.reduce((sum, i) => sum + Number(i.amount), 0);
  return { pendingTotal, pendingCount: pending.length, overdueCount: overdue.length, collectedThisMonth };
});

const STATUS_TABS: { value: InvoiceStatus | 'overdue' | 'all'; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'overdue', label: 'Vencidas' },
  { value: 'paid', label: 'Pagadas' },
  { value: 'cancelled', label: 'Canceladas' },
];

onMounted(async () => {
  await Promise.all([invoicesStore.fetchInvoices(), contractsStore.fetchContracts()]);
});

function openCreate() {
  form.value = emptyForm();
  contractFilter.value = '';
  formError.value = null;
  showModal.value = true;
}

function onContractChange() {
  const contract = activeContracts.value.find((c) => c.id === form.value.contract_id);
  if (contract) form.value.amount = Number(contract.monthly_fee);
}

async function handleSubmit() {
  const contract = activeContracts.value.find((c) => c.id === form.value.contract_id);
  if (!contract) {
    formError.value = 'Selecciona un contrato';
    return;
  }
  saving.value = true;
  formError.value = null;
  try {
    await invoicesStore.createInvoice({
      contract_id: contract.id,
      client_id: contract.client_id,
      amount: form.value.amount,
      period_start: form.value.period_start,
      period_end: form.value.period_end,
      due_date: form.value.due_date,
      notes: form.value.notes || null,
    });
    showModal.value = false;
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al crear la factura');
  } finally {
    saving.value = false;
  }
}

function openPay(inv: Invoice) {
  payModal.value = inv;
  payMethod.value = 'cash';
  payError.value = null;
}

async function handlePay() {
  if (!payModal.value) return;
  paying.value = true;
  payError.value = null;
  try {
    await invoicesStore.markPaid(payModal.value.id, payMethod.value);
    payModal.value = null;
  } catch (e) {
    payError.value = getErrorMessage(e, 'Error al registrar el pago');
  } finally {
    paying.value = false;
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
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Facturación</h1>
        <p class="text-slate-600 text-sm mt-1">Control interno de cobros — {{ invoicesStore.invoices.length }} facturas</p>
      </div>
      <button class="btn-primary" @click="openCreate">
        + Nueva factura
      </button>
    </div>

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
      class="field-input mb-4"
    />

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

    <div class="table-shell">
      <table class="w-full text-sm min-w-[820px]">
        <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-3">Factura</th>
            <th class="text-left px-4 py-3">Cliente</th>
            <th class="text-left px-4 py-3">Periodo</th>
            <th class="text-left px-4 py-3">Monto</th>
            <th class="text-left px-4 py-3">Vence</th>
            <th class="text-left px-4 py-3">Estado</th>
            <th class="text-right px-4 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="invoicesStore.loading">
            <td colspan="7" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
          </tr>
          <tr v-else-if="!filteredInvoices.length">
            <td colspan="7" class="px-4 py-6 text-center text-slate-500">No hay facturas en este filtro.</td>
          </tr>
          <tr v-for="inv in filteredInvoices" :key="inv.id" class="border-t border-slate-200 hover:bg-slate-50">
            <td class="px-4 py-3">
              <div class="font-mono text-xs text-slate-500">{{ inv.invoice_number }}</div>
              <div class="text-xs text-slate-400">{{ inv.service_contracts?.contract_number }}</div>
            </td>
            <td class="px-4 py-3">
              <button
                class="text-slate-900 hover:text-sky-600"
                @click="router.push(`/clientes/${inv.client_id}`)"
              >
                {{ inv.clients ? `${inv.clients.first_name} ${inv.clients.last_name}` : '—' }}
              </button>
            </td>
            <td class="px-4 py-3 text-slate-600 text-xs">{{ inv.period_start }} → {{ inv.period_end }}</td>
            <td class="px-4 py-3 font-medium">S/ {{ Number(inv.amount).toFixed(2) }}</td>
            <td class="px-4 py-3 text-slate-600 text-xs">{{ inv.due_date }}</td>
            <td class="px-4 py-3">
              <span
                class="badge"
                :class="isOverdue(inv) ? 'bg-red-500/15 text-red-600' : STATUS_CLASS[inv.status]"
              >
                {{ isOverdue(inv) ? 'Vencida' : STATUS_LABEL[inv.status] }}
              </span>
            </td>
            <td class="px-4 py-3 text-right space-x-3 whitespace-nowrap">
              <template v-if="inv.status === 'pending'">
                <button class="text-green-600 hover:text-green-700 text-xs" @click="openPay(inv)">Marcar pagada</button>
                <button class="text-red-500/80 hover:text-red-600 text-xs" @click="handleCancel(inv)">Cancelar</button>
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
          class="w-full max-w-lg modal-panel max-h-[90vh] overflow-y-auto"
          @submit.prevent="handleSubmit"
        >
          <h2 class="text-lg font-semibold mb-4">Nueva factura</h2>

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
            <p v-if="!activeContracts.length" class="text-xs text-amber-600 mt-1">No hay contratos activos.</p>
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
              {{ saving ? 'Creando...' : 'Crear factura' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="payModal" class="modal-overlay">
        <form class="w-full max-w-sm modal-panel" @submit.prevent="handlePay">
          <h2 class="text-lg font-semibold mb-1">Registrar pago</h2>
          <p class="text-xs text-slate-500 mb-4">{{ payModal.invoice_number }} — S/ {{ Number(payModal.amount).toFixed(2) }}</p>

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
  </AppLayout>
</template>
