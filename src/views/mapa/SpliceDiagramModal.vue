<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import HiloGrid from './HiloGrid.vue';
import { useFoFibraStore } from '@/stores/foFibra';
import type { TraceResult } from '@/stores/foFibra';
import { useContractsStore } from '@/stores/contracts';
import { ubicarHilo } from '@/lib/fiberColors';
import type { Client, FoCable, FoFusionDestinoTipo, InfraElemento, ServiceContract } from '@/types/domain';
import { getErrorMessage } from '@/lib/errors';

const props = defineProps<{
  elemento: InfraElemento;
  cables: FoCable[];
  clients: Client[];
  /** Oculta la pestaña de empalmes/fusiones (usado en el Mapa de Clientes: solo gestión de puertos). */
  soloPuertos?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  'trace-result': [result: TraceResult | null];
}>();

const fibra = useFoFibraStore();
const contractsStore = useContractsStore();
const tab = ref<'fusiones' | 'puertos'>(props.soloPuertos ? 'puertos' : 'fusiones');
const error = ref<string | null>(null);
const saving = ref(false);

const cablesAqui = computed(() =>
  props.cables.filter((c) => c.origen_infra_id === props.elemento.id || c.destino_infra_id === props.elemento.id),
);
const fusionesAqui = computed(() => fibra.fusiones.filter((f) => f.infra_elemento_id === props.elemento.id));

// ---- Constructor de fusión ----
const cableAId = ref<string>('');
const hiloA = ref<number | null>(null);
const destinoTipo = ref<FoFusionDestinoTipo>('cable');
const cableBId = ref<string>('');
const hiloB = ref<number | null>(null);
const puertoNap = ref<number | null>(null);

const cableA = computed(() => cablesAqui.value.find((c) => c.id === cableAId.value) ?? null);
const cableB = computed(() => cablesAqui.value.find((c) => c.id === cableBId.value) ?? null);

function fusionadoLabel(f: (typeof fusionesAqui.value)[number]): string {
  const cableA = props.cables.find((c) => c.id === f.cable_a_id);
  const base = `${cableA?.codigo ?? '?'} · hilo ${f.hilo_a_index}`;
  if (f.destino_tipo === 'cable') {
    const cb = props.cables.find((c) => c.id === f.cable_b_id);
    return `${base}  ⇄  ${cb?.codigo ?? '?'} · hilo ${f.hilo_b_index}`;
  }
  if (f.destino_tipo === 'splitter_out') return `${base}  →  Puerto NAP #${f.puerto_nap}`;
  return `${base}  →  Terminado`;
}

async function crearFusion() {
  error.value = null;
  if (!cableAId.value || !hiloA.value) {
    error.value = 'Selecciona el cable y el hilo de entrada.';
    return;
  }
  if (destinoTipo.value === 'cable' && (!cableBId.value || !hiloB.value)) {
    error.value = 'Selecciona el cable y el hilo de salida.';
    return;
  }
  if (destinoTipo.value === 'splitter_out' && !puertoNap.value) {
    error.value = 'Indica el número de puerto NAP.';
    return;
  }
  saving.value = true;
  try {
    await fibra.createFusion({
      infra_elemento_id: props.elemento.id,
      cable_a_id: cableAId.value,
      hilo_a_index: hiloA.value,
      destino_tipo: destinoTipo.value,
      cable_b_id: destinoTipo.value === 'cable' ? cableBId.value : null,
      hilo_b_index: destinoTipo.value === 'cable' ? hiloB.value : null,
      puerto_nap: destinoTipo.value === 'splitter_out' ? puertoNap.value : null,
    });
    hiloA.value = null;
    hiloB.value = null;
    puertoNap.value = null;
  } catch (e) {
    error.value = getErrorMessage(e, 'No se pudo crear la fusión (¿el hilo ya está fusionado?)');
  } finally {
    saving.value = false;
  }
}

async function eliminarFusion(id: string) {
  if (!confirm('¿Eliminar esta fusión?')) return;
  try {
    await fibra.deleteFusion(id);
  } catch (e) {
    error.value = getErrorMessage(e, 'No se pudo eliminar la fusión');
  }
}

// ---- Puertos NAP ----
const puertosLoading = ref(false);
const puertos = computed(() => fibra.napPuertosPorElemento[props.elemento.id] ?? []);
const puertoSeleccionado = ref<number | null>(null);
const clienteBuscado = ref('');
const traceResult = ref<TraceResult | null>(null);
const tracing = ref(false);

