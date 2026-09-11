<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useTr069Store } from '@/stores/tr069';
import { useClientsStore } from '@/stores/clients';
import { useContractsStore } from '@/stores/contracts';
import { getErrorMessage } from '@/lib/errors';
import type { ServiceContract, Tr069Device, Tr069PerformanceMetric } from '@/types/domain';

const tr069Store = useTr069Store();
const clientsStore = useClientsStore();
const contractsStore = useContractsStore();

const actionError = ref<string | null>(null);
const actionMessage = ref<string | null>(null);
const collectingAll = ref(false);

const expandedId = ref<string | null>(null);
const metricsById = ref<Record<string, Tr069PerformanceMetric | null>>({});
const metricsLoadingId = ref<string | null>(null);

const linkModalDevice = ref<Tr069Device | null>(null);
const clientFilter = ref('');
const clientContracts = ref<ServiceContract[]>([]);
const loadingContracts = ref(false);
const linkingClientId = ref('');
const linkingContractId = ref('');
const linkSaving = ref(false);
const linkError = ref<string | null>(null);

onMounted(async () => {
  try {
    await tr069Store.fetchDevices();
  } catch (e) {
    actionError.value = getErrorMessage(e, 'Error al cargar los dispositivos TR-069');
  }
});

function formatDate(value: string | null) {
  if (!value) return 'Nunca';
  return new Date(value).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' });
}

async function handleSync() {
  actionError.value = null;
  actionMessage.value = null;
  try {
    const res = await tr069Store.triggerSync();
    actionMessage.value = `Sincronizado: ${res.total} dispositivos en GenieACS (${res.created} nuevos, ${res.synced} actualizados).`;
    await tr069Store.fetchDevices();
  } catch (e) {
    actionError.value = getErrorMessage(e, 'No se pudo sincronizar con GenieACS');
  }
}

async function handleCollectAll() {
  actionError.value = null;
  actionMessage.value = null;
  collectingAll.value = true;
  try {
    const res = await tr069Store.collectAllMetrics();
    actionMessage.value = `Métricas recolectadas: ${res.collected}/${res.total} (${res.failed} fallidas).`;
  } catch (e) {
    actionError.value = getErrorMessage(e, 'No se pudieron recolectar las métricas');
  } finally {
    collectingAll.value = false;
  }
}

async function toggleExpand(device: Tr069Device) {
  if (expandedId.value === device.id) {
    expandedId.value = null;
    return;
  }
  expandedId.value = device.id;
  if (!(device.id in metricsById.value)) {
    metricsLoadingId.value = device.id;
    try {
      metricsById.value[device.id] = await tr069Store.fetchLatestMetric(device.id);
    } catch (e) {
      actionError.value = getErrorMessage(e, 'Error al leer las métricas del dispositivo');
    } finally {
      metricsLoadingId.value = null;
    }
  }
}

async function refreshDeviceMetrics(device: Tr069Device) {
  metricsLoadingId.value = device.id;
  try {
    const res = await tr069Store.collectDeviceMetrics(device.id);
    if (res.metrics) metricsById.value[device.id] = res.metrics;
    else metricsById.value[device.id] = await tr069Store.fetchLatestMetric(device.id);
  } catch (e) {
    actionError.value = getErrorMessage(e, 'Error al recolectar métricas de este dispositivo');
  } finally {
    metricsLoadingId.value = null;
  }
}

async function openLinkModal(device: Tr069Device) {
  linkModalDevice.value = device;
  linkError.value = null;
  clientFilter.value = '';
  clientContracts.value = [];
  linkingClientId.value = '';
  linkingContractId.value = device.service_contract_id ?? '';
  if (!clientsStore.clients.length) await clientsStore.fetchClients();
}

async function onClientChange() {
  linkingContractId.value = '';
  clientContracts.value = [];
  if (!linkingClientId.value) return;
  loadingContracts.value = true;
  try {
    clientContracts.value = await contractsStore.fetchContractsByClient(linkingClientId.value);
  } finally {
    loadingContracts.value = false;
  }
}

