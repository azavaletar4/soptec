<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useVehiculosStore, type VehiculoWithUrl } from '@/stores/vehiculos';
import { useCatalogsStore } from '@/stores/catalogs';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/lib/errors';
import { ALERTA_BADGE_CLASS, alertaMantenimiento, alertaSoat, peorNivel } from '@/lib/vehiculoAlertas';
import type { MantenimientoHistorial, MantenimientoTipo, Vehiculo, VehiculoEstado, VehiculoTipo } from '@/types/domain';

const vehiculosStore = useVehiculosStore();
const catalogs = useCatalogsStore();
const auth = useAuthStore();

const canDelete = computed(() => auth.role === 'SUPERADMIN' || auth.role === 'ADMIN');

onMounted(async () => {
  await Promise.all([vehiculosStore.fetchVehiculos(), catalogs.fetchStaff()]);
});

const TIPO_LABEL: Record<VehiculoTipo, string> = { auto: 'Auto', moto: 'Moto' };
const ESTADO_LABEL: Record<VehiculoEstado, string> = { activo: 'Activo', mantenimiento: 'En mantenimiento', inactivo: 'Inactivo' };
const ESTADO_CLASS: Record<VehiculoEstado, string> = {
  activo: 'bg-green-500/15 text-green-600',
  mantenimiento: 'bg-amber-500/15 text-amber-600',
  inactivo: 'bg-slate-500/15 text-slate-600',
};
const MANTENIMIENTO_LABEL: Record<MantenimientoTipo, string> = { preventivo: 'Preventivo', correctivo: 'Correctivo' };

// ---- Filtros ----
const search = ref('');
const filterTipo = ref<'' | VehiculoTipo>('');
const filterEstado = ref<'' | VehiculoEstado>('');

function asignadoA(v: Vehiculo): string {
  if (v.tecnico) return v.tecnico.full_name || v.tecnico.email;
  if (v.area) return v.area;
  return 'Sin asignar';
}

const filasConAlertas = computed(() =>
  vehiculosStore.vehiculos.map((v) => {
    const soat = alertaSoat(v);
    const mantenimiento = alertaMantenimiento(v);
    return { vehiculo: v, soat, mantenimiento, peor: peorNivel(soat.nivel, mantenimiento.nivel) };
  }),
);

const filasFiltradas = computed(() => {
  const q = search.value.trim().toLowerCase();
  return filasConAlertas.value.filter(
    (f) =>
      (!filterTipo.value || f.vehiculo.tipo === filterTipo.value) &&
      (!filterEstado.value || f.vehiculo.estado === filterEstado.value) &&
      (!q || f.vehiculo.placa.toLowerCase().includes(q) || f.vehiculo.marca.toLowerCase().includes(q) || asignadoA(f.vehiculo).toLowerCase().includes(q)),
  );
});

// Notificaciones prioritarias: cualquier vehiculo con SOAT o mantenimiento en rojo (vencido o critico).
const vehiculosUrgentes = computed(() => filasConAlertas.value.filter((f) => f.soat.nivel === 'rojo' || f.mantenimiento.nivel === 'rojo'));

// ---- CRUD de vehiculo ----
const showModal = ref(false);
const editing = ref<VehiculoWithUrl | null>(null);
const saving = ref(false);
const formError = ref<string | null>(null);

// Archivo del SOAT: se maneja aparte del resto del formulario porque se sube
// al bucket 'vehiculo-soat' despues de guardar el vehiculo (necesita su id).
const soatFile = ref<File | null>(null);
const soatFileRemoved = ref(false);

function emptyForm() {
  return {
    tipo: 'moto' as VehiculoTipo,
    placa: '',
    marca: '',
    modelo: '',
    tecnico_id: '' as string | '',
    area: '',
    estado: 'activo' as VehiculoEstado,
    soat_fecha_emision: '',
    soat_fecha_vencimiento: '',
    soat_aseguradora: '',
    kilometraje_actual: 0,
    proximo_mantenimiento_fecha: '',
    proximo_mantenimiento_km: null as number | null,
    notes: '',
  };
}
const form = ref(emptyForm());

