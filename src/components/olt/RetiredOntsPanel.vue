<script setup lang="ts">
import { ref, watch } from 'vue';
import { apiFetch } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import type { OltOnt } from '@/stores/olt';
const props = defineProps<{ deviceId: string }>();
const rows = ref<OltOnt[]>([]);
const loading = ref(false);
const error = ref('');
let epoch = 0;
async function load() {
  const current = ++epoch;
  rows.value = []; error.value = ''; loading.value = true;
  try {
    const result = await apiFetch<OltOnt[]>(`/api/olt-devices/${props.deviceId}/onts/retired`);
    if (current === epoch) rows.value = result.filter(row => !!row.retired_at);
  } catch (e) { if (current === epoch) error.value = getErrorMessage(e); }
  finally { if (current === epoch) loading.value = false; }
}
watch(() => props.deviceId, load, { immediate: true });
</script>

<template>
  <section aria-label="ONT retiradas">
    <p class="text-sm text-slate-600 mb-3">Registros históricos. La última posición no representa una posición activa ni permite operar sobre la OLT.</p>
    <p v-if="loading" role="status">Cargando historial…</p>
    <p v-else-if="error" role="alert">{{ error }} <button type="button" class="underline" @click="load">Reintentar</button></p>
    <p v-else-if="!rows.length">Sin ONT retiradas.</p>
    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm text-left">
        <thead><tr><th>Serial</th><th>Descripción histórica</th><th>Última posición histórica</th><th>Retirada el</th></tr></thead>
        <tbody><tr v-for="row in rows" :key="row.id">
          <td class="py-3 font-mono">{{ row.serial }}</td><td>{{ row.description || '—' }}</td>
          <td>{{ row.frame }}/{{ row.slot }}/{{ row.port }}:{{ row.ont_id }}</td>
          <td>{{ row.retired_at ? new Date(row.retired_at).toLocaleString('es-PE') : '—' }}</td>
        </tr></tbody>
      </table>
    </div>
  </section>
</template>
