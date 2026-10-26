<script setup lang="ts">
import { computed, ref, watch, onScopeDispose } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { supabase } from '@/lib/supabase';
import { getErrorMessage } from '@/lib/errors';
import { pointsAreEditable, requireWorkOrderPoints, type WorkOrderPointReview, type PointConfirmation } from '@/lib/workOrderPoints';
import type { JobType } from '@/types/domain';

const props = defineProps<{ jobType: JobType; jobId: string; status: string; points: number | null }>();
const emit = defineEmits<{ saved: [points: number]; confirmed: [confirmation: PointConfirmation] }>();
const auth = useAuthStore();
const isAdmin = computed(() => ['ADMIN', 'SUPERADMIN'].includes(auth.role ?? ''));
const review = ref<WorkOrderPointReview | null>(null);
const reviewLoading = ref(false);
const reviewError = ref('');
const currentPoints = computed(() => review.value ? review.value.points : props.points);
let reviewGeneration = 0;
const allowed = computed(() => isAdmin.value && !reviewLoading.value && !!review.value && !review.value.confirmation &&
  (review.value.canAdjustPoints ?? (!review.value.historical || review.value.prospectPointsPending === true)) &&
  (pointsAreEditable(review.value.status) || review.value.finished));
const canConfirm = computed(() => isAdmin.value && !reviewLoading.value && !!review.value?.finished &&
  !review.value.confirmation && !!review.value.technicalCompletedAt && !!review.value.crew.length);
const showConfirmation = ref(false);
const explicitlyConfirmed = ref(false);
const draft = ref<number | ''>('');
const reason = ref('');
const pointsChanged = computed(() => !!review.value && draft.value !== review.value.points);
const validDraft = computed(() => {
  try { return requireWorkOrderPoints(draft.value, props.jobType === 'ticket'); }
  catch { return null; }
});
const saving = ref(false);
const error = ref('');
const history = ref<{ id: string; old_points: number | null; new_points: number; changed_by: string; changed_at: string; reason: string }[]>([]);
const historyError = ref('');
let historyGeneration = 0;
onScopeDispose(() => { reviewGeneration++; historyGeneration++; });
async function loadReview() {
  const generation = ++reviewGeneration;
  review.value = null;
  reviewError.value = '';
  showConfirmation.value = false;
  explicitlyConfirmed.value = false;
  if (!isAdmin.value) { reviewLoading.value = false; return; }
  reviewLoading.value = true;
  try {
    const { data, error: err } = await supabase.rpc('work_order_point_review', { p_job_type: props.jobType, p_job_id: props.jobId });
    if (err) throw err;
    if (generation !== reviewGeneration) return;
    const next = data as unknown as WorkOrderPointReview;
    if (next?.definitiveClosure !== true) throw new Error('Falta instalar la candidata 20261024200000 de cierre definitivo; no se puede editar ni confirmar con la versión anterior.');
    review.value = next;
    draft.value = review.value.points ?? '';
    reason.value = '';
  } catch (e) { if (generation === reviewGeneration) reviewError.value = getErrorMessage(e, 'No se pudo revisar la orden'); }
  finally { if (generation === reviewGeneration) reviewLoading.value = false; }
}
async function loadHistory() {
  const generation = ++historyGeneration;
  history.value = [];
  historyError.value = '';
  if (!['ADMIN', 'SUPERADMIN'].includes(auth.role ?? '')) return;
  const { data, error: err } = await supabase.from('work_order_point_changes')
    .select('id,old_points,new_points,changed_by,changed_at,reason')
    .eq('job_type', props.jobType).eq('job_id', props.jobId)
    .order('changed_at', { ascending: false }).limit(20);
  if (generation !== historyGeneration || !isAdmin.value) return;
  if (err) historyError.value = getErrorMessage(err, 'No se pudo cargar el historial');
  else history.value = data ?? [];
}
watch(() => [props.jobId, props.jobType, auth.role, auth.user?.id], () => { void loadHistory(); }, { immediate: true });
watch(() => [props.jobId, props.jobType, props.status, props.points, auth.role, auth.user?.id], () => { void loadReview(); }, { immediate: true });
watch([draft, reason], () => { explicitlyConfirmed.value = false; });
async function save() {
  if (!allowed.value || saving.value) return;
  const generation = reviewGeneration;
  error.value = '';
  try {
    const points = requireWorkOrderPoints(draft.value, props.jobType === 'ticket');
    if (!reason.value.trim()) throw new Error('Indica el motivo del ajuste.');
    saving.value = true;
    const { error: err } = await supabase.rpc('adjust_work_order_points', {
      p_job_type: props.jobType, p_job_id: props.jobId, p_points: points,
      p_expected_points: review.value!.points, p_reason: reason.value.trim(),
    });
    if (err) throw err;
    if (generation !== reviewGeneration) return;
    emit('saved', points);
    reason.value = '';
    await Promise.all([loadHistory(), loadReview()]);
  } catch (e) { if (generation === reviewGeneration) error.value = getErrorMessage(e, 'No se pudo ajustar el puntaje'); }
  finally { saving.value = false; }
}
function openConfirmation() {
  error.value = '';
  if (!canConfirm.value || saving.value) return;
  explicitlyConfirmed.value = false;
  showConfirmation.value = true;
}
async function confirmPoints() {
  if (!canConfirm.value || !review.value || saving.value || !explicitlyConfirmed.value) return;
  const generation = reviewGeneration;
  error.value = '';
  try {
    const points = requireWorkOrderPoints(draft.value, props.jobType === 'ticket');
    if (pointsChanged.value && !allowed.value) throw new Error('Esta orden no permite modificar sus puntos. Actualiza la revisión.');
    if (points !== review.value.points && !reason.value.trim()) throw new Error('Indica el motivo del ajuste.');
    saving.value = true;
    const { data, error: err } = await supabase.rpc('confirm_work_order_points', {
      p_job_type: props.jobType, p_job_id: props.jobId, p_points: points,
      p_expected_token: review.value.token, p_reason: reason.value.trim(), p_confirmed: true,
    });
    if (err) throw err;
    if (generation !== reviewGeneration) return;
    const confirmation = data as unknown as PointConfirmation;
    emit('saved', Number(confirmation.points));
    emit('confirmed', confirmation);
    showConfirmation.value = false;
    await Promise.all([loadReview(), loadHistory()]);
  } catch (e) { if (generation === reviewGeneration) error.value = getErrorMessage(e, 'No se pudo confirmar; actualiza la revisión antes de reintentar'); }
  finally { saving.value = false; }
}
const formatPoints = (points: number) => new Intl.NumberFormat('es-PE', { maximumFractionDigits: 4 }).format(points);
</script>

