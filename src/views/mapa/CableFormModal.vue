<script setup lang="ts">
import { ref } from 'vue';
import { FO_HILOS_TOTAL_OPCIONES } from '@/types/domain';
import type { FoCable, FoCableTipo, InfraElemento, LatLngPoint } from '@/types/domain';
import type { OltDevice } from '@/stores/olt';
import { useConfirm } from '@/composables/useConfirm';

const props = defineProps<{
  canDelete?: boolean;
  deleting?: boolean;
  cable?: FoCable | null;
  path?: LatLngPoint[];
  defaultTipo?: FoCableTipo;
  metrajeSugerido?: number | null;
  infraElementos: InfraElemento[];
  oltDevices: OltDevice[];
}>();

const emit = defineEmits<{
  save: [payload: Record<string, unknown>];
  cancel: [];
  delete: [];
}>();

type ExtremoValue = '' | `olt:${string}` | `infra:${string}`;

function extremoInicial(oltId: string | null | undefined, infraId: string | null | undefined): ExtremoValue {
  if (oltId) return `olt:${oltId}`;
  if (infraId) return `infra:${infraId}`;
  return '';
}

const form = ref({
  codigo: props.cable?.codigo ?? '',
  tipo: props.cable?.tipo ?? props.defaultTipo ?? 'ramal',
  hilos_total: props.cable?.hilos_total ?? 12,
  metraje: props.cable?.metraje ?? props.metrajeSugerido ?? null,
  origen: extremoInicial(props.cable?.origen_olt_id, props.cable?.origen_infra_id),
  destino: extremoInicial(props.cable?.destino_olt_id, props.cable?.destino_infra_id),
  notes: props.cable?.notes ?? '',
});
const saving = ref(false);
const error = ref<string | null>(null);

function parseExtremo(v: ExtremoValue) {
  if (v.startsWith('olt:')) return { olt_id: v.slice(4), infra_id: null };
  if (v.startsWith('infra:')) return { olt_id: null, infra_id: v.slice(6) };
  return { olt_id: null, infra_id: null };
}

// Mismo patron que elementoNombre() en RedMapView.vue / nombreExtremo() en
// CableHilosModal.vue -- resuelve el nombre REAL a partir de los datos ya
// cargados (props.oltDevices/props.infraElementos), nunca por cercania.
function nombreDe(oltId: string | null, infraId: string | null): string {
  if (oltId) return props.oltDevices.find((o) => o.id === oltId)?.name ?? 'OLT';
  if (infraId) return props.infraElementos.find((e) => e.id === infraId)?.name ?? 'Elemento';
  return 'Sin definir';
}

