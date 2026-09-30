<script setup lang="ts">
import type { UnconfiguredOnt } from '@/stores/olt';

defineProps<{
  onts: UnconfiguredOnt[];
  loading: boolean;
  error: string | null;
  checkedAt: string | null;
  live: boolean;
}>();

const emit = defineEmits<{
  refresh: [];
  'refresh-live': [];
  reauthorize: [payload: { serial: string; slot: number; port: number; clientId: string; contractId?: string }];
}>();

const DEBT_HOLD_LABEL: Record<string, string> = {
  suspended: 'Cortado por deuda',
  pending: 'Deuda pendiente (sin cortar)',
  none: 'Sin deuda',
};
</script>

<template>
  <div class="rounded-xl border border-slate-200 bg-slate-100 p-4 mb-6">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-sm font-semibold">Desconfiguradas / Por reconectar ({{ onts.length }})</h2>
      <div class="flex items-center gap-2">
        <button class="text-xs text-sky-700 hover:underline" :disabled="loading" @click="emit('refresh')">
          {{ loading ? 'Consultando...' : 'Actualizar' }}
        </button>
        <button
          class="text-xs text-amber-700 hover:underline"
          :disabled="loading"
          title="Escaneo Telnet en vivo — usar justo antes de reconectar, para el dato mas fresco posible"
          @click="emit('refresh-live')"
        >
          Escanear ahora
        </button>
      </div>
    </div>
    <p class="text-xs text-slate-500 mb-3">
      ONUs detectadas por la OLT sin configurar, pero cuyo serial ya pertenece a un cliente conocido en SmartRayco
      (ej. se desconfiguraron en la OLT por corte de deuda, cambio de equipo, o se perdio el registro).
      {{ live ? 'Escaneo en vivo' : 'Desde la última sincronización' }}
      <template v-if="checkedAt">— {{ new Date(checkedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) }}</template>
    </p>
    <p v-if="error" class="text-xs text-red-600 mb-3">{{ error }}</p>
    <p v-else-if="!loading && !onts.length" class="text-sm text-slate-500">
      No hay ONUs de clientes conocidos pendientes de reconectar.
    </p>
    <div v-else class="table-shell">
      <table class="w-full text-sm min-w-[820px]">
        <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-2">Board / Port</th>
            <th class="text-left px-4 py-2">SN</th>
            <th class="text-left px-4 py-2">Cliente / Titular</th>
            <th class="text-left px-4 py-2">Usuario PPPoE</th>
            <th class="text-left px-4 py-2">Estado anterior</th>
            <th class="text-right px-4 py-2">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in onts" :key="u.interfaceRef" class="border-t border-slate-200">
            <td class="px-4 py-2 font-mono text-xs text-slate-600">{{ u.slot ?? '?' }} / {{ u.port ?? '?' }}</td>
            <td class="px-4 py-2 font-mono text-xs">{{ u.serial }}</td>
            <td class="px-4 py-2 text-xs text-slate-700">
              <template v-if="u.existingClient">
                {{ u.existingClient.first_name }} {{ u.existingClient.last_name }}
                <span class="block text-[10px] text-slate-400">DNI {{ u.existingClient.document_number }}</span>
              </template>
              <span v-else class="text-slate-400">—</span>
            </td>
            <td class="px-4 py-2 font-mono text-xs text-slate-600">{{ u.existingContract?.pppoe_username ?? '—' }}</td>
            <td class="px-4 py-2 text-xs">
              <span v-if="u.existingContract?.debt_hold_status === 'suspended'" class="badge bg-red-500/15 text-red-700">
                {{ DEBT_HOLD_LABEL.suspended }}
              </span>
              <span v-else-if="u.existingContract" class="text-slate-500">{{ DEBT_HOLD_LABEL[u.existingContract.debt_hold_status] }}</span>
              <span v-else class="text-slate-400">—</span>
            </td>
            <td class="px-4 py-2 text-right">
              <button
                class="text-sky-700 hover:underline text-xs"
                :disabled="u.slot === null || u.port === null || !u.existingClient"
                @click="
                  emit('reauthorize', {
                    serial: u.serial,
                    slot: u.slot!,
                    port: u.port!,
                    clientId: u.existingClient!.id,
                    contractId: u.existingContract?.id,
                  })
                "
              >
                Re-autorizar a {{ u.existingClient?.first_name }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
