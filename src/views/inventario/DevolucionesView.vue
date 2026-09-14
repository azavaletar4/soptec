<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useInventoryUnitsStore } from '@/stores/inventoryUnits';
import { getErrorMessage } from '@/lib/errors';
import type { InventoryUnit, InventoryUnitEvent, InventoryUnitStatus } from '@/types/domain';

const router = useRouter();
const inventoryUnitsStore = useInventoryUnitsStore();

type Tab = 'assigned' | 'damaged' | 'in_repair' | 'retired';

const TABS: { value: Tab; label: string }[] = [
  { value: 'assigned', label: 'Asignados (pendiente devolución)' },
  { value: 'damaged', label: 'Dañados' },
  { value: 'in_repair', label: 'En reparación' },
  { value: 'retired', label: 'Dados de baja' },
];

const activeTab = ref<Tab>('assigned');
const units = ref<InventoryUnit[]>([]);
const loading = ref(true);
const searchQuery = ref('');
const listError = ref<string | null>(null);

const UNIT_STATUS_LABEL: Record<InventoryUnitStatus, string> = {
  in_stock: 'En bodega',
  assigned: 'Asignado',
  damaged: 'Dañado',
  in_repair: 'En reparación',
  retired: 'Dado de baja',
};
const UNIT_STATUS_CLASS: Record<InventoryUnitStatus, string> = {
  in_stock: 'bg-green-500/15 text-green-600',
  assigned: 'bg-sky-500/15 text-sky-600',
  damaged: 'bg-red-500/15 text-red-600',
  in_repair: 'bg-amber-500/15 text-amber-600',
  retired: 'bg-slate-500/15 text-slate-600',
};

const filteredUnits = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return units.value;
  return units.value.filter((u) =>
    `${u.serial_number ?? ''} ${u.mac_address ?? ''} ${u.product?.name ?? ''} ${u.clients?.first_name ?? ''} ${u.clients?.last_name ?? ''}`
      .toLowerCase()
      .includes(q),
  );
});

async function loadUnits() {
  loading.value = true;
  listError.value = null;
  try {
    units.value = await inventoryUnitsStore.fetchUnitsByStatus(activeTab.value);
  } catch (e) {
    listError.value = getErrorMessage(e, 'Error al cargar los equipos');
  } finally {
    loading.value = false;
  }
}

function switchTab(tab: Tab) {
  activeTab.value = tab;
  loadUnits();
}

onMounted(loadUnits);

function formatDate(value: string) {
  return new Date(value).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' });
}

// ---- Registrar devolucion (equipo asignado -> bodega / dañado / reparacion) ----
const showReturnModal = ref(false);
const returnUnitTarget = ref<InventoryUnit | null>(null);
const returnForm = ref({ condition: 'in_stock' as 'in_stock' | 'damaged' | 'in_repair', reason: '' });
const returnSaving = ref(false);
const returnError = ref<string | null>(null);

function openReturn(unit: InventoryUnit) {
  returnUnitTarget.value = unit;
  returnForm.value = { condition: 'in_stock', reason: '' };
  returnError.value = null;
  showReturnModal.value = true;
}

async function handleReturn() {
  if (!returnUnitTarget.value) return;
  returnSaving.value = true;
  returnError.value = null;
  try {
    await inventoryUnitsStore.returnUnit(returnUnitTarget.value.id, returnForm.value.condition, returnForm.value.reason || undefined);
    showReturnModal.value = false;
    await loadUnits();
  } catch (e) {
    returnError.value = getErrorMessage(e, 'Error al registrar la devolución');
  } finally {
    returnSaving.value = false;
  }
}

async function handleMarkRepaired(unit: InventoryUnit) {
  try {
    await inventoryUnitsStore.markRepaired(unit.id);
    await loadUnits();
  } catch (e) {
    listError.value = getErrorMessage(e, 'Error al marcar el equipo como reparado');
  }
}

async function handleRetire(unit: InventoryUnit) {
  if (!confirm('¿Dar de baja este equipo? Ya no podrá reasignarse.')) return;
  try {
    await inventoryUnitsStore.retireUnit(unit.id);
    await loadUnits();
  } catch (e) {
    listError.value = getErrorMessage(e, 'Error al dar de baja el equipo');
  }
}

// ---- Historial ----
const showHistoryModal = ref(false);
const historyUnitTarget = ref<InventoryUnit | null>(null);
const historyEvents = ref<InventoryUnitEvent[]>([]);
const historyLoading = ref(false);

async function openHistory(unit: InventoryUnit) {
  historyUnitTarget.value = unit;
  showHistoryModal.value = true;
  historyLoading.value = true;
  try {
    historyEvents.value = await inventoryUnitsStore.fetchEvents(unit.id);
  } finally {
    historyLoading.value = false;
  }
}
</script>

