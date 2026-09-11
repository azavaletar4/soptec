<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useInventoryStore } from '@/stores/inventory';
import { getErrorMessage } from '@/lib/errors';
import type { InventoryMovement, InventoryMovementType } from '@/types/domain';

const route = useRoute();
const router = useRouter();
const inventoryStore = useInventoryStore();

const productId = computed(() => route.params.id as string);
const product = computed(() => inventoryStore.products.find((p) => p.id === productId.value));

const movements = ref<InventoryMovement[]>([]);
const movementsLoading = ref(true);

const showEditModal = ref(false);
const editForm = ref({ name: '', category: '', unit: '', price: 0, min_stock: 0 });
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

onMounted(async () => {
  if (!inventoryStore.products.length) await inventoryStore.fetchProducts();
  await loadMovements();
});

function openEdit() {
  if (!product.value) return;
  editForm.value = {
    name: product.value.name,
    category: product.value.category ?? '',
    unit: product.value.unit,
    price: Number(product.value.price),
    min_stock: Number(product.value.min_stock),
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
</script>

<template>
  <AppLayout>
    <button class="text-sm text-slate-400 hover:text-slate-100 mb-4" @click="router.push('/inventario')">← Volver a Inventario</button>

    <div v-if="!product" class="text-slate-500">Producto no encontrado.</div>
    <template v-else>
      <div class="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 class="text-2xl font-semibold mb-1">{{ product.name }}</h1>
          <p class="text-slate-400 text-sm">{{ product.category ?? 'Sin categoría' }} · {{ product.unit }} · $ {{ Number(product.price).toFixed(2) }}</p>
        </div>
        <button class="btn-secondary" @click="openEdit">Editar producto</button>
      </div>

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

          <div class="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Precio</label>
              <input v-model.number="editForm.price" type="number" step="0.01" min="0" class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Stock mínimo</label>
              <input v-model.number="editForm.min_stock" type="number" step="1" min="0" class="field-input" />
            </div>
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
  </AppLayout>
</template>