<template>
  <div class="mt-3 border-t border-slate-100 pt-3">
    <p class="text-xs text-slate-600">Puntos de la orden: {{ currentPoints ?? (jobType === 'installation' ? '10 (regla histórica)' : 'Sin asignación manual') }}</p>
    <p v-if="reviewLoading" class="text-xs mt-2">Consultando confirmación administrativa…</p>
    <p v-if="reviewError" role="alert" class="text-xs text-red-600 mt-2">{{ reviewError }}</p>
    <button v-if="isAdmin" type="button" class="text-xs text-sky-700 mt-2" :disabled="saving || reviewLoading" @click="loadReview">Actualizar revisión de puntos</button>
    <p v-if="review?.prospectPointsPending" class="text-xs text-amber-700 mt-2">Alta de Prospecto con puntos pendientes: ADMIN/SUPERADMIN debe asignar y confirmar un valor mayor que 0 antes del cierre administrativo definitivo.</p>
    <p v-else-if="review?.historical && !allowed" class="text-xs text-amber-700 mt-2">Puntaje histórico protegido. Esta confirmación no acredita puntos oficiales.</p>
    <form v-if="allowed" class="mt-2 space-y-2" @submit.prevent="save">
      <label class="block text-xs">Nuevo puntaje
        <input v-model.number="draft" type="number" :step="jobType === 'ticket' ? '1' : 'any'" :min="jobType === 'ticket' ? 1 : 0" required class="field-input" :disabled="saving" />
      </label>
      <label class="block text-xs">Motivo del ajuste
        <input v-model="reason" required maxlength="1000" class="field-input" :disabled="saving" />
      </label>
      <button type="submit" class="btn-secondary text-xs" :disabled="saving">{{ saving ? 'Guardando...' : 'Guardar puntaje' }}</button>
    </form>
    <p v-else-if="!isAdmin" class="text-xs text-slate-500 mt-1">Solo ADMIN/SUPERADMIN puede ajustar y confirmar puntos.</p>
    <div v-if="review?.confirmation" class="text-xs mt-2 space-y-1">
      <p class="font-semibold">Puntos confirmados: {{ formatPoints(review.confirmation.points) }}</p>
      <p class="font-semibold">Cierre administrativo definitivo. No se puede reabrir ni modificar la orden.</p>
      <p>{{ new Date(review.confirmation.confirmed_at).toLocaleString('es-PE', { timeZone: 'America/Lima' }) }} (Lima) · Responsable: {{ review.confirmation.confirmed_by }}</p>
      <p v-if="review.confirmation.recurrence_penalty">Descuento confirmado por reincidencia: {{ formatPoints(review.confirmation.recurrence_penalty) }} pts. Neto: {{ formatPoints(review.confirmation.points - review.confirmation.recurrence_penalty) }} pts.</p>
      <p v-for="member in review.confirmation.crew" :key="member.technicianId">{{ member.name }} · {{ member.role === 'leader' ? 'Líder' : 'Ayudante' }}: {{ formatPoints(member.netPoints ?? ((review.confirmation.points - (review.confirmation.recurrence_penalty ?? 0)) / review.confirmation.crew.length)) }} pts netos</p>
      <p>Importes y reparto congelados. Una incidencia posterior requiere una nueva orden.</p>
    </div>
    <template v-else-if="review">
      <p v-if="!review.finished" class="text-xs text-slate-500 mt-2">Disponible para confirmar puntos cuando el técnico termine la orden.</p>
      <p v-else-if="!review.technicalCompletedAt" class="text-xs text-amber-700 mt-2">Falta la fecha de finalización técnica; revisa la orden antes de confirmar puntos.</p>
      <p v-else-if="!review.crew.length" class="text-xs text-amber-700 mt-2">Asigna la cuadrilla antes de confirmar puntos.</p>
      <button v-if="canConfirm" type="button" class="btn-primary text-xs mt-2" :disabled="saving" @click="openConfirmation">Revisar confirmación administrativa</button>
    </template>
    <p v-if="error" role="alert" class="text-xs text-red-600 mt-1">{{ error }}</p>
    <p class="text-xs text-slate-500 mt-1">Se reparte entre los integrantes de la cuadrilla.</p>
    <p v-if="isAdmin && historyError" class="text-xs text-red-600 mt-2">{{ historyError }}</p>
    <details v-if="isAdmin && history.length" class="text-xs mt-2">
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
    <div v-if="showConfirmation && review" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="point-confirm-title">
      <form class="modal-panel w-full max-w-lg p-5 space-y-3" @submit.prevent="confirmPoints">
        <h3 id="point-confirm-title" class="font-semibold">Confirmar puntos definitivos</h3>
        <p>Puntos vigentes de la orden: <strong>{{ review.points == null ? 'Sin asignación manual' : formatPoints(review.points) + ' pts' }}</strong></p>
        <label v-if="allowed" class="block text-sm">Puntos definitivos de la orden
          <input v-model.number="draft" type="number" :step="jobType === 'ticket' ? '1' : 'any'" :min="jobType === 'ticket' ? 1 : 0" required class="field-input" :disabled="saving" />
        </label>
        <p v-else>Puntos definitivos: <strong>{{ validDraft == null ? 'Sin asignación' : formatPoints(validDraft) + ' pts' }}</strong></p>
        <label v-if="allowed && pointsChanged" class="block text-sm">Motivo del ajuste
          <input v-model="reason" required maxlength="1000" class="field-input" :disabled="saving" />
        </label>
        <p v-if="validDraft == null" class="text-sm text-amber-700">Ingresa un puntaje válido mayor que 0 antes de confirmar.</p>
        <p v-if="review.recurrencePenalty && validDraft != null" class="text-sm">Descuento existente por reincidencia: {{ formatPoints(review.recurrencePenalty) }} pts. Total neto a congelar: {{ formatPoints(validDraft - review.recurrencePenalty) }} pts.</p>
        <p v-if="review.historical" class="text-sm text-amber-700">Orden de prueba de octubre, sin acreditación oficial.</p>
        <ul class="text-sm space-y-1">
          <li v-for="member in review.crew" :key="member.technicianId">{{ member.name }} · {{ member.role === 'leader' ? 'Líder' : 'Ayudante' }}: {{ validDraft == null ? '—' : formatPoints((validDraft - (review.recurrencePenalty ?? 0)) / review.crew.length) }} pts netos</li>
        </ul>
        <p v-if="draft !== review.points" class="text-sm">Cambio {{ review.points ?? 'sin asignación' }} → {{ draft }} pts. Motivo: {{ reason || 'Falta indicar motivo' }}</p>
        <label class="flex gap-2 text-sm"><input v-model="explicitlyConfirmed" type="checkbox" required :disabled="saving" />Confirmo que los puntos y su distribución son correctos.</label>
        <p class="text-xs text-slate-500">Este cierre administrativo es definitivo y no cambia el estado técnico. Después no se podrá modificar, cancelar ni reabrir la orden. Una incidencia nueva requiere una nueva orden.</p>
        <p v-if="error" role="alert" class="text-sm text-red-600">{{ error }}</p>
        <div class="flex gap-2 justify-end">
          <button type="button" class="btn-secondary" :disabled="saving" @click="showConfirmation = false">Volver</button>
          <button type="submit" class="btn-primary" :disabled="saving || !explicitlyConfirmed || validDraft == null || (pointsChanged && (!allowed || !reason.trim()))">{{ saving ? 'Confirmando…' : 'Confirmar puntos' }}</button>
        </div>
      </form>
    </div>
  </div>
</template>
