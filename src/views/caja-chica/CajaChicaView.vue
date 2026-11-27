<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useCajaChicaStore, type CajaChicaMovimientoWithUrl } from '@/stores/cajaChica';
import { useVehiculosStore } from '@/stores/vehiculos';
import { useCatalogsStore } from '@/stores/catalogs';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/lib/errors';
import type { CajaChicaTipo } from '@/types/domain';
import CajaFinancePanel from '@/components/caja-chica/CajaFinancePanel.vue';
import CajaChicaConfigPanel from '@/components/caja-chica/CajaChicaConfigPanel.vue';
import { operatingExpenseCents, cashMethodLabel } from '@/lib/financeCash';
import { limaDate, formatPen } from '@/lib/financeMoney';

const cajaChicaStore = useCajaChicaStore();
const vehiculosStore = useVehiculosStore();
const catalogs = useCatalogsStore();
const auth = useAuthStore();

const TIPO_LABEL: Record<CajaChicaTipo, string> = { ingreso: 'Ingreso', egreso: 'Egreso' };

function todayIso() {
  return limaDate();
}
function firstOfMonthIso() {
  return limaDate().slice(0, 7) + '-01';
}

function staffLabel(s: { full_name: string | null; email: string }) {
  return s.full_name || s.email;
}

// Fase 30: Caja Chica organizada en pestañas — Resumen (panorama + gráficos),
// Cobranzas y cierre (diseño ya aprobado, sin cambios de estructura),
// Movimientos (tabla + filtros) y Configuración (responsables/categorías).
type Tab = 'resumen' | 'cobranzas' | 'movimientos' | 'config';
const tab = ref<Tab>('resumen');

