<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useActivosTecnicosStore, type ActivoTecnicoWithUrl } from '@/stores/activosTecnicos';
import { useCatalogsStore } from '@/stores/catalogs';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/lib/errors';
import { costoDepreciadoSugerido, esElegibleRenovacion, nivelVidaUtil, vidaUtilRestantePct } from '@/lib/activosDepreciacion';
import { ALERTA_BADGE_CLASS } from '@/lib/vehiculoAlertas';
import type { ActivoCategoria, ActivoEstado, ActivoTecnico } from '@/types/domain';

const activosStore = useActivosTecnicosStore();
const catalogs = useCatalogsStore();
const auth = useAuthStore();

const canDelete = computed(() => auth.role === 'SUPERADMIN' || auth.role === 'ADMIN');

onMounted(async () => {
  await Promise.all([activosStore.fetchActivos(), catalogs.fetchStaff()]);
});

const CATEGORIA_META: Record<ActivoCategoria, { label: string; icon: string; vidaUtilDefault: number }> = {
  celular: { label: 'Celulares Corporativos', icon: '📱', vidaUtilDefault: 36 },
  herramienta: { label: 'Herramientas de Campo', icon: '🛠️', vidaUtilDefault: 24 },
  epp: { label: 'Indumentaria y EPP', icon: '🥾', vidaUtilDefault: 12 },
};
const ESTADO_LABEL: Record<ActivoEstado, string> = {
  nuevo: 'Nuevo',
  en_uso_bueno: 'En uso — Buen estado',
  en_uso_desgastado: 'En uso — Desgastado',
  danado: 'Dañado / Reparación',
  baja: 'Dado de baja',
};
const ESTADO_CLASS: Record<ActivoEstado, string> = {
  nuevo: 'bg-sky-500/15 text-sky-700',
  en_uso_bueno: 'bg-green-500/15 text-green-600',
  en_uso_desgastado: 'bg-amber-500/15 text-amber-700',
  danado: 'bg-red-500/15 text-red-600',
  baja: 'bg-slate-500/15 text-slate-600',
};

function asignadoA(a: ActivoTecnico): string {
  return a.tecnico?.full_name || a.tecnico?.email || 'Sin asignar';
}

function vidaUtilLabel(a: ActivoTecnico): string {
  const pct = vidaUtilRestantePct(a);
  if (pct == null) return 'Sin entregar';
  if (pct <= 0) return esElegibleRenovacion(a) ? '🔁 Elegible para renovación' : '0% restante';
  return `${pct}% restante`;
}

// ---- Filtros ----
const search = ref('');
const filterCategoria = ref<'' | ActivoCategoria>('');
const filterEstado = ref<'' | ActivoEstado>('');

const filasConVidaUtil = computed(() =>
  activosStore.activos.map((a) => ({
    activo: a,
    pct: vidaUtilRestantePct(a),
    nivel: nivelVidaUtil(vidaUtilRestantePct(a)),
    elegibleRenovacion: esElegibleRenovacion(a),
    costoReposicion: costoDepreciadoSugerido(a),
  })),
);

const filasFiltradas = computed(() => {
  const q = search.value.trim().toLowerCase();
  return filasConVidaUtil.value.filter(
    (f) =>
      (!filterCategoria.value || f.activo.categoria === filterCategoria.value) &&
      (!filterEstado.value || f.activo.estado === filterEstado.value) &&
      (!q ||
        f.activo.codigo.toLowerCase().includes(q) ||
        f.activo.nombre.toLowerCase().includes(q) ||
        asignadoA(f.activo).toLowerCase().includes(q)),
  );
});

// Tarjetas de categoria (conteo rapido, clic = filtro) — mismo criterio
// visual que el grid de albumes de InventarioView, pero son solo 3 y fijas
// (no hace falta el RPC de albumes dinamicos).
const categoriaCards = computed(() =>
  (Object.keys(CATEGORIA_META) as ActivoCategoria[]).map((cat) => ({
    value: cat,
    ...CATEGORIA_META[cat],
    count: activosStore.activos.filter((a) => a.categoria === cat).length,
  })),
);

// Activos con vida util agotada (elegibles para renovacion) — aviso prioritario, igual que vehiculosUrgentes en FlotaView.
const activosElegibles = computed(() => filasConVidaUtil.value.filter((f) => f.elegibleRenovacion));

// ---- CRUD de activo ----
const showModal = ref(false);
const editing = ref<ActivoTecnicoWithUrl | null>(null);
const saving = ref(false);
const formError = ref<string | null>(null);

