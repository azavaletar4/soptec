<script setup lang="ts">
import { useRouter } from 'vue-router';
import type { DisabledOnt } from '@/stores/olt';

defineProps<{
  items: DisabledOnt[];
  loading: boolean;
  error: string | null;
  checkedAt: string | null;
  enablingId: string | null;
}>();

const emit = defineEmits<{
  refresh: [];
  'enable-service': [ont: DisabledOnt];
}>();

const router = useRouter();

function clientName(ont: DisabledOnt) {
  if (!ont.clients) return ont.description || 'Sin cliente vinculado';
  return `${ont.clients.first_name} ${ont.clients.last_name}`;
}

function goToClient(ont: DisabledOnt) {
  if (!ont.client_id) return;
  router.push(`/clientes/${ont.client_id}`);
}
</script>

<template>
  <div class="rounded-xl border border-slate-200 bg-slate-100 p-4 mb-6">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-sm font-semibold">ONUs deshabilitadas / cortadas ({{ items.length }})</h2>
      <button class="text-xs text-sky-700 hover:underline" :disabled="loading" @click="emit('refresh')">
        {{ loading ? 'Consultando...' : 'Actualizar' }}
      </button>
    </div>
    <p class="text-xs text-slate-500 mb-3">
      <template v-if="checkedAt">Desde la última sincronización — {{ new Date(checkedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) }}</template>
    </p>
    <p v-if="error" class="text-xs text-red-600 mb-3">{{ error }}</p>
    <p v-else-if="!loading && !items.length" class="text-sm text-slate-500">
      No hay ONUs deshabilitadas ni cortadas por mora en este momento.
    </p>
    <div v-else class="table-shell">
      <table class="w-full text-sm min-w-[720px]">
        <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-2">Posición</th>
            <th class="text-left px-4 py-2">Serial</th>
            <th class="text-left px-4 py-2">Cliente</th>
            <th class="text-left px-4 py-2">Motivo</th>
            <th class="text-right px-4 py-2">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="ont in items" :key="ont.id" class="border-t border-slate-200">
            <td class="px-4 py-2 font-mono text-xs text-slate-600">{{ ont.frame }}/{{ ont.slot }}/{{ ont.port }}:{{ ont.ont_id }}</td>
            <td class="px-4 py-2 font-mono text-xs">{{ ont.serial }}</td>
            <td class="px-4 py-2 text-xs">{{ clientName(ont) }}</td>
            <td class="px-4 py-2 text-xs">
              <span
                v-if="ont.reason === 'manual' || ont.reason === 'both'"
                class="inline-block px-2 py-0.5 rounded-full bg-slate-500/15 text-slate-600 mr-1"
              >
                Desactivado manualmente
              </span>
              <span
                v-if="ont.reason === 'billing' || ont.reason === 'both'"
                class="inline-block px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700"
              >
                Corte por facturación / mora
              </span>
              <p v-if="ont.reason === 'both'" class="text-[11px] text-slate-400 mt-1">
                Al habilitar el servicio, el ancho de banda seguirá reducido por mora hasta regularizar el pago.
              </p>
            </td>
            <td class="px-4 py-2 text-right whitespace-nowrap">
              <button
                v-if="ont.reason === 'manual' || ont.reason === 'both'"
                class="text-sky-700 hover:underline text-xs mr-3 disabled:opacity-50"
                :disabled="enablingId === ont.id"
                @click="emit('enable-service', ont)"
              >
                {{ enablingId === ont.id ? 'Habilitando...' : 'Habilitar Servicio' }}
              </button>
              <button
                v-else
                class="text-slate-400 text-xs mr-3 cursor-not-allowed"
                disabled
                title="Es un corte por facturación — no hay admin-state que habilitar aquí; corresponde reactivarlo desde Facturación"
              >
                Habilitar Servicio
              </button>
              <button v-if="ont.client_id" class="text-slate-600 hover:underline text-xs" @click="goToClient(ont)">
                Ver Cliente Asociado
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
