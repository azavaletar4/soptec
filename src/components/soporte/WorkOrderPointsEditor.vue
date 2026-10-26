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
const allowed = computed(() => isAdmin.value && !reviewLoading.value && !!review.value && !review.value.confirmation &&
  (review.value.canAdjustPoints ?? (!review.value.historical || review.value.prospectPointsPending === true)) &&
  (pointsAreEditable(review.value.status) || review.value.finished));
const canConfirm = computed(() => isAdmin.value && !reviewLoading.value && !!review.value?.finished &&
  !review.value.confirmation && !!review.value.technicalCompletedAt && !!review.value.crew.length);
const draft = ref<number | ''>('');
const reason = ref('');
const saving = ref(false);
const error = ref('');
const pointsChanged = computed(() => !!review.value && draft.value !== review.value.points);
const validDraft = computed(() => {
  try { return requireWorkOrderPoints(draft.value, props.jobType === 'ticket'); }
  catch { return null; }
});
const canSubmit = computed(() => canConfirm.value && validDraft.value != null &&
  (!pointsChanged.value || (allowed.value && !!reason.value.trim())));
type Change = { id: string; old_points: number | null; new_points: number; changed_by: string; changed_at: string; reason: string };
const history = ref<Change[]>([]);
const firstChange = ref<{ old_points: number | null } | null | undefined>();
const historyError = ref('');
const names = ref<Record<string, string>>({});
const namesLoading = ref(false);
const namesError = ref('');
let reviewGeneration = 0, historyGeneration = 0, namesGeneration = 0;
onScopeDispose(() => { reviewGeneration++; historyGeneration++; namesGeneration++; });
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const safeText = (text: string) => text.replace(uuid, '[referencia]');
const personName = (name?: string | null) => name?.replace(uuid, '').trim() || 'Nombre no disponible';
const formatPoints = (points: number) => new Intl.NumberFormat('es-PE', { maximumFractionDigits: 4 }).format(points);
const pointsText = (points: number | null) => points == null ? 'Sin asignación' : formatPoints(points);
const initialText = computed(() => firstChange.value === undefined
  ? (historyError.value ? 'No disponible' : 'Consultando…')
  : pointsText(firstChange.value === null ? currentPoints.value : firstChange.value.old_points));
const dateText = (date: string) => new Date(date).toLocaleString('es-PE', { timeZone: 'America/Lima' });
const responsibleName = (id: string) => names.value[id] ?? (namesLoading.value ? 'Consultando…' : 'Nombre no disponible');

