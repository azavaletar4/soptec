<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { supabase } from '@/lib/supabase';
import { fechaLimaISO } from '@/lib/asistenciaReglas';
import { AUSENCIA_BADGE_CLASS, AUSENCIA_LABEL, AUSENCIA_LABEL_CORTO, type Ausencia } from '@/lib/asistenciaAusencias';
import { getErrorMessage } from '@/lib/errors';

const props = defineProps<{ administracion?: boolean }>();
const emit = defineEmits<{ changed: [] }>();
const auth = useAuthStore();
const canReport = computed(() => ['ADMIN', 'TECNICO_RED'].includes(auth.role ?? '') && !props.administracion);
const canResolve = computed(() => auth.role === 'SUPERADMIN' && props.administracion);
const rows = ref<Ausencia[]>([]);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const motivo = ref('salud');
const observacion = ref('');
// Siempre la fecha real de hoy en Peru — nunca un valor fijado al abrir el
// formulario, asi no hace falta un boton para "refrescarla" si el panel
// queda abierto de un dia para el otro.
const fecha = computed(() => fechaLimaISO());
const decisionMotivos = ref<Record<string, string>>({});
const page = ref(0);
const hasMore = ref(false);
const filtro = ref('pendiente');
// Panel personal: colapsado por defecto (pantalla movil amontonada). Usa
// v-show (nunca v-if) para no desmontar el formulario al cerrar/abrir — los
// refs de motivo/observacion no se tocan, nada escrito se pierde.
const abierto = ref(false);
// Conserva la misma operación si se pierde la respuesta; no crea duplicados.
let operacion: { id: string; fecha: string; motivo: string; observacion: string } | null = null;
async function load() {
  error.value = '';
  try {
    if (!canReport.value && !canResolve.value) { rows.value = []; return; }
    let query = supabase.from('asistencia_solicitudes').select(canResolve.value ? '*, profile:profiles!asistencia_solicitudes_user_id_fkey(full_name,email)' : '*').order('created_at', { ascending: false }).order('id').range(page.value * 25, page.value * 25 + 25);
    if (canReport.value) query = query.eq('user_id', auth.user!.id);
    if (canResolve.value && filtro.value) query = query.eq('estado', filtro.value);
    const { data, error: e } = await query;
    if (e) throw e;
    hasMore.value = (data?.length ?? 0) > 25;
    rows.value = (data ?? []).slice(0, 25) as unknown as Ausencia[];
  } catch (e) { error.value = getErrorMessage(e, 'No se pudieron cargar las solicitudes'); }
}
async function reportar() {
  busy.value = true; error.value = ''; notice.value = '';
  try {
    // Autorecuperacion: si quedo una operacion pendiente de un dia anterior
    // (ej. fallo de red justo antes de medianoche y el panel nunca se
    // cerro), se descarta sola — nunca se reenvia una fecha vieja.
    if (operacion && operacion.fecha !== fecha.value) operacion = null;
    operacion ??= { id: crypto.randomUUID(), fecha: fecha.value, motivo: motivo.value, observacion: observacion.value };
    const { error: e } = await supabase.rpc('reportar_ausencia_hoy', { p_operacion_id: operacion.id, p_fecha_esperada: operacion.fecha, p_motivo: operacion.motivo, p_observacion: operacion.observacion });
    if (e) throw e;
    operacion = null; observacion.value = ''; page.value = 0;
    notice.value = 'Ausencia reportada — queda pendiente de aprobación.';
    await load(); emit('changed');
  } catch (e) { error.value = getErrorMessage(e, 'No se pudo reportar la ausencia'); }
  finally { busy.value = false; }
}
function nuevaOperacion() { operacion = null; error.value = ''; }
async function resolver(row: Ausencia, decision: 'aprobada' | 'rechazada') {
  if (!window.confirm(`¿Confirmar solicitud ${decision}?`)) return;
  busy.value = true; error.value = '';
  let failure = '';
  try {
    const { error: e } = await supabase.rpc('resolver_ausencia', { p_solicitud_id: row.id, p_version_esperada: row.version, p_decision: decision, p_motivo: decisionMotivos.value[row.id] ?? '' });
    if (e) throw e;
    emit('changed');
  } catch (e) { failure = getErrorMessage(e, 'No se pudo resolver'); }
  finally { await load(); if (failure) error.value = failure; busy.value = false; }
}
watch(page, load);
watch(filtro, () => { page.value = 0; void load(); });
onMounted(load);
</script>

