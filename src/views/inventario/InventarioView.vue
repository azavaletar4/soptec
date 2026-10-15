<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import InventorySearchResults from '@/components/inventario/InventorySearchResults.vue';
import AppLayout from '@/components/layout/AppLayout.vue';
import AlbumCard from '@/components/inventario/AlbumCard.vue';
import { useInventoryStore } from '@/stores/inventory';
import { useAuthStore } from '@/stores/auth';
import { useAsyncAction } from '@/composables/useAsyncAction';
import { getErrorMessage } from '@/lib/errors';
import type { InventoryProduct } from '@/types/domain';

const router = useRouter();
const route = useRoute();
const inventoryStore = useInventoryStore();
const auth = useAuthStore();

// Fase 58: eliminar productos queda acotado a SUPERADMIN (antes tambien ADMIN).
const canDelete = computed(() => auth.isSuperAdmin);

const showModal = ref(false);
const searchQuery = ref(String(route.query.q ?? ''));
watch(searchQuery, (q) => { void router.replace({ query: { ...route.query, q: q || undefined, searchPage: undefined } }); });
const searchRevision = ref(0);
const editingProduct = ref<InventoryProduct | null>(null);

const emptyForm = () => ({
  name: '',
  category_id: '' as string,
  unit: 'unidad',
  price: 0,
  min_stock: 0,
  purchase_date: '',
  is_serialized: false,
});
const form = ref(emptyForm());


/** KPIs resumidos: suman lo que devuelve inventory_get_albums (Fase 44), incluye el álbum virtual de averiados/retirados. */
const kpis = computed(() => {
  const albums = inventoryStore.albums;
  return {
    total: albums.reduce((sum, a) => sum + a.item_count, 0),
    lowStock: albums.reduce((sum, a) => sum + a.low_stock, 0),
    totalValue: albums.reduce((sum, a) => sum + a.total_value, 0),
  };
});

const isSearching = computed(() => searchQuery.value.trim().length > 0);

async function loadAll() {
  await Promise.all([inventoryStore.fetchAlbums(), inventoryStore.fetchCategories()]);
  searchRevision.value++;
}

onMounted(loadAll);

function openAlbum(slug: string) {
  router.push(`/inventario/album/${slug}`);
}

function openCreate() {
  editingProduct.value = null;
  form.value = emptyForm();
  formError.value = null;
  showModal.value = true;
}

function openEdit(p: InventoryProduct) {
  editingProduct.value = p;
  form.value = {
    name: p.name,
    category_id: p.category_id ?? '',
    unit: p.unit,
    price: Number(p.price),
    min_stock: Number(p.min_stock),
    purchase_date: p.purchase_date ?? '',
    is_serialized: p.is_serialized,
  };
  formError.value = null;
  showModal.value = true;
}

// useAsyncAction (mismo molde que las otras pantallas) — la validacion del
// nombre queda antes de llamar a run(), igual que en UsuariosView.vue.
const { loading: saving, error: formError, run: submitProduct } = useAsyncAction(async () => {
  if (editingProduct.value) {
    await inventoryStore.updateProduct(editingProduct.value.id, {
      name: form.value.name,
      category_id: form.value.category_id || null,
      unit: form.value.unit || 'unidad',
      price: form.value.price,
      min_stock: form.value.min_stock,
      purchase_date: form.value.purchase_date || null,
    });
  } else {
    await inventoryStore.createProduct({
      name: form.value.name,
      category_id: form.value.category_id || null,
      unit: form.value.unit || 'unidad',
      price: form.value.price,
      min_stock: form.value.min_stock,
      purchase_date: form.value.purchase_date || null,
      is_serialized: form.value.is_serialized,
    });
  }
  await loadAll();
}, 'Error al guardar el producto');

async function handleSubmit() {
  if (!form.value.name.trim()) {
    formError.value = 'El nombre es requerido';
    return;
  }
  await submitProduct();
  if (!formError.value) showModal.value = false;
}