async function loadReview(preserveDraft = false): Promise<WorkOrderPointReview | null> {
  const generation = ++reviewGeneration;
  reviewError.value = '';
  if (!preserveDraft) { review.value = null; draft.value = ''; reason.value = ''; error.value = ''; }
  if (!isAdmin.value) { reviewLoading.value = false; return null; }
  reviewLoading.value = true;
  try {
    const { data, error: err } = await supabase.rpc('work_order_point_review', { p_job_type: props.jobType, p_job_id: props.jobId });
    if (err) throw err;
    if (generation !== reviewGeneration) return null;
    const next = data as unknown as WorkOrderPointReview;
    if (next?.definitiveClosure !== true) throw new Error('No se pudo verificar el cierre de esta orden.');
    review.value = next;
    if (!preserveDraft || next.confirmation) { draft.value = next.points ?? ''; reason.value = ''; }
    return next;
  } catch (e) {
    if (generation === reviewGeneration) reviewError.value = safeText(getErrorMessage(e, 'No se pudo consultar la orden.'));
    return null;
  } finally { if (generation === reviewGeneration) reviewLoading.value = false; }
}
async function loadHistory(keepInitial = false) {
  const generation = ++historyGeneration;
  history.value = []; historyError.value = '';
  if (!keepInitial) firstChange.value = undefined;
  if (!isAdmin.value) return;
  try {
    const [recent, first] = await Promise.all([
      supabase.from('work_order_point_changes').select('id,old_points,new_points,changed_by,changed_at,reason')
        .eq('job_type', props.jobType).eq('job_id', props.jobId).order('changed_at', { ascending: false }).limit(20),
      supabase.from('work_order_point_changes').select('old_points')
        .eq('job_type', props.jobType).eq('job_id', props.jobId)
        .order('changed_at', { ascending: true }).order('id', { ascending: true }).limit(1),
    ]);
    if (generation !== historyGeneration || !isAdmin.value) return;
    if (recent.error) throw recent.error;
    if (first.error) throw first.error;
    history.value = recent.data ?? [];
    firstChange.value = first.data?.[0] ?? null;
  } catch (e) {
    if (generation === historyGeneration) {
      historyError.value = safeText(getErrorMessage(e, 'No se pudo consultar el historial.'));
      if (!keepInitial) firstChange.value = undefined;
    }
  }
}
async function loadNames() {
  const generation = ++namesGeneration;
  names.value = {}; namesError.value = ''; namesLoading.value = false;
  if (!isAdmin.value) return;
  const ids = [...new Set([review.value?.confirmation?.confirmed_by, ...history.value.map(c => c.changed_by)].filter((id): id is string => !!id))];
  if (!ids.length) return;
  namesLoading.value = true;
  try {
    // Minimal caller-authenticated SELECT under existing profiles RLS. Include
    // inactive former staff; do not use an active-only catalog or privileged key.
    const { data, error: err } = await supabase.from('profiles').select('id,full_name').in('id', ids);
    if (err) throw err;
    if (generation === namesGeneration && isAdmin.value) names.value = Object.fromEntries((data ?? []).map(p => [p.id, personName(p.full_name)]));
  } catch {
    if (generation === namesGeneration) namesError.value = 'No se pudo consultar el nombre del responsable.';
  } finally { if (generation === namesGeneration) namesLoading.value = false; }
}
watch(() => [props.jobId, props.jobType, auth.role, auth.user?.id], () => { void loadHistory(); }, { immediate: true });
watch(() => [props.jobId, props.jobType, props.status, props.points, auth.role, auth.user?.id], () => { void loadReview(); }, { immediate: true });
watch(() => [auth.role, auth.user?.id, review.value?.confirmation?.confirmed_by, ...history.value.map(c => c.changed_by)], () => { void loadNames(); }, { immediate: true });

function acceptConfirmation(confirmation: PointConfirmation, pointsBefore = review.value?.points ?? null) {
  if (!review.value) return;
  // An empty, successfully loaded audit means this adjustment is the first.
  if (firstChange.value === null && Number(confirmation.points) !== pointsBefore) firstChange.value = { old_points: pointsBefore };
  review.value = { ...review.value, points: Number(confirmation.points), confirmation, lastConfirmation: confirmation, canAdjustPoints: false };
  draft.value = Number(confirmation.points); reason.value = ''; error.value = '';
  void loadHistory(true);
  emit('saved', Number(confirmation.points));
  emit('confirmed', confirmation);
}
async function confirmPoints() {
  if (!canConfirm.value || !review.value || saving.value) return;
  const generation = reviewGeneration;
  const pointsBefore = review.value.points;
  error.value = '';
  try {
    const points = requireWorkOrderPoints(draft.value, props.jobType === 'ticket');
    if (pointsChanged.value && !allowed.value) throw new Error('Esta orden no permite modificar sus puntos.');
    if (pointsChanged.value && !reason.value.trim()) throw new Error('Indica el motivo del cambio.');
    saving.value = true;
    // This explicit click is the only confirmation. The existing RPC locks the
    // row and atomically adjusts/audits/confirms; same token/value is idempotent.
    const { data, error: err } = await supabase.rpc('confirm_work_order_points', {
      p_job_type: props.jobType, p_job_id: props.jobId, p_points: points,
      p_expected_token: review.value.token, p_reason: pointsChanged.value ? reason.value.trim() : '', p_confirmed: true,
    });
    if (err) throw err;
    if (generation !== reviewGeneration) return;
    const confirmation = data as unknown as PointConfirmation;
    if (!confirmation?.id || !Array.isArray(confirmation.crew)) throw new Error('No se recibió el cierre. Consultando su estado.');
    acceptConfirmation(confirmation, pointsBefore);
  } catch (e) {
    if (generation !== reviewGeneration) return;
    error.value = safeText(getErrorMessage(e, 'No se pudo cerrar la orden. Intenta nuevamente.'));
    // A lost response may hide a committed closure. Reconcile by reading only;
    // never issue a second automatic mutation or silently change the proposal.
    const recovered = await loadReview(true);
    if (recovered?.confirmation) acceptConfirmation(recovered.confirmation, pointsBefore);
    else if (recovered) void loadHistory();
  } finally { saving.value = false; }
}
</script>