<template>
  <AppLayout>
    <button class="text-sm text-slate-600 hover:text-slate-900 mb-4" @click="router.push('/inventario')">← Volver a Inventario</button>

    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Devoluciones</h1>
        <p class="text-slate-600 text-sm mt-1">Gestiona equipos devueltos por clientes: dañados, en reparación o listos para reasignar.</p>
      </div>
    </div>

    <div class="flex flex-wrap gap-2 mb-4">
      <button
        v-for="t in TABS"
        :key="t.value"
        class="px-3 py-1.5 rounded-lg text-xs font-medium"
        :class="activeTab === t.value ? 'bg-sky-500 text-slate-950' : 'bg-slate-100 text-slate-600 hover:text-slate-900'"
        @click="switchTab(t.value)"
      >
        {{ t.label }}
      </button>
    </div>

    <input v-model="searchQuery" placeholder="Buscar por serie, MAC, producto o cliente..." class="field-input w-full mb-4" />

    <p v-if="listError" class="mb-4 text-sm text-red-600">{{ listError }}</p>

    <div class="table-shell">
      <table class="w-full text-sm min-w-[760px]">
        <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-3">Producto</th>
            <th class="text-left px-4 py-3">Serie</th>
            <th class="text-left px-4 py-3">MAC</th>
            <th class="text-left px-4 py-3">Estado</th>
            <th class="text-left px-4 py-3">Cliente</th>
            <th class="text-left px-4 py-3">Actualizado</th>
            <th class="text-right px-4 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="7" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
          </tr>
          <tr v-else-if="!filteredUnits.length">
            <td colspan="7" class="px-4 py-6 text-center text-slate-500">No hay equipos en este filtro.</td>
          </tr>
          <tr v-for="u in filteredUnits" :key="u.id" class="border-t border-slate-200">
            <td class="px-4 py-3">
              <router-link :to="`/inventario/${u.product_id}`" class="text-sky-600 hover:underline">{{ u.product?.name ?? 'Equipo' }}</router-link>
            </td>
            <td class="px-4 py-3 font-mono text-xs">{{ u.serial_number || '—' }}</td>
            <td class="px-4 py-3 font-mono text-xs">{{ u.mac_address || '—' }}</td>
            <td class="px-4 py-3">
              <span class="badge" :class="UNIT_STATUS_CLASS[u.status]">{{ UNIT_STATUS_LABEL[u.status] }}</span>
            </td>
            <td class="px-4 py-3 text-slate-600">
              <router-link v-if="u.clients" :to="`/clientes/${u.clients.id}`" class="text-sky-600 hover:underline">
                {{ u.clients.first_name }} {{ u.clients.last_name }}
              </router-link>
              <span v-else>—</span>
            </td>
            <td class="px-4 py-3 text-slate-500 text-xs">{{ formatDate(u.updated_at) }}</td>
            <td class="px-4 py-3 text-right">
              <div class="flex justify-end gap-1.5 flex-wrap">
                <button class="text-xs text-slate-600 hover:text-slate-900" @click="openHistory(u)">Historial</button>
                <button v-if="u.status === 'assigned'" class="text-xs text-amber-600 hover:text-amber-700" @click="openReturn(u)">Devolución</button>
                <button v-if="u.status === 'in_repair'" class="text-xs text-green-600 hover:text-green-700" @click="handleMarkRepaired(u)">Marcar reparado</button>
                <button v-if="u.status === 'damaged' || u.status === 'in_repair'" class="text-xs text-red-600 hover:text-red-700" @click="handleRetire(u)">Dar de baja</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div v-if="showReturnModal" class="modal-overlay">
        <form class="w-full max-w-sm modal-panel" @submit.prevent="handleReturn">
          <h2 class="text-lg font-semibold mb-1">Registrar devolución</h2>
          <p class="text-xs text-slate-500 mb-4 font-mono">{{ returnUnitTarget?.serial_number || returnUnitTarget?.mac_address }}</p>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Condición del equipo</label>
            <select v-model="returnForm.condition" class="field-input">
              <option value="in_stock">Buen estado — listo para reasignar</option>
              <option value="damaged">Dañado</option>
              <option value="in_repair">Enviar a reparación</option>
            </select>
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-600 mb-1">Motivo</label>
            <input v-model="returnForm.reason" class="field-input" placeholder="ej. Baja del servicio, cambio de equipo..." />
          </div>

          <p v-if="returnError" class="text-sm text-red-600 mb-3">{{ returnError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showReturnModal = false">Cancelar</button>
            <button type="submit" :disabled="returnSaving" class="btn-primary">
              {{ returnSaving ? 'Guardando...' : 'Registrar devolución' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showHistoryModal" class="modal-overlay">
        <div class="w-full max-w-md modal-panel max-h-[90vh] overflow-y-auto">
          <h2 class="text-lg font-semibold mb-1">Historial del equipo</h2>
          <p class="text-xs text-slate-500 mb-4 font-mono">{{ historyUnitTarget?.serial_number || historyUnitTarget?.mac_address }}</p>

          <p v-if="historyLoading" class="text-slate-500 text-sm">Cargando...</p>
          <p v-else-if="!historyEvents.length" class="text-slate-500 text-sm">Sin eventos registrados.</p>
          <ul v-else class="space-y-3">
            <li v-for="ev in historyEvents" :key="ev.id" class="text-xs border-l-2 border-slate-300 pl-3">
              <div class="flex items-center gap-2">
                <span class="badge" :class="UNIT_STATUS_CLASS[ev.to_status]">{{ UNIT_STATUS_LABEL[ev.to_status] }}</span>
                <span class="text-slate-500">{{ formatDate(ev.created_at) }}</span>
              </div>
              <p v-if="ev.reason" class="text-slate-600 mt-1">{{ ev.reason }}</p>
              <p v-if="ev.clients" class="text-slate-500 mt-0.5">Cliente: {{ ev.clients.first_name }} {{ ev.clients.last_name }}</p>
              <p class="text-slate-400 mt-0.5">{{ ev.author?.full_name || ev.author?.email || '—' }}</p>
            </li>
          </ul>

          <div class="flex justify-end mt-4">
            <button class="btn-ghost" @click="showHistoryModal = false">Cerrar</button>
          </div>
        </div>
      </div>
    </Teleport>
  </AppLayout>
</template>