// ---- Filtros (pestaña Movimientos) ----
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
// el saldo y los totales del dia/mes deben reflejar la caja real; misma
// fuente que la tabla de Movimientos y que el arqueo de Cobranzas y cierre,
// para que saldo/movimientos/arqueo sean siempre coherentes entre sí). ----
const summary = computed(() => {
  const today = todayIso();
  const monthStart = firstOfMonthIso();
  let saldo = 0;
  let gastadoHoy = 0;
  let gastadoMes = 0;
  const porCategoria = new Map<string, number>();
  const byId = new Map(cajaChicaStore.movimientos.map((m) => [m.id, m]));

  for (const m of cajaChicaStore.movimientos) {
    const monto = Number(m.monto);
    saldo += m.tipo === 'ingreso' ? monto : -monto;
    const expense = operatingExpenseCents(m, byId) / 100;
    if (expense !== 0) {
      if (m.fecha === today) gastadoHoy += expense;
      if (m.fecha >= monthStart) {
        gastadoMes += expense;
        porCategoria.set(m.categoria_id, (porCategoria.get(m.categoria_id) ?? 0) + expense);
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

// Cobranzas del día (efectivo) para la tarjeta de Resumen — misma fuente
// (caja_finance_daily) que Cobranzas y cierre, nunca un valor aparte.
const cobranzasHoy = computed(() => Number(cajaChicaStore.daily?.linkedCashCollections ?? 0));
const retirosPropietarioMes = computed(() => {
  const monthStart = firstOfMonthIso();
  return cajaChicaStore.movimientos
    .filter((m) => m.finance_kind === 'owner_withdrawal' && m.fecha >= monthStart)
    .reduce((n, m) => n + Number(m.monto), 0);
});

// ---- Responsables visibles en el selector (Fase 30, nunca hardcodeado):
// filtra catalogs.staff con la configuración ya cargada — ausencia de fila
// en responsablesConfig = visible por defecto. ----
const visibleStaff = computed(() => {
  const config = new Map(cajaChicaStore.responsablesConfig.map((r) => [r.profileId, r.visible]));
  return catalogs.staff.filter((s) => config.get(s.id) ?? true);
});

// ---- Registrar movimiento; las correcciones conservan el original ----
const showModal = ref(false);
const formStep = ref<'form' | 'confirm'>('form');
const saving = ref(false);
const formError = ref<string | null>(null);
const comprobanteFile = ref<File | null>(null);
const manualCategories = computed(() =>
  cajaChicaStore.categorias.filter((c) => c.tipo === form.value.tipo && !['Cobros de clientes', 'Retiros del propietario'].includes(c.nombre)),
);

function defaultResponsable(): string {
  const me = catalogs.staff.find((s) => s.id === auth.user?.id);
  if (me && visibleStaff.value.some((s) => s.id === me.id)) return staffLabel(me);
  return visibleStaff.value[0] ? staffLabel(visibleStaff.value[0]) : '';
}

const emptyForm = () => ({
  fecha: todayIso(),
  tipo: 'egreso' as CajaChicaTipo,
  categoria_id: '',
  monto: 0,
  descripcion: '',
  responsable: defaultResponsable(),
  vehiculo_id: '',
});
const form = ref(emptyForm());
watch(() => form.value.tipo, () => {
  // Cambiar el tipo recalcula la lista de categorías disponibles — la
  // categoría elegida antes puede ya no aplicar (ingreso vs egreso).
  form.value.categoria_id = manualCategories.value[0]?.id ?? '';
});

const selectedCategoria = computed(() => cajaChicaStore.categorias.find((c) => c.id === form.value.categoria_id) ?? null);

// ---- Nueva categoria inline (mismo patron que "+ Nueva zona") ----
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
    const created = await cajaChicaStore.createCategoria(name, form.value.tipo);
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
  form.value = emptyForm();
  form.value.categoria_id = manualCategories.value[0]?.id ?? '';
  comprobanteFile.value = null;
  showNewCategoria.value = false;
  formError.value = null;
  formStep.value = 'form';
  showModal.value = true;
}

function onComprobanteChange(e: Event) {
  comprobanteFile.value = (e.target as HTMLInputElement).files?.[0] ?? null;
}

function reviewMovimiento() {
  formError.value = null;
  if (!form.value.descripcion.trim() || !form.value.responsable.trim() || !form.value.categoria_id || form.value.monto <= 0) {
    formError.value = 'Completa descripción, responsable, categoría y un monto mayor a cero.';
    return;
  }
  formStep.value = 'confirm';
}

async function handleConfirmSave() {
  saving.value = true;
  formError.value = null;
  try {
    let comprobantePath: string | null = null;
    if (comprobanteFile.value) {
      comprobantePath = await cajaChicaStore.uploadComprobante(comprobanteFile.value);
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
    await cajaChicaStore.createMovimiento(payload);
    if (cajaChicaStore.daily?.enabled) await cajaChicaStore.fetchDaily(limaDate());
    showModal.value = false;
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al guardar el movimiento');
    formStep.value = 'form';
  } finally {
    saving.value = false;
  }
}

const reversalKeys = new Map<string, string>();
async function handleReverse(m: CajaChicaMovimientoWithUrl) {
  const reason = window.prompt('Motivo de anulación (se conservará el movimiento original y su compensación)');
  if (!reason || reason.trim().length < 5) return;
  const key = reversalKeys.get(m.id) ?? crypto.randomUUID();
  reversalKeys.set(m.id, key);
  try {
    await cajaChicaStore.reverseMovimiento(key, m.id, reason.trim());
    await cajaChicaStore.fetchDaily(limaDate());
  } catch (e) {
    alert(getErrorMessage(e, 'No se pudo anular el movimiento'));
  }
}

onMounted(async () => {
  await Promise.all([
    cajaChicaStore.fetchMovimientos(),
    cajaChicaStore.fetchCategorias(),
    cajaChicaStore.fetchResponsablesConfig(),
    catalogs.fetchStaff(),
  ]);
  cajaChicaStore.fetchDaily(todayIso()).catch(() => {});
  vehiculosStore.fetchVehiculos().catch(() => {});
});
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
      <div>
        <h1 class="text-2xl font-semibold">Caja Chica</h1>
        <p class="text-slate-600 text-sm mt-1">Gastos e ingresos menores en efectivo — {{ cajaChicaStore.movimientos.length }} movimientos</p>
      </div>
      <button class="btn-primary" @click="openCreate">+ Nuevo movimiento</button>
    </div>

    <div class="flex gap-1 mb-6 border-b border-slate-200 overflow-x-auto">
      <button type="button" class="px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px"
        :class="tab === 'resumen' ? 'border-sky-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'" @click="tab = 'resumen'">Resumen</button>
      <button type="button" class="px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px"
        :class="tab === 'cobranzas' ? 'border-sky-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'" @click="tab = 'cobranzas'">Cobranzas y cierre</button>
      <button type="button" class="px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px"
        :class="tab === 'movimientos' ? 'border-sky-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'" @click="tab = 'movimientos'">Movimientos</button>
      <button type="button" class="px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px"
        :class="tab === 'config' ? 'border-sky-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'" @click="tab = 'config'">Configuración</button>
    </div>

    <!-- ===================== RESUMEN ===================== -->
    <section v-if="tab === 'resumen'">
      <div class="grid gap-4 mb-6" style="grid-template-columns: minmax(220px, 1.3fr) repeat(3, minmax(180px, 1fr))">
        <div class="rounded-xl p-5 flex items-start justify-between" style="background:#102d49">
          <div>
            <div class="text-3xl font-bold text-white">{{ formatPen(summary.saldo) }}</div>
            <div class="text-sm text-white/80 mt-1">Efectivo disponible en caja</div>
          </div>
          <span class="w-10 h-10 rounded-lg flex items-center justify-center text-lg" style="background:#ffffff26">💰</span>
        </div>
        <div class="surface p-5 flex items-start justify-between">
          <div>
            <div class="text-xl font-semibold text-slate-900">{{ formatPen(cobranzasHoy) }}</div>
            <div class="text-xs text-slate-500 mt-1">Cobranzas en efectivo (hoy)</div>
          </div>
          <span class="w-9 h-9 rounded-lg bg-green-50 text-green-700 flex items-center justify-center text-base">💵</span>
        </div>
        <div class="surface p-5 flex items-start justify-between">
          <div>
            <div class="text-xl font-semibold text-slate-900">{{ formatPen(summary.gastadoHoy) }}</div>
            <div class="text-xs text-slate-500 mt-1">Gastado hoy</div>
          </div>
          <span class="w-9 h-9 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center text-base">📅</span>
        </div>
        <div class="surface p-5 flex items-start justify-between">
          <div>
            <div class="text-xl font-semibold text-slate-900">{{ formatPen(summary.gastadoMes) }}</div>
            <div class="text-xs text-slate-500 mt-1">Gastado este mes</div>
          </div>
          <span class="w-9 h-9 rounded-lg bg-sky-50 text-sky-700 flex items-center justify-center text-base">📊</span>
        </div>
      </div>
      <div class="grid gap-4 mb-6" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))">
        <div class="surface p-4 flex items-center justify-between">
          <div>
            <div class="text-lg font-semibold text-slate-900">{{ formatPen(retirosPropietarioMes) }}</div>
            <div class="text-xs text-slate-500 mt-1">Retiros del propietario (mes)</div>
          </div>
          <span class="w-9 h-9 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center text-base">🏦</span>
        </div>
      </div>

      <div class="grid gap-4 mb-6" style="grid-template-columns: 1.1fr 0.9fr">
        <div class="surface p-5">
          <h2 class="text-sm font-semibold mb-3">Gasto por categoría (este mes)</h2>
          <p v-if="!summary.categorias.length" class="text-xs text-slate-400">Sin egresos manuales este mes.</p>
          <div v-else class="space-y-2">
            <div v-for="c in summary.categorias" :key="c.nombre" class="flex items-center gap-3 text-sm">
              <span class="w-36 shrink-0 text-slate-600 text-xs truncate">{{ c.nombre }}</span>
              <div class="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div class="h-full rounded-full bg-sky-500" :style="{ width: (c.total / summary.maxCategoria) * 100 + '%' }"></div>
              </div>
              <span class="w-20 shrink-0 text-right font-medium text-xs">{{ formatPen(c.total) }}</span>
            </div>
          </div>
        </div>
        <div class="surface p-5">
          <h2 class="text-sm font-semibold mb-3">Medios de pago (hoy)</h2>
          <p v-if="!cajaChicaStore.daily?.methods?.length" class="text-xs text-slate-400">Sin cobranzas registradas hoy.</p>
          <div v-for="m in cajaChicaStore.daily?.methods ?? []" :key="m.method" class="flex items-center justify-between py-1.5 text-sm border-b border-slate-50 last:border-0">
            <span>{{ cashMethodLabel(m.method) }}</span>
            <b class="font-variant-numeric-tabular">{{ formatPen(m.net) }}</b>
          </div>
        </div>
      </div>

      <div class="surface p-5 mb-6">
        <h2 class="text-sm font-semibold mb-3">Cobranzas por administradora (hoy)</h2>
        <p v-if="!cajaChicaStore.daily?.collectors?.length" class="text-xs text-slate-400">Sin cobranzas registradas hoy.</p>
        <div v-for="c in cajaChicaStore.daily?.collectors ?? []" :key="c.id + c.method" class="flex items-center justify-between py-1.5 text-sm border-b border-slate-50 last:border-0">
          <span>{{ c.name }} <span class="text-slate-400">· {{ cashMethodLabel(c.method) }}</span></span>
          <b>{{ formatPen(c.received) }}</b>
        </div>
      </div>
    </section>

    <!-- ===================== COBRANZAS Y CIERRE (diseño ya aprobado) ===================== -->
    <section v-if="tab === 'cobranzas'">
      <CajaFinancePanel />
    </section>

    <!-- ===================== MOVIMIENTOS ===================== -->
    <section v-if="tab === 'movimientos'">
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
        <table class="w-full text-sm min-w-[960px]">
          <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
            <tr>
              <th class="text-left px-4 py-3">Fecha</th>
              <th class="text-left px-4 py-3">Categoría</th>
              <th class="text-left px-4 py-3">Descripción</th>
              <th class="text-left px-4 py-3">Responsable</th>
              <th class="text-left px-4 py-3">Registrado por</th>
              <th class="text-left px-4 py-3">Monto</th>
              <th class="text-left px-4 py-3">Tipo</th>
              <th class="text-left px-4 py-3">Comprobante</th>
              <th class="text-right px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="cajaChicaStore.loading">
              <td colspan="9" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
            </tr>
            <tr v-else-if="!filteredMovimientos.length">
              <td colspan="9" class="px-4 py-6 text-center text-slate-500">No hay movimientos en este filtro.</td>
            </tr>
            <tr v-for="m in filteredMovimientos" :key="m.id" class="border-t border-slate-200 hover:bg-slate-50">
              <td class="px-4 py-3 text-slate-600 text-xs">{{ m.fecha }}</td>
              <td class="px-4 py-3">
                <span class="badge bg-slate-500/15 text-slate-600">{{ m.caja_chica_categorias?.nombre ?? '—' }}</span>
              </td>
              <td class="px-4 py-3">
                {{ m.descripcion }}
                <div v-if="m.vehiculos" class="text-[11px] text-slate-400">🚗 {{ m.vehiculos.placa }} — {{ m.vehiculos.marca }}</div>
              </td>
              <td class="px-4 py-3 text-slate-600">{{ m.responsable || '—' }}</td>
              <td class="px-4 py-3 text-slate-400 text-xs">{{ m.created_by_profile?.full_name || m.created_by_profile?.email || '—' }}</td>
              <td class="px-4 py-3 font-medium" :class="m.tipo === 'ingreso' ? 'text-green-600' : 'text-slate-900'">
                {{ m.tipo === 'ingreso' ? '+' : '-' }} {{ formatPen(m.monto) }}
              </td>
              <td class="px-4 py-3">
                <span class="badge" :class="m.tipo === 'ingreso' ? 'bg-green-500/15 text-green-600' : 'bg-amber-500/15 text-amber-700'">
                  {{ TIPO_LABEL[m.tipo] }}
                </span>
              </td>
              <td class="px-4 py-3">
                <a v-if="m.url" :href="m.url" target="_blank" rel="noopener" class="text-sky-600 hover:underline" title="Ver comprobante">📎</a>
                <span v-else class="text-slate-300">—</span>
              </td>
              <td class="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                <button v-if="!m.reversed_at && (!m.finance_kind || ['manual', 'owner_withdrawal'].includes(m.finance_kind))" class="text-red-500/80 hover:text-red-600 text-xs" @click="handleReverse(m)">Anular</button>
                <span v-else class="text-xs text-slate-500">{{ m.reversed_at ? 'Anulado' : m.finance_kind === 'collection' ? 'Vinculado al recibo' : 'Compensación auditada' }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ===================== CONFIGURACIÓN ===================== -->
    <section v-if="tab === 'config'">
      <CajaChicaConfigPanel />
    </section>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay">
        <div class="w-full max-w-lg modal-panel max-h-[90vh] overflow-y-auto">
          <h2 class="text-lg font-semibold mb-4">{{ formStep === 'form' ? 'Nuevo movimiento' : 'Confirmar movimiento' }}</h2>

          <form v-if="formStep === 'form'" @submit.prevent="reviewMovimiento">
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
                <button type="button" class="text-xs text-sky-700 hover:text-sky-700" @click="showNewCategoria = !showNewCategoria">
                  {{ showNewCategoria ? 'Cancelar' : '+ Nueva categoría' }}
                </button>
              </div>
              <select v-if="!showNewCategoria" v-model="form.categoria_id" required class="field-input">
                <option value="" disabled>Selecciona una categoría</option>
                <option v-for="cat in manualCategories" :key="cat.id" :value="cat.id">{{ cat.nombre }}</option>
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
              <p class="text-xs text-slate-400 mt-1">
                Solo se muestran categorías de {{ form.tipo === 'ingreso' ? 'ingreso' : 'egreso' }}; una categoría nueva queda disponible para todos los movimientos futuros de ese mismo tipo.
              </p>
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
              <label class="block text-xs text-slate-600 mb-1">Responsable del gasto</label>
              <select v-model="form.responsable" required class="field-input">
                <option value="" disabled>Selecciona quién hizo o autorizó el gasto</option>
                <option v-for="s in visibleStaff" :key="s.id" :value="staffLabel(s)">{{ staffLabel(s) }}</option>
              </select>
              <p class="text-xs text-slate-400 mt-1">Precargado con tu usuario si está habilitado — puedes cambiarlo. Lista administrable en la pestaña "Configuración".</p>
            </div>

            <div class="mb-4">
              <label class="block text-xs text-slate-600 mb-1">Comprobante (opcional)</label>
              <input type="file" accept="image/*,.pdf" class="field-input" @change="onComprobanteChange" />
            </div>

            <p v-if="formError" class="text-sm text-red-600 mb-3">{{ formError }}</p>

            <div class="flex justify-end gap-2">
              <button type="button" class="btn-ghost" @click="showModal = false">Cancelar</button>
              <button type="submit" class="btn-primary">Revisar movimiento</button>
            </div>
          </form>

          <div v-else>
            <div class="space-y-1 mb-4">
              <div class="flex justify-between py-1.5 border-b border-dashed border-slate-200 text-sm"><span class="text-slate-500">Tipo</span><b>{{ TIPO_LABEL[form.tipo] }}</b></div>
              <div class="flex justify-between py-1.5 border-b border-dashed border-slate-200 text-sm"><span class="text-slate-500">Categoría</span><b>{{ selectedCategoria?.nombre ?? '—' }}</b></div>
              <div v-if="selectedCategoria?.permite_vehiculo && form.vehiculo_id" class="flex justify-between py-1.5 border-b border-dashed border-slate-200 text-sm">
                <span class="text-slate-500">Vehículo</span><b>{{ vehiculosStore.vehiculos.find((v) => v.id === form.vehiculo_id)?.placa }}</b>
              </div>
              <div class="flex justify-between py-1.5 border-b border-dashed border-slate-200 text-sm gap-4"><span class="text-slate-500 shrink-0">Descripción</span><b class="text-right">{{ form.descripcion }}</b></div>
              <div class="flex justify-between py-1.5 border-b border-dashed border-slate-200 text-sm"><span class="text-slate-500">Responsable</span><b>{{ form.responsable }}</b></div>
              <div class="flex justify-between py-1.5 border-b border-dashed border-slate-200 text-sm"><span class="text-slate-500">Registrado por</span><b>{{ staffLabel({ full_name: auth.user ? (catalogs.staff.find((s) => s.id === auth.user!.id)?.full_name ?? null) : null, email: auth.user?.email ?? '' }) }}</b></div>
              <div v-if="comprobanteFile" class="flex justify-between py-1.5 border-b border-dashed border-slate-200 text-sm"><span class="text-slate-500">Comprobante</span><b>1 archivo adjunto</b></div>
            </div>
            <div class="flex justify-between items-center rounded-lg px-4 py-3 text-white mb-4" style="background:#102d49">
              <span class="text-sm">Monto</span>
              <b class="text-lg">{{ formatPen(form.monto) }}</b>
            </div>
            <p class="text-xs text-slate-400 mb-3">Revisa los datos antes de guardar — el movimiento queda registrado de inmediato al confirmar.</p>
            <p v-if="formError" class="text-sm text-red-600 mb-3">{{ formError }}</p>
            <div class="flex justify-end gap-2">
              <button type="button" class="btn-ghost" :disabled="saving" @click="formStep = 'form'">Volver</button>
              <button type="button" :disabled="saving" class="btn-primary" @click="handleConfirmSave">
                {{ saving ? 'Guardando...' : 'Confirmar y guardar' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </AppLayout>
</template>