async function handleDelete(p: InventoryProduct) {
  if (!canDelete.value) return;
  const ok = confirm(`¿Eliminar "${p.name}"? Dejará de aparecer en el inventario, pero se conserva su historial (Kardex/equipos) para auditoría.`);
  if (!ok) return;
  try {
    await inventoryStore.deactivateProduct(p.id);
    await loadAll();
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
        <p class="text-slate-600 text-sm mt-1">{{ kpis.total }} ítems · {{ kpis.lowStock }} con stock bajo</p>
      </div>
      <div class="flex gap-2">
        <button class="btn-secondary" @click="router.push('/inventario/activos-fijos')">🧰 Activos y Herramientas</button>
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
        <div class="text-2xl font-semibold" :class="kpis.lowStock ? 'text-amber-600' : ''">{{ kpis.lowStock }}</div>
        <div class="text-xs text-slate-500 mt-1">Con stock bajo el mínimo</div>
      </div>
      <div class="surface p-4">
        <div class="text-2xl font-semibold">S/ {{ kpis.totalValue.toFixed(2) }}</div>
        <div class="text-xs text-slate-500 mt-1">Valor total en stock</div>
      </div>
    </div>

    <div class="flex flex-wrap gap-3 mb-4">
      <input
        v-model="searchQuery"
        placeholder="Buscar producto, modelo, serie o MAC..."
        class="field-input flex-1 min-w-[220px]"
      />
    </div>

    <p v-if="inventoryStore.error" class="mb-4 text-sm text-red-600">{{ inventoryStore.error }}</p>

    <!-- Búsqueda global activa: lista plana (mismo formato de fila que la tabla original) -->
    <InventorySearchResults v-if="isSearching" :query="searchQuery" :revision="searchRevision" editable :can-delete="canDelete" @edit="openEdit" @delete="handleDelete" />
    <!-- Vista por defecto: álbumes/colecciones visuales -->
    <div v-else>
      <div v-if="inventoryStore.loading && !inventoryStore.albums.length" class="text-center text-slate-500 py-10">
        Cargando álbumes...
      </div>
      <div v-else class="grid gap-4" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))">
        <AlbumCard
          v-for="a in inventoryStore.albums"
          :key="a.album_slug"
          :icon="a.icon"
          :name="a.album_name"
          :color="a.color"
          :item-count="a.item_count"
          :low-stock="a.low_stock"
          :total-value="a.total_value"
          @click="openAlbum(a.album_slug)"
        />
      </div>
    </div>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay">
        <form class="w-full max-w-md modal-panel max-h-[90vh] overflow-y-auto" @submit.prevent="handleSubmit">
          <h2 class="text-lg font-semibold mb-4">{{ editingProduct ? 'Editar producto' : 'Nuevo producto' }}</h2>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Nombre</label>
            <input v-model="form.name" required class="field-input" />
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Álbum / Categoría</label>
              <select v-model="form.category_id" class="field-input">
                <option value="">Sin asignar</option>
                <option v-for="c in inventoryStore.categories" :key="c.id" :value="c.id">{{ c.icon }} {{ c.name }}</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Unidad</label>
              <input v-model="form.unit" placeholder="unidad, metro, caja..." class="field-input" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Precio</label>
              <input v-model.number="form.price" type="number" step="0.01" min="0" class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Stock mínimo</label>
              <input v-model.number="form.min_stock" type="number" step="1" min="0" class="field-input" />
            </div>
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-600 mb-1">Fecha de compra</label>
            <input v-model="form.purchase_date" type="date" class="field-input" />
          </div>

          <label v-if="!editingProduct" class="flex items-start gap-2 mb-4 text-sm text-slate-700">
            <input v-model="form.is_serialized" type="checkbox" class="mt-0.5" />
            <span>
              Control por número de serie / MAC
              <span class="block text-xs text-slate-500">Para ONUs, routers o antenas: cada equipo se registra individualmente en vez de llevar solo un stock numérico.</span>
            </span>
          </label>

          <p v-if="formError" class="text-sm text-red-600 mb-3">{{ formError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showModal = false">Cancelar</button>
            <button type="submit" :disabled="saving" class="btn-primary">
              {{ saving ? 'Guardando...' : editingProduct ? 'Guardar cambios' : 'Crear producto' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