/** v-model.number deja '' (no null) si el usuario borra un campo numerico opcional; esto lo normaliza antes de guardar. */
function numOrNull(v: number | string | null): number | null {
  return v === '' || v == null ? null : Number(v);
}

function openCreate() {
  editing.value = null;
  form.value = emptyForm();
  soatFile.value = null;
  soatFileRemoved.value = false;
  formError.value = null;
  showModal.value = true;
}

function openEdit(v: VehiculoWithUrl) {
  editing.value = v;
  form.value = {
    tipo: v.tipo,
    placa: v.placa,
    marca: v.marca,
    modelo: v.modelo ?? '',
    tecnico_id: v.tecnico_id ?? '',
    area: v.area ?? '',
    estado: v.estado,
    soat_fecha_emision: v.soat_fecha_emision ?? '',
    soat_fecha_vencimiento: v.soat_fecha_vencimiento ?? '',
    soat_aseguradora: v.soat_aseguradora ?? '',
    kilometraje_actual: Number(v.kilometraje_actual),
    proximo_mantenimiento_fecha: v.proximo_mantenimiento_fecha ?? '',
    proximo_mantenimiento_km: v.proximo_mantenimiento_km != null ? Number(v.proximo_mantenimiento_km) : null,
    notes: v.notes ?? '',
  };
  soatFile.value = null;
  soatFileRemoved.value = false;
  formError.value = null;
  showModal.value = true;
}

function onSoatFileChange(e: Event) {
  soatFile.value = (e.target as HTMLInputElement).files?.[0] ?? null;
  if (soatFile.value) soatFileRemoved.value = false;
}

function removeSoatFile() {
  soatFile.value = null;
  soatFileRemoved.value = true;
}

async function handleSubmit() {
  saving.value = true;
  formError.value = null;
  try {
    const payload = {
      tipo: form.value.tipo,
      placa: form.value.placa.trim().toUpperCase(),
      marca: form.value.marca.trim(),
      modelo: form.value.modelo.trim() || null,
      tecnico_id: form.value.tecnico_id || null,
      area: form.value.area.trim() || null,
      estado: form.value.estado,
      soat_fecha_emision: form.value.soat_fecha_emision || null,
      soat_fecha_vencimiento: form.value.soat_fecha_vencimiento || null,
      soat_aseguradora: form.value.soat_aseguradora.trim() || null,
      kilometraje_actual: numOrNull(form.value.kilometraje_actual) ?? 0,
      proximo_mantenimiento_fecha: form.value.proximo_mantenimiento_fecha || null,
      proximo_mantenimiento_km: numOrNull(form.value.proximo_mantenimiento_km),
      notes: form.value.notes.trim() || null,
    };
    const saved = editing.value ? await vehiculosStore.updateVehiculo(editing.value.id, payload) : await vehiculosStore.createVehiculo(payload);

    if (soatFile.value) {
      await vehiculosStore.uploadSoatFile(saved.id, soatFile.value, editing.value?.soat_archivo_path ?? null);
    } else if (soatFileRemoved.value && editing.value?.soat_archivo_path) {
      await vehiculosStore.removeSoatFile(saved.id, editing.value.soat_archivo_path);
    }

    showModal.value = false;
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al guardar el vehículo');
  } finally {
    saving.value = false;
  }
}

async function handleDelete(v: Vehiculo) {
  if (!confirm(`¿Eliminar el vehículo "${v.placa}"? Se borrará también su historial de mantenimiento. Esta acción no se puede deshacer.`)) return;
  try {
    await vehiculosStore.deleteVehiculo(v.id);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al eliminar el vehículo'));
  }
}

// ---- Historial de mantenimiento (ver + registrar nuevo) ----
const showHistorialModal = ref(false);
const historialVehiculo = ref<Vehiculo | null>(null);
const historial = ref<MantenimientoHistorial[]>([]);
const historialLoading = ref(false);

