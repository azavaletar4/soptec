<script setup lang="ts">
import { computed } from 'vue';
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
