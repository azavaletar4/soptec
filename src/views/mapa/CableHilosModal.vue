<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import HiloGrid from './HiloGrid.vue';
import { useFoFibraStore } from '@/stores/foFibra';
import { ubicarHilo, HILO_ESTADO_LABEL } from '@/lib/fiberColors';
import type { FoCable, FoHiloEstadoTipo, InfraElemento } from '@/types/domain';
import type { OltDevice } from '@/stores/olt';
import { getErrorMessage } from '@/lib/errors';
import { confirmMapRemoval } from '@/lib/mapPassiveDeletion';
import { useToast } from '@/composables/useToast';

const props = defineProps<{
  canDelete?: boolean;
  deleting?: boolean;
  cable: FoCable;
  infraElementos: InfraElemento[];
  oltDevices: OltDevice[];
}>();

const emit = defineEmits<{
  close: [];
  edit: [];
  delete: [];
  changed: [];
  'open-splice': [infraElementoId: string];
}>();

const fibra = useFoFibraStore();
const loading = ref(true);
const selected = ref<number | null>(null);
const error = ref<string | null>(null);
const deletingHilo = ref(false);
const retired = computed(() => new Set((fibra.hiloEstadosPorCable[props.cable.id] ?? []).filter(h => h.map_removed_at).map(h => h.hilo_index)));

const estadosMap = computed<Record<number, FoHiloEstadoTipo>>(() => {
  const rows = fibra.hiloEstadosPorCable[props.cable.id] ?? [];
  return Object.fromEntries(rows.map((r) => [r.hilo_index, r.estado]));
});

function nombreExtremo(oltId: string | null, infraId: string | null): string {
  if (oltId) return props.oltDevices.find((o) => o.id === oltId)?.name ?? 'OLT';
  if (infraId) return props.infraElementos.find((e) => e.id === infraId)?.name ?? 'Elemento';
  return 'Sin definir';
}

const origenNombre = computed(() => nombreExtremo(props.cable.origen_olt_id, props.cable.origen_infra_id));
const destinoNombre = computed(() => nombreExtremo(props.cable.destino_olt_id, props.cable.destino_infra_id));

const selectedUbicacion = computed(() => (selected.value ? ubicarHilo(selected.value) : null));

onMounted(async () => {
  try {
    await fibra.fetchHiloEstados(props.cable.id);
  } finally {
    loading.value = false;
  }
});

async function marcarEstado(estado: FoHiloEstadoTipo) {
  if (!selected.value) return;
  try {
    await fibra.setHiloEstado(props.cable.id, selected.value, estado);
  } catch (e) {
    error.value = getErrorMessage(e, 'No se pudo actualizar el hilo');
  }
}

async function eliminarHilo() {
  if (!props.canDelete || !selected.value || deletingHilo.value) return;
  const hilo = selected.value;
  deletingHilo.value = true;
  error.value = null;
  try {
    const preview = await confirmMapRemoval('hilo', props.cable.id, `hilo ${hilo} de ${props.cable.codigo}`, hilo);
    if (!preview) return;
    await fibra.deleteHilo(props.cable.id, hilo, preview);
    selected.value = null;
    emit('changed');
    useToast().success('Hilo retirado del mapa. Se conservaron la numeración y las referencias históricas.');
  } catch (e) {
    error.value = getErrorMessage(e, 'No se pudo eliminar el hilo');
  } finally {
    deletingHilo.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" style="z-index: 2100" @click.self="emit('close')">
      <div class="w-full max-w-2xl modal-panel max-h-[90vh] overflow-y-auto">
        <div class="flex items-start justify-between mb-1">
          <div>
            <h2 class="text-lg font-semibold">{{ cable.codigo }}</h2>
            <p class="text-xs text-slate-500 mt-0.5">
              {{ cable.tipo === 'troncal' ? 'Cable troncal' : 'Cable ramal / distribución' }} · {{ cable.hilos_total }} FO
              <span v-if="cable.metraje"> · {{ cable.metraje }} m</span>
            </p>
          </div>
          <button class="text-slate-500 hover:text-slate-900" @click="emit('close')">✕</button>
        </div>

        <div class="flex items-center gap-2 text-xs text-slate-600 mb-4">
          <button class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200" @click="cable.origen_infra_id && emit('open-splice', cable.origen_infra_id)">
            📍 {{ origenNombre }}
          </button>
          <span>→</span>
          <button class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200" @click="cable.destino_infra_id && emit('open-splice', cable.destino_infra_id)">
            📍 {{ destinoNombre }}
          </button>
          <button class="ml-auto btn-secondary text-xs" @click="emit('edit')">Editar cable</button>
          <button v-if="canDelete" class="text-red-600 hover:underline text-xs" :disabled="deleting" @click="emit('delete')">Eliminar</button>
        </div>

        <div v-if="loading" class="text-sm text-slate-500 py-6 text-center">Cargando hilos…</div>
        <template v-else>
          <HiloGrid :hilos-total="cable.hilos_total" :retired="retired" :estados="estadosMap" :selected="selected" @select="selected = $event" />

          <div v-if="selectedUbicacion" class="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <p class="font-medium mb-2">
              Hilo {{ selectedUbicacion.hiloIndex }} — Tubo {{ selectedUbicacion.tuboNumero }} ({{ selectedUbicacion.tuboColor.name }}) · Color de hilo:
              {{ selectedUbicacion.hiloColor.name }}
            </p>
            <div class="flex flex-wrap gap-1.5">
              <button v-if="canDelete" type="button" class="text-red-600 hover:underline text-xs" :disabled="deletingHilo || deleting" @click="eliminarHilo">Eliminar hilo del mapa</button>
              <button
                v-for="(label, estado) in HILO_ESTADO_LABEL"
                :key="estado"
                class="px-2 py-1 rounded text-xs"
                :class="estadosMap[selectedUbicacion.hiloIndex] === estado ? 'bg-sky-500 text-slate-950' : 'bg-slate-100 hover:bg-slate-200'"
                @click="marcarEstado(estado as FoHiloEstadoTipo)"
              >
                {{ label }}
              </button>
            </div>
          </div>

          <p v-if="error" class="text-sm text-red-600 mt-3">{{ error }}</p>

          <p class="text-xs text-slate-500 mt-4">
            Para ver las fusiones/empalmes de este hilo con otros cables, abre la caja de origen o destino (📍 arriba).
          </p>
        </template>
      </div>
    </div>
  </Teleport>
</template>
