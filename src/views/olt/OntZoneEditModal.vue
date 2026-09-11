<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useOltStore, type OltOnt } from '@/stores/olt';
import { useCatalogsStore } from '@/stores/catalogs';
import { getErrorMessage } from '@/lib/errors';

// Replica el panel de edicion de zona/splitter/contacto de SmartOLT (ver
// captura de referencia): permite anotar topologia fisica y datos de
// contacto directo en la ONT sin necesitar un alta formal de cliente.
const props = defineProps<{ ont: OltOnt; deviceId: string }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const oltStore = useOltStore();
const catalogsStore = useCatalogsStore();

const form = ref({
  zone_id: props.ont.zone_id ?? '',
  splitter: props.ont.splitter ?? '',
  splitter_port: props.ont.splitter_port ?? '',
  description: props.ont.description ?? '',
  address_comment: props.ont.address_comment ?? '',
  contact: props.ont.contact ?? '',
  latitude: props.ont.latitude != null ? String(props.ont.latitude) : '',
  longitude: props.ont.longitude != null ? String(props.ont.longitude) : '',
});

const saving = ref(false);
const error = ref<string | null>(null);

const newZoneName = ref('');
const creatingZone = ref(false);

const mapUrl = computed(() => {
  if (!form.value.latitude || !form.value.longitude) return null;
  return `https://www.google.com/maps?q=${form.value.latitude},${form.value.longitude}`;
});

onMounted(() => {
  if (!catalogsStore.zones.length) catalogsStore.fetchZones();
});

async function handleCreateZone() {
  const name = newZoneName.value.trim();
  if (!name) return;
  creatingZone.value = true;
  try {
    const zone = await catalogsStore.createZone(name);
    form.value.zone_id = zone.id;
    newZoneName.value = '';
  } catch (e) {
    error.value = getErrorMessage(e, 'Error al crear la zona');
  } finally {
    creatingZone.value = false;
  }
}

async function handleSave() {
  saving.value = true;
  error.value = null;
  try {
    await oltStore.updateOntMeta(props.deviceId, props.ont.id, {
      zone_id: form.value.zone_id || null,
      splitter: form.value.splitter || null,
      splitter_port: form.value.splitter_port || null,
      description: form.value.description || null,
      address_comment: form.value.address_comment || null,
      contact: form.value.contact || null,
      latitude: form.value.latitude ? Number(form.value.latitude) : null,
      longitude: form.value.longitude ? Number(form.value.longitude) : null,
    });
    emit('saved');
  } catch (e) {
    error.value = getErrorMessage(e, 'Error al guardar');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <form class="w-full max-w-md modal-panel" @submit.prevent="handleSave">
        <h2 class="text-lg font-semibold mb-1">Zona y topología</h2>
        <p class="text-xs text-slate-500 mb-4 font-mono">{{ ont.serial }}</p>

        <div class="space-y-3">
          <div>
            <label class="field-label">Zona</label>
            <select v-model="form.zone_id" class="field-input">
              <option value="">Sin zona</option>
              <option v-for="z in catalogsStore.zones" :key="z.id" :value="z.id">{{ z.name }}</option>
            </select>
            <div class="flex gap-2 mt-1.5">
              <input v-model="newZoneName" placeholder="Nueva zona..." class="field-input text-xs py-1.5" />
              <button
                type="button"
                class="text-xs text-sky-400 hover:underline whitespace-nowrap"
                :disabled="!newZoneName.trim() || creatingZone"
                @click="handleCreateZone"
              >
                {{ creatingZone ? 'Creando...' : '+ Crear' }}
              </button>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="field-label">Splitter</label>
              <input v-model="form.splitter" placeholder="ej. nap 2" class="field-input" />
            </div>
            <div>
              <label class="field-label">Puerto del splitter</label>
              <input v-model="form.splitter_port" class="field-input" />
            </div>
          </div>

          <div>
            <label class="field-label">Nombre</label>
            <input v-model="form.description" class="field-input" />
          </div>

          <div>
            <label class="field-label">Dirección o comentario</label>
            <input v-model="form.address_comment" class="field-input" />
          </div>

          <div>
            <label class="field-label">Contacto</label>
            <input v-model="form.contact" class="field-input" />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="field-label">Latitud</label>
              <input v-model="form.latitude" type="text" inputmode="decimal" class="field-input" />
            </div>
            <div>
              <label class="field-label">Longitud</label>
              <input v-model="form.longitude" type="text" inputmode="decimal" class="field-input" />
            </div>
          </div>

          <a v-if="mapUrl" :href="mapUrl" target="_blank" rel="noopener" class="text-xs text-sky-400 hover:underline block text-right">
            Mapa »
          </a>
        </div>

        <p v-if="error" class="text-sm text-red-400 mt-4">{{ error }}</p>

        <div class="flex justify-end gap-2 mt-5">
          <button type="button" class="btn-ghost" @click="emit('close')">Cerrar</button>
          <button type="submit" :disabled="saving" class="btn-primary">
            {{ saving ? 'Guardando...' : 'Actualizar' }}
          </button>
        </div>
      </form>
    </div>
  </Teleport>
</template>