const cargoFile = ref<File | null>(null);
const cargoFileRemoved = ref(false);

function emptyForm() {
  return {
    categoria: 'herramienta' as ActivoCategoria,
    codigo: '',
    nombre: '',
    modelo: '',
    costo_compra: 0,
    fecha_compra: '',
    vida_util_meses: CATEGORIA_META.herramienta.vidaUtilDefault,
    tecnico_id: '' as string | '',
    fecha_entrega: '',
    estado: 'nuevo' as ActivoEstado,
    notas: '',
  };
}
const form = ref(emptyForm());

// Sugiere la vida util tipica de la categoria elegida — solo al crear (en
// edicion no se quiere pisar un valor que el usuario ya haya corregido a
// mano para un activo puntual).
watch(
  () => form.value.categoria,
  (cat) => {
    if (!editing.value) form.value.vida_util_meses = CATEGORIA_META[cat].vidaUtilDefault;
  },
);

function numOrNull(v: number | string | null): number | null {
  return v === '' || v == null ? null : Number(v);
}

function openCreate(categoriaInicial?: ActivoCategoria) {
  editing.value = null;
  form.value = emptyForm();
  if (categoriaInicial) {
    form.value.categoria = categoriaInicial;
    form.value.vida_util_meses = CATEGORIA_META[categoriaInicial].vidaUtilDefault;
  }
  cargoFile.value = null;
  cargoFileRemoved.value = false;
  formError.value = null;
  showModal.value = true;
}

function openEdit(a: ActivoTecnicoWithUrl) {
  editing.value = a;
  form.value = {
    categoria: a.categoria,
    codigo: a.codigo,
    nombre: a.nombre,
    modelo: a.modelo ?? '',
    costo_compra: Number(a.costo_compra),
    fecha_compra: a.fecha_compra ?? '',
    vida_util_meses: a.vida_util_meses,
    tecnico_id: a.tecnico_id ?? '',
    fecha_entrega: a.fecha_entrega ?? '',
    estado: a.estado,
    notas: a.notas ?? '',
  };
  cargoFile.value = null;
  cargoFileRemoved.value = false;
  formError.value = null;
  showModal.value = true;
}

function onCargoFileChange(e: Event) {
  cargoFile.value = (e.target as HTMLInputElement).files?.[0] ?? null;
  if (cargoFile.value) cargoFileRemoved.value = false;
}

function removeCargoFile() {
  cargoFile.value = null;
  cargoFileRemoved.value = true;
}

async function handleSubmit() {
  saving.value = true;
  formError.value = null;
  try {
    const payload = {
      categoria: form.value.categoria,
      codigo: form.value.codigo.trim(),
      nombre: form.value.nombre.trim(),
      modelo: form.value.modelo.trim() || null,
      costo_compra: numOrNull(form.value.costo_compra) ?? 0,
      fecha_compra: form.value.fecha_compra || null,
      vida_util_meses: numOrNull(form.value.vida_util_meses) ?? CATEGORIA_META[form.value.categoria].vidaUtilDefault,
      tecnico_id: form.value.tecnico_id || null,
      fecha_entrega: form.value.fecha_entrega || null,
      estado: form.value.estado,
      notas: form.value.notas.trim() || null,
    };
    const saved = editing.value ? await activosStore.updateActivo(editing.value.id, payload) : await activosStore.createActivo(payload);

    if (cargoFile.value) {
      await activosStore.uploadCargoFile(saved.id, cargoFile.value, editing.value?.cargo_documento_path ?? null);
    } else if (cargoFileRemoved.value && editing.value?.cargo_documento_path) {
      await activosStore.removeCargoFile(saved.id, editing.value.cargo_documento_path);
    }

    showModal.value = false;
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al guardar el activo');
  } finally {
    saving.value = false;
  }
}

