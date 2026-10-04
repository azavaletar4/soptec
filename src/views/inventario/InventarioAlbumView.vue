<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import ProductGridCard from '@/components/inventario/ProductGridCard.vue';
import MoveAlbumMenu from '@/components/inventario/MoveAlbumMenu.vue';
import { useInventoryStore } from '@/stores/inventory';
import { useInventoryUnitsStore } from '@/stores/inventoryUnits';
import { getErrorMessage } from '@/lib/errors';
import type { InventoryProduct, InventoryUnit, InventoryUnitStatus } from '@/types/domain';

const route = useRoute();
const router = useRouter();
const inventoryStore = useInventoryStore();
const unitsStore = useInventoryUnitsStore();

// Álbumes virtuales (Fase 44, separados en Fase 51c): no son filas de
// inventory_categories, se arman agregando por status de inventory_units.
// 'por_recoger' = recojo pendiente por baja de servicio (aun no se sabe en
// que estado llega); 'averiados' = ya fallo / esta en reparacion / dado de
// baja. Separados a proposito para no volver a mezclar lo que las acciones
// "Marcar para Recupero" vs "Averiado / Mantenimiento" ya distinguen.
const VIRTUAL_ALBUMS: Record<string, { title: string; icon: string; statuses: InventoryUnitStatus[] }> = {
  por_recoger: { title: 'Equipos por Recoger', icon: '🔄', statuses: ['en_recupero'] },
  averiados: { title: 'Averiados / En Reparación', icon: '🛠️', statuses: ['damaged', 'in_repair', 'retired'] },
};
const slug = computed(() => String(route.params.slug));
const virtualAlbum = computed(() => VIRTUAL_ALBUMS[slug.value]);
const isRecoveryAlbum = computed(() => !!virtualAlbum.value);

const loading = ref(false);
const error = ref<string | null>(null);
const searchQuery = ref('');

// --- Álbum real (por categoría) ---
const inStockCounts = ref<Record<string, number>>({});
const category = computed(() => inventoryStore.categories.find((c) => c.slug === slug.value));
const products = computed(() => inventoryStore.products);
const filteredProducts = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return products.value;
  return products.value.filter((p) => p.name.toLowerCase().includes(q));
});

// --- Álbumes virtuales "Equipos por Recoger" / "Averiados / En Reparación" ---
const recoveryUnits = ref<InventoryUnit[]>([]);
const filteredUnits = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return recoveryUnits.value;
  return recoveryUnits.value.filter((u) =>
    `${u.product?.name ?? ''} ${u.serial_number ?? ''} ${u.mac_address ?? ''}`.toLowerCase().includes(q),
  );
});

const albumTitle = computed(() => virtualAlbum.value?.title ?? category.value?.name ?? 'Álbum');
const albumIcon = computed(() => virtualAlbum.value?.icon ?? category.value?.icon ?? '📦');

