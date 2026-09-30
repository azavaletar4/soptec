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
  authorize: [payload: { serial: string; slot: number; port: number }];
}>();

// "show gpon onu uncfg" (unico comando disponible antes de autorizar una
// ONU) NO trae vendor/tipo real, solo interfaceRef + serial — no existe otro
// comando confirmado en este firmware que de mas que eso. Los primeros 4
// caracteres del serial son el "Vendor ID" ONU estandar (ITU-T G.984), igual
// que se ve en el equipo real (ej. "MSTC8CBF86B4") — se muestra como
// heuristica best-effort, marcada "inferido".
const VENDOR_BY_PREFIX: Record<string, string> = {
  ZTEG: 'ZTE',
  HWTC: 'Huawei',
  FHTT: 'FiberHome',
  ALCL: 'Alcatel/Nokia',
  CIGG: 'CIG',
  MSTC: 'Mercury',
};

function vendorFromSerial(serial: string) {
  const prefix = serial.slice(0, 4).toUpperCase();
  return VENDOR_BY_PREFIX[prefix] ?? prefix;
}
</script>

<template>
  <div class="rounded-xl border border-slate-200 bg-slate-100 p-4 mb-6">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-sm font-semibold">ONUs sin configurar / por autorizar ({{ onts.length }})</h2>
      <div class="flex items-center gap-2">
        <button class="text-xs text-sky-700 hover:underline" :disabled="loading" @click="emit('refresh')">
          {{ loading ? 'Consultando...' : 'Actualizar' }}
        </button>
        <button
          class="text-xs text-amber-700 hover:underline"
          :disabled="loading"
          title="Escaneo Telnet en vivo — usar justo antes de autorizar una ONU nueva, para el dato mas fresco posible"
          @click="emit('refresh-live')"
        >
          Escanear ahora
        </button>
      </div>
    </div>
    <p class="text-xs text-slate-500 mb-3">
      {{ live ? 'Escaneo en vivo' : 'Desde la última sincronización' }}
      <template v-if="checkedAt">— {{ new Date(checkedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) }}</template>
    </p>
    <p v-if="error" class="text-xs text-red-600 mb-3">{{ error }}</p>
    <p v-else-if="!loading && !onts.length" class="text-sm text-slate-500">
      No hay ONUs detectadas sin autorizar en este momento.
    </p>
    <div v-else class="table-shell">
      <table class="w-full text-sm min-w-[720px]">
        <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-2">PON Type</th>
            <th class="text-left px-4 py-2">Board / Port</th>
            <th class="text-left px-4 py-2">PON description</th>
            <th class="text-left px-4 py-2">SN / MAC</th>
            <th class="text-left px-4 py-2">Vendor / Type detectado</th>
            <th class="text-right px-4 py-2">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in onts" :key="u.interfaceRef" class="border-t border-slate-200">
            <td class="px-4 py-2 text-xs text-slate-600">GPON</td>
            <td class="px-4 py-2 font-mono text-xs text-slate-600">{{ u.slot ?? '?' }} / {{ u.port ?? '?' }}</td>
            <td class="px-4 py-2 text-xs text-slate-600">Slot {{ u.slot ?? '?' }} · Puerto {{ u.port ?? '?' }}</td>
            <td class="px-4 py-2 font-mono text-xs">{{ u.serial }}</td>
            <td class="px-4 py-2 text-xs text-slate-500" :title="'Inferido del prefijo del serial, no confirmado por la OLT'">
              {{ vendorFromSerial(u.serial) }} <span class="text-[10px] text-slate-400">(inferido)</span>
            </td>
            <td class="px-4 py-2 text-right">
              <button
                class="text-sky-700 hover:underline text-xs"
                :disabled="u.slot === null || u.port === null"
                @click="emit('authorize', { serial: u.serial, slot: u.slot!, port: u.port! })"
              >
                + Autorizar
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="text-[11px] text-slate-400 mt-3">
      El ID de ONU se calcula automáticamente al autorizar (el número que muestra la OLT aquí no es
      confiable como ID libre).
    </p>
  </div>
</template>