function puertoInfo(n: number) {
  return (
    puertos.value.find((p) => p.puerto_numero === n) ?? {
      puerto_numero: n,
      estado: 'libre' as const,
      client_id: null,
      contract_id: null,
      fusion_id: null,
      service_contracts: null,
    }
  );
}

const puertoActual = computed(() => (puertoSeleccionado.value != null ? puertoInfo(puertoSeleccionado.value) : null));
const clienteActual = computed(() => (puertoActual.value?.client_id ? props.clients.find((c) => c.id === puertoActual.value!.client_id) ?? null : null));

const clientesFiltrados = computed(() => {
  const q = clienteBuscado.value.trim().toLowerCase();
  if (!q) return props.clients.slice(0, 20);
  return props.clients.filter((c) => `${c.first_name} ${c.last_name}`.toLowerCase().includes(q)).slice(0, 20);
});

async function cargarPuertos() {
  puertosLoading.value = true;
  try {
    await fibra.fetchNapPuertos(props.elemento.id);
  } finally {
    puertosLoading.value = false;
  }
}

// Un cliente puede tener mas de un servicio (Fase 38): elegirlo aca no
// asigna el puerto todavia, primero hay que decidir a cual de sus lineas
// corresponde — si tiene una sola, se salta el paso solo.
const clientePendiente = ref<Client | null>(null);
const contratosPendientes = ref<ServiceContract[]>([]);
const loadingContratosPendientes = ref(false);

async function elegirCliente(c: Client) {
  clientePendiente.value = c;
  loadingContratosPendientes.value = true;
  try {
    contratosPendientes.value = await contractsStore.fetchContractsByClient(c.id);
    if (contratosPendientes.value.length === 1) {
      await asignarContrato(contratosPendientes.value[0].id);
    } else if (!contratosPendientes.value.length) {
      error.value = 'Este cliente no tiene ningun servicio creado todavia.';
      clientePendiente.value = null;
    }
  } finally {
    loadingContratosPendientes.value = false;
  }
}

async function asignarContrato(contractId: string) {
  if (!clientePendiente.value) return;
  await asignarCliente(clientePendiente.value.id, contractId);
  clientePendiente.value = null;
  contratosPendientes.value = [];
}

async function asignarCliente(clientId: string | null, contractId: string | null = null) {
  if (puertoSeleccionado.value == null) return;
  const actual = puertoInfo(puertoSeleccionado.value);
  try {
    await fibra.upsertNapPuerto({
      infra_elemento_id: props.elemento.id,
      puerto_numero: puertoSeleccionado.value,
      estado: clientId ? 'ocupado' : 'libre',
      client_id: clientId,
      contract_id: contractId,
      fusion_id: actual.fusion_id,
    });
  } catch (e) {
    error.value = getErrorMessage(e, 'No se pudo actualizar el puerto');
  }
}

async function trazarRuta() {
  if (puertoSeleccionado.value == null) return;
  const p = puertoInfo(puertoSeleccionado.value);
  if (!p.fusion_id) {
    error.value = 'Este puerto no tiene una fusión de fibra asignada todavía.';
    return;
  }
  tracing.value = true;
  error.value = null;
  try {
    if (!fibra.cables.length) await fibra.fetchCables();
    if (!fibra.fusiones.length) await fibra.fetchFusiones();
    const result = fibra.traceFromNapPuerto(p);
    traceResult.value = result;
    emit('trace-result', result);
  } finally {
    tracing.value = false;
  }
}

