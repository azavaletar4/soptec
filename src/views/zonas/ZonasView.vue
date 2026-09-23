<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useCatalogsStore } from '@/stores/catalogs';
import { useClientsStore } from '@/stores/clients';
import { useInfraElementosStore } from '@/stores/infraElementos';
import { useFoFibraStore } from '@/stores/foFibra';
import { getErrorMessage } from '@/lib/errors';
import { NAP_CLIENT_LIMIT, ZONE_CLIENT_LIMIT, ZONE_NAP_LIMIT, type Zone } from '@/types/domain';

const catalogs = useCatalogsStore();
const clientsStore = useClientsStore();
const infraStore = useInfraElementosStore();
const fibra = useFoFibraStore();

onMounted(async () => {
  await Promise.all([
    catalogs.fetchZones(),
    clientsStore.fetchClients(),
    infraStore.fetchElementos(),
    fibra.fetchTodosNapPuertos(),
  ]);
});

const search = ref('');

function fillClass(count: number, limit: number) {
  if (count >= limit) return 'bg-red-500/15 text-red-600';
  if (count >= limit * 0.9) return 'bg-amber-500/15 text-amber-600';
  return 'bg-green-500/15 text-green-600';
}

// Distribucion por cajas NAP: cada caja NAP (infra_elementos.tipo = 'caja_nap')
// puede asignarse a una zona (ver /mapa/red); la ocupacion sale de
// fo_nap_puertos, que ya queda sincronizada con el cliente asignado en cada
// puerto (modulo de fibra optica), sin duplicar el dato aca.
const napsByZone = computed(() => {
  const byZone: Record<string, ReturnType<typeof buildNap>[]> = {};
  for (const el of infraStore.elementos) {
    if (el.tipo !== 'caja_nap' || !el.zone_id) continue;
    (byZone[el.zone_id] ??= []).push(buildNap(el));
  }
  for (const zoneId in byZone) {
    byZone[zoneId].sort((a, b) => b.used - a.used || a.name.localeCompare(b.name));
  }
  return byZone;

  function buildNap(el: (typeof infraStore.elementos)[number]) {
    const puertos = fibra.napPuertosPorElemento[el.id] ?? [];
    const ocupados = puertos.filter((p) => p.estado === 'ocupado' && p.client_id);
    const capacity = el.puertos_total ?? NAP_CLIENT_LIMIT;
    const clients = ocupados
      .map((p) => ({
        id: p.client_id as string,
        name: p.clients ? `${p.clients.first_name} ${p.clients.last_name}`.trim() : 'Cliente',
        puerto: p.puerto_numero,
      }))
      .sort((a, b) => a.puerto - b.puerto);
    return { id: el.id, name: el.name, used: ocupados.length, capacity, clients };
  }
});

// La busqueda encuentra tanto por nombre de zona como por nombre de caja NAP
// (referencia rapida: "en que zona/clientes esta la NAP X"), expandiendo
// automaticamente las zonas que coincidan mientras se escribe.
const zonesWithCount = computed(() => {
  const q = search.value.trim().toLowerCase();
  return catalogs.zones
    .map((z) => ({
      zone: z,
      count: clientsStore.clients.filter((c) => c.zone_id === z.id).length,
      naps: napsByZone.value[z.id] ?? [],
    }))
    .filter((z) => !q || z.zone.name.toLowerCase().includes(q) || z.naps.some((n) => n.name.toLowerCase().includes(q)))
    .sort((a, b) => b.count - a.count);
});

const zonesAtLimit = computed(() => zonesWithCount.value.filter((z) => z.count >= ZONE_CLIENT_LIMIT));

const napsAtLimit = computed(() =>
  zonesWithCount.value.flatMap((z) => z.naps.filter((n) => n.used >= n.capacity).map((n) => ({ zone: z.zone.name, nap: n.name }))),
);

const expanded = ref<Record<string, boolean>>({});
function toggleExpanded(zoneId: string) {
  expanded.value[zoneId] = !expanded.value[zoneId];
}
function isExpanded(zoneId: string) {
  return search.value.trim() ? true : !!expanded.value[zoneId];
}

const showModal = ref(false);
const editing = ref<Zone | null>(null);
const saving = ref(false);
const formError = ref<string | null>(null);
const form = ref({ name: '', description: '' });

function openCreate() {
  editing.value = null;
  form.value = { name: '', description: '' };
  formError.value = null;
  showModal.value = true;
}

function openEdit(zone: Zone) {
  editing.value = zone;
  form.value = { name: zone.name, description: zone.description ?? '' };
  formError.value = null;
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
}

async function handleSubmit() {
  saving.value = true;
  formError.value = null;
  try {
    const name = form.value.name.trim();
    const description = form.value.description.trim() || null;
    if (editing.value) {
      await catalogs.updateZone(editing.value.id, { name, description });
    } else {
      await catalogs.createZone(name, description);
    }
    showModal.value = false;
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al guardar la zona');
  } finally {
    saving.value = false;
  }
}

