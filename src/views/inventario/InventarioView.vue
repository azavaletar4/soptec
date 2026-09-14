<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useInventoryStore } from '@/stores/inventory';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/lib/errors';
import type { InventoryProduct } from '@/types/domain';

const router = useRouter();
const inventoryStore = useInventoryStore();
const auth = useAuthStore();

const canDelete = computed(() => auth.role === 'SUPERADMIN' || auth.role === 'ADMIN');

const showModal = ref(false);
const saving = ref(false);
const formError = ref<string | null>(null);
const searchQuery = ref('');
const categoryFilter = ref('all');
const lowStockOnly = ref(false);

const emptyForm = () => ({
  name: '',
  category: '',
  unit: 'unidad',
  price: 0,
  min_stock: 0,
  purchase_date: '',
  is_serialized: false,
});
const form = ref(emptyForm());

function isLowStock(p: InventoryProduct) {
  return p.current_stock <= p.min_stock;
}

const categories = computed(() => {
  const set = new Set(inventoryStore.products.map((p) => p.category).filter(Boolean) as string[]);
  return [...set].sort();
});

const filteredProducts = computed(() => {
  let list = inventoryStore.products;
  if (categoryFilter.value !== 'all') list = list.filter((p) => p.category === categoryFilter.value);
  if (lowStockOnly.value) list = list.filter(isLowStock);
  const q = searchQuery.value.trim().toLowerCase();
  if (q) list = list.filter((p) => `${p.name} ${p.category ?? ''}`.toLowerCase().includes(q));
  return list;
});

const kpis = computed(() => {
  const products = inventoryStore.products;
  const lowStock = products.filter(isLowStock).length;
  const totalValue = products.reduce((sum, p) => sum + p.current_stock * Number(p.price), 0);
  return { total: products.length, lowStock, totalValue };
});

onMounted(async () => {
  await inventoryStore.fetchProducts();
});

function openCreate() {
  form.value = emptyForm();
  formError.value = null;
  showModal.value = true;
}

async function handleSubmit() {
  if (!form.value.name.trim()) {
    formError.value = 'El nombre es requerido';
    return;
  }
  saving.value = true;
  formError.value = null;
  try {
    await inventoryStore.createProduct({
      name: form.value.name,
      category: form.value.category || null,
      unit: form.value.unit || 'unidad',
      price: form.value.price,
      min_stock: form.value.min_stock,
      purchase_date: form.value.purchase_date || null,
      is_serialized: form.value.is_serialized,
    });
    showModal.value = false;
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al crear el producto');
  } finally {
    saving.value = false;
  }
}

function goToDetail(p: InventoryProduct) {
  router.push(`/inventario/${p.id}`);
}