onMounted(() => {
  if (props.elemento.tipo === 'caja_nap') cargarPuertos();
});
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" style="z-index: 2100" @click.self="emit('close')">
      <div class="w-full max-w-3xl modal-panel max-h-[90vh] overflow-y-auto">
        <div class="flex items-start justify-between mb-3">
          <div>
            <h2 class="text-lg font-semibold">{{ elemento.name }}</h2>
            <p class="text-xs text-slate-500 mt-0.5">
              {{ elemento.tipo === 'caja_nap' ? 'Caja NAP' : elemento.tipo === 'manga' ? 'Mufa / empalme' : elemento.tipo }}
              <span v-if="elemento.spliteo"> · Splitter {{ elemento.spliteo }}</span>
              · {{ cablesAqui.length }} cable(s) conectados
            </p>
          </div>
          <button class="text-slate-500 hover:text-slate-900" @click="emit('close')">✕</button>
        </div>

        <div v-if="!soloPuertos" class="flex gap-1 mb-4 border-b border-slate-200">
          <button
            class="px-3 py-2 text-sm"
            :class="tab === 'fusiones' ? 'border-b-2 border-sky-500 text-sky-600 font-medium' : 'text-slate-500'"
            @click="tab = 'fusiones'"
          >
            Empalmes / fusiones
          </button>
          <button
            v-if="elemento.tipo === 'caja_nap'"
            class="px-3 py-2 text-sm"
            :class="tab === 'puertos' ? 'border-b-2 border-sky-500 text-sky-600 font-medium' : 'text-slate-500'"
            @click="tab = 'puertos'"
          >
            Puertos de cliente ({{ elemento.puertos_total ?? '?' }})
          </button>
        </div>
        <p v-else class="text-xs text-slate-500 mb-3">
          Puertos de cliente de esta caja NAP. Para empalmes/fusiones de fibra, usa el Mapa de Red.
        </p>

        <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>

        <!-- Tab: fusiones -->
        <div v-if="tab === 'fusiones' && !soloPuertos">
          <div v-if="cablesAqui.length === 0" class="text-sm text-slate-500 py-4 text-center">
            Ningún cable tiene esta caja como origen o destino todavía. Traza un cable hacia aquí desde la barra de herramientas.
          </div>
          <template v-else>
            <div class="rounded-xl border border-slate-200 p-3 mb-4">
              <p class="text-sm font-medium mb-2">Nueva fusión</p>
              <div class="grid grid-cols-2 gap-3 mb-2">
                <div>
                  <label class="field-label">Cable / hilo de entrada</label>
                  <select v-model="cableAId" class="field-input">
                    <option value="">— Cable A —</option>
                    <option v-for="c in cablesAqui" :key="c.id" :value="c.id">{{ c.codigo }} ({{ c.hilos_total }} FO)</option>
                  </select>
                </div>
                <div>
                  <label class="field-label">Destino</label>
                  <select v-model="destinoTipo" class="field-input">
                    <option value="cable">Otro cable (empalme de paso)</option>
                    <option value="splitter_out">Puerto NAP (splitter)</option>
                    <option value="terminado">Terminado / sin continuidad</option>
                  </select>
                </div>
              </div>
              <HiloGrid v-if="cableA" :hilos-total="cableA.hilos_total" :selected="hiloA" @select="hiloA = $event" />

              <template v-if="destinoTipo === 'cable'">
                <div class="mt-3">
                  <label class="field-label">Cable de salida</label>
                  <select v-model="cableBId" class="field-input">
                    <option value="">— Cable B —</option>
                    <option v-for="c in cablesAqui.filter((c) => c.id !== cableAId)" :key="c.id" :value="c.id">
                      {{ c.codigo }} ({{ c.hilos_total }} FO)
                    </option>
                  </select>
                </div>
                <HiloGrid v-if="cableB" class="mt-2" :hilos-total="cableB.hilos_total" :selected="hiloB" @select="hiloB = $event" />
              </template>

              <div v-else-if="destinoTipo === 'splitter_out'" class="mt-3">
                <label class="field-label">Número de puerto NAP</label>
                <input v-model.number="puertoNap" type="number" min="1" :max="elemento.puertos_total ?? undefined" class="field-input w-32" />
              </div>

              <button class="btn-primary text-xs mt-3" :disabled="saving" @click="crearFusion">
                {{ saving ? 'Guardando...' : 'Fusionar' }}
              </button>
            </div>

            <p class="text-sm font-medium mb-2">Fusiones existentes ({{ fusionesAqui.length }})</p>
            <ul class="space-y-1.5">
              <li
                v-for="f in fusionesAqui"
                :key="f.id"
                class="flex items-center justify-between text-xs rounded-lg bg-slate-50 border border-slate-200 px-3 py-2"
              >
                <span class="flex items-center gap-2">
                  <span class="w-2.5 h-2.5 rounded-full inline-block" :style="{ background: ubicarHilo(f.hilo_a_index).hiloColor.hex }"></span>
                  {{ fusionadoLabel(f) }}
                </span>
                <button class="text-red-600 hover:underline" @click="eliminarFusion(f.id)">Eliminar</button>
              </li>
              <li v-if="!fusionesAqui.length" class="text-xs text-slate-400">Sin fusiones registradas aún.</li>
            </ul>
          </template>
        </div>

        <!-- Tab: puertos NAP -->
        <div v-else-if="tab === 'puertos'">
          <div v-if="!elemento.puertos_total" class="text-sm text-slate-500 py-4 text-center">
            Configura la "Capacidad de puertos" en la ficha del elemento para habilitar esta vista.
          </div>
          <div v-else-if="puertosLoading" class="text-sm text-slate-500 py-4 text-center">Cargando puertos…</div>
          <template v-else>
            <div class="grid grid-cols-8 gap-2 mb-4">
              <button
                v-for="n in elemento.puertos_total"
                :key="n"
                class="h-10 rounded-lg text-xs font-medium border-2 flex items-center justify-center"
                :class="[
                  puertoInfo(n).estado === 'ocupado' ? 'bg-sky-500/20 border-sky-500 text-sky-700' : '',
                  puertoInfo(n).estado === 'libre' ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700' : '',
                  puertoInfo(n).estado === 'reservado' ? 'bg-amber-500/10 border-amber-500/40 text-amber-700' : '',
                  puertoInfo(n).estado === 'dañado' ? 'bg-red-500/10 border-red-500/40 text-red-700' : '',
                  puertoSeleccionado === n ? 'ring-2 ring-offset-1 ring-slate-900' : '',
                ]"
                @click="puertoSeleccionado = n"
              >
                {{ n }}
              </button>
            </div>

            <div v-if="puertoSeleccionado != null" class="rounded-xl border border-slate-200 p-3">
              <p class="text-sm font-medium mb-2">Puerto #{{ puertoSeleccionado }}</p>
              <p class="text-xs text-slate-500 mb-2">
                {{ puertoActual?.fusion_id ? 'Alimentado por fusión de splitter.' : 'Sin fibra asignada aún en Empalmes.' }}
              </p>

              <div v-if="clienteActual" class="text-sm mb-2">
                Cliente: <b>{{ clienteActual.first_name }} {{ clienteActual.last_name }}</b>
                <span v-if="puertoActual?.service_contracts" class="text-xs text-slate-500 ml-1">({{ puertoActual.service_contracts.contract_number }})</span>
                <span v-else class="text-xs text-amber-600 ml-1">(sin línea especificada)</span>
                <button class="ml-2 text-red-600 hover:underline text-xs" @click="asignarCliente(null)">Quitar</button>
              </div>
              <div v-else-if="clientePendiente" class="mb-2">
                <p class="text-xs text-slate-600 mb-1">
                  {{ clientePendiente.first_name }} {{ clientePendiente.last_name }} tiene {{ contratosPendientes.length }} servicios — ¿cuál va en este puerto?
                </p>
                <button
                  v-for="ct in contratosPendientes"
                  :key="ct.id"
                  class="block w-full text-left px-2 py-1 rounded hover:bg-slate-100 text-xs"
                  @click="asignarContrato(ct.id)"
                >
                  {{ ct.contract_number }} — {{ ct.installation_address || 'Sin dirección' }}
                </button>
                <button class="text-xs text-slate-500 hover:underline mt-1" @click="clientePendiente = null">Cancelar</button>
              </div>
              <div v-else class="mb-2">
                <input v-model="clienteBuscado" placeholder="Buscar cliente por nombre…" class="field-input mb-1" />
                <div class="max-h-32 overflow-y-auto text-xs">
                  <button
                    v-for="c in clientesFiltrados"
                    :key="c.id"
                    class="block w-full text-left px-2 py-1 rounded hover:bg-slate-100"
                    :disabled="loadingContratosPendientes"
                    @click="elegirCliente(c)"
                  >
                    {{ c.first_name }} {{ c.last_name }}
                  </button>
                </div>
              </div>

              <button
                class="btn-secondary text-xs"
                :disabled="tracing || !puertoActual?.fusion_id"
                @click="trazarRuta"
              >
                {{ tracing ? 'Trazando...' : 'Trazar ruta hasta la OLT →' }}
              </button>

              <div v-if="traceResult" class="mt-3 text-xs">
                <p v-if="traceResult.reachedOlt" class="text-emerald-600 font-medium mb-1">✓ Ruta completa hasta la OLT ({{ traceResult.hops.length }} tramo(s))</p>
                <p v-else class="text-amber-600 font-medium mb-1">⚠ Ruta incompleta: {{ traceResult.error }}</p>
                <ol class="space-y-1">
                  <li v-for="(hop, i) in traceResult.hops" :key="i" class="flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full inline-block" :style="{ background: ubicarHilo(hop.hiloIndex).hiloColor.hex }"></span>
                    {{ hop.cable.codigo }} · hilo {{ hop.hiloIndex }}
                  </li>
                </ol>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>
