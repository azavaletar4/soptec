<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useCatalogsStore } from '@/stores/catalogs';
import { supabase } from '@/lib/supabase';
import { fechaLimaISO, formatFechaHora } from '@/lib/asistenciaReglas';
import { exentoDeAsistencia } from '@/lib/asistenciaAusencias';
import { NOVEDAD_BADGE_CLASS, NOVEDAD_TIPO_LABEL, novedadTexto } from '@/lib/asistenciaNovedades';
import type { AsistenciaNovedad, NovedadTipo, NovedadTurno } from '@/types/domain';
import { getErrorMessage } from '@/lib/errors';

// A2: vacaciones/descanso/permiso por horas/media jornada. SUPERADMIN
// configura y aprueba en un solo paso (no hay "pendiente" como en A1) —
// ver asistencia_novedad_crear/cancelar. ADMIN/TECNICO_RED solo consultan
// sus propias filas (RLS ya limita la lectura a eso).
const props = defineProps<{ administracion?: boolean }>();
const emit = defineEmits<{ changed: [] }>();
const auth = useAuthStore();
const catalogs = useCatalogsStore();
const canConfigure = computed(() => auth.role === 'SUPERADMIN' && props.administracion);
const canConsultar = computed(() => ['ADMIN', 'TECNICO_RED'].includes(auth.role ?? '') && !props.administracion);

const rows = ref<AsistenciaNovedad[]>([]);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const soloActivas = ref(true);

const empleados = computed(() => catalogs.staff.filter((p) => !exentoDeAsistencia(p.role)));

const TIPOS: NovedadTipo[] = ['vacaciones', 'descanso_programado', 'media_jornada', 'permiso_horas'];
const form = ref({ userId: '', tipo: 'vacaciones' as NovedadTipo, fechaInicio: '', fechaFin: '', turno: 'manana' as NovedadTurno, horaInicio: '', horaFin: '', motivo: '' });

async function load() {
  error.value = '';
  try {
    if (!canConfigure.value && !canConsultar.value) { rows.value = []; return; }
    let query = supabase.from('asistencia_novedades').select(canConfigure.value ? '*, profile:profiles!asistencia_novedades_user_id_fkey(full_name,email)' : '*').order('fecha_inicio', { ascending: false });
    if (soloActivas.value) query = query.eq('estado', 'activa');
    const { data, error: e } = await query;
    if (e) throw e;
    rows.value = (data ?? []) as unknown as AsistenciaNovedad[];
  } catch (e) { error.value = getErrorMessage(e, 'No se pudieron cargar las novedades'); }
}
onMounted(async () => { if (canConfigure.value) await catalogs.fetchStaff(); await load(); });

function resetFormCamposPorTipo() {
  form.value.turno = 'manana'; form.value.horaInicio = ''; form.value.horaFin = '';
  if (form.value.tipo !== 'permiso_horas' && form.value.tipo !== 'media_jornada') form.value.fechaFin = form.value.fechaInicio;
}

async function crear() {
  if (!form.value.userId || !form.value.fechaInicio) return;
  busy.value = true; error.value = ''; notice.value = '';
  try {
    const esRangoLibre = form.value.tipo === 'vacaciones' || form.value.tipo === 'descanso_programado';
    const fechaFin = esRangoLibre ? (form.value.fechaFin || form.value.fechaInicio) : form.value.fechaInicio;
    const { error: e } = await supabase.rpc('asistencia_novedad_crear', {
      p_operacion_id: crypto.randomUUID(),
      p_user_id: form.value.userId,
      p_tipo: form.value.tipo,
      p_fecha_inicio: form.value.fechaInicio,
      p_fecha_fin: fechaFin,
      p_turno: form.value.tipo === 'media_jornada' ? form.value.turno : null,
      p_hora_inicio: form.value.tipo === 'permiso_horas' ? form.value.horaInicio : null,
      p_hora_fin: form.value.tipo === 'permiso_horas' ? form.value.horaFin : null,
      p_motivo: form.value.motivo.trim() || null,
    });
    if (e) throw e;
    notice.value = 'Novedad programada.';
    form.value = { userId: '', tipo: 'vacaciones', fechaInicio: '', fechaFin: '', turno: 'manana', horaInicio: '', horaFin: '', motivo: '' };
    await load(); emit('changed');
  } catch (e) { error.value = getErrorMessage(e, 'No se pudo programar la novedad'); }
  finally { busy.value = false; }
}

const cancelMotivos = ref<Record<string, string>>({});
async function cancelar(row: AsistenciaNovedad) {
  const motivo = (cancelMotivos.value[row.id] ?? '').trim();
  if (!motivo) return;
  if (!window.confirm('¿Cancelar esta novedad? El colaborador volverá a estar sujeto a marcación/falta en esas fechas.')) return;
  busy.value = true; error.value = '';
  let failure = '';
  try {
    const { error: e } = await supabase.rpc('asistencia_novedad_cancelar', { p_novedad_id: row.id, p_version_esperada: row.version, p_motivo: motivo });
    if (e) throw e;
    delete cancelMotivos.value[row.id];
    emit('changed');
  } catch (e) { failure = getErrorMessage(e, 'No se pudo cancelar'); }
  finally { await load(); if (failure) error.value = failure; busy.value = false; }
}

const misNovedades = computed(() => rows.value.filter((n) => n.fecha_fin >= fechaLimaISO()).concat(rows.value.filter((n) => n.fecha_fin < fechaLimaISO())));
</script>

