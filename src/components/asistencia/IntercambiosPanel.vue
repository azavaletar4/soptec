<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useCatalogsStore } from '@/stores/catalogs';
import { supabase } from '@/lib/supabase';
import { fetchIntercambios, type Intercambio } from '@/lib/asistenciaIntercambios';
import { fechaLimaISO, formatFechaHora } from '@/lib/asistenciaReglas';
import { getErrorMessage } from '@/lib/errors';

const props = defineProps<{ administracion?: boolean }>();
const emit = defineEmits<{ changed: [] }>();
const auth = useAuthStore();
const catalogs = useCatalogsStore();
const configura = computed(() => props.administracion && auth.role === 'SUPERADMIN');
const consulta = computed(() => !props.administracion && ['ADMIN', 'TECNICO_RED'].includes(auth.role ?? ''));
const empleados = computed(() => catalogs.staff.filter(p => ['ADMIN', 'TECNICO_RED'].includes(p.role)));
const rows = ref<Intercambio[]>([]);
const busy = ref(false), error = ref(''), notice = ref('');
const form = ref({ user: '', descanso: '', trabajo: '', ingreso: '', salida: '' });
const motivos = ref<Record<string, string>>({});
let operacion: { key: string; id: string } | undefined;
async function load() {
  try { rows.value = await fetchIntercambios(); }
  catch (e) { error.value = getErrorMessage(e, 'No se pudieron cargar los intercambios. Reintente.'); }
}
onMounted(async () => {
  if (!configura.value && !consulta.value) return;
  try { if (configura.value) await catalogs.fetchStaff(); await load(); }
  catch (e) { error.value = getErrorMessage(e, 'No se pudo cargar el personal. Reintente.'); }
});
async function crear() {
  if (busy.value) return;
  busy.value = true; error.value = ''; notice.value = '';
  const key = JSON.stringify(form.value);
  if (operacion?.key !== key) operacion = { key, id: crypto.randomUUID() };
  try {
    const { error: e } = await supabase.rpc('asistencia_intercambio_crear', {
      p_operacion_id: operacion.id, p_user_id: form.value.user,
      p_fecha_descanso: form.value.descanso, p_fecha_trabajo: form.value.trabajo,
      p_hora_ingreso: form.value.ingreso, p_hora_salida: form.value.salida,
    });
    if (e) throw e;
    operacion = undefined;
    notice.value = 'Intercambio autorizado: ambos días quedaron vinculados.';
    form.value = { user: '', descanso: '', trabajo: '', ingreso: '', salida: '' };
    await load(); emit('changed');
  } catch (e) { error.value = getErrorMessage(e, 'No se pudo autorizar el intercambio'); }
  finally { busy.value = false; }
}
async function cancelar(row: Intercambio) {
  if (busy.value || !motivos.value[row.id]?.trim()) return;
  busy.value = true; error.value = ''; notice.value = '';
  try {
    const { error: e } = await supabase.rpc('asistencia_intercambio_cancelar', { p_id: row.id, p_motivo: motivos.value[row.id].trim() });
    if (e) throw e;
    await load(); emit('changed');
  } catch (e) { error.value = getErrorMessage(e, 'No se pudo cancelar el intercambio'); }
  finally { busy.value = false; }
}
function nombre(id: string) { const p = catalogs.staff.find(p => p.id === id); return p?.full_name || p?.email || 'Colaborador pendiente de identificar'; }
</script>

<template>
  <section v-if="configura || consulta" class="my-4 border-t border-slate-200 pt-3">
    <h2 class="text-base font-semibold">{{ configura ? 'Intercambio de días de descanso' : 'Mis intercambios de descanso' }}</h2>
    <p class="text-xs text-slate-500 mb-3">Un día de descanso autorizado se compensa trabajando un domingo o feriado. Ambos días forman un solo intercambio. Horario de Perú.</p>
    <form v-if="configura" class="surface p-4 grid gap-3 sm:grid-cols-2 mb-3" @submit.prevent="crear">
      <label><span class="field-label">Colaborador</span><select v-model="form.user" class="field-input" required><option value="" disabled>Seleccionar...</option><option v-for="p in empleados" :key="p.id" :value="p.id">{{ p.full_name || p.email }}</option></select></label>
      <label><span class="field-label">Día de descanso autorizado</span><input v-model="form.descanso" type="date" :min="fechaLimaISO()" class="field-input" required /></label>
      <label><span class="field-label">Día compensatorio (domingo o feriado)</span><input v-model="form.trabajo" type="date" :min="fechaLimaISO()" class="field-input" required /></label>
      <label><span class="field-label">Ingreso del día compensatorio</span><input v-model="form.ingreso" type="time" class="field-input" required /></label>
      <label><span class="field-label">Salida del día compensatorio</span><input v-model="form.salida" type="time" class="field-input" required /></label>
      <div class="sm:col-span-2"><button class="btn-primary" :disabled="busy">Programar y autorizar intercambio</button></div>
    </form>
    <p v-if="error" role="alert" class="text-sm text-red-600">{{ error }}</p>
    <button v-if="error" class="btn-secondary" @click="error = ''; load()">Reintentar</button>
    <p v-if="notice" role="status" class="text-sm text-green-700">{{ notice }}</p>
    <p v-if="!rows.length && !error" class="text-xs text-slate-500">Sin intercambios registrados.</p>
    <article v-for="row in rows" :key="row.id" class="surface p-3 my-2 text-sm">
      <p v-if="configura" class="font-semibold">{{ nombre(row.user_id) }}</p>
      <p>Descanso autorizado: {{ row.fecha_descanso }} ↔ Jornada compensatoria: {{ row.fecha_trabajo }}</p>
      <p>Ingreso {{ row.hora_ingreso.slice(0, 5) }} · Salida {{ row.hora_salida.slice(0, 5) }} · {{ row.estado === 'activo' ? 'Autorizado' : 'Cancelado' }}</p>
      <p class="text-xs text-slate-500">Autorizado {{ formatFechaHora(row.created_at) }}<span v-if="configura"> · {{ nombre(row.created_by) }}</span></p>
      <p v-if="row.estado === 'cancelado'" class="text-xs">Cancelado {{ formatFechaHora(row.cancelled_at) }} · {{ row.cancel_motivo }}</p>
      <div v-if="configura && row.estado === 'activo' && row.fecha_descanso > fechaLimaISO() && row.fecha_trabajo > fechaLimaISO()" class="flex flex-wrap gap-2 mt-2">
        <input v-model="motivos[row.id]" class="field-input" placeholder="Motivo de cancelación" maxlength="500" />
        <button class="btn-secondary" :disabled="busy || !motivos[row.id]?.trim()" @click="cancelar(row)">Cancelar intercambio</button>
      </div>
    </article>
  </section>
</template>
