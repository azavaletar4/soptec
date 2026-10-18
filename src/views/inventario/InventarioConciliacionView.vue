<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/lib/errors';
import { formatPeruDateTime } from '@/lib/oltAlertPresentation';
import { readInventoryReconciliation, RECONCILIATION_LABELS, normalizeMac, type ReconciliationRow } from '@/lib/inventoryReconciliation';
import { UNIT_LOCATION_LABELS } from '@/lib/inventoryPresentation';

const route = useRoute(), auth = useAuthStore();
const rows = ref<ReconciliationRow[]>([]), loading = ref(false), error = ref(''), checkedAt = ref('');
const counts = ref({ units: 0, installations: 0, closures: 0, tickets: 0, ticketClosures: 0 });
const query = ref(''), category = ref(''), classification = ref(''), status = ref(typeof route.query.status === 'string' ? route.query.status : '');
const page = ref(0);
let controller: AbortController | undefined, generation = 0;
const categories = computed(() => [...new Map(rows.value.map(row => [row.category, row.unit.product?.inventory_categories?.name ?? 'Sin categoría'])).entries()]);
const filtered = computed(() => rows.value.filter(row => {
  const term = query.value.trim().toLocaleLowerCase();
  const u = row.unit;
  return (!category.value || category.value === row.category) && (!classification.value || classification.value === row.classification)
    && (!status.value || status.value === u.status)
    && (!term || `${u.product?.name ?? ''} ${u.serial_number ?? ''} ${u.mac_address ?? ''} ${u.clients?.first_name ?? ''} ${u.clients?.last_name ?? ''}`.toLocaleLowerCase().includes(term) || (!!normalizeMac(term) && normalizeMac(term) === normalizeMac(u.mac_address)));
}));
const visible = computed(() => filtered.value.slice(page.value * 25, (page.value + 1) * 25));
const warehouseCandidates = computed(() => rows.value.filter(row => row.unit.status === 'in_stock' && row.classification === 'possible').length);
watch([query, category, classification, status], () => { page.value = 0; });
async function load() {
  controller?.abort(); controller = new AbortController(); const request = ++generation;
  const actor = auth.user?.id;
  rows.value = []; checkedAt.value = ''; error.value = ''; loading.value = true; page.value = 0;
  try {
    const result = await readInventoryReconciliation(supabase, auth.role, controller.signal);
    if (request !== generation || actor !== auth.user?.id) return;
    rows.value = result.rows; counts.value = result.counts; checkedAt.value = new Date().toISOString();
  } catch (e) { if (request === generation) error.value = getErrorMessage(e, 'No se pudo leer la conciliación'); }
  finally { if (request === generation) loading.value = false; }
}
watch(() => [auth.user?.id, auth.role], () => { generation++; controller?.abort(); rows.value = []; checkedAt.value = ''; loading.value = false; error.value = 'La sesión cambió. Vuelve a abrir el reporte.'; }, { flush: 'sync' });
onMounted(load);
onBeforeUnmount(() => { generation++; controller?.abort(); });
</script>