async function load() {
  loading.value = true;
  error.value = null;
  try {
    if (!inventoryStore.categories.length) await inventoryStore.fetchCategories();

    if (virtualAlbum.value) {
      recoveryUnits.value = await unitsStore.fetchUnitsByStatus(virtualAlbum.value.statuses);
    } else {
      const cat = inventoryStore.categories.find((c) => c.slug === slug.value);
      if (!cat) throw new Error('Álbum no encontrado');
      await inventoryStore.fetchProducts({ categoryId: cat.id });
      const serializedIds = products.value.filter((p) => p.is_serialized).map((p) => p.id);
      inStockCounts.value = await unitsStore.fetchInStockCounts(serializedIds);
    }
  } catch (e) {
    error.value = getErrorMessage(e, 'Error al cargar el álbum');
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(slug, load);

function goToDetail(p: InventoryProduct) {
  router.push(`/inventario/${p.id}`);
}

// --- Mover producto de álbum ---
const movingProduct = ref<InventoryProduct | null>(null);
async function moveProductToCategory(categoryId: string) {
  if (!movingProduct.value) return;
  try {
    await inventoryStore.updateProductCategory(movingProduct.value.id, categoryId);
    movingProduct.value = null;
    await load();
  } catch (e) {
    error.value = getErrorMessage(e, 'Error al mover el producto');
  }
}

// --- Mover unidad (equipo) al/del álbum virtual de averiados/retirados ---
const movingUnit = ref<InventoryUnit | null>(null);
async function moveUnitStatus(status: InventoryUnitStatus, reason: string) {
  if (!movingUnit.value) return;
  try {
    await unitsStore.registerEvent({
      unitId: movingUnit.value.id,
      toStatus: status,
      clientId: movingUnit.value.client_id ?? undefined,
      reason: reason || undefined,
    });
    movingUnit.value = null;
    await load();
  } catch (e) {
    error.value = getErrorMessage(e, 'Error al cambiar el estado del equipo');
  }
}

const STATUS_LABEL: Record<InventoryUnitStatus, string> = {
  in_stock: 'Disponible',
  assigned: 'Asignado',
  damaged: 'Averiado',
  in_repair: 'En reparación',
  retired: 'Retirado',
  en_recupero: 'Por Recoger',
  pending_approval: 'Pendiente de aprobación',
};
const STATUS_BADGE: Record<InventoryUnitStatus, string> = {
  in_stock: 'bg-green-500/15 text-green-600',
  assigned: 'bg-sky-500/15 text-sky-700',
  damaged: 'bg-red-500/15 text-red-600',
  in_repair: 'bg-amber-500/15 text-amber-700',
  retired: 'bg-slate-200 text-slate-500',
  en_recupero: 'bg-rose-500/15 text-rose-700',
  pending_approval: 'bg-orange-500/15 text-orange-700',
};
</script>

<template>
  <AppLayout>
    <button class="text-sm text-sky-600 hover:text-sky-700 mb-3" @click="router.push('/inventario')">
      ← Inventario
    </button>

    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div class="flex items-center gap-3">
        <span class="text-3xl">{{ albumIcon }}</span>
        <div>
          <h1 class="text-2xl font-semibold">{{ albumTitle }}</h1>
          <p class="text-slate-600 text-sm mt-1">
            {{ isRecoveryAlbum ? filteredUnits.length : filteredProducts.length }}
            {{ isRecoveryAlbum ? (filteredUnits.length === 1 ? 'equipo' : 'equipos') : (filteredProducts.length === 1 ? 'ítem' : 'ítems') }}
          </p>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap gap-3 mb-4">
      <input v-model="searchQuery" placeholder="Buscar en este álbum..." class="field-input flex-1 min-w-[220px]" />
    </div>

    <p v-if="error" class="mb-4 text-sm text-red-600">{{ error }}</p>
    <div v-if="loading" class="text-center text-slate-500 py-10">Cargando...</div>

    <!-- Álbum virtual: equipos por recoger / averiados -->
    <template v-else-if="isRecoveryAlbum">
      <div v-if="!filteredUnits.length" class="surface p-8 text-center text-slate-500">
        {{ slug === 'por_recoger' ? 'No hay equipos pendientes de recojo por ahora.' : 'No hay equipos averiados, en reparación o retirados por ahora.' }}
      </div>
      <div v-else class="grid gap-4" style="grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))">
        <div v-for="u in filteredUnits" :key="u.id" class="surface p-4 flex flex-col gap-2">
          <div class="flex items-start justify-between gap-2">
            <h4 class="text-sm font-semibold text-slate-900">{{ u.product?.name ?? 'Equipo' }}</h4>
            <span class="badge" :class="STATUS_BADGE[u.status]">{{ STATUS_LABEL[u.status] }}</span>
          </div>
          <p class="text-xs text-slate-500">
            {{ u.serial_number ? `S/N ${u.serial_number}` : '' }}
            {{ u.mac_address ? `MAC ${u.mac_address}` : '' }}
          </p>
          <p v-if="u.clients" class="text-xs text-slate-500">
            Cliente:
            <router-link :to="`/clientes/${u.clients.id}`" class="text-sky-600 hover:underline">
              {{ u.clients.first_name }} {{ u.clients.last_name }}
            </router-link>
          </p>
          <p v-if="u.pending_pickup_profile" class="text-xs text-slate-500">
            Técnico asignado: {{ u.pending_pickup_profile.full_name || u.pending_pickup_profile.email }}
          </p>
          <p v-if="u.notes" class="text-xs text-slate-400 italic">{{ u.notes }}</p>
          <div class="mt-auto pt-2 flex justify-end">
            <button type="button" class="text-xs text-sky-700 hover:text-sky-700" @click="movingUnit = u">
              🔀 Cambiar estado
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- Álbum real: productos de la categoría -->
    <template v-else>
      <div v-if="!filteredProducts.length" class="surface p-8 text-center text-slate-500">
        No hay productos en este álbum todavía.
      </div>
      <div v-else class="grid gap-4" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))">
        <ProductGridCard
          v-for="p in filteredProducts"
          :key="p.id"
          :product="p"
          :units-in-stock="inStockCounts[p.id]"
          @open="goToDetail(p)"
          @move="movingProduct = p"
        />
      </div>
    </template>

    <MoveAlbumMenu
      v-if="movingProduct"
      mode="product"
      :categories="inventoryStore.categories"
      :current-category-id="movingProduct.category_id"
      @close="movingProduct = null"
      @move-category="moveProductToCategory"
    />
    <MoveAlbumMenu
      v-if="movingUnit"
      mode="unit"
      :current-status="movingUnit.status"
      @close="movingUnit = null"
      @move-status="moveUnitStatus"
    />
  </AppLayout>
</template>