const mantForm = ref({ fecha: '', tipo: 'preventivo' as MantenimientoTipo, kilometraje: null as number | null, costo: null as number | null, taller: '', descripcion: '' });
const mantSaving = ref(false);
const mantError = ref<string | null>(null);

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function openHistorial(v: Vehiculo) {
  historialVehiculo.value = v;
  mantForm.value = { fecha: todayIso(), tipo: 'preventivo', kilometraje: Number(v.kilometraje_actual) || null, costo: null, taller: '', descripcion: '' };
  mantError.value = null;
  showHistorialModal.value = true;
  historialLoading.value = true;
  try {
    historial.value = await vehiculosStore.fetchHistorial(v.id);
  } finally {
    historialLoading.value = false;
  }
}

async function handleAddMantenimiento() {
  if (!historialVehiculo.value) return;
  mantSaving.value = true;
  mantError.value = null;
  try {
    await vehiculosStore.createMantenimiento({
      vehiculo_id: historialVehiculo.value.id,
      fecha: mantForm.value.fecha || todayIso(),
      tipo: mantForm.value.tipo,
      descripcion: mantForm.value.descripcion.trim() || null,
      costo: numOrNull(mantForm.value.costo),
      taller: mantForm.value.taller.trim() || null,
      kilometraje: numOrNull(mantForm.value.kilometraje),
    });
    historial.value = await vehiculosStore.fetchHistorial(historialVehiculo.value.id);
    historialVehiculo.value = vehiculosStore.vehiculos.find((v) => v.id === historialVehiculo.value?.id) ?? historialVehiculo.value;
    mantForm.value = { fecha: todayIso(), tipo: 'preventivo', kilometraje: Number(historialVehiculo.value?.kilometraje_actual) || null, costo: null, taller: '', descripcion: '' };
  } catch (e) {
    mantError.value = getErrorMessage(e, 'Error al registrar el mantenimiento');
  } finally {
    mantSaving.value = false;
  }
}