<template>
  <AppLayout>
    <router-link to="/inventario" class="text-sm text-sky-700">← Inventario</router-link>
    <div class="flex flex-wrap items-start justify-between gap-3 my-4">
      <div><h1 class="text-2xl font-semibold">Conciliación de equipos</h1><p class="text-sm text-slate-600 mt-1">Compara registros sin cambiar existencias ni ubicación.</p></div>
      <button class="btn-secondary" :disabled="loading" @click="load">Actualizar lectura</button>
    </div>
    <div class="surface p-4 mb-4 text-sm text-slate-600">
      <strong class="text-sky-700">Solo lectura.</strong> Una instalación finalizada no demuestra dónde está un equipo hoy.
      Las confirmaciones corresponden a vínculos vigentes del sistema; requieren conteo físico para confirmar existencias reales.
      <p class="mt-2">Las coincidencias de serie se comparan con el serial de ONT del cierre, únicamente para la categoría ONUs / ONTs. Las MAC permiten detectar duplicados entre unidades.</p>
      <p class="mt-2">También se compara contra cierres de avería (Soporte) resueltos o cerrados que registraron el serial de la ONT en sitio. Esa coincidencia puede indicar un reemplazo de equipo o solo una verificación durante la visita — nunca se marca como instalación confirmada por sí sola; siempre queda para revisión.</p>
    </div>
    <p v-if="error" role="alert" class="surface p-4 text-red-600 mb-4">{{ error }}. No se presenta un reporte parcial. Si falta acceso a una fuente, requiere revisión posterior; no se cambian permisos.</p>
    <p v-if="loading" class="py-8 text-center text-slate-500">Leyendo registros...</p>
    <template v-else-if="checkedAt">
      <div class="grid sm:grid-cols-3 gap-3 mb-4">
        <div class="surface p-4"><strong class="text-2xl">{{ rows.length }}</strong><p class="text-xs text-slate-500">Unidades físicas registradas (serializadas)</p></div>
        <div class="surface p-4"><strong class="text-2xl text-amber-700">{{ warehouseCandidates }}</strong><p class="text-xs text-slate-500">En almacén con señales por revisar</p></div>
        <div class="surface p-4"><p class="text-sm">{{ formatPeruDateTime(checkedAt) }} (Perú)</p><p class="text-xs text-slate-500">Lectura de {{ counts.installations }} altas y {{ counts.closures }} cierres de alta, {{ counts.tickets }} averías y {{ counts.ticketClosures }} cierres de avería con serial</p></div>
      </div>
      <div class="surface p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <label class="text-xs">Buscar serie, MAC, modelo o cliente<input v-model="query" class="field-input mt-1" placeholder="Buscar en el reporte" /></label>
        <label class="text-xs">Categoría<select v-model="category" class="field-input mt-1"><option value="">Todas las categorías</option><option v-for="[slug, name] in categories" :key="slug" :value="slug">{{ name }}</option></select></label>
        <label class="text-xs">Resultado<select v-model="classification" class="field-input mt-1"><option value="">Todos los resultados</option><option v-for="(label, value) in RECONCILIATION_LABELS" :key="value" :value="value">{{ label }}</option></select></label>
        <label class="text-xs">Ubicación registrada<select v-model="status" class="field-input mt-1"><option value="">Todos los estados</option><option v-for="(label, value) in UNIT_LOCATION_LABELS" :key="value" :value="value">{{ label }}</option></select></label>
      </div>
      <p class="text-xs text-slate-500 mb-3">{{ filtered.length }} resultados · Fuentes visibles para tu sesión, leídas en varias consultas; pueden cambiar mientras se consulta. No es un conteo físico ni una captura transaccional.</p>
      <div class="space-y-3">
        <article v-for="row in visible" :key="row.unit.id" class="surface p-4">
          <div class="flex flex-wrap justify-between gap-2">
            <div><h2 class="font-semibold text-sm">{{ row.unit.product?.name || 'Modelo no disponible' }}</h2><router-link :to="{ name: 'inventario-detalle', params: { id: row.unit.product_id }, query: { unit: row.unit.id, returnTo: '/inventario/conciliacion' } }" class="font-mono text-xs text-sky-700 underline">{{ row.unit.serial_number || row.unit.mac_address || 'Ver unidad y Kardex' }}</router-link><p v-if="row.unit.serial_number && row.unit.mac_address" class="font-mono text-xs text-slate-500">MAC {{ row.unit.mac_address }}</p></div>
            <span class="badge self-start" :class="row.classification === 'possible' ? 'bg-amber-100 text-amber-800' : row.classification === 'unknown' ? 'bg-slate-100 text-slate-600' : 'bg-sky-50 text-sky-700'">{{ RECONCILIATION_LABELS[row.classification] }}</span>
          </div>
          <p class="text-xs text-slate-500 mt-2">Estado registrado: {{ UNIT_LOCATION_LABELS[row.unit.status] || row.unit.status }}</p>
          <ul class="text-sm text-slate-600 mt-2 list-disc pl-5"><li v-for="reason in row.reasons" :key="reason">{{ reason }}</li></ul>
          <div class="text-xs mt-3 flex flex-wrap gap-3">
            <router-link v-if="row.unit.client_id && row.unit.clients?.id === row.unit.client_id" :to="`/clientes/${row.unit.client_id}`" class="text-sky-700 underline">Cliente vinculado: {{ row.unit.clients.first_name }} {{ row.unit.clients.last_name }}</router-link>
            <router-link v-if="row.unit.contract?.id === row.unit.contract_id && row.unit.client_id && row.unit.contract?.client_id === row.unit.client_id" :to="`/clientes/${row.unit.client_id}/servicios/${row.unit.contract_id}`" class="text-sky-700 underline">Contrato vinculado: {{ row.unit.contract?.contract_number || row.unit.contract_id }}</router-link>
            <router-link v-if="row.installation && row.installation.client_id === row.unit.client_id" :to="`/soporte/instalaciones/${row.installation.id}`" class="text-sky-700 underline">Orden vinculada: {{ row.installation.id }}</router-link>
            <router-link v-if="row.ticket && row.ticket.client_id === row.unit.client_id" :to="`/soporte/${row.ticket.id}`" class="text-sky-700 underline">Avería vinculada: {{ row.ticket.id }}</router-link>
            <span v-else-if="row.unit.ticket_id" class="text-amber-700">Avería vinculada sin confirmar: cliente/contrato no coincide — revisar manualmente.</span>
            <span v-if="row.unit.custody_technician_id && row.unit.technician?.id === row.unit.custody_technician_id">Técnico vinculado: {{ row.unit.technician.full_name || row.unit.technician.email || 'Nombre no disponible' }}</span>
          </div>
        </article>
        <p v-if="!filtered.length" class="surface p-6 text-center text-slate-500">No hay unidades que coincidan con los filtros.</p>
      </div>
      <div class="flex justify-between items-center gap-2 mt-4 text-xs"><button class="btn-secondary" :disabled="page === 0" @click="page--">Anterior</button><span>Página {{ page + 1 }} de {{ Math.max(1, Math.ceil(filtered.length / 25)) }}</span><button class="btn-secondary" :disabled="(page + 1) * 25 >= filtered.length" @click="page++">Siguiente</button></div>
    </template>
  </AppLayout>
</template>
