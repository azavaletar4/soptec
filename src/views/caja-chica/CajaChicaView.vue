<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useCajaChicaStore, type CajaChicaMovimientoWithUrl } from '@/stores/cajaChica';
import { useVehiculosStore } from '@/stores/vehiculos';
import { useCatalogsStore } from '@/stores/catalogs';
import { getErrorMessage } from '@/lib/errors';
import type { CajaChicaTipo } from '@/types/domain';

const cajaChicaStore = useCajaChicaStore();
const vehiculosStore = useVehiculosStore();
const catalogs = useCatalogsStore();

const TIPO_LABEL: Record<CajaChicaTipo, string> = { ingreso: 'Ingreso', egreso: 'Egreso' };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonthIso() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function staffLabel(s: { full_name: string | null; email: string }) {
  return s.full_name || s.email;
}

// ---- Filtros ----
const dateFrom = ref('');
const dateTo = ref('');
const categoriaFilter = ref<string>('all');
const tipoFilter = ref<CajaChicaTipo | 'all'>('all');
const searchQuery = ref('');

const filteredMovimientos = computed(() => {
  let list = cajaChicaStore.movimientos;
  if (dateFrom.value) list = list.filter((m) => m.fecha >= dateFrom.value);
  if (dateTo.value) list = list.filter((m) => m.fecha <= dateTo.value);
  if (categoriaFilter.value !== 'all') list = list.filter((m) => m.categoria_id === categoriaFilter.value);
  if (tipoFilter.value !== 'all') list = list.filter((m) => m.tipo === tipoFilter.value);
  const q = searchQuery.value.trim().toLowerCase();
  if (q) list = list.filter((m) => `${m.descripcion} ${m.responsable}`.toLowerCase().includes(q));
  return list;
});