async function handleLinkSubmit() {
  if (!linkModalDevice.value) return;
  linkSaving.value = true;
  linkError.value = null;
  try {
    await tr069Store.linkContract(linkModalDevice.value.id, linkingContractId.value || null);
    linkModalDevice.value = null;
  } catch (e) {
    linkError.value = getErrorMessage(e, 'Error al vincular el contrato');
  } finally {
    linkSaving.value = false;
  }
}

async function handleUnlink() {
  if (!linkModalDevice.value) return;
  linkSaving.value = true;
  linkError.value = null;
  try {
    await tr069Store.linkContract(linkModalDevice.value.id, null);
    linkModalDevice.value = null;
  } catch (e) {
    linkError.value = getErrorMessage(e, 'Error al desvincular el contrato');
  } finally {
    linkSaving.value = false;
  }
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">TR-069 / GenieACS</h1>
        <p class="text-slate-400 text-sm mt-1">{{ tr069Store.devices.length }} CPEs reportados por GenieACS</p>
      </div>
      <div class="flex gap-2">
        <button class="btn-ghost" :disabled="collectingAll" @click="handleCollectAll">
          {{ collectingAll ? 'Recolectando...' : 'Recolectar métricas' }}
        </button>
        <button class="btn-primary" :disabled="tr069Store.syncing" @click="handleSync">
          {{ tr069Store.syncing ? 'Sincronizando...' : 'Sincronizar con GenieACS' }}
        </button>
      </div>
    </div>

    <p v-if="actionMessage" class="mb-4 text-sm text-emerald-400">{{ actionMessage }}</p>
    <p v-if="actionError" class="mb-4 text-sm text-red-400">{{ actionError }}</p>

    <div class="table-shell">
      <table class="w-full text-sm min-w-[1000px]">
        <thead class="bg-slate-900 text-slate-400 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-3">CPE</th>
            <th class="text-left px-4 py-3">Modelo / Firmware</th>
            <th class="text-left px-4 py-3">WAN IP</th>
            <th class="text-left px-4 py-3">SSID</th>
            <th class="text-left px-4 py-3">Contrato</th>
            <th class="text-left px-4 py-3">Último reporte</th>
            <th class="text-right px-4 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="tr069Store.loading">
            <td colspan="7" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
          </tr>
          <tr v-else-if="!tr069Store.devices.length">
            <td colspan="7" class="px-4 py-6 text-center text-slate-500">
              No hay dispositivos TR-069 sincronizados aún. Verifica que el stack de GenieACS esté corriendo
              (<code class="text-xs">GENIEACS_NBI</code> en el backend) y presiona "Sincronizar con GenieACS".
            </td>
          </tr>
          <template v-for="device in tr069Store.devices" :key="device.id">
            <tr class="border-t border-slate-800 cursor-pointer hover:bg-slate-900/40" @click="toggleExpand(device)">
              <td class="px-4 py-3">
                <div class="font-mono text-xs">{{ device.cpe_serial }}</div>
                <div class="text-[10px] text-slate-500">{{ device.cpe_oui }}</div>
              </td>
              <td class="px-4 py-3">
                <div>{{ device.model_name ?? '—' }}</div>
                <div class="text-[10px] text-slate-500">{{ device.firmware_version ?? '—' }}</div>
              </td>
              <td class="px-4 py-3 font-mono text-xs">{{ device.wan_ip ?? '—' }}</td>
              <td class="px-4 py-3">{{ device.ssid ?? '—' }}</td>
              <td class="px-4 py-3">
                <span v-if="device.contracts" class="badge bg-sky-500/15 text-sky-400">{{ device.contracts.contract_number }}</span>
                <span v-else class="text-slate-500 text-xs">Sin vincular</span>
              </td>
              <td class="px-4 py-3 text-slate-400">{{ formatDate(device.last_seen_at) }}</td>
              <td class="px-4 py-3 text-right space-x-3 whitespace-nowrap text-xs" @click.stop>
                <button class="text-sky-400 hover:underline" @click="openLinkModal(device)">Vincular</button>
                <button class="text-slate-400 hover:underline" @click="toggleExpand(device)">
                  {{ expandedId === device.id ? 'Ocultar' : 'Métricas' }}
                </button>
              </td>
            </tr>
            <tr v-if="expandedId === device.id" class="border-t border-slate-800 bg-slate-900/40">
              <td colspan="7" class="px-4 py-4">
                <div v-if="metricsLoadingId === device.id" class="text-xs text-slate-500">Consultando...</div>
                <div v-else-if="!metricsById[device.id]" class="flex items-center justify-between">
                  <span class="text-xs text-slate-500">Sin métricas registradas todavía.</span>
                  <button class="text-sky-400 hover:underline text-xs" @click="refreshDeviceMetrics(device)">Recolectar ahora</button>
                </div>
                <div v-else class="flex flex-wrap items-center gap-6 text-xs">
                  <div><span class="text-slate-500">Rx:</span> {{ metricsById[device.id]?.rx_power ?? '—' }} dBm</div>
                  <div><span class="text-slate-500">Tx:</span> {{ metricsById[device.id]?.tx_power ?? '—' }} dBm</div>
                  <div><span class="text-slate-500">Temp:</span> {{ metricsById[device.id]?.temperature ?? '—' }} °C</div>
                  <div><span class="text-slate-500">Uptime:</span> {{ metricsById[device.id]?.uptime ?? '—' }} s</div>
                  <div><span class="text-slate-500">Estado:</span> {{ metricsById[device.id]?.connection_status ?? '—' }}</div>
                  <div class="text-slate-500">{{ formatDate(metricsById[device.id]?.collected_at ?? null) }}</div>
                  <button class="text-sky-400 hover:underline ml-auto" @click="refreshDeviceMetrics(device)">Actualizar</button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div v-if="linkModalDevice" class="modal-overlay">
        <form class="w-full max-w-lg modal-panel max-h-[90vh] overflow-y-auto" @submit.prevent="handleLinkSubmit">
          <h2 class="text-lg font-semibold mb-4">Vincular CPE a un contrato</h2>
          <p class="text-xs text-slate-500 mb-4 font-mono">{{ linkModalDevice.genieacs_id }}</p>

          <div class="mb-3">
            <label class="block text-xs text-slate-400 mb-1">Cliente</label>
            <input v-model="clientFilter" placeholder="Buscar por nombre o documento..." class="field-input mb-2" />
            <select v-model="linkingClientId" size="5" class="field-input" @change="onClientChange">
              <option
                v-for="c in clientsStore.clients.filter((c) =>
                  `${c.first_name} ${c.last_name} ${c.document_number}`.toLowerCase().includes(clientFilter.trim().toLowerCase()),
                ).slice(0, 30)"
                :key="c.id"
                :value="c.id"
              >
                {{ c.first_name }} {{ c.last_name }} — {{ c.document_number }}
              </option>
            </select>
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-400 mb-1">Contrato</label>
            <select v-model="linkingContractId" class="field-input" :disabled="!linkingClientId || loadingContracts">
              <option value="">{{ loadingContracts ? 'Cargando...' : 'Selecciona un contrato' }}</option>
              <option v-for="c in clientContracts" :key="c.id" :value="c.id">{{ c.contract_number }}</option>
            </select>
          </div>

          <p v-if="linkError" class="text-sm text-red-400 mb-3">{{ linkError }}</p>

          <div class="flex justify-between gap-2">
            <button
              v-if="linkModalDevice.service_contract_id"
              type="button"
              class="text-red-400 hover:underline text-xs"
              :disabled="linkSaving"
              @click="handleUnlink"
            >
              Desvincular
            </button>
            <div class="flex gap-2 ml-auto">
              <button type="button" class="btn-ghost" @click="linkModalDevice = null">Cancelar</button>
              <button type="submit" :disabled="linkSaving || !linkingContractId" class="btn-primary">
                {{ linkSaving ? 'Guardando...' : 'Vincular' }}
              </button>
            </div>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
