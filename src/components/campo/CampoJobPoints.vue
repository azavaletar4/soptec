<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { supabase } from '@/lib/supabase';
import { usePersonalRead } from '@/composables/usePersonalRead';
interface OrderPoints {
  jobPoints: number; configuredPoints: number | null; personalPoints: number;
  crewSize: number; status: string; asOf: string;
  scoringState?: 'historical' | 'pending' | 'confirmed';
  creditedPoints?: number | null; recurrencePenalty?: number; creditedAt?: string;
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
      <template v-if="data.scoringState === 'confirmed'">
        <p class="mt-1">Puntos confirmados de la orden: <strong>{{ pointNumber(data.jobPoints) }} pts</strong></p>
        <p class="mt-1">Tu parte: {{ pointNumber(data.personalPoints) }} pts · {{ data.crewSize }} integrante(s)</p>
        <p v-if="data.recurrencePenalty" class="mt-1">Descuento por reincidencia: {{ pointNumber(data.recurrencePenalty) }} pts</p>
        <p class="mt-1">Tu aporte neto: <strong>{{ pointNumber(data.creditedPoints ?? 0) }} pts</strong></p>
        <p v-if="data.creditedAt" class="mt-1 text-slate-500">Acreditado: {{ new Date(data.creditedAt).toLocaleString('es-PE', { timeZone: 'America/Lima' }) }} (Perú). Se incluye en el período de confirmación.</p>
      </template>
      <template v-else>
        <p class="mt-1">Puntos totales: <strong>{{ pointNumber(data.jobPoints) }} pts</strong></p>
        <p class="mt-1">Tu parte asignada: {{ pointNumber(data.personalPoints) }} pts · {{ data.crewSize }} integrante(s)</p>
        <p v-if="data.scoringState === 'pending'" class="mt-1 text-slate-500">Pendiente de confirmación administrativa. Estos puntos todavía no suman en Mi Avance ni en Ranking.</p>
        <p v-else-if="data.scoringState === 'historical'" class="mt-1 text-slate-500">Orden del período piloto. Conserva su cálculo histórico y no se traslada a los puntos oficiales de noviembre.</p>
      </template>
    </template>
  </section>
</template>