// ---- Resumen (siempre sobre TODOS los movimientos, no el filtro activo —
// el saldo y los totales del dia/mes deben reflejar la caja real). ----
const summary = computed(() => {
  const today = todayIso();
  const monthStart = firstOfMonthIso();
  let saldo = 0;
  let gastadoHoy = 0;
  let gastadoMes = 0;
  const porCategoria = new Map<string, number>();

  for (const m of cajaChicaStore.movimientos) {
    const monto = Number(m.monto);
    saldo += m.tipo === 'ingreso' ? monto : -monto;
    if (m.tipo === 'egreso') {
      if (m.fecha === today) gastadoHoy += monto;
      if (m.fecha >= monthStart) {
        gastadoMes += monto;
        porCategoria.set(m.categoria_id, (porCategoria.get(m.categoria_id) ?? 0) + monto);
      }
    }
  }

  const categorias = cajaChicaStore.categorias
    .map((cat) => ({ nombre: cat.nombre, total: porCategoria.get(cat.id) ?? 0 }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);
  const maxCategoria = Math.max(1, ...categorias.map((c) => c.total));

  return { saldo, gastadoHoy, gastadoMes, categorias, maxCategoria };
});

// ---- Modal crear/editar ----
const showModal = ref(false);
const editing = ref<CajaChicaMovimientoWithUrl | null>(null);
const saving = ref(false);
const formError = ref<string | null>(null);
const comprobanteFile = ref<File | null>(null);

const emptyForm = () => ({
  fecha: todayIso(),
  tipo: 'egreso' as CajaChicaTipo,
  categoria_id: cajaChicaStore.categorias[0]?.id ?? '',
  monto: 0,
  descripcion: '',
  responsable: '',
  vehiculo_id: '',
});
const form = ref(emptyForm());

const selectedCategoria = computed(() => cajaChicaStore.categorias.find((c) => c.id === form.value.categoria_id) ?? null);

// ---- Nueva categoria (inline, igual patron que "+ Nueva zona") ----
const showNewCategoria = ref(false);
const newCategoriaName = ref('');
const savingCategoria = ref(false);
const categoriaError = ref<string | null>(null);

async function handleCreateCategoria() {
  const name = newCategoriaName.value.trim();
  if (!name) return;
  savingCategoria.value = true;
  categoriaError.value = null;
  try {
    const created = await cajaChicaStore.createCategoria(name);
    form.value.categoria_id = created.id;
    showNewCategoria.value = false;
    newCategoriaName.value = '';
  } catch (e) {
    categoriaError.value = getErrorMessage(e, 'Error al crear la categoría');
  } finally {
    savingCategoria.value = false;
  }
}

function openCreate() {
  editing.value = null;
  form.value = emptyForm();
  comprobanteFile.value = null;
  showNewCategoria.value = false;
  formError.value = null;
  showModal.value = true;
}

function openEdit(m: CajaChicaMovimientoWithUrl) {
  editing.value = m;
  form.value = {
    fecha: m.fecha,
    tipo: m.tipo,
    categoria_id: m.categoria_id,
    monto: Number(m.monto),
    descripcion: m.descripcion,
    responsable: m.responsable,
    vehiculo_id: m.vehiculo_id ?? '',
  };
  comprobanteFile.value = null;
  showNewCategoria.value = false;
  formError.value = null;
  showModal.value = true;
}

function onComprobanteChange(e: Event) {
  comprobanteFile.value = (e.target as HTMLInputElement).files?.[0] ?? null;
}

async function handleSubmit() {
  if (!form.value.descripcion.trim() || !form.value.responsable.trim() || !form.value.categoria_id || form.value.monto <= 0) return;
  saving.value = true;
  formError.value = null;
  try {
    let comprobantePath = editing.value?.comprobante_path ?? null;
    if (comprobanteFile.value) {
      comprobantePath = await cajaChicaStore.uploadComprobante(comprobanteFile.value, editing.value?.comprobante_path);
    }
    const payload = {
      fecha: form.value.fecha,
      tipo: form.value.tipo,
      categoria_id: form.value.categoria_id,
      monto: form.value.monto,
      descripcion: form.value.descripcion.trim(),
      responsable: form.value.responsable.trim(),
      vehiculo_id: selectedCategoria.value?.permite_vehiculo && form.value.vehiculo_id ? form.value.vehiculo_id : null,
      comprobante_path: comprobantePath,
    };
    if (editing.value) {
      await cajaChicaStore.updateMovimiento(editing.value.id, payload);
    } else {
      await cajaChicaStore.createMovimiento(payload);
    }
    showModal.value = false;
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al guardar el movimiento');
  } finally {
    saving.value = false;
  }
}

async function handleDelete(m: CajaChicaMovimientoWithUrl) {
  const ok = confirm(`¿Eliminar el movimiento "${m.descripcion}" (S/ ${Number(m.monto).toFixed(2)})? Esta acción no se puede deshacer.`);
  if (!ok) return;
  try {
    await cajaChicaStore.deleteMovimiento(m.id, m.comprobante_path);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al eliminar el movimiento'));
  }
}

onMounted(async () => {
  await Promise.all([cajaChicaStore.fetchMovimientos(), cajaChicaStore.fetchCategorias(), catalogs.fetchStaff()]);
  vehiculosStore.fetchVehiculos().catch(() => {});
});
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Caja Chica</h1>
        <p class="text-slate-600 text-sm mt-1">Gastos e ingresos menores en efectivo — {{ cajaChicaStore.movimientos.length }} movimientos</p>
      </div>
      <button class="btn-primary" @click="openCreate">+ Nuevo movimiento</button>
    </div>

    <div class="grid gap-4 mb-6" style="grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))">
      <div class="text-left rounded-xl p-5 flex items-start justify-between" :style="{ background: summary.saldo >= 0 ? '#16a34a' : '#dc2626' }">
        <div>
          <div class="text-3xl font-bold text-white">S/ {{ summary.saldo.toFixed(2) }}</div>
          <div class="text-sm text-white/90 mt-1">Saldo actual</div>
        </div>
        <span class="text-2xl">💵</span>
      </div>
      <div class="text-left rounded-xl p-5 flex items-start justify-between" style="background:#d97706">
        <div>
          <div class="text-3xl font-bold text-white">S/ {{ summary.gastadoHoy.toFixed(2) }}</div>
          <div class="text-sm text-white/90 mt-1">Gastado hoy</div>
        </div>
        <span class="text-2xl">📅</span>
      </div>
      <div class="text-left rounded-xl p-5 flex items-start justify-between" style="background:#0369a1">
        <div>
          <div class="text-3xl font-bold text-white">S/ {{ summary.gastadoMes.toFixed(2) }}</div>
          <div class="text-sm text-white/90 mt-1">Gastado este mes</div>
        </div>
        <span class="text-2xl">📊</span>
      </div>
    </div>

    <div v-if="summary.categorias.length" class="surface p-5 mb-6">
      <h2 class="text-sm font-semibold mb-3">Gasto por categoría (este mes)</h2>
      <div class="space-y-2">
        <div v-for="c in summary.categorias" :key="c.nombre" class="flex items-center gap-3 text-sm">
          <span class="w-40 shrink-0 text-slate-600 text-xs">{{ c.nombre }}</span>
          <div class="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden">
            <div class="h-full rounded-full bg-sky-500" :style="{ width: (c.total / summary.maxCategoria) * 100 + '%' }"></div>
          </div>
          <span class="w-20 shrink-0 text-right font-medium text-xs">S/ {{ c.total.toFixed(2) }}</span>
        </div>
      </div>
    </div>

    <div class="surface p-4 mb-6">
      <div class="grid gap-3 mb-3" style="grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))">
        <div>
          <label class="block text-xs text-slate-600 mb-1">Desde</label>
          <input v-model="dateFrom" type="date" class="field-input" />
        </div>
        <div>
          <label class="block text-xs text-slate-600 mb-1">Hasta</label>
          <input v-model="dateTo" type="date" class="field-input" />
        </div>
        <div>
          <label class="block text-xs text-slate-600 mb-1">Categoría</label>
          <select v-model="categoriaFilter" class="field-input">
            <option value="all">Todas</option>
            <option v-for="cat in cajaChicaStore.categorias" :key="cat.id" :value="cat.id">{{ cat.nombre }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-slate-600 mb-1">Tipo</label>
          <select v-model="tipoFilter" class="field-input">
            <option value="all">Todos</option>
            <option value="ingreso">Ingreso</option>
            <option value="egreso">Egreso</option>
          </select>
        </div>
      </div>
      <input v-model="searchQuery" placeholder="Buscar por descripción o responsable..." class="field-input" />
    </div>

    <p v-if="cajaChicaStore.error" class="mb-4 text-sm text-red-600">{{ cajaChicaStore.error }}</p>

    <div class="table-shell">
      <table class="w-full text-sm min-w-[860px]">
        <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-3">Fecha</th>
            <th class="text-left px-4 py-3">Categoría</th>
            <th class="text-left px-4 py-3">Descripción</th>
            <th class="text-left px-4 py-3">Responsable</th>
            <th class="text-left px-4 py-3">Monto</th>
            <th class="text-left px-4 py-3">Tipo</th>
            <th class="text-left px-4 py-3">Comprobante</th>
            <th class="text-right px-4 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="cajaChicaStore.loading">
            <td colspan="8" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
          </tr>
          <tr v-else-if="!filteredMovimientos.length">
            <td colspan="8" class="px-4 py-6 text-center text-slate-500">No hay movimientos en este filtro.</td>
          </tr>
          <tr v-for="m in filteredMovimientos" :key="m.id" class="border-t border-slate-200 hover:bg-slate-50">
            <td class="px-4 py-3 text-slate-600 text-xs">{{ m.fecha }}</td>
            <td class="px-4 py-3">
              <span class="badge bg-slate-500/15 text-slate-600">{{ m.caja_chica_categorias?.nombre ?? '—' }}</span>
            </td>
            <td class="px-4 py-3">
              {{ m.descripcion }}
              <div v-if="m.vehiculos" class="text-[11px] text-slate-400">{{ m.vehiculos.placa }} — {{ m.vehiculos.marca }}</div>
            </td>
            <td class="px-4 py-3 text-slate-600">{{ m.responsable }}</td>
            <td class="px-4 py-3 font-medium" :class="m.tipo === 'ingreso' ? 'text-green-600' : 'text-slate-900'">
              {{ m.tipo === 'ingreso' ? '+' : '-' }} S/ {{ Number(m.monto).toFixed(2) }}
            </td>
            <td class="px-4 py-3">
              <span class="badge" :class="m.tipo === 'ingreso' ? 'bg-green-500/15 text-green-600' : 'bg-amber-500/15 text-amber-600'">
                {{ TIPO_LABEL[m.tipo] }}
              </span>
            </td>
            <td class="px-4 py-3">
              <a v-if="m.url" :href="m.url" target="_blank" rel="noopener" class="text-sky-600 hover:underline" title="Ver comprobante">📎</a>
              <span v-else class="text-slate-300">—</span>
            </td>
            <td class="px-4 py-3 text-right space-x-3 whitespace-nowrap">
              <button class="text-slate-600 hover:text-slate-900 text-xs" @click="openEdit(m)">Editar</button>
              <button class="text-red-500/80 hover:text-red-600 text-xs" @click="handleDelete(m)">Eliminar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay">
        <form class="w-full max-w-lg modal-panel max-h-[90vh] overflow-y-auto" @submit.prevent="handleSubmit">
          <h2 class="text-lg font-semibold mb-4">{{ editing ? 'Editar movimiento' : 'Nuevo movimiento' }}</h2>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Fecha</label>
              <input v-model="form.fecha" type="date" required class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Tipo</label>
              <select v-model="form.tipo" class="field-input">
                <option value="egreso">Egreso</option>
                <option value="ingreso">Ingreso</option>
              </select>
            </div>
          </div>

          <div class="mb-3">
            <div class="flex items-center justify-between mb-1">
              <label class="block text-xs text-slate-600">Categoría</label>
              <button type="button" class="text-xs text-sky-600 hover:text-sky-700" @click="showNewCategoria = !showNewCategoria">
                {{ showNewCategoria ? 'Cancelar' : '+ Nueva categoría' }}
              </button>
            </div>
            <select v-if="!showNewCategoria" v-model="form.categoria_id" required class="field-input">
              <option value="" disabled>Selecciona una categoría</option>
              <option v-for="cat in cajaChicaStore.categorias" :key="cat.id" :value="cat.id">{{ cat.nombre }}</option>
            </select>
            <div v-else class="flex gap-2">
              <input
                v-model="newCategoriaName"
                placeholder="Nombre de la categoría"
                class="flex-1 min-w-0 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                @keydown.enter.prevent="handleCreateCategoria"
              />
              <button
                type="button"
                :disabled="savingCategoria || !newCategoriaName.trim()"
                class="px-3 py-2 rounded-lg bg-sky-500 text-slate-950 text-sm font-semibold disabled:opacity-60"
                @click="handleCreateCategoria"
              >
                {{ savingCategoria ? '...' : 'Agregar' }}
              </button>
            </div>
            <p v-if="categoriaError" class="text-xs text-red-600 mt-1">{{ categoriaError }}</p>
            <p class="text-xs text-slate-400 mt-1">Una categoría nueva queda disponible para todos los movimientos futuros.</p>
          </div>

          <div v-if="selectedCategoria?.permite_vehiculo" class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Vehículo (opcional)</label>
            <select v-model="form.vehiculo_id" class="field-input">
              <option value="">Sin vincular</option>
              <option v-for="v in vehiculosStore.vehiculos" :key="v.id" :value="v.id">{{ v.placa }} — {{ v.marca }} {{ v.modelo }}</option>
            </select>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Monto (S/)</label>
            <input v-model.number="form.monto" type="number" step="0.01" min="0.01" required class="field-input" />
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Descripción</label>
            <input v-model="form.descripcion" required placeholder="Ej. Gasolina camioneta placa XXX - instalación zona PON 3" class="field-input" />
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Responsable</label>
            <select v-model="form.responsable" required class="field-input">
              <option value="" disabled>Selecciona quién hizo o autorizó el gasto</option>
              <option v-for="s in catalogs.staff" :key="s.id" :value="staffLabel(s)">{{ staffLabel(s) }}</option>
            </select>
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-600 mb-1">Comprobante (opcional)</label>
            <a v-if="editing?.url" :href="editing.url" target="_blank" rel="noopener" class="text-xs text-sky-600 hover:underline mb-1 inline-block">
              Ver comprobante actual
            </a>
            <input type="file" accept="image/*,.pdf" class="field-input" @change="onComprobanteChange" />
          </div>

          <p v-if="formError" class="text-sm text-red-600 mb-3">{{ formError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showModal = false">Cancelar</button>
            <button type="submit" :disabled="saving" class="btn-primary">
              {{ saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear movimiento' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