async function handleDelete(p: InventoryProduct) {
  if (!canDelete.value) return;
  const ok = confirm(`¿Eliminar "${p.name}"? Dejará de aparecer en el inventario, pero se conserva su historial (Kardex/equipos) para auditoría.`);
  if (!ok) return;
  try {
    await inventoryStore.deactivateProduct(p.id);
  } catch (e) {
    inventoryStore.error = getErrorMessage(e, 'Error al eliminar el producto');
  }
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Inventario</h1>
        <p class="text-slate-400 text-sm mt-1">{{ kpis.total }} productos · {{ kpis.lowStock }} con stock bajo</p>
      </div>
      <div class="flex gap-2">
        <button class="btn-secondary" @click="router.push('/inventario/devoluciones')">Devoluciones</button>
        <button class="btn-primary" @click="openCreate">+ Nuevo producto</button>
      </div>
    </div>

    <div class="grid gap-4 mb-6" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))">
      <div class="surface p-4">
        <div class="text-2xl font-semibold">{{ kpis.total }}</div>
        <div class="text-xs text-slate-500 mt-1">Productos activos</div>
      </div>
      <div class="surface p-4">
        <div class="text-2xl font-semibold" :class="kpis.lowStock ? 'text-amber-400' : ''">{{ kpis.lowStock }}</div>
        <div class="text-xs text-slate-500 mt-1">Con stock bajo el mínimo</div>
      </div>
      <div class="surface p-4">
        <div class="text-2xl font-semibold">S/ {{ kpis.totalValue.toFixed(2) }}</div>
        <div class="text-xs text-slate-500 mt-1">Valor total en stock</div>
      </div>
    </div>

    <div class="flex flex-wrap gap-3 mb-4">
      <input v-model="searchQuery" placeholder="Buscar producto o categoría..." class="field-input flex-1 min-w-[220px]" />
      <select v-model="categoryFilter" class="field-input w-auto">
        <option value="all">Todas las categorías</option>
        <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
      </select>
      <button
        class="px-3 py-1.5 rounded-lg text-xs font-medium"
        :class="lowStockOnly ? 'bg-amber-500 text-slate-950' : 'bg-slate-900 text-slate-400 hover:text-slate-100'"
        @click="lowStockOnly = !lowStockOnly"
      >
        ⚠ Solo stock bajo
      </button>
    </div>

    <p v-if="inventoryStore.error" class="mb-4 text-sm text-red-400">{{ inventoryStore.error }}</p>

    <div class="table-shell">
      <table class="w-full text-sm min-w-[760px]">
        <thead class="bg-slate-900 text-slate-400 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-3">Producto</th>
            <th class="text-left px-4 py-3">Categoría</th>
            <th class="text-right px-4 py-3">Stock actual</th>
            <th class="text-right px-4 py-3">Mínimo</th>
            <th class="text-left px-4 py-3">Unidad</th>
            <th class="text-right px-4 py-3">Precio</th>
            <th class="text-left px-4 py-3">Fecha de compra</th>
            <th class="text-left px-4 py-3">Control</th>
            <th class="text-right px-4 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="inventoryStore.loading">
            <td colspan="9" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
          </tr>
          <tr v-else-if="!filteredProducts.length">
            <td colspan="9" class="px-4 py-6 text-center text-slate-500">No hay productos en este filtro.</td>
          </tr>
          <tr
            v-for="p in filteredProducts"
            :key="p.id"
            class="border-t border-slate-800 hover:bg-slate-900/50 cursor-pointer"
            @click="goToDetail(p)"
          >
            <td class="px-4 py-3 text-slate-100">{{ p.name }}</td>
            <td class="px-4 py-3 text-slate-400">{{ p.category ?? '—' }}</td>
            <td class="px-4 py-3 text-right">
              <span class="badge" :class="isLowStock(p) ? 'bg-amber-500/15 text-amber-400' : 'bg-green-500/15 text-green-400'">
                {{ p.current_stock }}
              </span>
            </td>
            <td class="px-4 py-3 text-right text-slate-400">{{ p.min_stock }}</td>
            <td class="px-4 py-3 text-slate-400">{{ p.unit }}</td>
            <td class="px-4 py-3 text-right text-slate-400">S/ {{ Number(p.price).toFixed(2) }}</td>
            <td class="px-4 py-3 text-slate-400 text-xs">{{ p.purchase_date ?? '—' }}</td>
            <td class="px-4 py-3">
              <span v-if="p.is_serialized" class="badge bg-sky-500/15 text-sky-400">Por serie/MAC</span>
              <span v-else class="text-slate-600 text-xs">Por cantidad</span>
            </td>
            <td class="px-4 py-3 text-right">
              <button v-if="canDelete" class="text-xs text-red-400 hover:text-red-300" @click.stop="handleDelete(p)">Eliminar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay">
        <form class="w-full max-w-md modal-panel max-h-[90vh] overflow-y-auto" @submit.prevent="handleSubmit">
          <h2 class="text-lg font-semibold mb-4">Nuevo producto</h2>

          <div class="mb-3">
            <label class="block text-xs text-slate-400 mb-1">Nombre</label>
            <input v-model="form.name" required class="field-input" />
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Categoría</label>
              <input v-model="form.category" placeholder="ej. Cables, Routers..." class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Unidad</label>
              <input v-model="form.unit" placeholder="unidad, metro, caja..." class="field-input" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Precio</label>
              <input v-model.number="form.price" type="number" step="0.01" min="0" class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Stock mínimo</label>
              <input v-model.number="form.min_stock" type="number" step="1" min="0" class="field-input" />
            </div>
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-400 mb-1">Fecha de compra</label>
            <input v-model="form.purchase_date" type="date" class="field-input" />
          </div>

          <label class="flex items-start gap-2 mb-4 text-sm text-slate-300">
            <input v-model="form.is_serialized" type="checkbox" class="mt-0.5" />
            <span>
              Control por número de serie / MAC
              <span class="block text-xs text-slate-500">Para ONUs, routers o antenas: cada equipo se registra individualmente en vez de llevar solo un stock numérico.</span>
            </span>
          </label>

          <p v-if="formError" class="text-sm text-red-400 mb-3">{{ formError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showModal = false">Cancelar</button>
            <button type="submit" :disabled="saving" class="btn-primary">
              {{ saving ? 'Creando...' : 'Crear producto' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