<template>
  <section v-if="isAdmin" class="mt-3 border-t border-slate-100 pt-3 text-sm">
    <p v-if="reviewLoading && !review" class="text-slate-500">Consultando cierre…</p>
    <div v-else-if="review?.confirmation" class="space-y-2">
      <p class="font-semibold">Estado: Cerrada</p>
      <p>Puntos iniciales: <strong>{{ initialText }}</strong></p>
      <p>Puntos finales: <strong>{{ formatPoints(review.confirmation.points) }}</strong></p>
      <ul class="space-y-1">
        <li v-for="member in review.confirmation.crew" :key="member.technicianId">
          {{ personName(member.name) }} · {{ member.role === 'leader' ? 'Líder' : 'Ayudante' }}:
          {{ formatPoints(member.netPoints ?? ((review.confirmation.points - (review.confirmation.recurrence_penalty ?? 0)) / review.confirmation.crew.length)) }} pts
        </li>
      </ul>
      <p>Fecha y hora del cierre: {{ dateText(review.confirmation.confirmed_at) }}</p>
    </div>
    <form v-else-if="review" class="space-y-3" @submit.prevent="confirmPoints">
      <p>Puntos iniciales: <strong>{{ initialText }}</strong></p>
      <label class="block">¿Con cuántos puntos se cierra?
        <input v-model.number="draft" type="number" :step="jobType === 'ticket' ? '1' : 'any'" :min="jobType === 'ticket' ? 1 : 0"
          required class="field-input" :readonly="!allowed" :disabled="saving || !canConfirm" />
      </label>
      <label v-if="allowed && pointsChanged" class="block">Motivo del cambio
        <input v-model="reason" required maxlength="1000" class="field-input" :disabled="saving" />
      </label>
      <ul class="space-y-1">
        <li v-for="member in review.crew" :key="member.technicianId">
          {{ personName(member.name) }} · {{ member.role === 'leader' ? 'Líder' : 'Ayudante' }}:
          {{ validDraft == null ? '—' : formatPoints((validDraft - (review.recurrencePenalty ?? 0)) / review.crew.length) }} pts
        </li>
      </ul>
      <p v-if="!review.finished" class="text-slate-500">Pendiente de finalización técnica.</p>
      <p v-else-if="!review.technicalCompletedAt" class="text-amber-700">Falta la fecha de finalización del trabajo.</p>
      <p v-else-if="!review.crew.length" class="text-amber-700">Asigna los técnicos antes de cerrar.</p>
      <p v-else-if="validDraft == null" class="text-amber-700">Ingresa puntos mayores a 0.</p>
      <button type="submit" class="btn-primary" :disabled="saving || !canSubmit">{{ saving ? 'Confirmando…' : 'Confirmar cierre' }}</button>
    </form>
    <p v-if="error" role="alert" class="text-red-600 mt-2">{{ error }}</p>
    <p v-if="reviewError" role="alert" class="text-red-600 mt-2">{{ reviewError }}</p>
    <button v-if="reviewError && !review && !saving" type="button" class="btn-secondary mt-2" @click="loadReview()">Reintentar carga</button>
    <details v-if="review" class="text-xs mt-3 text-slate-500">
      <summary>Más información</summary>
      <div class="space-y-2 mt-2">
        <p v-if="review.confirmation">Cerrado por: {{ responsibleName(review.confirmation.confirmed_by) }}</p>
        <p>El cierre es definitivo. Fecha y hora en Perú.</p>
        <p v-if="review.historical">Octubre es un período de prueba, sin acreditación oficial. Los puntos oficiales comienzan el 01/11/2026.</p>
        <p v-if="review.confirmation?.recurrence_penalty || review.recurrencePenalty">Descuento por reincidencia: {{ formatPoints(review.confirmation?.recurrence_penalty ?? review.recurrencePenalty ?? 0) }} pts.</p>
        <p v-if="historyError">{{ historyError }}</p>
        <p v-if="namesError">{{ namesError }}</p>
        <ul v-if="history.length" class="space-y-2">
          <li v-for="change in history" :key="change.id">
            {{ pointsText(change.old_points) }} → {{ formatPoints(change.new_points) }} pts · {{ dateText(change.changed_at) }}
            <p>{{ safeText(change.reason) }}</p>
            <p>Responsable: {{ responsibleName(change.changed_by) }}</p>
          </li>
        </ul>
      </div>
    </details>
  </section>
</template>