async function handleDelete(zone: Zone) {
  const ok = confirm(`¿Eliminar la zona "${zone.name}"? Esta acción no se puede deshacer.`);
  if (!ok) return;
  try {
    await catalogs.deleteZone(zone.id);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al eliminar la zona'));
  }
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Zonas</h1>
        <p class="text-slate-600 text-sm mt-1">
          {{ zonesWithCount.length }} zonas · límite de {{ ZONE_CLIENT_LIMIT }} clientes por zona · máx.
          {{ ZONE_NAP_LIMIT }} cajas NAP por zona · máx. {{ NAP_CLIENT_LIMIT }} clientes por NAP
        </p>
      </div>
      <button class="btn-primary" @click="openCreate()">+ Agregar zona</button>
    </div>

    <div class="mb-4 max-w-xs">
      <label class="field-label">Buscar</label>
      <input v-model="search" class="field-input" placeholder="Nombre de zona o de caja NAP" />
    </div>

    <p class="mb-4 text-xs text-slate-500">
      Utilice zonas para agrupar a los clientes por ciudad, barrio o pueblo. Despliegue una zona para ver sus cajas
      NAP, cuántos clientes tiene cada una y cuáles son (asignados desde el mapa de fibra en /mapa/red). Buscar por
      el nombre de una NAP expande directamente la zona donde está.
    </p>

    <p v-if="zonesAtLimit.length" class="mb-2 text-sm text-red-600">
      ⚠ {{ zonesAtLimit.length }} zona(s) llegaron al límite de {{ ZONE_CLIENT_LIMIT }} clientes:
      {{ zonesAtLimit.map((z) => z.zone.name).join(', ') }}. No se podrán asignar más clientes ahí hasta liberar
      cupo.
    </p>

    <p v-if="napsAtLimit.length" class="mb-4 text-sm text-red-600">
      ⚠ {{ napsAtLimit.length }} caja(s) NAP llenas ({{ NAP_CLIENT_LIMIT }} clientes):
      {{ napsAtLimit.map((n) => `${n.nap} (${n.zone})`).join(', ') }}.
    </p>

    <div class="table-shell mb-6">
      <table class="w-full text-sm min-w-[560px]">
        <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-3">Nombre</th>
            <th class="text-left px-4 py-3">Carga</th>
            <th class="text-left px-4 py-3">Cajas NAP</th>
            <th class="text-right px-4 py-3">Acción</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!zonesWithCount.length">
            <td colspan="4" class="px-4 py-6 text-center text-slate-500">No hay zonas registradas.</td>
          </tr>
          <template v-for="z in zonesWithCount" :key="z.zone.id">
            <tr class="border-t border-slate-200 hover:bg-slate-50">
              <td class="px-4 py-3 font-medium text-slate-900">{{ z.zone.name }}</td>
              <td class="px-4 py-3">
                <span class="badge" :class="fillClass(z.count, ZONE_CLIENT_LIMIT)">{{ z.count }} / {{ ZONE_CLIENT_LIMIT }}</span>
              </td>
              <td class="px-4 py-3">
                <button
                  v-if="z.naps.length"
                  class="inline-flex items-center gap-1 text-xs text-sky-600 hover:underline"
                  @click="toggleExpanded(z.zone.id)"
                >
                  <span>{{ isExpanded(z.zone.id) ? '▾' : '▸' }}</span>
                  {{ z.naps.length }} / {{ ZONE_NAP_LIMIT }} NAPs
                </button>
                <span v-else class="text-xs text-slate-400">Sin cajas NAP asignadas</span>
              </td>
              <td class="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                <button class="text-slate-600 hover:text-slate-900 text-xs" @click="openEdit(z.zone)">Editar</button>
                <button class="text-red-500/80 hover:text-red-600 text-xs" @click="handleDelete(z.zone)">Borrar</button>
              </td>
            </tr>
            <tr v-if="isExpanded(z.zone.id) && z.naps.length" class="border-t border-slate-100 bg-slate-50/60">
              <td colspan="4" class="px-4 py-3">
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  <div v-for="n in z.naps" :key="n.id" class="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <div class="flex items-center justify-between gap-2 mb-1.5">
                      <span class="text-xs font-medium text-slate-700 truncate" :title="n.name">{{ n.name }}</span>
                      <span class="badge shrink-0" :class="fillClass(n.used, n.capacity)">{{ n.used }} / {{ n.capacity }}</span>
                    </div>
                    <ul v-if="n.clients.length" class="space-y-0.5 max-h-28 overflow-y-auto">
                      <li v-for="c in n.clients" :key="c.id">
                        <router-link
                          :to="`/clientes/${c.id}`"
                          class="block truncate text-xs text-sky-600 hover:underline"
                          :title="c.name"
                        >
                          {{ c.name }}
                        </router-link>
                      </li>
                    </ul>
                    <p v-else class="text-xs text-slate-400">Sin clientes asignados</p>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay">
        <form class="w-full max-w-md modal-panel" @submit.prevent="handleSubmit">
          <h2 class="text-lg font-semibold mb-3">{{ editing ? 'Editar zona' : 'Nueva zona' }}</h2>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Nombre</label>
            <input v-model="form.name" required class="field-input" />
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Descripción</label>
            <textarea v-model="form.description" rows="2" class="field-input" />
          </div>

          <p v-if="formError" class="text-sm text-red-600 mb-3">{{ formError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-secondary" @click="closeModal">Cancelar</button>
            <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? 'Guardando...' : 'Guardar' }}</button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
