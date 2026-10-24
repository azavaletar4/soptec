<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { supabase } from '@/lib/supabase';
import { usePersonalRead } from '@/composables/usePersonalRead';
interface OrderPoints {
  jobPoints: number; configuredPoints: number | null; personalPoints: number;
  crewSize: number; status: string; asOf: string;
}
const pointNumber = (value: number) => new Intl.NumberFormat('es-PE', { maximumFractionDigits: 4 }).format(value);
const props = defineProps<{ jobType: string; jobId: string }>();
const auth = useAuthStore();
const identity = computed(() => auth.role === 'TECNICO_RED' && auth.user?.id ? `${auth.user.id}:${props.jobType}:${props.jobId}` : null);
const { data, loading, error, load } = usePersonalRead(identity, async () => {
  const { data, error } = await supabase.rpc('my_field_order_points', { p_job_type: props.jobType, p_job_id: props.jobId });
  if (error) throw error;
  return data as unknown as OrderPoints | null;
});
let channel: ReturnType<typeof supabase.channel> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let stopWatching: (() => void) | undefined;
function disconnect() {
  if (channel) { void supabase.removeChannel(channel); channel = null; }
  if (timer) { clearInterval(timer); timer = null; }
}
function refresh() { if (identity.value && document.visibilityState === 'visible') void load(); }
onMounted(() => {
  stopWatching = watch(identity, (key) => {
    disconnect();
    if (!key) return;
    const table = { ticket: 'tickets', installation: 'installations', routine: 'routines' }[props.jobType];
    if (!table) return;
    channel = supabase.channel(`field-order-points:${key}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter: `id=eq.${props.jobId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_assignees', filter: `job_id=eq.${props.jobId}` }, refresh)
      .subscribe((status) => { if (status === 'SUBSCRIBED') refresh(); });
    // Fallback si realtime se interrumpe o DELETE no incluye el job_id.
    timer = setInterval(refresh, 15000);
  }, { immediate: true });
  window.addEventListener('focus', refresh);
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', refresh);
});
onBeforeUnmount(() => {
  stopWatching?.(); disconnect();
  window.removeEventListener('focus', refresh);
  window.removeEventListener('online', refresh);
  document.removeEventListener('visibilitychange', refresh);
});
</script>

<template>
  <section v-if="identity" class="surface p-3 mb-3 text-xs" aria-live="polite">
    <div class="flex items-center justify-between gap-2">
      <h2 class="font-semibold text-sm">Puntos de la orden</h2>
      <button class="text-sky-700 p-2" :disabled="loading" @click="load">Actualizar</button>
    </div>
    <p v-if="loading" class="text-slate-500">Consultando puntos…</p>
    <p v-else-if="error" class="text-red-700">No se pudieron consultar los puntos. Intenta actualizar.</p>
    <p v-else-if="!data" class="text-slate-500">Orden no disponible para tu asignación actual.</p>
    <template v-else>
      <p class="mt-1">Puntaje actual: <strong>{{ pointNumber(data.jobPoints) }} pts</strong></p>
      <p class="mt-1">Tu parte asignada: {{ pointNumber(data.personalPoints) }} pts · {{ data.crewSize }} integrante(s)</p>
      <p v-if="data.configuredPoints == null" class="text-slate-500 mt-1">Sin asignación manual; se muestra la regla vigente.</p>
      <p class="text-slate-500 mt-2">Solo consulta del puntaje asignado. No confirma acreditación administrativa.</p>
    </template>
  </section>
</template>