async function handleDelete(a: ActivoTecnico) {
  if (!confirm(`¿Eliminar el activo "${a.codigo} — ${a.nombre}"? Esta acción no se puede deshacer.`)) return;
  try {
    await activosStore.deleteActivo(a.id);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al eliminar el activo'));
  }
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">🧰 Activos y Herramientas</h1>
        <p class="text-slate-600 text-sm mt-1">{{ activosStore.activos.length }} activo(s) registrados</p>
      </div>
      <button class="btn-primary" @click="openCreate()">+ Agregar activo</button>
    </div>

    <div class="grid gap-3 mb-6" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))">
      <button
        v-for="c in categoriaCards"
        :key="c.value"
        type="button"
        class="surface p-4 text-left hover:border-sky-300 transition-colors"
        :class="filterCategoria === c.value ? 'border-sky-400 ring-1 ring-sky-300' : ''"
        @click="filterCategoria = filterCategoria === c.value ? '' : c.value"
      >
        <div class="text-2xl mb-1">{{ c.icon }}</div>
        <div class="text-sm font-medium text-slate-800">{{ c.label }}</div>
        <div class="text-xs text-slate-500 mt-0.5">{{ c.count }} ítem(s)</div>
      </button>
    </div>

    <div v-if="activosElegibles.length" class="rounded-xl border border-red-500/40 bg-red-500/10 p-4 mb-6">
      <h2 class="text-sm font-semibold text-red-700 mb-2">
        🔁 Activos elegibles para renovación por empresa ({{ activosElegibles.length }})
      </h2>
      <ul class="space-y-1">
        <li v-for="f in activosElegibles" :key="f.activo.id" class="text-xs text-red-700 flex flex-wrap items-center gap-2">
          <span class="font-medium">{{ f.activo.codigo }}</span>
          <span class="text-red-600/80">({{ CATEGORIA_META[f.activo.categoria].label }} · {{ asignadoA(f.activo) }})</span>
          <span>— vida útil agotada, sin cargo al técnico</span>
          <button class="text-red-700 underline" @click="openEdit(f.activo)">Revisar →</button>
        </li>
      </ul>
    </div>

    <div class="flex flex-wrap items-end gap-3 mb-4">
      <div>
        <label class="field-label">Buscar</label>
        <input v-model="search" class="field-input" placeholder="Código, nombre o asignado" />
      </div>
      <div>
        <label class="field-label">Categoría</label>
        <select v-model="filterCategoria" class="field-input">
          <option value="">Todas</option>
          <option v-for="(meta, cat) in CATEGORIA_META" :key="cat" :value="cat">{{ meta.icon }} {{ meta.label }}</option>
        </select>
      </div>
      <div>
        <label class="field-label">Estado</label>
        <select v-model="filterEstado" class="field-input">
          <option value="">Todos</option>
          <option v-for="(label, estado) in ESTADO_LABEL" :key="estado" :value="estado">{{ label }}</option>
        </select>
      </div>
    </div>

    <p v-if="activosStore.error" class="mb-4 text-sm text-red-600">{{ activosStore.error }}</p>

    <div class="table-shell">
      <table class="w-full text-sm min-w-[980px]">
        <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-3">Código</th>
            <th class="text-left px-4 py-3">Categoría</th>
            <th class="text-left px-4 py-3">Nombre / Modelo</th>
            <th class="text-left px-4 py-3">Asignado a</th>
            <th class="text-left px-4 py-3">Estado</th>
            <th class="text-left px-4 py-3">Vida útil</th>
            <th class="text-right px-4 py-3">Costo compra</th>
            <th class="text-right px-4 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="activosStore.loading">
            <td colspan="8" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
          </tr>
          <tr v-else-if="!filasFiltradas.length">
            <td colspan="8" class="px-4 py-6 text-center text-slate-500">No hay activos que coincidan.</td>
          </tr>
          <tr v-for="f in filasFiltradas" :key="f.activo.id" class="border-t border-slate-200 hover:bg-slate-50">
            <td class="px-4 py-3 font-mono text-xs text-slate-900">{{ f.activo.codigo }}</td>
            <td class="px-4 py-3">{{ CATEGORIA_META[f.activo.categoria].icon }} {{ CATEGORIA_META[f.activo.categoria].label }}</td>
            <td class="px-4 py-3 text-slate-600">{{ f.activo.nombre }}<span v-if="f.activo.modelo"> · {{ f.activo.modelo }}</span></td>
            <td class="px-4 py-3 text-slate-600">{{ asignadoA(f.activo) }}</td>
            <td class="px-4 py-3">
              <span class="badge" :class="ESTADO_CLASS[f.activo.estado]">{{ ESTADO_LABEL[f.activo.estado] }}</span>
            </td>
            <td class="px-4 py-3">
              <span class="badge" :class="ALERTA_BADGE_CLASS[f.nivel]">{{ vidaUtilLabel(f.activo) }}</span>
              <p v-if="(f.activo.estado === 'danado' || f.activo.estado === 'baja') && f.costoReposicion != null" class="text-[11px] text-slate-500 mt-1">
                Repos. sugerida: S/ {{ f.costoReposicion.toFixed(2) }}
              </p>
            </td>
            <td class="px-4 py-3 text-right font-mono">S/ {{ Number(f.activo.costo_compra).toFixed(2) }}</td>
            <td class="px-4 py-3 text-right space-x-3 whitespace-nowrap">
              <button class="text-xs text-sky-700 hover:text-sky-700" @click="openEdit(f.activo)">Editar</button>
              <button v-if="canDelete" class="text-xs text-red-500/80 hover:text-red-600" @click="handleDelete(f.activo)">Borrar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal: crear/editar activo -->
    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay">
        <form class="w-full max-w-lg modal-panel max-h-[90vh] overflow-y-auto" @submit.prevent="handleSubmit">
          <h2 class="text-lg font-semibold mb-4">{{ editing ? 'Editar activo' : 'Nuevo activo' }}</h2>

          <h3 class="text-xs font-semibold text-slate-500 uppercase mb-2">Datos del activo</h3>
          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="field-label">Categoría</label>
              <select v-model="form.categoria" class="field-input">
                <option v-for="(meta, cat) in CATEGORIA_META" :key="cat" :value="cat">{{ meta.icon }} {{ meta.label }}</option>
              </select>
            </div>
            <div>
              <label class="field-label">Código / Serial</label>
              <input v-model="form.codigo" required class="field-input" placeholder="ej. IMEI o código interno" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="field-label">Nombre</label>
              <input v-model="form.nombre" required class="field-input" placeholder="ej. Celular Soporte, Taladro" />
            </div>
            <div>
              <label class="field-label">Modelo</label>
              <input v-model="form.modelo" class="field-input" placeholder="ej. Redmi 12 128GB" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label class="field-label">Costo de compra (S/)</label>
              <input v-model.number="form.costo_compra" type="number" step="0.01" min="0" class="field-input" />
            </div>
            <div>
              <label class="field-label">Fecha de compra</label>
              <input v-model="form.fecha_compra" type="date" class="field-input" />
            </div>
          </div>
          <div class="mb-4">
            <label class="field-label">Vida útil estimada (meses)</label>
            <input v-model.number="form.vida_util_meses" type="number" min="1" class="field-input" />
            <p class="text-[11px] text-slate-400 mt-1">Sugerido: 12 EPP, 24 herramientas, 36 celulares — se precarga al elegir la categoría.</p>
          </div>

          <h3 class="text-xs font-semibold text-slate-500 uppercase mb-2">Asignación</h3>
          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="field-label">Técnico asignado</label>
              <select v-model="form.tecnico_id" class="field-input">
                <option value="">Sin asignar (en bodega)</option>
                <option v-for="s in catalogs.staff" :key="s.id" :value="s.id">{{ s.full_name || s.email }}</option>
              </select>
            </div>
            <div>
              <label class="field-label">Fecha de entrega</label>
              <input v-model="form.fecha_entrega" type="date" class="field-input" />
            </div>
          </div>
          <div class="mb-4">
            <label class="field-label">Estado actual</label>
            <select v-model="form.estado" class="field-input">
              <option v-for="(label, estado) in ESTADO_LABEL" :key="estado" :value="estado">{{ label }}</option>
            </select>
          </div>

          <h3 class="text-xs font-semibold text-slate-500 uppercase mb-2">Cargo de recepción</h3>
          <div class="mb-4">
            <label class="field-label">Documento firmado por el técnico (PDF o foto)</label>
            <div v-if="editing?.cargoUrl && !cargoFileRemoved" class="flex items-center gap-2 mb-2 text-xs">
              <a :href="editing.cargoUrl" target="_blank" rel="noopener" class="text-sky-600 hover:underline">📄 Ver cargo actual</a>
              <button type="button" class="text-red-500/80 hover:text-red-600" @click="removeCargoFile">Quitar</button>
            </div>
            <p v-else-if="cargoFileRemoved" class="text-xs text-amber-700 mb-2">El archivo se quitará al guardar.</p>
            <input type="file" accept="application/pdf,image/*" class="field-input" @change="onCargoFileChange" />
            <p v-if="cargoFile" class="text-xs text-slate-500 mt-1">Se subirá: {{ cargoFile.name }}</p>
          </div>

          <div class="mb-4">
            <label class="field-label">Notas</label>
            <textarea v-model="form.notas" rows="2" class="field-input"></textarea>
          </div>

          <p v-if="formError" class="text-sm text-red-600 mb-3">{{ formError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showModal = false">Cancelar</button>
            <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? 'Guardando...' : 'Guardar' }}</button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
