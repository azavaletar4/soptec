<script setup lang="ts">
import type { Invoice, InvoiceStatus } from '@/types/domain';

export interface ZoneInvoiceRow {
  invoice: Invoice;
  overdue: boolean;
}

export interface ZoneGroup {
  zoneKey: string;
  zoneName: string;
  rows: ZoneInvoiceRow[];
  pendingCount: number;
  overdueCount: number;
  collectedTotal: number;
  pendingTotal: number;
}

defineProps<{
  group: ZoneGroup;
  expanded: boolean;
  isSuperadmin: boolean;
}>();

defineEmits<{
  toggle: [];
  pay: [inv: Invoice];
  cancel: [inv: Invoice];
  recibo: [inv: Invoice];
  edit: [inv: Invoice];
  delete: [inv: Invoice];
  'go-client': [clientId: string];
}>();

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

function semaphoreClass(group: ZoneGroup) {
  if (group.overdueCount > 0) return 'bg-red-500';
  if (group.pendingCount > 0) return 'bg-amber-500';
  return 'bg-green-500';
}
</script>

<template>
  <div class="table-shell mb-3">
    <button
      type="button"
      class="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
      @click="$emit('toggle')"
    >
      <span class="w-2.5 h-2.5 rounded-full shrink-0" :class="semaphoreClass(group)"></span>
      <span class="font-semibold flex-1 min-w-[140px]">{{ group.zoneName }}</span>
      <span class="flex flex-wrap items-center gap-2 text-xs">
        <span v-if="group.pendingCount" class="badge bg-amber-500/15 text-amber-600">{{ group.pendingCount }} pendientes</span>
        <span v-if="group.overdueCount" class="badge bg-red-500/15 text-red-600">{{ group.overdueCount }} vencidas</span>
        <span class="badge bg-green-500/15 text-green-600">Cobrado S/ {{ group.collectedTotal.toFixed(2) }}</span>
        <span v-if="group.pendingTotal" class="badge bg-slate-500/15 text-slate-600">Pendiente S/ {{ group.pendingTotal.toFixed(2) }}</span>
      </span>
      <span class="text-slate-400 shrink-0">{{ expanded ? '▲' : '▼' }}</span>
    </button>

    <div v-if="expanded" class="overflow-x-auto border-t border-slate-200">
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
          <tr v-for="{ invoice: inv, overdue } in group.rows" :key="inv.id" class="border-t border-slate-200 hover:bg-slate-50">
            <td class="px-4 py-3">
              <div class="font-mono text-xs text-slate-500">{{ inv.invoice_number }}</div>
              <div class="text-xs text-slate-400">{{ inv.service_contracts?.contract_number }}</div>
            </td>
            <td class="px-4 py-3">
              <button class="text-slate-900 hover:text-sky-600" @click="$emit('go-client', inv.client_id)">
                {{ inv.clients ? `${inv.clients.first_name} ${inv.clients.last_name}` : '—' }}
              </button>
            </td>
            <td class="px-4 py-3 text-slate-600 text-xs">{{ inv.period_start }} → {{ inv.period_end }}</td>
            <td class="px-4 py-3 font-medium">
              <template v-if="inv.status === 'pending' && Number(inv.amount_due) < Number(inv.amount)">
                <div>S/ {{ Number(inv.amount_due).toFixed(2) }}</div>
                <div class="text-[11px] text-slate-400 line-through font-normal">S/ {{ Number(inv.amount).toFixed(2) }}</div>
                <div class="text-[10px] text-green-600 font-normal">con descuento</div>
              </template>
              <template v-else>S/ {{ Number(inv.amount).toFixed(2) }}</template>
            </td>
            <td class="px-4 py-3 text-slate-600 text-xs">{{ inv.due_date }}</td>
            <td class="px-4 py-3">
              <span class="badge" :class="overdue ? 'bg-red-500/15 text-red-600' : STATUS_CLASS[inv.status]">
                {{ overdue ? 'Vencida' : STATUS_LABEL[inv.status] }}
              </span>
            </td>
            <td class="px-4 py-3 text-right space-x-3 whitespace-nowrap">
              <template v-if="inv.status === 'pending'">
                <button class="text-green-600 hover:text-green-700 text-xs" @click="$emit('pay', inv)">Marcar pagada</button>
                <button class="text-red-500/80 hover:text-red-600 text-xs" @click="$emit('cancel', inv)">Cancelar</button>
              </template>
              <button v-if="inv.status === 'paid'" class="text-sky-600 hover:text-sky-700 text-xs" @click="$emit('recibo', inv)">Imprimir recibo</button>
              <button v-if="isSuperadmin" class="text-slate-600 hover:text-slate-900 text-xs" @click="$emit('edit', inv)">Editar</button>
              <button v-if="isSuperadmin" class="text-red-500/80 hover:text-red-600 text-xs" @click="$emit('delete', inv)">Eliminar</button>
              <span v-if="inv.status === 'cancelled' && !isSuperadmin" class="text-xs text-slate-400">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
