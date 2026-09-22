<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useDebtHoldStore, type ApplyResult } from '@/stores/debtHold';
import { getErrorMessage } from '@/lib/errors';
import type { DebtHoldEvent, ServiceContract } from '@/types/domain';

const debtHoldStore = useDebtHoldStore();

const scanning = ref(false);
const scanMessage = ref<string | null>(null);
const actionError = ref<string | null>(null);
const actingId = ref<string | null>(null);

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente de confirmar',
  suspended: 'Corte aplicado',
};
const STATUS_CLASS: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-600',
  suspended: 'bg-red-500/15 text-red-600',
};

onMounted(() => {
  debtHoldStore.fetchPending().catch((e) => {
    actionError.value = getErrorMessage(e, 'Error al cargar los cortes pendientes');
  });
});

async function handleScan() {
  scanning.value = true;
  scanMessage.value = null;
  actionError.value = null;
  try {
    const res = await debtHoldStore.runScan();
    scanMessage.value = `Escaneo: ${res.flagged} contrato(s) marcado(s) de ${res.scanned} con facturas vencidas${res.errors ? ` (${res.errors} errores)` : ''}.`;
    await debtHoldStore.fetchPending();
  } catch (e) {
    actionError.value = getErrorMessage(e, 'Error al escanear vencidos');
  } finally {
    scanning.value = false;
  }
}

function describeResult(result: ApplyResult): string | null {
  if (result.ok) return null;
  const parts = [
    result.olt.ok ? null : `OLT: ${result.olt.error}`,
    result.mikrotik.ok ? null : `MikroTik: ${result.mikrotik.error}`,
  ].filter(Boolean);
  return parts.join(' · ') || 'Error desconocido';
}

async function handleApply(contract: ServiceContract) {
  const clientName = contract.clients ? `${contract.clients.first_name} ${contract.clients.last_name}` : contract.contract_number;
  if (!confirm(`¿Aplicar el corte por deuda a ${clientName} (${contract.contract_number})? Esto cambia su plan real en la OLT y su perfil PPPoE en MikroTik ahora mismo.`)) return;
  actingId.value = contract.id;
  actionError.value = null;
  try {
    const result = await debtHoldStore.applyHold(contract.id);
    const problem = describeResult(result);
    if (problem) actionError.value = `Corte aplicado parcialmente en ${contract.contract_number}: ${problem}. Podes reintentar (los pasos que ya funcionaron no se repiten de mas).`;
  } catch (e) {
    actionError.value = getErrorMessage(e, 'Error al aplicar el corte');
  } finally {
    actingId.value = null;
  }
}

async function handleReactivate(contract: ServiceContract) {
  const clientName = contract.clients ? `${contract.clients.first_name} ${contract.clients.last_name}` : contract.contract_number;
  if (!confirm(`¿Reactivar a ${clientName} (${contract.contract_number})? Vuelve al plan contratado en la OLT y su perfil PPPoE original.`)) return;
  actingId.value = contract.id;
  actionError.value = null;
  try {
    const result = await debtHoldStore.reactivate(contract.id);
    const problem = describeResult(result);
    if (problem) actionError.value = `Reactivacion parcial en ${contract.contract_number}: ${problem}. Podes reintentar.`;
  } catch (e) {
    actionError.value = getErrorMessage(e, 'Error al reactivar');
  } finally {
    actingId.value = null;
  }
}

const historyModal = ref<ServiceContract | null>(null);
const historyEvents = ref<DebtHoldEvent[]>([]);
const loadingHistory = ref(false);

async function openHistory(contract: ServiceContract) {
  historyModal.value = contract;
  loadingHistory.value = true;
  try {
    historyEvents.value = await debtHoldStore.fetchEvents(contract.id);
  } catch (e) {
    actionError.value = getErrorMessage(e, 'Error al leer el historial');
  } finally {
    loadingHistory.value = false;
  }
}

const EVENT_LABEL: Record<string, string> = {
  flagged: 'Marcado como moroso',
  applied: 'Corte aplicado',
  reactivated: 'Reactivado',
  error: 'Error',
};

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' });
}

