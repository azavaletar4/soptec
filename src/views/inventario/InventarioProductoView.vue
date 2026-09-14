<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useInventoryStore } from '@/stores/inventory';
import { useInventoryUnitsStore } from '@/stores/inventoryUnits';
import { useClientsStore } from '@/stores/clients';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/lib/errors';
import type { InventoryMovement, InventoryMovementType, InventoryUnit, InventoryUnitEvent, InventoryUnitStatus } from '@/types/domain';

const route = useRoute();
const router = useRouter();
const inventoryStore = useInventoryStore();
const inventoryUnitsStore = useInventoryUnitsStore();
const clientsStore = useClientsStore();
const auth = useAuthStore();

const canDelete = computed(() => auth.role === 'SUPERADMIN' || auth.role === 'ADMIN');

const productId = computed(() => route.params.id as string);
const product = computed(() => inventoryStore.products.find((p) => p.id === productId.value));

const movements = ref<InventoryMovement[]>([]);
const movementsLoading = ref(true);

const showEditModal = ref(false);
const editForm = ref({ name: '', category: '', unit: '', price: 0, min_stock: 0, purchase_date: '' });
const editSaving = ref(false);
const editError = ref<string | null>(null);

const showMovementModal = ref(false);
const movementType = ref<InventoryMovementType>('ingreso');
const movementForm = ref({ quantity: 1, reason: '' });
const movementSaving = ref(false);
const movementError = ref<string | null>(null);

const MOVEMENT_LABEL: Record<InventoryMovementType, string> = { ingreso: 'Ingreso', egreso: 'Egreso' };
const MOVEMENT_CLASS: Record<InventoryMovementType, string> = {
  ingreso: 'bg-green-500/15 text-green-400',
  egreso: 'bg-red-500/15 text-red-400',
};

const isLowStock = computed(() => !!product.value && product.value.current_stock <= product.value.min_stock);

async function loadMovements() {
  movementsLoading.value = true;
  try {
    movements.value = await inventoryStore.fetchMovements(productId.value);
  } finally {
    movementsLoading.value = false;
  }
}

// ---- Unidades serializadas (control por numero de serie / MAC) ----
const units = ref<InventoryUnit[]>([]);
const unitsLoading = ref(true);

const UNIT_STATUS_LABEL: Record<InventoryUnitStatus, string> = {
  in_stock: 'En bodega',
  assigned: 'Asignado',
  damaged: 'Dañado',
  in_repair: 'En reparación',
  retired: 'Dado de baja',
};
const UNIT_STATUS_CLASS: Record<InventoryUnitStatus, string> = {
  in_stock: 'bg-green-500/15 text-green-400',
  assigned: 'bg-sky-500/15 text-sky-400',
  damaged: 'bg-red-500/15 text-red-400',
  in_repair: 'bg-amber-500/15 text-amber-400',
  retired: 'bg-slate-500/15 text-slate-400',
};

const unitKpis = computed(() => {
  const counts: Record<string, number> = {};
  for (const u of units.value) counts[u.status] = (counts[u.status] ?? 0) + 1;
  return {
    total: units.value.length,
    in_stock: counts.in_stock ?? 0,
    assigned: counts.assigned ?? 0,
    damaged: counts.damaged ?? 0,
    in_repair: counts.in_repair ?? 0,
    retired: counts.retired ?? 0,
  };
});

const unitsError = ref<string | null>(null);

async function loadUnits() {
  unitsLoading.value = true;
  try {
    units.value = await inventoryUnitsStore.fetchUnitsByProduct(productId.value);
  } finally {
    unitsLoading.value = false;
  }
}

const showUnitModal = ref(false);
const unitForm = ref({ serial_number: '', mac_address: '', notes: '' });
const unitSaving = ref(false);
const unitFormError = ref<string | null>(null);

