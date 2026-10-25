<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { supabase } from '@/lib/supabase';
import { usePersonalRead } from '@/composables/usePersonalRead';
import { pointNumber, type PointContribution } from '@/lib/fieldProgress';
const props = defineProps<{ jobType: string; jobId: string }>();
const auth = useAuthStore();
const identity = computed(() => auth.role === 'TECNICO_RED' && auth.user?.id ? `${auth.user.id}:${props.jobType}:${props.jobId}` : null);
const { data, loading, error, load } = usePersonalRead(identity, async () => {
  const { data, error } = await supabase.rpc('my_field_job_points', { p_job_type: props.jobType, p_job_id: props.jobId });
  if (error) throw error;
  return data as unknown as Pick<PointContribution, 'kind' | 'points' | 'crewSize' | 'occurredAt'>[] | null;
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
    channel = supabase.channel(`field-job-contribution:${key}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter: `id=eq.${props.jobId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_assignees', filter: `job_id=eq.${props.jobId}` }, refresh)
      .subscribe((status) => { if (status === 'SUBSCRIBED') refresh(); });
    // Confirming unchanged points need not UPDATE the order. The confirmation
    // table is admin-only; technicians refresh through their own read RPC.
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
      <h2 class="font-semibold text-sm">Mi aporte en puntos</h2>
      <button class="text-sky-700 p-2" :disabled="loading" @click="load">Actualizar</button>
    </div>
    <p v-if="loading" class="text-slate-500">Consultando aporte…</p>
    <p v-else-if="error" class="text-red-700">No se pudo consultar el aporte. Intenta actualizar.</p>
    <p v-else-if="!data?.length" class="text-slate-500">Sin aporte registrado para ti en este trabajo.</p>
    <template v-else>
      <p v-for="e in data" :key="e.kind" class="mt-1" :class="e.points < 0 ? 'text-red-700' : ''">
        {{ e.kind === 'recurrence' ? 'Descuento por reincidencia' : 'Aporte del trabajo' }}:
        <strong>{{ pointNumber(e.points) }} pts</strong> · {{ e.crewSize }} integrante(s)
      </p>
      <p class="text-slate-500 mt-2">Desde noviembre, los aportes oficiales requieren confirmación administrativa y quedan congelados. Octubre corresponde a pruebas.</p>
    </template>
  </section>
</template>
