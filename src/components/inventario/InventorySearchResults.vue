<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { supabase } from '@/lib/supabase';
import { searchInventory, type InventorySearchScope, type SearchUnit } from '@/lib/inventorySearch';
import { getErrorMessage } from '@/lib/errors';
import type { InventoryProduct, InventoryUnitStatus } from '@/types/domain';

const props = defineProps<{ query: string; scope?: InventorySearchScope; editable?: boolean; canDelete?: boolean; revision?: number }>();
const emit = defineEmits<{ edit: [product: InventoryProduct]; delete: [product: InventoryProduct] }>();
const route = useRoute();
const router = useRouter();
const products = ref<InventoryProduct[]>([]);
const units = ref<SearchUnit[]>([]);
const selected = ref<SearchUnit | null>(null);
const initialPage = Number(route.query.searchPage ?? 0);
const page = ref(Number.isSafeInteger(initialPage) && initialPage >= 0 ? initialPage : 0);
watch(page, (value) => { void router.replace({ query: { ...route.query, q: props.query, searchPage: value || undefined } }); });
const more = ref(false);
const loading = ref(false);
const error = ref('');
let timer: ReturnType<typeof setTimeout>;
let controller: AbortController | undefined;
let generation = 0;
const labels: Record<InventoryUnitStatus, string> = {
  in_stock: 'Disponible', assigned: 'Asignado', damaged: 'Averiado', in_repair: 'En reparación',
  retired: 'Retirado', en_recupero: 'Por recoger', pending_approval: 'Pendiente de aprobación',
};
watch(() => [props.query, props.scope, page.value, props.revision], () => {
  clearTimeout(timer);
  controller?.abort();
  const request = ++generation;
  products.value = []; units.value = []; more.value = false; error.value = ''; selected.value = null;
  loading.value = true;
  timer = setTimeout(async () => {
    controller = new AbortController();
    try {
      const result = await searchInventory(supabase, props.query, page.value, props.scope, controller.signal);
      if (request !== generation) return;
      products.value = result.products; units.value = result.units; more.value = result.more;
    } catch (e) {
      if (request === generation) error.value = getErrorMessage(e, 'Error al buscar inventario');
    } finally { if (request === generation) loading.value = false; }
  }, 300);
}, { immediate: true, deep: true });
watch(() => [props.query, props.scope], () => {
  page.value = 0;
}, { deep: true });
onBeforeUnmount(() => { clearTimeout(timer); controller?.abort(); generation++; });
</script>

<template>
  <section aria-live="polite" class="space-y-3">
    <p v-if="loading" class="text-slate-500">Buscando...</p>
    <p v-else-if="error" role="alert" class="text-red-600">No se pudo completar la búsqueda. Intenta nuevamente. {{ error }}</p>
    <p v-else-if="!products.length && !units.length" class="surface p-6 text-slate-500">Sin coincidencias.</p>
    <div v-for="p in products" :key="p.id" class="surface p-4">
      <router-link :to="{ path: `/inventario/${p.id}`, query: { returnTo: route.fullPath } }" class="text-sky-700 hover:underline">{{ p.name }}</router-link>
      <p class="text-xs text-slate-500">{{ p.inventory_categories?.name ?? p.category ?? 'Sin categoría' }} · Producto</p>
      <p v-if="!p.is_serialized" class="text-sm">Stock: {{ p.current_stock }} {{ p.unit }}</p>
      <div v-if="editable" class="flex gap-3 mt-2">
        <button class="text-sm text-sky-700" @click="emit('edit', p)">Editar</button>
        <button v-if="canDelete" class="text-sm text-red-600" @click="emit('delete', p)">Eliminar</button>
      </div>
    </div>
    <div v-for="u in units" :key="u.id" class="surface p-4">
      <router-link :to="{ path: `/inventario/${u.product_id}`, query: { returnTo: route.fullPath } }" class="text-sky-700 hover:underline">{{ u.product.name }}</router-link>
      <p class="text-xs text-slate-500">{{ u.product.inventory_categories?.name ?? u.product.category ?? 'Sin categoría' }} · {{ labels[u.status] }}</p>
      <p class="text-sm">Serie: {{ u.serial_number || 'Sin registrar' }} · MAC: {{ u.mac_address || 'Sin registrar' }}</p>
      <p v-if="u.clients" class="text-sm">Cliente: <router-link class="text-sky-700 hover:underline" :to="`/clientes/${u.clients.id}`">{{ u.clients.first_name }} {{ u.clients.last_name }}</router-link></p>
      <p v-if="u.contract" class="text-sm">Contrato: <router-link class="text-sky-700 hover:underline" :to="`/clientes/${u.contract.client_id}/servicios/${u.contract.id}`">{{ u.contract.contract_number || u.contract.id }}</router-link><span v-if="u.contract.client_code"> · Código: {{ u.contract.client_code }}</span></p>
      <p v-if="u.contract?.installation_address" class="text-sm">Dirección del contrato: {{ u.contract.installation_address }}</p>
      <button class="text-sm text-sky-700 hover:underline" @click="selected = u">Ver unidad</button>
    </div>
    <div v-if="!loading && !error" class="flex items-center gap-3">
      <button class="btn-secondary" :disabled="page === 0" @click="page--">Anterior</button>
      <span>Página {{ page + 1 }}</span>
      <button class="btn-secondary" :disabled="!more" @click="page++">Siguiente</button>
    </div>
    <Teleport to="body">
      <div v-if="selected" class="modal-overlay" @click.self="selected = null" @keydown.esc="selected = null">
        <div role="dialog" aria-modal="true" aria-label="Detalle de unidad" class="modal-panel w-full max-w-lg">
          <h2 class="text-lg font-semibold">{{ selected.product.name }}</h2>
          <p>Serie: {{ selected.serial_number || 'Sin registrar' }}</p>
          <p>MAC: {{ selected.mac_address || 'Sin registrar' }}</p>
          <p>Estado: {{ labels[selected.status] }}</p>
          <p>Ubicación física: no registrada en este catálogo.</p>
          <p>Cliente: {{ selected.clients ? `${selected.clients.first_name} ${selected.clients.last_name}` : selected.client_id ? 'Sin información visible' : 'Pendiente de vincular' }}</p>
          <p>Contrato: {{ selected.contract ? selected.contract.contract_number || selected.contract.id : selected.contract_id ? 'Sin información visible' : 'Pendiente de vincular' }}</p>
          <p v-if="selected.contract?.installation_address">Dirección del contrato: {{ selected.contract.installation_address }}</p>
          <p v-if="selected.notes">Notas: {{ selected.notes }}</p>
          <button autofocus class="btn-secondary mt-4" @click="selected = null">Cerrar</button>
        </div>
      </div>
    </Teleport>
  </section>
</template>
