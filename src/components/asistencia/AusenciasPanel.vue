<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { supabase } from '@/lib/supabase';
import { fechaLimaISO, formatFechaHora } from '@/lib/asistenciaReglas';
import { AUSENCIA_BADGE_CLASS, AUSENCIA_LABEL_CORTO, decisionMotivoEfectivo, type Ausencia } from '@/lib/asistenciaAusencias';
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
    let query = supabase.from('asistencia_solicitudes').select(canResolve.value ? '*, profile:profiles!asistencia_solicitudes_user_id_fkey(full_name,email), resolver:profiles!asistencia_solicitudes_resolved_by_fkey(full_name,email)' : '*').order('created_at', { ascending: false }).order('id').range(page.value * 25, page.value * 25 + 25);
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
  // Rechazar siempre exige un motivo real escrito por SUPERADMIN — el boton
  // ya queda deshabilitado sin texto, pero se revalida aqui por si acaso.
  const motivoEfectivo = decisionMotivoEfectivo(decision, decisionMotivos.value[row.id] ?? '');
  if (!motivoEfectivo) return;
  if (!window.confirm(decision === 'aprobada' ? '¿Aprobar esta ausencia?' : '¿Rechazar esta ausencia?')) return;
  busy.value = true; error.value = '';
  let failure = '';
  try {
    const { error: e } = await supabase.rpc('resolver_ausencia', { p_solicitud_id: row.id, p_version_esperada: row.version, p_decision: decision, p_motivo: motivoEfectivo });
    if (e) throw e;
    delete decisionMotivos.value[row.id];
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

  <!-- Bandeja de administracion (SUPERADMIN): tarjetas anchas, 1 por -->
  <!-- solicitud. Antes usaba `class="input"` — una clase que no existe en -->
  <!-- style.css (la real es field-input/field-label) — por eso se veia sin -->
  <!-- estilo, diminuto y amontonado a la izquierda. Misma logica/RPC/RLS. -->
  <section v-else-if="canResolve" class="my-4">
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div>
        <h2 class="text-lg font-semibold text-slate-900">Solicitudes de ausencia</h2>
        <p class="text-sm text-slate-500">Aprueba o rechaza las ausencias reportadas por el equipo.</p>
      </div>
      <div class="flex items-center gap-2">
        <select v-model="filtro" class="field-input" style="width: auto">
          <option value="pendiente">Pendientes</option>
          <option value="aprobada">Aprobadas</option>
          <option value="rechazada">Rechazadas</option>
          <option value="">Todas</option>
        </select>
        <button class="btn-secondary text-sm" :disabled="busy" @click="load">Actualizar</button>
      </div>
    </div>

    <p v-if="error" role="alert" class="text-sm text-red-600 mb-3">{{ error }}</p>
    <p v-if="notice" role="status" class="text-sm text-amber-600 mb-3">{{ notice }}</p>
    <p v-if="!rows.length" class="surface text-sm text-slate-500 py-10 text-center">No hay solicitudes en esta página.</p>

    <div class="grid gap-4">
      <article v-for="row in rows" :key="row.id" class="surface p-5">
        <!-- Identidad + estado: jerarquia clara, nombre primero. -->
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="font-semibold text-slate-900">{{ row.profile?.full_name || row.profile?.email || row.user_id }}</p>
            <p class="text-sm text-slate-500 mt-0.5">{{ row.fecha }} · {{ row.motivo }}</p>
          </div>
          <span class="badge" :class="AUSENCIA_BADGE_CLASS[row.estado]">{{ AUSENCIA_LABEL_CORTO[row.estado] }}</span>
        </div>
        <p v-if="row.observacion" class="text-sm text-slate-600 mt-3">{{ row.observacion }}</p>

        <!-- Ya resuelta: quien y cuando, hora real de Peru. -->
        <div v-if="row.estado !== 'pendiente'" class="text-sm text-slate-500 border-t border-slate-100 mt-4 pt-3">
          <p>{{ row.estado === 'aprobada' ? 'Aprobado' : 'Rechazado' }} por {{ row.resolver?.full_name || row.resolver?.email || 'SUPERADMIN' }} · {{ formatFechaHora(row.resolved_at) }}</p>
          <p v-if="row.decision_motivo" class="mt-1 text-slate-600">«{{ row.decision_motivo }}»</p>
        </div>

        <!-- Pendiente: panel de decision, usa el ancho completo de la tarjeta. -->
        <div v-else class="border-t border-slate-100 mt-4 pt-4 grid gap-3 md:grid-cols-[2fr_1fr] md:items-end">
          <label class="block">
            <span class="field-label">Comentario de la decisión</span>
            <textarea
              v-model="decisionMotivos[row.id]"
              maxlength="1000"
              rows="3"
              class="field-input w-full resize-none"
              placeholder="Ej: coordinado con el equipo (opcional para aprobar, obligatorio para rechazar)"
            />
          </label>
          <div class="flex gap-3 md:flex-col">
            <button class="btn-primary flex-1 md:flex-none" :disabled="busy" @click="resolver(row, 'aprobada')">Aprobar</button>
            <button class="btn-secondary flex-1 md:flex-none" :disabled="busy || !decisionMotivos[row.id]?.trim()" @click="resolver(row, 'rechazada')">Rechazar</button>
          </div>
          <p v-if="!decisionMotivos[row.id]?.trim()" class="text-xs text-slate-400 md:col-span-2">Escribe un comentario arriba para poder rechazar — aprobar no lo necesita.</p>
        </div>
      </article>
    </div>

    <div class="flex gap-2 mt-4">
      <button class="btn-secondary" :disabled="page === 0 || busy" @click="page--">Anterior</button>
      <button class="btn-secondary" :disabled="!hasMore || busy" @click="page++">Siguiente</button>
    </div>
  </section>
</template>
