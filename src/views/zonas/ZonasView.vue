<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useCatalogsStore } from '@/stores/catalogs';
import { useClientsStore } from '@/stores/clients';
import { getErrorMessage } from '@/lib/errors';
import { ZONE_CLIENT_LIMIT, type Zone } from '@/types/domain';

const catalogs = useCatalogsStore();
const clientsStore = useClientsStore();

onMounted(async () => {
  await Promise.all([catalogs.fetchZones(), clientsStore.fetchClients()]);
});

const zonesWithCount = computed(() =>
  catalogs.zones
    .map((z) => ({
      zone: z,
      count: clientsStore.clients.filter((c) => c.zone_id === z.id).length,
    }))
    .sort((a, b) => b.count - a.count),
);

const zonesAtLimit = computed(() => zonesWithCount.value.filter((z) => z.count >= ZONE_CLIENT_LIMIT));

function fillClass(count: number) {
  if (count >= ZONE_CLIENT_LIMIT) return 'bg-red-500/15 text-red-600';
  if (count >= ZONE_CLIENT_LIMIT * 0.9) return 'bg-amber-500/15 text-amber-600';
  return 'bg-green-500/15 text-green-600';
}

const showModal = ref(false);
const editing = ref<Zone | null>(null);
const saving = ref(false);
const formError = ref<string | null>(null);
const form = ref({ name: '', description: '' });

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
  if (!editing.value) return;
  saving.value = true;
  formError.value = null;
  try {
    await catalogs.updateZone(editing.value.id, {
      name: form.value.name.trim(),
      description: form.value.description.trim() || null,
    });
    showModal.value = false;
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al guardar la zona');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Zonas</h1>
        <p class="text-slate-600 text-sm mt-1">
          {{ zonesWithCount.length }} zonas · límite de {{ ZONE_CLIENT_LIMIT }} clientes por zona
        </p>
      </div>
    </div>

    <p v-if="zonesAtLimit.length" class="mb-4 text-sm text-red-600">
      ⚠ {{ zonesAtLimit.length }} zona(s) llegaron al límite de {{ ZONE_CLIENT_LIMIT }} clientes:
      {{ zonesAtLimit.map((z) => z.zone.name).join(', ') }}. No se podrán asignar más clientes ahí hasta liberar
      cupo.
    </p>

    <div class="table-shell mb-6">
      <table class="w-full text-sm min-w-[640px]">
        <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-3">Zona</th>
            <th class="text-left px-4 py-3">Descripción</th>
            <th class="text-left px-4 py-3">Clientes</th>
            <th class="text-right px-4 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!zonesWithCount.length">
            <td colspan="4" class="px-4 py-6 text-center text-slate-500">No hay zonas registradas.</td>
          </tr>
          <tr v-for="z in zonesWithCount" :key="z.zone.id" class="border-t border-slate-200 hover:bg-slate-50">
            <td class="px-4 py-3 font-medium text-slate-900">{{ z.zone.name }}</td>
            <td class="px-4 py-3 text-slate-600">{{ z.zone.description || '—' }}</td>
            <td class="px-4 py-3">
              <span class="badge" :class="fillClass(z.count)">{{ z.count }} / {{ ZONE_CLIENT_LIMIT }}</span>
            </td>
            <td class="px-4 py-3 text-right">
              <button class="text-slate-600 hover:text-slate-900 text-xs" @click="openEdit(z.zone)">Editar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="text-xs text-slate-400">
      Las zonas nuevas se crean desde el formulario de cliente ("+ Nueva zona"). Aquí puedes renombrarlas o editar su
      descripción.
    </p>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay">
        <form class="w-full max-w-md modal-panel" @submit.prevent="handleSubmit">
          <h2 class="text-lg font-semibold mb-3">Editar zona</h2>

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
