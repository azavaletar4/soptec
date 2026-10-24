<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { supabase } from '@/lib/supabase';
import { getErrorMessage } from '@/lib/errors';
import { pointsAreEditable, requireWorkOrderPoints } from '@/lib/workOrderPoints';
import type { JobType } from '@/types/domain';

const props = defineProps<{ jobType: JobType; jobId: string; status: string; points: number | null }>();
const emit = defineEmits<{ saved: [points: number] }>();
const auth = useAuthStore();
const allowed = computed(() => ['ADMIN', 'SUPERADMIN'].includes(auth.role ?? '') && pointsAreEditable(props.status));
const draft = ref<number | ''>('');
const reason = ref('');
const saving = ref(false);
const error = ref('');
const history = ref<{ id: string; old_points: number | null; new_points: number; changed_by: string; changed_at: string; reason: string }[]>([]);
const historyError = ref('');
async function loadHistory() {
  history.value = [];
  historyError.value = '';
  if (!['ADMIN', 'SUPERADMIN'].includes(auth.role ?? '')) return;
  const { data, error: err } = await supabase.from('work_order_point_changes')
    .select('id,old_points,new_points,changed_by,changed_at,reason')
    .eq('job_type', props.jobType).eq('job_id', props.jobId)
    .order('changed_at', { ascending: false }).limit(20);
  if (err) historyError.value = getErrorMessage(err, 'No se pudo cargar el historial');
  else history.value = data ?? [];
}
watch(() => [props.jobId, props.jobType, auth.role], () => { void loadHistory(); }, { immediate: true });
watch(() => [props.jobId, props.points], () => { draft.value = props.points ?? ''; reason.value = ''; }, { immediate: true });
async function save() {
  if (!allowed.value || saving.value) return;
  error.value = '';
  try {
    const points = requireWorkOrderPoints(draft.value, props.jobType === 'ticket');
    if (!reason.value.trim()) throw new Error('Indica el motivo del ajuste.');
    saving.value = true;
    const { error: err } = await supabase.rpc('adjust_work_order_points', {
      p_job_type: props.jobType, p_job_id: props.jobId, p_points: points,
      p_expected_points: props.points, p_reason: reason.value.trim(),
    });
    if (err) throw err;
    emit('saved', points);
    reason.value = '';
    await loadHistory();
  } catch (e) { error.value = getErrorMessage(e, 'No se pudo ajustar el puntaje'); }
  finally { saving.value = false; }
}
</script>

<template>
  <div class="mt-3 border-t border-slate-100 pt-3">
    <p class="text-xs text-slate-600">Puntos de la orden: {{ points ?? (jobType === 'installation' ? '10 (regla histórica)' : 'Sin asignación manual') }}</p>
    <form v-if="allowed" class="mt-2 space-y-2" @submit.prevent="save">
      <label class="block text-xs">Nuevo puntaje
        <input v-model.number="draft" type="number" :step="jobType === 'ticket' ? '1' : 'any'" :min="jobType === 'ticket' ? 1 : 0" required class="field-input" :disabled="saving" />
      </label>
      <label class="block text-xs">Motivo del ajuste
        <input v-model="reason" required maxlength="1000" class="field-input" :disabled="saving" />
      </label>
      <button type="submit" class="btn-secondary text-xs" :disabled="saving">{{ saving ? 'Guardando...' : 'Guardar puntaje' }}</button>
    </form>
    <p v-else class="text-xs text-slate-500 mt-1">Solo ADMIN/SUPERADMIN puede ajustar puntos antes del cierre del técnico.</p>
    <p v-if="error" role="alert" class="text-xs text-red-600 mt-1">{{ error }}</p>
    <p class="text-xs text-slate-500 mt-1">Se reparte entre los integrantes de la cuadrilla.</p>
    <p v-if="historyError" class="text-xs text-red-600 mt-2">{{ historyError }}</p>
    <details v-if="history.length" class="text-xs mt-2">
      <summary>Últimos ajustes (hasta 20)</summary>
      <ul class="space-y-2 mt-2">
        <li v-for="change in history" :key="change.id" class="break-words">
          {{ change.old_points ?? 'Sin asignación manual' }} → {{ change.new_points }} pts ·
          {{ new Date(change.changed_at).toLocaleString('es-PE', { timeZone: 'America/Lima' }) }} (Lima)
          <p>{{ change.reason }}</p>
          <p class="text-slate-500">Responsable: {{ change.changed_by }}</p>
        </li>
      </ul>
    </details>
  </div>
</template>