function openCreateUnit() {
  unitForm.value = { serial_number: '', mac_address: '', notes: '' };
  unitFormError.value = null;
  showUnitModal.value = true;
}

async function handleCreateUnit() {
  if (!unitForm.value.serial_number.trim() && !unitForm.value.mac_address.trim()) {
    unitFormError.value = 'Ingresa al menos el número de serie o la dirección MAC';
    return;
  }
  unitSaving.value = true;
  unitFormError.value = null;
  try {
    await inventoryUnitsStore.createUnit({
      productId: productId.value,
      serialNumber: unitForm.value.serial_number.trim(),
      macAddress: unitForm.value.mac_address.trim(),
      notes: unitForm.value.notes.trim(),
    });
    showUnitModal.value = false;
    await loadUnits();
  } catch (e) {
    unitFormError.value = getErrorMessage(e, 'Error al registrar el equipo (revisa que la serie/MAC no esté repetida)');
  } finally {
    unitSaving.value = false;
  }
}

// ---- Asignar a cliente ----
const showAssignModal = ref(false);
const assignUnitTarget = ref<InventoryUnit | null>(null);
const assignClientFilter = ref('');
const assignClientId = ref('');
const assignSaving = ref(false);
const assignError = ref<string | null>(null);

const filteredAssignClients = computed(() => {
  const q = assignClientFilter.value.trim().toLowerCase();
  const list = clientsStore.clients;
  if (!q) return list.slice(0, 30);
  return list.filter((c) => `${c.first_name} ${c.last_name} ${c.document_number}`.toLowerCase().includes(q)).slice(0, 30);
});

async function openAssign(unit: InventoryUnit) {
  assignUnitTarget.value = unit;
  assignClientFilter.value = '';
  assignClientId.value = '';
  assignError.value = null;
  showAssignModal.value = true;
  if (!clientsStore.clients.length) await clientsStore.fetchClients();
}

async function handleAssign() {
  if (!assignUnitTarget.value || !assignClientId.value) return;
  assignSaving.value = true;
  assignError.value = null;
  try {
    await inventoryUnitsStore.assignUnit(assignUnitTarget.value.id, assignClientId.value);
    showAssignModal.value = false;
    await loadUnits();
  } catch (e) {
    assignError.value = getErrorMessage(e, 'Error al asignar el equipo');
  } finally {
    assignSaving.value = false;
  }
}

// ---- Devolucion / reparacion / baja ----
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
    unitsError.value = getErrorMessage(e, 'Error al marcar el equipo como reparado');
  }
}

async function handleRetire(unit: InventoryUnit) {
  if (!confirm('¿Dar de baja este equipo? Ya no podrá reasignarse.')) return;
  try {
    await inventoryUnitsStore.retireUnit(unit.id);
    await loadUnits();
  } catch (e) {
    unitsError.value = getErrorMessage(e, 'Error al dar de baja el equipo');
  }
}

// ---- Historial (kardex) por unidad ----
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

onMounted(async () => {
  if (!inventoryStore.products.length) await inventoryStore.fetchProducts();
  if (product.value?.is_serialized) {
    await loadUnits();
  } else {
    await loadMovements();
  }
});

function openEdit() {
  if (!product.value) return;
  editForm.value = {
    name: product.value.name,
    category: product.value.category ?? '',
    unit: product.value.unit,
    price: Number(product.value.price),
    min_stock: Number(product.value.min_stock),
    purchase_date: product.value.purchase_date ?? '',
  };
  editError.value = null;
  showEditModal.value = true;
}

async function handleEdit() {
  if (!product.value) return;
  editSaving.value = true;
  editError.value = null;
  try {
    await inventoryStore.updateProduct(product.value.id, {
      name: editForm.value.name,
      category: editForm.value.category || null,
      unit: editForm.value.unit,
      price: editForm.value.price,
      min_stock: editForm.value.min_stock,
      purchase_date: editForm.value.purchase_date || null,
    });
    showEditModal.value = false;
  } catch (e) {
    editError.value = getErrorMessage(e, 'Error al actualizar el producto');
  } finally {
    editSaving.value = false;
  }
}