async function handleDeleteMantenimiento(m: MantenimientoHistorial) {
  if (!historialVehiculo.value) return;
  if (!confirm('¿Eliminar este registro del historial? Esta acción no se puede deshacer.')) return;
  try {
    await vehiculosStore.deleteMantenimiento(m.id, historialVehiculo.value.id);
    historial.value = historial.value.filter((h) => h.id !== m.id);
    historialVehiculo.value = vehiculosStore.vehiculos.find((v) => v.id === historialVehiculo.value?.id) ?? historialVehiculo.value;
  } catch (e) {
    mantError.value = getErrorMessage(e, 'Error al eliminar el registro');
  }
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Flota y Mantenimiento Vehicular</h1>
        <p class="text-slate-600 text-sm mt-1">{{ vehiculosStore.vehiculos.length }} vehículo(s) registrados</p>
      </div>
      <button class="btn-primary" @click="openCreate()">+ Agregar vehículo</button>
    </div>

    <div v-if="vehiculosUrgentes.length" class="rounded-xl border border-red-500/40 bg-red-500/10 p-4 mb-6">
      <h2 class="text-sm font-semibold text-red-700 mb-2">⚠ Vehículos que requieren atención urgente ({{ vehiculosUrgentes.length }})</h2>
      <ul class="space-y-1">
        <li v-for="f in vehiculosUrgentes" :key="f.vehiculo.id" class="text-xs text-red-700 flex flex-wrap items-center gap-2">
          <span class="font-medium">{{ f.vehiculo.placa }}</span>
          <span class="text-red-600/80">({{ TIPO_LABEL[f.vehiculo.tipo] }} · {{ asignadoA(f.vehiculo) }})</span>
          <span v-if="f.soat.nivel === 'rojo'">— {{ f.soat.label }}</span>
          <span v-if="f.mantenimiento.nivel === 'rojo'">— {{ f.mantenimiento.label }}</span>
          <button class="text-red-700 underline" @click="openHistorial(f.vehiculo)">Registrar mantenimiento →</button>
        </li>
      </ul>
    </div>

    <div class="flex flex-wrap items-end gap-3 mb-4">
      <div>
        <label class="field-label">Buscar</label>
        <input v-model="search" class="field-input" placeholder="Placa, marca o asignado" />
      </div>
      <div>
        <label class="field-label">Tipo</label>
        <select v-model="filterTipo" class="field-input">
          <option value="">Todos</option>
          <option value="auto">Auto</option>
          <option value="moto">Moto</option>
        </select>
      </div>
      <div>
        <label class="field-label">Estado</label>
        <select v-model="filterEstado" class="field-input">
          <option value="">Todos</option>
          <option value="activo">Activo</option>
          <option value="mantenimiento">En mantenimiento</option>
          <option value="inactivo">Inactivo</option>
        </select>
      </div>
    </div>

    <p v-if="vehiculosStore.error" class="mb-4 text-sm text-red-600">{{ vehiculosStore.error }}</p>

    <div class="table-shell">
      <table class="w-full text-sm min-w-[980px]">
        <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-3">Placa</th>
            <th class="text-left px-4 py-3">Tipo</th>
            <th class="text-left px-4 py-3">Marca / Modelo</th>
            <th class="text-left px-4 py-3">Asignado a</th>
            <th class="text-left px-4 py-3">Estado</th>
            <th class="text-left px-4 py-3">SOAT</th>
            <th class="text-left px-4 py-3">Mantenimiento</th>
            <th class="text-right px-4 py-3">Km actual</th>
            <th class="text-right px-4 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="vehiculosStore.loading">
            <td colspan="9" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
          </tr>
          <tr v-else-if="!filasFiltradas.length">
            <td colspan="9" class="px-4 py-6 text-center text-slate-500">No hay vehículos que coincidan.</td>
          </tr>
          <tr v-for="f in filasFiltradas" :key="f.vehiculo.id" class="border-t border-slate-200 hover:bg-slate-50">
            <td class="px-4 py-3 font-medium text-slate-900">{{ f.vehiculo.placa }}</td>
            <td class="px-4 py-3">{{ TIPO_LABEL[f.vehiculo.tipo] }}</td>
            <td class="px-4 py-3 text-slate-600">{{ f.vehiculo.marca }}<span v-if="f.vehiculo.modelo"> · {{ f.vehiculo.modelo }}</span></td>
            <td class="px-4 py-3 text-slate-600">{{ asignadoA(f.vehiculo) }}</td>
            <td class="px-4 py-3">
              <span class="badge" :class="ESTADO_CLASS[f.vehiculo.estado]">{{ ESTADO_LABEL[f.vehiculo.estado] }}</span>
            </td>
            <td class="px-4 py-3">
              <span class="badge" :class="ALERTA_BADGE_CLASS[f.soat.nivel]" :title="f.soat.label">{{ f.soat.label }}</span>
            </td>
            <td class="px-4 py-3">
              <span class="badge" :class="ALERTA_BADGE_CLASS[f.mantenimiento.nivel]" :title="f.mantenimiento.label">{{ f.mantenimiento.label }}</span>
            </td>
            <td class="px-4 py-3 text-right font-mono">{{ f.vehiculo.kilometraje_actual }}</td>
            <td class="px-4 py-3 text-right space-x-3 whitespace-nowrap">
              <button class="text-xs text-slate-600 hover:text-slate-900" @click="openHistorial(f.vehiculo)">Mantenimiento</button>
              <button class="text-xs text-sky-600 hover:text-sky-700" @click="openEdit(f.vehiculo)">Editar</button>
              <button v-if="canDelete" class="text-xs text-red-500/80 hover:text-red-600" @click="handleDelete(f.vehiculo)">Borrar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal: crear/editar vehiculo -->
    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay">
        <form class="w-full max-w-lg modal-panel max-h-[90vh] overflow-y-auto" @submit.prevent="handleSubmit">
          <h2 class="text-lg font-semibold mb-4">{{ editing ? 'Editar vehículo' : 'Nuevo vehículo' }}</h2>

          <h3 class="text-xs font-semibold text-slate-500 uppercase mb-2">Datos básicos</h3>
          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="field-label">Tipo</label>
              <select v-model="form.tipo" class="field-input">
                <option value="auto">Auto</option>
                <option value="moto">Moto</option>
              </select>
            </div>
            <div>
              <label class="field-label">Placa</label>
              <input v-model="form.placa" required class="field-input" placeholder="ej. PBA-1234" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="field-label">Marca</label>
              <input v-model="form.marca" required class="field-input" placeholder="ej. Honda" />
            </div>
            <div>
              <label class="field-label">Modelo</label>
              <input v-model="form.modelo" class="field-input" placeholder="ej. CB 190R 2023" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="field-label">Técnico asignado</label>
              <select v-model="form.tecnico_id" class="field-input">
                <option value="">Sin técnico (asignar por área)</option>
                <option v-for="s in catalogs.staff" :key="s.id" :value="s.id">{{ s.full_name || s.email }}</option>
              </select>
            </div>
            <div>
              <label class="field-label">Área asignada</label>
              <input v-model="form.area" class="field-input" placeholder="ej. Soporte / Bodega" />
            </div>
          </div>
          <div class="mb-4">
            <label class="field-label">Estado</label>
            <select v-model="form.estado" class="field-input">
              <option value="activo">Activo</option>
              <option value="mantenimiento">En mantenimiento</option>
              <option value="inactivo">Inactivo</option>
            </select>
          </div>

          <h3 class="text-xs font-semibold text-slate-500 uppercase mb-2">Control SOAT</h3>
          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="field-label">Fecha de emisión</label>
              <input v-model="form.soat_fecha_emision" type="date" class="field-input" />
            </div>
            <div>
              <label class="field-label">Fecha de vencimiento</label>
              <input v-model="form.soat_fecha_vencimiento" type="date" class="field-input" />
            </div>
          </div>
          <div class="mb-4">
            <label class="field-label">Aseguradora</label>
            <input v-model="form.soat_aseguradora" class="field-input" placeholder="ej. Seguros Sucre" />
          </div>
          <div class="mb-4">
            <label class="field-label">Archivo del SOAT (PDF o foto)</label>
            <div v-if="editing?.soatUrl && !soatFileRemoved" class="flex items-center gap-2 mb-2 text-xs">
              <a :href="editing.soatUrl" target="_blank" rel="noopener" class="text-sky-600 hover:underline">📄 Ver archivo actual</a>
              <button type="button" class="text-red-500/80 hover:text-red-600" @click="removeSoatFile">Quitar</button>
            </div>
            <p v-else-if="soatFileRemoved" class="text-xs text-amber-600 mb-2">El archivo se quitará al guardar.</p>
            <input type="file" accept="application/pdf,image/*" class="field-input" @change="onSoatFileChange" />
            <p v-if="soatFile" class="text-xs text-slate-500 mt-1">Se subirá: {{ soatFile.name }}</p>
          </div>

          <h3 class="text-xs font-semibold text-slate-500 uppercase mb-2">Mantenimiento</h3>
          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="field-label">Kilometraje actual</label>
              <input v-model.number="form.kilometraje_actual" type="number" step="0.1" min="0" class="field-input" />
            </div>
            <div>
              <label class="field-label">Próximo mantenimiento (km)</label>
              <input v-model.number="form.proximo_mantenimiento_km" type="number" step="0.1" min="0" class="field-input" />
            </div>
          </div>
          <div class="mb-3">
            <label class="field-label">Próximo mantenimiento (fecha)</label>
            <input v-model="form.proximo_mantenimiento_fecha" type="date" class="field-input" />
          </div>
          <div class="mb-4">
            <label class="field-label">Notas</label>
            <textarea v-model="form.notes" rows="2" class="field-input"></textarea>
          </div>

          <p v-if="formError" class="text-sm text-red-600 mb-3">{{ formError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showModal = false">Cancelar</button>
            <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? 'Guardando...' : 'Guardar' }}</button>
          </div>
        </form>
      </div>
    </Teleport>

    <!-- Modal: historial + registro rapido de mantenimiento -->
    <Teleport to="body">
      <div v-if="showHistorialModal" class="modal-overlay">
        <div class="w-full max-w-2xl modal-panel max-h-[90vh] overflow-y-auto">
          <h2 class="text-lg font-semibold mb-1">Mantenimiento — {{ historialVehiculo?.placa }}</h2>
          <p class="text-xs text-slate-500 mb-4">{{ historialVehiculo?.marca }} {{ historialVehiculo?.modelo }} · {{ historialVehiculo ? asignadoA(historialVehiculo) : '' }}</p>

          <form class="rounded-xl border border-slate-200 bg-slate-50/60 p-3 mb-4" @submit.prevent="handleAddMantenimiento">
            <h3 class="text-xs font-semibold text-slate-500 uppercase mb-2">Registrar nuevo mantenimiento</h3>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <div>
                <label class="field-label">Fecha</label>
                <input v-model="mantForm.fecha" type="date" required class="field-input" />
              </div>
              <div>
                <label class="field-label">Tipo</label>
                <select v-model="mantForm.tipo" class="field-input">
                  <option value="preventivo">Preventivo</option>
                  <option value="correctivo">Correctivo</option>
                </select>
              </div>
              <div>
                <label class="field-label">Kilometraje</label>
                <input v-model.number="mantForm.kilometraje" type="number" step="0.1" min="0" class="field-input" />
              </div>
              <div>
                <label class="field-label">Costo</label>
                <input v-model.number="mantForm.costo" type="number" step="0.01" min="0" class="field-input" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label class="field-label">Taller / Mecánico</label>
                <input v-model="mantForm.taller" class="field-input" />
              </div>
              <div>
                <label class="field-label">Descripción del trabajo</label>
                <input v-model="mantForm.descripcion" class="field-input" />
              </div>
            </div>
            <p v-if="mantError" class="text-sm text-red-600 mb-2">{{ mantError }}</p>
            <div class="flex justify-end">
              <button type="submit" class="btn-primary text-sm" :disabled="mantSaving">{{ mantSaving ? 'Guardando...' : 'Registrar' }}</button>
            </div>
          </form>

          <h3 class="text-sm font-semibold mb-2">Historial completo</h3>
          <p v-if="historialLoading" class="text-slate-500 text-sm">Cargando...</p>
          <p v-else-if="!historial.length" class="text-slate-500 text-sm">Sin mantenimientos registrados todavía.</p>
          <ul v-else class="space-y-2 max-h-72 overflow-y-auto">
            <li v-for="m in historial" :key="m.id" class="text-xs border-l-2 border-slate-300 pl-3 py-1 flex items-start justify-between gap-2">
              <div>
                <div class="flex items-center gap-2">
                  <span class="badge" :class="m.tipo === 'correctivo' ? 'bg-amber-500/15 text-amber-600' : 'bg-sky-500/15 text-sky-600'">
                    {{ MANTENIMIENTO_LABEL[m.tipo] }}
                  </span>
                  <span class="text-slate-500">{{ m.fecha }}</span>
                  <span v-if="m.kilometraje != null" class="text-slate-400">· {{ m.kilometraje }} km</span>
                  <span v-if="m.costo != null" class="text-slate-400">· ${{ Number(m.costo).toFixed(2) }}</span>
                </div>
                <p v-if="m.taller" class="text-slate-600 mt-0.5">{{ m.taller }}</p>
                <p v-if="m.descripcion" class="text-slate-500 mt-0.5">{{ m.descripcion }}</p>
                <p class="text-slate-400 mt-0.5">{{ m.author?.full_name || m.author?.email || '—' }}</p>
              </div>
              <button v-if="canDelete" class="text-red-500/80 hover:text-red-600 shrink-0" @click="handleDeleteMantenimiento(m)">Eliminar</button>
            </li>
          </ul>

          <div class="flex justify-end mt-4">
            <button class="btn-ghost" @click="showHistorialModal = false">Cerrar</button>
          </div>
        </div>
      </div>
    </Teleport>
  </AppLayout>
</template>