<template>
  <!-- Consulta personal (ADMIN/TECNICO_RED): solo lectura de sus propios días autorizados. -->
  <section v-if="canConsultar && rows.length" class="border-t border-slate-200 mt-3 pt-3">
    <p class="text-sm font-medium text-slate-700 mb-2">📅 Mis días autorizados</p>
    <div class="space-y-1.5">
      <div v-for="n in misNovedades" :key="n.id" class="text-xs border-t border-slate-100 pt-1.5 flex items-center justify-between gap-2">
        <span>{{ n.fecha_inicio }}{{ n.fecha_fin !== n.fecha_inicio ? ` al ${n.fecha_fin}` : '' }}</span>
        <span class="badge text-[10px]" :class="[NOVEDAD_BADGE_CLASS[n.tipo], n.estado === 'cancelada' ? 'opacity-50 line-through' : '']">{{ novedadTexto(n) }}</span>
      </div>
    </div>
  </section>

  <!-- Configuración SUPERADMIN: programar y cancelar vacaciones/descansos/permisos/medias jornadas. -->
  <section v-else-if="canConfigure" class="my-4">
    <div class="mb-4">
      <h2 class="text-lg font-semibold text-slate-900">Vacaciones, descansos y permisos</h2>
      <p class="text-sm text-slate-500">Programa directamente — queda activa de inmediato, sin paso de aprobación aparte.</p>
    </div>

    <div class="attendance-management">
    <form class="surface p-4 grid gap-3 sm:grid-cols-2 mb-4" @submit.prevent="crear">
      <h3 class="text-sm font-semibold text-slate-900 sm:col-span-2">Nueva autorización</h3>
      <label class="block">
        <span class="field-label">Colaborador</span>
        <select v-model="form.userId" required class="field-input">
          <option value="" disabled>Seleccionar...</option>
          <option v-for="p in empleados" :key="p.id" :value="p.id">{{ p.full_name || p.email }}</option>
        </select>
      </label>
      <label class="block">
        <span class="field-label">Tipo</span>
        <select v-model="form.tipo" class="field-input" @change="resetFormCamposPorTipo">
          <option v-for="t in TIPOS" :key="t" :value="t">{{ NOVEDAD_TIPO_LABEL[t] }}</option>
        </select>
      </label>
      <label class="block">
        <span class="field-label">{{ form.tipo === 'vacaciones' || form.tipo === 'descanso_programado' ? 'Desde' : 'Fecha' }}</span>
        <input v-model="form.fechaInicio" type="date" required class="field-input" />
      </label>
      <label v-if="form.tipo === 'vacaciones' || form.tipo === 'descanso_programado'" class="block">
        <span class="field-label">Hasta</span>
        <input v-model="form.fechaFin" type="date" :min="form.fechaInicio" required class="field-input" />
      </label>
      <label v-if="form.tipo === 'media_jornada'" class="block">
        <span class="field-label">Turno libre</span>
        <select v-model="form.turno" class="field-input">
          <option value="manana">Mañana</option>
          <option value="tarde">Tarde</option>
        </select>
      </label>
      <template v-if="form.tipo === 'permiso_horas'">
        <label class="block">
          <span class="field-label">Desde las</span>
          <input v-model="form.horaInicio" type="time" required class="field-input" />
        </label>
        <label class="block">
          <span class="field-label">Hasta las</span>
          <input v-model="form.horaFin" type="time" required class="field-input" />
        </label>
      </template>
      <label class="block sm:col-span-2">
        <span class="field-label">Motivo (opcional)</span>
        <textarea v-model="form.motivo" maxlength="500" rows="2" class="field-input w-full resize-none" />
      </label>
      <div class="sm:col-span-2">
        <button class="btn-primary text-sm" :disabled="busy">{{ busy ? 'Programando...' : '+ Programar novedad' }}</button>
      </div>
    </form>

    <div class="attendance-list">
    <h3 class="attendance-list-heading">Autorizaciones registradas</h3>
    <p v-if="error" role="alert" class="text-sm text-red-600 mb-3">{{ error }}</p>
    <p v-if="notice" role="status" class="text-sm text-amber-600 mb-3">{{ notice }}</p>

    <label class="flex items-center gap-2 text-xs text-slate-500 mb-2">
      <input v-model="soloActivas" type="checkbox" @change="load" /> Solo activas
    </label>

    <p v-if="!rows.length" class="surface text-sm text-slate-500 py-8 text-center">Sin novedades registradas.</p>
    <div class="grid gap-3">
      <article v-for="n in rows" :key="n.id" class="surface p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="font-semibold text-slate-900">{{ n.profile?.full_name || n.profile?.email || n.user_id }}</p>
            <p class="text-sm text-slate-500 mt-0.5">{{ n.fecha_inicio }}{{ n.fecha_fin !== n.fecha_inicio ? ` al ${n.fecha_fin}` : '' }}</p>
          </div>
          <span class="badge" :class="NOVEDAD_BADGE_CLASS[n.tipo]">{{ novedadTexto(n) }}</span>
        </div>
        <p v-if="n.motivo" class="text-sm text-slate-600 mt-2">{{ n.motivo }}</p>
        <div v-if="n.estado === 'cancelada'" class="text-xs text-slate-500 border-t border-slate-100 mt-3 pt-2">
          Cancelada · {{ formatFechaHora(n.cancelled_at) }}
          <span v-if="n.cancel_motivo" class="block mt-1">«{{ n.cancel_motivo }}»</span>
        </div>
        <div v-else class="border-t border-slate-100 mt-3 pt-3 flex flex-wrap items-end gap-2">
          <input v-model="cancelMotivos[n.id]" placeholder="Motivo de cancelación (obligatorio)" class="field-input flex-1 min-w-[180px] text-sm" />
          <button class="btn-secondary text-sm" :disabled="busy || !cancelMotivos[n.id]?.trim()" @click="cancelar(n)">Cancelar</button>
        </div>
      </article>
    </div>
    </div>
    </div>
  </section>
</template>