async function submit() {
  error.value = null;
  if (!form.value.codigo.trim()) {
    error.value = 'El código del cable es obligatorio.';
    return;
  }
  const origen = parseExtremo(form.value.origen as ExtremoValue);
  const destino = parseExtremo(form.value.destino as ExtremoValue);

  // Desvincular un extremo YA conectado (pasar a "Sin definir") exige
  // SUPERADMIN y confirmacion explicita -- el servidor (trigger
  // guard_cable_endpoint_unlink) lo exige igual, con o sin esto; esto solo
  // evita un intento fallido confuso y explica, en lenguaje simple, que se
  // desvincula y que permanece intacto. Reasignar a OTRO elemento real
  // (ninguno de los dos queda vacio) no entra aqui: no es una
  // desvinculacion, sigue disponible para el mismo personal de siempre.
  const unlinkingOrigen = !!(props.cable?.origen_olt_id || props.cable?.origen_infra_id) && !origen.olt_id && !origen.infra_id;
  const unlinkingDestino = !!(props.cable?.destino_olt_id || props.cable?.destino_infra_id) && !destino.olt_id && !destino.infra_id;
  if (unlinkingOrigen || unlinkingDestino) {
    if (!props.canDelete) {
      error.value = 'Solo un SUPERADMIN puede desvincular un extremo ya conectado.';
      return;
    }
    const partes: string[] = [];
    if (unlinkingOrigen) partes.push(`origen (actualmente "${nombreDe(props.cable!.origen_olt_id, props.cable!.origen_infra_id)}")`);
    if (unlinkingDestino) partes.push(`destino (actualmente "${nombreDe(props.cable!.destino_olt_id, props.cable!.destino_infra_id)}")`);
    const ok = await useConfirm().confirmDialog({
      title: 'Desvincular extremo conectado',
      message: `Vas a desvincular el ${partes.join(' y el ')} de este cable.\nEl cable, su trazado, hilos, fusiones e historial permanecen intactos.\nLa caja/OLT y sus clientes, contratos u órdenes NO se modifican — solo deja de estar marcada como extremo de este cable.\nDespués podrás mover ese extremo libremente desde "Editar trazado".`,
      wrapMessage: true,
      warning: true,
      focusCancel: true,
      confirmLabel: 'Desvincular',
    });
    if (!ok) return;
  }

  saving.value = true;
  try {
    emit('save', {
      codigo: form.value.codigo.trim(),
      tipo: form.value.tipo,
      hilos_total: form.value.hilos_total,
      metraje: form.value.metraje,
      notes: form.value.notes || null,
      origen_olt_id: origen.olt_id,
      origen_infra_id: origen.infra_id,
      destino_olt_id: destino.olt_id,
      destino_infra_id: destino.infra_id,
      ...(props.path ? { path: props.path } : {}),
    });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" style="z-index: 2100" @click.self="emit('cancel')">
      <form class="w-full max-w-lg modal-panel max-h-[90vh] overflow-y-auto" @submit.prevent="submit">
        <h2 class="text-lg font-semibold mb-4">{{ cable ? 'Editar cable' : 'Nuevo tendido de fibra' }}</h2>

        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="field-label">Código / nombre del tramo</label>
            <input v-model="form.codigo" required placeholder="ej. TR-OLT01-NAP04" class="field-input" />
          </div>
          <div>
            <label class="field-label">Tipo</label>
            <select v-model="form.tipo" class="field-input">
              <option value="troncal">Troncal</option>
              <option value="ramal">Ramal / distribución</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="field-label">Capacidad (hilos)</label>
            <select v-model.number="form.hilos_total" class="field-input">
              <option v-for="n in FO_HILOS_TOTAL_OPCIONES" :key="n" :value="n">{{ n }} FO</option>
            </select>
          </div>
          <div>
            <label class="field-label">Metraje (m)</label>
            <input v-model.number="form.metraje" type="number" min="0" step="1" placeholder="Automático desde el trazo" class="field-input" />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="field-label">Origen</label>
            <select v-model="form.origen" class="field-input">
              <option value="">— Sin definir —</option>
              <optgroup label="OLT">
                <option v-for="o in oltDevices" :key="o.id" :value="`olt:${o.id}`">{{ o.name }}</option>
              </optgroup>
              <optgroup label="Elementos pasivos">
                <option v-for="e in infraElementos" :key="e.id" :value="`infra:${e.id}`">{{ e.name }}</option>
              </optgroup>
            </select>
          </div>
          <div>
            <label class="field-label">Destino</label>
            <select v-model="form.destino" class="field-input">
              <option value="">— Sin definir —</option>
              <optgroup label="OLT">
                <option v-for="o in oltDevices" :key="o.id" :value="`olt:${o.id}`">{{ o.name }}</option>
              </optgroup>
              <optgroup label="Elementos pasivos">
                <option v-for="e in infraElementos" :key="e.id" :value="`infra:${e.id}`">{{ e.name }}</option>
              </optgroup>
            </select>
          </div>
        </div>

        <p class="text-xs text-slate-500 mb-3">
          El origen/destino define la continuidad óptica: es lo que permite trazar la ruta de un hilo desde la OLT hasta el cliente.
        </p>

        <div class="mb-4">
          <label class="field-label">Notas</label>
          <textarea v-model="form.notes" rows="2" class="field-input"></textarea>
        </div>

        <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>

        <div class="flex justify-between gap-2">
          <button v-if="cable && canDelete" type="button" class="text-red-600 hover:underline text-xs" :disabled="saving || deleting" @click="emit('delete')">
            Eliminar cable
          </button>
          <div class="flex gap-2 ml-auto">
            <button type="button" class="btn-ghost" @click="emit('cancel')">Cancelar</button>
            <button type="submit" :disabled="saving || !form.codigo" class="btn-primary">
              {{ saving ? 'Guardando...' : 'Guardar' }}
            </button>
          </div>
        </div>
      </form>
    </div>
  </Teleport>
</template>