function openMovement(type: InventoryMovementType) {
  movementType.value = type;
  movementForm.value = { quantity: 1, reason: '' };
  movementError.value = null;
  showMovementModal.value = true;
}

async function handleMovement() {
  if (!product.value || movementForm.value.quantity <= 0) {
    movementError.value = 'La cantidad debe ser mayor a 0';
    return;
  }
  movementSaving.value = true;
  movementError.value = null;
  try {
    await inventoryStore.registerMovement({
      productId: product.value.id,
      type: movementType.value,
      quantity: movementForm.value.quantity,
      reason: movementForm.value.reason,
    });
    showMovementModal.value = false;
    await loadMovements();
  } catch (e) {
    movementError.value = getErrorMessage(e, 'Error al registrar el movimiento');
  } finally {
    movementSaving.value = false;
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' });
}

async function handleDeleteProduct() {
  if (!product.value || !canDelete.value) return;
  const ok = confirm(`¿Eliminar "${product.value.name}"? Dejará de aparecer en el inventario, pero se conserva su historial (Kardex/equipos) para auditoría.`);
  if (!ok) return;
  try {
    await inventoryStore.deactivateProduct(product.value.id);
    router.push('/inventario');
  } catch (e) {
    inventoryStore.error = getErrorMessage(e, 'Error al eliminar el producto');
  }
}
</script>

<template>
  <AppLayout>
    <button class="text-sm text-slate-400 hover:text-slate-100 mb-4" @click="router.push('/inventario')">← Volver a Inventario</button>

    <div v-if="!product" class="text-slate-500">Producto no encontrado.</div>
    <template v-else>
      <div class="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 class="text-2xl font-semibold mb-1">{{ product.name }}</h1>
          <p class="text-slate-400 text-sm">
            {{ product.category ?? 'Sin categoría' }} · {{ product.unit }} · S/ {{ Number(product.price).toFixed(2) }}
            <span v-if="product.purchase_date"> · Compra: {{ product.purchase_date }}</span>
          </p>
        </div>
        <div class="flex gap-2">
          <button class="btn-secondary" @click="openEdit">Editar producto</button>
          <button v-if="canDelete" class="px-3 py-1.5 rounded-lg text-sm text-red-400 hover:bg-red-500/10" @click="handleDeleteProduct">Eliminar</button>
        </div>
      </div>

      <p v-if="inventoryStore.error" class="mb-4 text-sm text-red-400">{{ inventoryStore.error }}</p>

      <template v-if="!product.is_serialized">
        <div class="grid gap-4 mb-6" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))">
          <div class="surface p-4">
            <div class="text-3xl font-bold" :class="isLowStock ? 'text-amber-400' : 'text-green-400'">{{ product.current_stock }}</div>
            <div class="text-xs text-slate-500 mt-1">Stock actual ({{ product.unit }})</div>
          </div>
          <div class="surface p-4">
            <div class="text-3xl font-bold text-slate-300">{{ product.min_stock }}</div>
            <div class="text-xs text-slate-500 mt-1">Stock mínimo</div>
          </div>
          <div class="surface p-4 flex items-center gap-2">
            <button class="btn-primary flex-1" @click="openMovement('ingreso')">+ Ingreso</button>
            <button class="btn-secondary flex-1" @click="openMovement('egreso')">− Egreso</button>
          </div>
        </div>

        <p v-if="isLowStock" class="text-sm text-amber-400 mb-4">⚠ El stock está en o por debajo del mínimo configurado.</p>

        <h2 class="text-lg font-semibold mb-3">Kardex</h2>
        <div class="table-shell">
          <table class="w-full text-sm min-w-[680px]">
            <thead class="bg-slate-900 text-slate-400 text-xs uppercase">
              <tr>
                <th class="text-left px-4 py-3">Fecha</th>
                <th class="text-left px-4 py-3">Tipo</th>
                <th class="text-right px-4 py-3">Cantidad</th>
                <th class="text-right px-4 py-3">Saldo</th>
                <th class="text-left px-4 py-3">Motivo</th>
                <th class="text-left px-4 py-3">Usuario</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="movementsLoading">
                <td colspan="6" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
              </tr>
              <tr v-else-if="!movements.length">
                <td colspan="6" class="px-4 py-6 text-center text-slate-500">Sin movimientos todavía.</td>
              </tr>
              <tr v-for="m in movements" :key="m.id" class="border-t border-slate-800">
                <td class="px-4 py-3 text-slate-500 text-xs">{{ formatDate(m.created_at) }}</td>
                <td class="px-4 py-3">
                  <span class="badge" :class="MOVEMENT_CLASS[m.movement_type]">{{ MOVEMENT_LABEL[m.movement_type] }}</span>
                </td>
                <td class="px-4 py-3 text-right font-mono">{{ m.movement_type === 'ingreso' ? '+' : '−' }}{{ m.quantity }}</td>
                <td class="px-4 py-3 text-right font-mono text-slate-100">{{ m.balance_after }}</td>
                <td class="px-4 py-3 text-slate-400">{{ m.reason ?? '—' }}</td>
                <td class="px-4 py-3 text-slate-400 text-xs">{{ m.author?.full_name || m.author?.email || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <template v-else>
        <div class="grid gap-4 mb-6" style="grid-template-columns: repeat(auto-fit, minmax(140px, 1fr))">
          <div class="surface p-4">
            <div class="text-2xl font-bold text-slate-100">{{ unitKpis.total }}</div>
            <div class="text-xs text-slate-500 mt-1">Total equipos</div>
          </div>
          <div class="surface p-4">
            <div class="text-2xl font-bold text-green-400">{{ unitKpis.in_stock }}</div>
            <div class="text-xs text-slate-500 mt-1">En bodega</div>
          </div>
          <div class="surface p-4">
            <div class="text-2xl font-bold text-sky-400">{{ unitKpis.assigned }}</div>
            <div class="text-xs text-slate-500 mt-1">Asignados</div>
          </div>
          <div class="surface p-4">
            <div class="text-2xl font-bold text-amber-400">{{ unitKpis.damaged + unitKpis.in_repair }}</div>
            <div class="text-xs text-slate-500 mt-1">Dañados / en reparación</div>
          </div>
          <div class="surface p-4 flex items-center">
            <button class="btn-primary w-full" @click="openCreateUnit">+ Registrar equipo</button>
          </div>
        </div>

        <p v-if="unitsError" class="text-sm text-red-400 mb-3">{{ unitsError }}</p>

        <h2 class="text-lg font-semibold mb-3">Equipos (serie / MAC)</h2>
        <div class="table-shell">
          <table class="w-full text-sm min-w-[760px]">
            <thead class="bg-slate-900 text-slate-400 text-xs uppercase">
              <tr>
                <th class="text-left px-4 py-3">Serie</th>
                <th class="text-left px-4 py-3">MAC</th>
                <th class="text-left px-4 py-3">Estado</th>
                <th class="text-left px-4 py-3">Cliente</th>
                <th class="text-right px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="unitsLoading">
                <td colspan="5" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
              </tr>
              <tr v-else-if="!units.length">
                <td colspan="5" class="px-4 py-6 text-center text-slate-500">Sin equipos registrados todavía.</td>
              </tr>
              <tr v-for="u in units" :key="u.id" class="border-t border-slate-800">
                <td class="px-4 py-3 font-mono text-xs">{{ u.serial_number || '—' }}</td>
                <td class="px-4 py-3 font-mono text-xs">{{ u.mac_address || '—' }}</td>
                <td class="px-4 py-3">
                  <span class="badge" :class="UNIT_STATUS_CLASS[u.status]">{{ UNIT_STATUS_LABEL[u.status] }}</span>
                </td>
                <td class="px-4 py-3 text-slate-400">
                  <router-link v-if="u.clients" :to="`/clientes/${u.clients.id}`" class="text-sky-400 hover:underline">
                    {{ u.clients.first_name }} {{ u.clients.last_name }}
                  </router-link>
                  <span v-else>—</span>
                </td>
                <td class="px-4 py-3 text-right">
                  <div class="flex justify-end gap-1.5 flex-wrap">
                    <button class="text-xs text-slate-400 hover:text-slate-100" @click="openHistory(u)">Historial</button>
                    <button v-if="u.status === 'in_stock'" class="text-xs text-sky-400 hover:text-sky-300" @click="openAssign(u)">Asignar</button>
                    <button v-if="u.status === 'assigned'" class="text-xs text-amber-400 hover:text-amber-300" @click="openReturn(u)">Devolución</button>
                    <button v-if="u.status === 'in_repair'" class="text-xs text-green-400 hover:text-green-300" @click="handleMarkRepaired(u)">Marcar reparado</button>
                    <button v-if="u.status === 'damaged' || u.status === 'in_repair'" class="text-xs text-red-400 hover:text-red-300" @click="handleRetire(u)">Dar de baja</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>

    <Teleport to="body">
      <div v-if="showEditModal" class="modal-overlay">
        <form class="w-full max-w-md modal-panel max-h-[90vh] overflow-y-auto" @submit.prevent="handleEdit">
          <h2 class="text-lg font-semibold mb-4">Editar producto</h2>

          <div class="mb-3">
            <label class="block text-xs text-slate-400 mb-1">Nombre</label>
            <input v-model="editForm.name" required class="field-input" />
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Categoría</label>
              <input v-model="editForm.category" class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Unidad</label>
              <input v-model="editForm.unit" class="field-input" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Precio</label>
              <input v-model.number="editForm.price" type="number" step="0.01" min="0" class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Stock mínimo</label>
              <input v-model.number="editForm.min_stock" type="number" step="1" min="0" class="field-input" />
            </div>
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-400 mb-1">Fecha de compra</label>
            <input v-model="editForm.purchase_date" type="date" class="field-input" />
          </div>

          <p v-if="editError" class="text-sm text-red-400 mb-3">{{ editError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showEditModal = false">Cancelar</button>
            <button type="submit" :disabled="editSaving" class="btn-primary">
              {{ editSaving ? 'Guardando...' : 'Guardar cambios' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showMovementModal" class="modal-overlay">
        <form class="w-full max-w-sm modal-panel" @submit.prevent="handleMovement">
          <h2 class="text-lg font-semibold mb-4">
            {{ movementType === 'ingreso' ? 'Registrar ingreso' : 'Registrar egreso' }}
          </h2>

          <div class="mb-3">
            <label class="block text-xs text-slate-400 mb-1">Cantidad ({{ product?.unit }})</label>
            <input v-model.number="movementForm.quantity" type="number" step="0.01" min="0.01" required class="field-input" />
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-400 mb-1">Motivo</label>
            <input
              v-model="movementForm.reason"
              :placeholder="movementType === 'ingreso' ? 'ej. Compra, devolución...' : 'ej. Instalación, reparación...'"
              class="field-input"
            />
          </div>

          <p v-if="movementError" class="text-sm text-red-400 mb-3">{{ movementError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showMovementModal = false">Cancelar</button>
            <button type="submit" :disabled="movementSaving" class="btn-primary">
              {{ movementSaving ? 'Guardando...' : 'Registrar' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showUnitModal" class="modal-overlay">
        <form class="w-full max-w-sm modal-panel" @submit.prevent="handleCreateUnit">
          <h2 class="text-lg font-semibold mb-4">Registrar equipo</h2>

          <div class="mb-3">
            <label class="block text-xs text-slate-400 mb-1">Número de serie</label>
            <input v-model="unitForm.serial_number" class="field-input" placeholder="ej. ZTEGC1234567" />
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-400 mb-1">Dirección MAC</label>
            <input v-model="unitForm.mac_address" class="field-input" placeholder="ej. AA:BB:CC:DD:EE:FF" />
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-400 mb-1">Notas</label>
            <input v-model="unitForm.notes" class="field-input" placeholder="Opcional" />
          </div>

          <p v-if="unitFormError" class="text-sm text-red-400 mb-3">{{ unitFormError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showUnitModal = false">Cancelar</button>
            <button type="submit" :disabled="unitSaving" class="btn-primary">
              {{ unitSaving ? 'Guardando...' : 'Registrar' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showAssignModal" class="modal-overlay">
        <form class="w-full max-w-sm modal-panel max-h-[90vh] overflow-y-auto" @submit.prevent="handleAssign">
          <h2 class="text-lg font-semibold mb-1">Asignar equipo</h2>
          <p class="text-xs text-slate-500 mb-4 font-mono">{{ assignUnitTarget?.serial_number || assignUnitTarget?.mac_address }}</p>

          <div class="mb-3">
            <label class="block text-xs text-slate-400 mb-1">Buscar cliente</label>
            <input v-model="assignClientFilter" class="field-input" placeholder="Nombre o documento..." />
          </div>

          <select v-model="assignClientId" required size="6" class="field-input mb-4">
            <option v-for="c in filteredAssignClients" :key="c.id" :value="c.id">
              {{ c.first_name }} {{ c.last_name }} · {{ c.document_number }}
            </option>
          </select>

          <p v-if="assignError" class="text-sm text-red-400 mb-3">{{ assignError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showAssignModal = false">Cancelar</button>
            <button type="submit" :disabled="assignSaving || !assignClientId" class="btn-primary">
              {{ assignSaving ? 'Asignando...' : 'Asignar' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showReturnModal" class="modal-overlay">
        <form class="w-full max-w-sm modal-panel" @submit.prevent="handleReturn">
          <h2 class="text-lg font-semibold mb-1">Registrar devolución</h2>
          <p class="text-xs text-slate-500 mb-4 font-mono">{{ returnUnitTarget?.serial_number || returnUnitTarget?.mac_address }}</p>

          <div class="mb-3">
            <label class="block text-xs text-slate-400 mb-1">Condición del equipo</label>
            <select v-model="returnForm.condition" class="field-input">
              <option value="in_stock">Buen estado — listo para reasignar</option>
              <option value="damaged">Dañado</option>
              <option value="in_repair">Enviar a reparación</option>
            </select>
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-400 mb-1">Motivo</label>
            <input v-model="returnForm.reason" class="field-input" placeholder="ej. Baja del servicio, cambio de equipo..." />
          </div>

          <p v-if="returnError" class="text-sm text-red-400 mb-3">{{ returnError }}</p>

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
            <li v-for="ev in historyEvents" :key="ev.id" class="text-xs border-l-2 border-slate-700 pl-3">
              <div class="flex items-center gap-2">
                <span class="badge" :class="UNIT_STATUS_CLASS[ev.to_status]">{{ UNIT_STATUS_LABEL[ev.to_status] }}</span>
                <span class="text-slate-500">{{ formatDate(ev.created_at) }}</span>
              </div>
              <p v-if="ev.reason" class="text-slate-400 mt-1">{{ ev.reason }}</p>
              <p v-if="ev.clients" class="text-slate-500 mt-0.5">Cliente: {{ ev.clients.first_name }} {{ ev.clients.last_name }}</p>
              <p class="text-slate-600 mt-0.5">{{ ev.author?.full_name || ev.author?.email || '—' }}</p>
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