<template>
  <!-- Panel personal (ADMIN/TECNICO_RED): compacto, colapsado por defecto. -->
  <section v-if="canReport" class="border-t border-slate-200 mt-3 pt-3">
    <button type="button" class="flex items-center justify-between w-full text-sm font-medium text-slate-700" @click="abierto = !abierto">
      <span>📝 Reportar una ausencia</span>
      <span class="text-slate-400">{{ abierto ? '▲' : '▼' }}</span>
    </button>
    <div v-show="abierto" class="mt-2.5 space-y-2.5">
      <form class="grid gap-2" @submit.prevent="reportar">
        <p class="text-xs text-slate-500">Fecha: {{ fecha }}</p>
        <label class="text-xs text-slate-600">Motivo
          <select v-model="motivo" class="input" @change="nuevaOperacion">
            <option value="salud">Salud</option>
            <option value="asuntos_personales">Asuntos personales</option>
            <option value="emergencia">Emergencia</option>
            <option value="otros">Otros</option>
          </select>
        </label>
        <label class="text-xs text-slate-600">Observación (opcional)
          <textarea v-model="observacion" maxlength="1000" class="input" rows="2" @input="nuevaOperacion" />
        </label>
        <button class="btn-primary w-full text-sm" :disabled="busy">{{ busy ? 'Enviando...' : 'Enviar solicitud' }}</button>
      </form>
      <p v-if="error" role="alert" class="text-xs text-red-600">{{ error }}</p>
      <p v-if="notice" role="status" class="text-xs text-amber-600">{{ notice }}</p>

      <div v-if="rows.length" class="space-y-1.5 pt-1">
        <p class="text-xs font-medium text-slate-500">Mis solicitudes</p>
        <div v-for="row in rows" :key="row.id" class="text-xs border-t border-slate-100 pt-1.5">
          <div class="flex items-center justify-between">
            <span>{{ row.fecha }}</span>
            <span class="badge text-[10px]" :class="AUSENCIA_BADGE_CLASS[row.estado]">{{ AUSENCIA_LABEL_CORTO[row.estado] }}</span>
          </div>
          <p v-if="row.decision_motivo" class="text-slate-500 mt-0.5">{{ row.decision_motivo }}</p>
        </div>
      </div>
      <div v-if="rows.length || page > 0" class="flex gap-2">
        <button type="button" class="btn-secondary text-xs" :disabled="page === 0 || busy" @click="page--">Anterior</button>
        <button type="button" class="btn-secondary text-xs" :disabled="!hasMore || busy" @click="page++">Siguiente</button>
      </div>
    </div>
  </section>

  <!-- Bandeja de administracion (SUPERADMIN) — sin cambios de layout. -->
  <section v-else-if="canResolve" class="surface p-4 my-4">
    <h2 class="font-semibold">Solicitudes de ausencia · SUPERADMIN</h2>
    <p class="text-sm">Fecha de Perú. La solicitud requiere justificación y decisión de SUPERADMIN; no sustituye una marcación.</p>
    <p v-if="error" role="alert" class="text-red-600">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <label>Estado <select v-model="filtro" class="input"><option value="pendiente">Pendientes de justificar</option><option value="aprobada">Justificadas</option><option value="rechazada">Rechazadas</option><option value="">Todas</option></select></label>
    <button class="btn-secondary my-2" :disabled="busy" @click="load">Actualizar solicitudes</button>
    <p v-if="!rows.length">No hay solicitudes en esta página.</p>
    <article v-for="row in rows" :key="row.id" class="border-t py-3">
      <p><strong>{{ row.fecha }} · {{ AUSENCIA_LABEL[row.estado] }}</strong></p>
      <p class="text-xs">Usuario: {{ row.profile?.full_name || row.profile?.email || row.user_id }}</p>
      <p>{{ row.motivo }} · {{ row.observacion || 'Sin observación' }}</p>
      <p v-if="row.decision_motivo">Decisión: {{ row.decision_motivo }}</p>
      <div v-if="row.estado === 'pendiente'" class="flex flex-wrap gap-2">
        <input v-model="decisionMotivos[row.id]" placeholder="Motivo obligatorio de la decisión" maxlength="1000" class="input" />
        <button class="btn-primary" :disabled="busy || !decisionMotivos[row.id]?.trim()" @click="resolver(row, 'aprobada')">Aprobar</button>
        <button class="btn-secondary" :disabled="busy || !decisionMotivos[row.id]?.trim()" @click="resolver(row, 'rechazada')">Rechazar</button>
      </div>
    </article>
    <div class="flex gap-2"><button class="btn-secondary" :disabled="page === 0 || busy" @click="page--">Anterior</button><button class="btn-secondary" :disabled="!hasMore || busy" @click="page++">Siguiente</button></div>
  </section>
</template>
