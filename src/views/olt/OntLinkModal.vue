<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useOltStore, type OltOnt, type OltDevice } from '@/stores/olt';
import { useClientsStore } from '@/stores/clients';
import { useContractsStore } from '@/stores/contracts';
import { getErrorMessage } from '@/lib/errors';
import type { ServiceContract } from '@/types/domain';

// Vincula una ONT "pendiente de vincular" (ver listUnlinkedOnts en
// oltConnectionStatus.ts) a un cliente y uno de sus contratos — POST
// /:id/onts/:ontDbId/link, que valida todo de nuevo en el backend (esta
// pantalla solo evita mandar una solicitud obviamente incompleta; el
// backend es la autoridad real, nunca se confía solo en esto). Nunca toca
// la OLT ni reprovisiona nada.
const props = defineProps<{ ont: OltOnt; device: OltDevice }>();
const emit = defineEmits<{ close: []; linked: [ont: OltOnt] }>();

const oltStore = useOltStore();
const clientsStore = useClientsStore();
const contractsStore = useContractsStore();

const loadingClients = ref(false);
const clientSearch = ref('');
const selectedClientId = ref('');
const contracts = ref<ServiceContract[]>([]);
const loadingContracts = ref(false);
const selectedContractId = ref('');
const confirming = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

onMounted(async () => {
  if (clientsStore.clients.length) return;
  loadingClients.value = true;
  try {
    await clientsStore.fetchClients();
  } catch (e) {
    error.value = getErrorMessage(e, 'No se pudo cargar la lista de clientes');
  } finally {
    loadingClients.value = false;
  }
});

// Mismo patron que el buscador de referido en ClientesView.vue — busca por
// nombre o documento, limitado a 30 resultados.
const filteredClients = computed(() => {
  const q = clientSearch.value.trim().toLowerCase();
  const list = clientsStore.clients;
  if (!q) return list.slice(0, 30);
  return list
    .filter((c) => `${c.first_name} ${c.last_name} ${c.document_number}`.toLowerCase().includes(q))
    .slice(0, 30);
});

const selectedClient = computed(() => clientsStore.clients.find((c) => c.id === selectedClientId.value) ?? null);
const selectedContract = computed(() => contracts.value.find((c) => c.id === selectedContractId.value) ?? null);

async function onSelectClient() {
  selectedContractId.value = '';
  contracts.value = [];
  error.value = null;
  if (!selectedClientId.value) return;
  loadingContracts.value = true;
  try {
    contracts.value = await contractsStore.fetchContractsByClient(selectedClientId.value);
  } catch (e) {
    error.value = getErrorMessage(e, 'No se pudieron cargar los contratos de este cliente');
  } finally {
    loadingContracts.value = false;
  }
}

// El backend vuelve a rechazar un contrato cancelado o ya ocupado -- esto
// solo evita ofrecerlo como opcion util, nunca es la validacion real.
function contractEligible(c: ServiceContract): boolean {
  return c.status !== 'cancelled';
}

function goToConfirm() {
  if (!selectedClientId.value || !selectedContractId.value) return;
  error.value = null;
  confirming.value = true;
}

async function confirmLink() {
  if (!selectedClientId.value || !selectedContractId.value) return;
  saving.value = true;
  error.value = null;
  try {
    const updated = await oltStore.linkOntToContract(props.device.id, props.ont.id, {
      clientId: selectedClientId.value,
      contractId: selectedContractId.value,
      expectedSerial: props.ont.serial,
    });
    emit('linked', updated);
  } catch (e) {
    error.value = getErrorMessage(e, 'No se pudo vincular la ONT. Vuelve a revisar los datos.');
    confirming.value = false;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="w-full max-w-lg modal-panel">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-lg font-semibold">Vincular ONT a cliente</h2>
            <p class="text-xs text-slate-500 font-mono">{{ ont.serial }} · {{ ont.frame }}/{{ ont.slot }}/{{ ont.port }}:{{ ont.ont_id }}</p>
          </div>
          <button class="btn-ghost !p-2" @click="emit('close')" aria-label="Cerrar">✕</button>
        </div>

        <template v-if="!confirming">
          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Cliente</label>
            <input v-model="clientSearch" placeholder="Buscar por nombre o documento..." class="field-input text-sm mb-2" />
            <p v-if="loadingClients" class="text-xs text-slate-500">Cargando clientes...</p>
            <select v-else v-model="selectedClientId" size="6" class="field-input text-sm" @change="onSelectClient">
              <option v-for="c in filteredClients" :key="c.id" :value="c.id">
                {{ c.first_name }} {{ c.last_name }} — {{ c.document_number }}
              </option>
            </select>
          </div>

          <div v-if="selectedClientId" class="mb-4">
            <label class="block text-xs text-slate-600 mb-1">Contrato</label>
            <p v-if="loadingContracts" class="text-xs text-slate-500">Cargando contratos...</p>
            <p v-else-if="!contracts.length" class="text-xs text-slate-500">Este cliente no tiene contratos.</p>
            <select v-else v-model="selectedContractId" class="field-input text-sm">
              <option v-for="c in contracts" :key="c.id" :value="c.id" :disabled="!contractEligible(c)">
                {{ c.contract_number ?? c.id }} — {{ c.status }}{{ !contractEligible(c) ? ' (no elegible)' : '' }}
              </option>
            </select>
          </div>

          <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="emit('close')">Cancelar</button>
            <button
              type="button"
              class="btn-primary"
              :disabled="!selectedClientId || !selectedContractId"
              @click="goToConfirm"
            >
              Continuar
            </button>
          </div>
        </template>

        <template v-else>
          <p class="text-sm text-slate-600 mb-3">Confirma los datos antes de guardar — esto solo escribe en SmartRayco, nunca en la OLT:</p>
          <dl class="space-y-2 text-sm mb-4 surface p-4">
            <div class="flex justify-between gap-3"><dt class="text-slate-500">Cliente</dt><dd class="text-right">{{ selectedClient ? `${selectedClient.first_name} ${selectedClient.last_name}` : '—' }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-slate-500">Contrato</dt><dd class="text-right">{{ selectedContract?.contract_number ?? '—' }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-slate-500">Serial de la ONT</dt><dd class="text-right font-mono text-xs">{{ ont.serial }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-slate-500">Posición</dt><dd class="text-right font-mono text-xs">{{ ont.frame }}/{{ ont.slot }}/{{ ont.port }}:{{ ont.ont_id }}</dd></div>
          </dl>

          <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" :disabled="saving" @click="confirming = false">Atrás</button>
            <button type="button" class="btn-primary" :disabled="saving" @click="confirmLink">
              {{ saving ? 'Vinculando...' : 'Confirmar vínculo' }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>
