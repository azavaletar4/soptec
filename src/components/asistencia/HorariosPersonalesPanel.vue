<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useCatalogsStore } from '@/stores/catalogs';
import { useAsistenciaStore } from '@/stores/asistencia';
import { exentoDeAsistencia } from '@/lib/asistenciaAusencias';
import { DIA_SEMANA_LABEL, horarioPersonalTexto } from '@/lib/asistenciaHorariosPersonales';
import type { NovedadTurno } from '@/types/domain';
import { getErrorMessage } from '@/lib/errors';

// A2.1: horario parcial RECURRENTE por trabajador (ej. dos tecnicos que
// todos los sabados trabajan media jornada, uno por la manana y otro por
// la tarde) — distinto de un permiso EXCEPCIONAL de un solo dia
// (NovedadesPanel, tipo "media_jornada"). Solo SUPERADMIN configura;
// ADMIN/TECNICO_RED solo consultan su propio horario (RLS).
const props = defineProps<{ administracion?: boolean }>();
const emit = defineEmits<{ changed: [] }>();
const auth = useAuthStore();
const catalogs = useCatalogsStore();
const store = useAsistenciaStore();
const canConfigure = computed(() => auth.role === 'SUPERADMIN' && props.administracion);
const canConsultar = computed(() => ['ADMIN', 'TECNICO_RED'].includes(auth.role ?? '') && !props.administracion);

const error = ref('');
const notice = ref('');
const busy = ref(false);
const empleados = computed(() => catalogs.staff.filter((p) => !exentoDeAsistencia(p.role)));

// Domingo queda fuera de alcance (A3: intercambio de descanso) — no se ofrece como opcion.
const DIAS = [1, 2, 3, 4, 5, 6];
const form = ref({ userId: '', diaSemana: 6, turno: 'tarde' as NovedadTurno, horaIngreso: '', horaSalida: '' });

onMounted(async () => {
  if (canConfigure.value) await catalogs.fetchStaff();
  try { await store.fetchHorariosPersonales(); } catch (e) { error.value = getErrorMessage(e, 'No se pudieron cargar los horarios'); }
});

async function guardar() {
  if (!form.value.userId || !form.value.horaIngreso || !form.value.horaSalida) return;
  busy.value = true; error.value = ''; notice.value = '';
  try {
    await store.saveHorarioPersonal({
      user_id: form.value.userId, dia_semana: form.value.diaSemana, turno: form.value.turno,
      hora_ingreso: form.value.horaIngreso, hora_salida: form.value.horaSalida,
    });
    notice.value = 'Horario guardado.';
    form.value = { userId: '', diaSemana: 6, turno: 'tarde', horaIngreso: '', horaSalida: '' };
    emit('changed');
  } catch (e) { error.value = getErrorMessage(e, 'No se pudo guardar el horario'); }
  finally { busy.value = false; }
}

async function eliminar(userId: string, diaSemana: number) {
  if (!window.confirm('¿Eliminar este horario? La persona volverá al horario general de la compañía ese día.')) return;
  busy.value = true; error.value = '';
  try { await store.deleteHorarioPersonal(userId, diaSemana); emit('changed'); }
  catch (e) { error.value = getErrorMessage(e, 'No se pudo eliminar'); }
  finally { busy.value = false; }
}
</script>

<template>
  <!-- Consulta personal (ADMIN/TECNICO_RED): solo lectura de su propio horario habitual. -->
  <section v-if="canConsultar && store.horariosPersonales.length" class="border-t border-slate-200 mt-3 pt-3">
    <p class="text-sm font-medium text-slate-700 mb-2">📌 Mi horario habitual</p>
    <div class="space-y-1.5">
      <div v-for="h in store.horariosPersonales" :key="h.id" class="text-xs border-t border-slate-100 pt-1.5">
        {{ horarioPersonalTexto(h) }}
      </div>
    </div>
  </section>

  <!-- Configuración SUPERADMIN: horarios parciales recurrentes por trabajador. -->
  <section v-else-if="canConfigure" class="my-4">
    <div class="mb-4">
      <h2 class="text-lg font-semibold text-slate-900">Horarios parciales habituales</h2>
      <p class="text-sm text-slate-500">
        Patrón semanal fijo de un colaborador (ej. todos los sábados, media jornada) — distinto de un permiso
        excepcional de un solo día (ver "Vacaciones, descansos y permisos" arriba). Las horas siempre se configuran
        aquí, nunca se asumen.
      </p>
    </div>

    <form class="surface p-4 grid gap-3 sm:grid-cols-2 mb-4" @submit.prevent="guardar">
      <label class="block">
        <span class="field-label">Colaborador</span>
        <select v-model="form.userId" required class="field-input">
          <option value="" disabled>Seleccionar...</option>
          <option v-for="p in empleados" :key="p.id" :value="p.id">{{ p.full_name || p.email }}</option>
        </select>
      </label>
      <label class="block">
        <span class="field-label">Día de la semana</span>
        <select v-model.number="form.diaSemana" class="field-input">
          <option v-for="d in DIAS" :key="d" :value="d">{{ DIA_SEMANA_LABEL[d] }}</option>
        </select>
      </label>
      <label class="block">
        <span class="field-label">Turno</span>
        <select v-model="form.turno" class="field-input">
          <option value="manana">Mañana</option>
          <option value="tarde">Tarde</option>
        </select>
      </label>
      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="field-label">Ingreso</span>
          <input v-model="form.horaIngreso" type="time" required class="field-input" />
        </label>
        <label class="block">
          <span class="field-label">Salida</span>
          <input v-model="form.horaSalida" type="time" required class="field-input" />
        </label>
      </div>
      <div class="sm:col-span-2">
        <button class="btn-primary text-sm" :disabled="busy">{{ busy ? 'Guardando...' : '+ Guardar horario' }}</button>
        <p class="text-xs text-slate-400 mt-1">Ya tiene un horario para ese colaborador/día: se reemplaza, no se duplica.</p>
      </div>
    </form>

    <p v-if="error" role="alert" class="text-sm text-red-600 mb-3">{{ error }}</p>
    <p v-if="notice" role="status" class="text-sm text-amber-600 mb-3">{{ notice }}</p>

    <p v-if="!store.horariosPersonales.length" class="surface text-sm text-slate-500 py-8 text-center">Sin horarios personales configurados.</p>
    <div v-else class="grid gap-2">
      <div v-for="h in store.horariosPersonales" :key="h.id" class="surface p-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p class="font-semibold text-slate-900 text-sm">{{ h.profile?.full_name || h.profile?.email || h.user_id }}</p>
          <p class="text-sm text-slate-500">{{ horarioPersonalTexto(h) }}</p>
        </div>
        <button class="btn-secondary text-xs" :disabled="busy" @click="eliminar(h.user_id, h.dia_semana)">Eliminar</button>
      </div>
    </div>
  </section>
</template>