const total = computed(() => debtHoldStore.pending.length);
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Cortes por deuda</h1>
        <p class="text-slate-600 text-sm mt-1">{{ total }} contrato(s) marcado(s) o cortado(s)</p>
      </div>
      <button class="btn-primary" :disabled="scanning" @click="handleScan">
        {{ scanning ? 'Escaneando...' : 'Escanear vencidos ahora' }}
      </button>
    </div>

    <p class="text-xs text-slate-500 mb-4">
      El sistema marca solo los contratos con facturas vencidas hace varios dias (revision automatica periodica) — el
      corte real (cambiar el plan en la OLT y el perfil PPPoE en MikroTik) siempre lo confirma una persona con el
      botón "Aplicar corte".
    </p>

    <p v-if="scanMessage" class="mb-4 text-sm text-emerald-600">{{ scanMessage }}</p>
    <p v-if="actionError" class="mb-4 text-sm text-red-600">{{ actionError }}</p>
    <p v-if="debtHoldStore.error" class="mb-4 text-sm text-red-600">{{ debtHoldStore.error }}</p>

    <div class="table-shell">
      <table class="w-full text-sm min-w-[900px]">
        <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-3">Contrato</th>
            <th class="text-left px-4 py-3">Cliente</th>
            <th class="text-left px-4 py-3">Plan contratado</th>
            <th class="text-left px-4 py-3">Factura vencida</th>
            <th class="text-left px-4 py-3">Estado</th>
            <th class="text-right px-4 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="debtHoldStore.loading">
            <td colspan="6" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
          </tr>
          <tr v-else-if="!debtHoldStore.pending.length">
            <td colspan="6" class="px-4 py-6 text-center text-slate-500">No hay cortes pendientes ni aplicados ahora mismo.</td>
          </tr>
          <tr v-for="ct in debtHoldStore.pending" :key="ct.id" class="border-t border-slate-200 hover:bg-slate-50">
            <td class="px-4 py-3 font-mono text-xs">{{ ct.contract_number }}</td>
            <td class="px-4 py-3">
              <div>{{ ct.clients?.first_name }} {{ ct.clients?.last_name }}</div>
              <div class="text-[10px] text-slate-500">{{ ct.clients?.phone || '—' }}</div>
            </td>
            <td class="px-4 py-3 text-slate-600">{{ ct.plans?.name || '—' }}</td>
            <td class="px-4 py-3 text-slate-600">
              <span v-if="ct.invoices">
                {{ ct.invoices.invoice_number }} · vence {{ ct.invoices.due_date }} · S/ {{ Number(ct.invoices.amount).toFixed(2) }}
              </span>
              <span v-else>—</span>
            </td>
            <td class="px-4 py-3">
              <span class="badge" :class="STATUS_CLASS[ct.debt_hold_status]">{{ STATUS_LABEL[ct.debt_hold_status] }}</span>
            </td>
            <td class="px-4 py-3 text-right space-x-3 whitespace-nowrap text-xs">
              <button
                v-if="ct.debt_hold_status === 'pending'"
                class="text-red-600 hover:underline"
                :disabled="actingId === ct.id"
                @click="handleApply(ct)"
              >
                {{ actingId === ct.id ? 'Aplicando...' : 'Aplicar corte' }}
              </button>
              <button
                v-if="ct.debt_hold_status === 'suspended'"
                class="text-emerald-600 hover:underline"
                :disabled="actingId === ct.id"
                @click="handleReactivate(ct)"
              >
                {{ actingId === ct.id ? 'Reactivando...' : 'Reactivar' }}
              </button>
              <button class="text-slate-600 hover:underline" @click="openHistory(ct)">Historial</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div v-if="historyModal" class="modal-overlay">
        <div class="w-full max-w-lg modal-panel max-h-[80vh] overflow-y-auto">
          <h2 class="text-lg font-semibold mb-1">Historial</h2>
          <p class="text-xs text-slate-500 mb-4 font-mono">{{ historyModal.contract_number }}</p>

          <p v-if="loadingHistory" class="text-sm text-slate-500">Cargando...</p>
          <ul v-else-if="historyEvents.length" class="space-y-2">
            <li v-for="ev in historyEvents" :key="ev.id" class="text-xs border-b border-slate-100 pb-2">
              <span class="font-medium">{{ EVENT_LABEL[ev.event_type] ?? ev.event_type }}</span>
              <span class="text-slate-400"> — {{ formatDate(ev.created_at) }}</span>
              <p v-if="ev.detail" class="text-slate-600 mt-0.5">{{ ev.detail }}</p>
            </li>
          </ul>
          <p v-else class="text-sm text-slate-500">Sin eventos registrados.</p>

          <div class="flex justify-end mt-4">
            <button type="button" class="btn-ghost" @click="historyModal = null">Cerrar</button>
          </div>
        </div>
      </div>
    </Teleport>
  </AppLayout>
</template>
