<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useOntEvidenceClock } from '@/composables/useOntEvidenceClock';
import { enforceOntEvidence } from '@/lib/ontTelemetryEvidence';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useTr069Store } from '@/stores/tr069';
import { useClientsStore } from '@/stores/clients';
import { useContractsStore } from '@/stores/contracts';
import { useOltStore, type OltSerialStatus } from '@/stores/olt';
import { useConfirm } from '@/composables/useConfirm';
import { getErrorMessage } from '@/lib/errors';
import { useAuthStore } from '@/stores/auth';
import { compareWifiPlan, type WifiSsidPlan } from '@/lib/tr069WifiPlan';
import type { WifiTrialStatus } from '@/lib/tr069WifiTrial';
import type { ServiceContract, Tr069Device, Tr069PerformanceMetric } from '@/types/domain';
import type { WifiNetwork } from '@/stores/tr069';

const tr069Store = useTr069Store();
const clientsStore = useClientsStore();
const contractsStore = useContractsStore();
const oltStore = useOltStore();
const { confirmDialog } = useConfirm();
const auth = useAuthStore();
const canPrepareWifi = computed(() => ['ADMIN', 'SUPERADMIN'].includes(auth.role ?? ''));

// Estado online/offline real de la ONU (olt_onts.status), por numero de
// serie del CPE — distinto del "ultimo reporte" de GenieACS (ese es TR-069,
// esto es lo que ve la OLT por GPON).
const loadedOntStatuses = ref<Record<string, OltSerialStatus>>({});
const ontEvidenceNow = useOntEvidenceClock();
const ontStatusBySerial = computed(() => Object.fromEntries(Object.entries(loadedOntStatuses.value)
  .map(([serial, row]) => [serial, enforceOntEvidence(row, ontEvidenceNow.value)])));

async function loadOntStatuses() {
  const serials = tr069Store.devices.map((d) => d.cpe_serial).filter(Boolean);
  if (!serials.length) return;
  try {
    loadedOntStatuses.value = await oltStore.fetchOntStatusBySerials(serials);
  } catch {
    // Sin acceso a la OLT desde este rol: la columna simplemente queda vacia.
  }
}

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

// Preparación de un único SSID: ninguna tarea ni escritura sobre el CPE.
const configModalDevice = ref<Tr069Device | null>(null);
const configForm = ref({ wifiSsid: '' });
const configDeviceId = ref<string | null>(null);
const configCanonicalSerial = ref<string | null>(null);
const configPlan = ref<WifiSsidPlan | null>(null);
const configTrial = ref<WifiTrialStatus | null>(null);
const configWifiNetworks = ref<WifiNetwork[]>([]);
const configWifiPath = ref('');
const configSelectedNetwork = computed(() => configWifiNetworks.value.find(n => n.path === configWifiPath.value));
const configLoadingCurrent = ref(false);
const configSaving = ref(false);
const configError = ref<string | null>(null);
const configResult = ref<string | null>(null);

async function openConfigModal(device: Tr069Device) {
  configModalDevice.value = device;
  configForm.value = { wifiSsid: '' };
  configDeviceId.value = null;
  configCanonicalSerial.value = null;
  configPlan.value = null;
  configTrial.value = null;
  configWifiNetworks.value = [];
  configWifiPath.value = '';
  configError.value = null;
  configResult.value = null;
  configLoadingCurrent.value = true;
  try {
    const wifi = await tr069Store.fetchWifiNetworks(device.cpe_serial);
    if (configModalDevice.value?.id !== device.id) return;
    configDeviceId.value = wifi.deviceId;
    configCanonicalSerial.value = wifi.serial;
    configWifiNetworks.value = wifi.networks;
    configWifiPath.value = '';
    if (!wifi.found) configError.value = 'No se encontró una identidad GenieACS única para esta ONT.';
    if (wifi.serial === 'HWTC1D3691B7' && canPrepareWifi.value) {
      configTrial.value = await tr069Store.wifiTrialStatus(device.cpe_serial);
      configResult.value = configTrial.value.message;
    }
  } catch (e) {
    configError.value = getErrorMessage(e, 'Error al consultar GenieACS');
  } finally {
    configLoadingCurrent.value = false;
  }
}

async function handleSaveConfig() {
  if (configTrial.value?.enabled) return runWifiTrial('change');
  const device = configModalDevice.value;
  const network = configWifiNetworks.value.find(n => n.path === configWifiPath.value);
  if (!device || !canPrepareWifi.value || !configDeviceId.value || configSaving.value) return;
  if (!network || network.ssid === null || !network.timestamp || !configForm.value.wifiSsid.trim()) {
    configError.value = 'Selecciona una red con SSID recuperable e ingresa el nuevo nombre.';
    return;
  }
  const payload = { deviceId: configDeviceId.value, path: network.path, ssid: configForm.value.wifiSsid,
    expectedSsid: network.ssid, expectedTimestamp: network.timestamp, confirmed: true };
  const ok = await confirmDialog({ title: 'Confirmar preparación de un SSID', confirmLabel: 'Preparar sin aplicar', wrapMessage: true,
    message: `Huawei: ${configCanonicalSerial.value}\nSerial TR-069: ${device.cpe_serial}\nInstancia: ${network.path}\nActual: ${network.ssid}\nPropuesto: ${payload.ssid}\nSolo se guardará un plan descargable. No se enviará al equipo.` });
  if (!ok || configModalDevice.value?.id !== device.id) return;
  configSaving.value = true;
  configError.value = null;
  configResult.value = null;
  try {
    const plan = await tr069Store.prepareWifiSsid(device.cpe_serial, payload);
    if (configModalDevice.value?.id !== device.id) return;
    configPlan.value = plan;
    configResult.value = 'Plan preparado. No aplicado. Descarga el respaldo antes de cerrar.';
  } catch (e) {
    configError.value = getErrorMessage(e, 'No se pudo preparar el SSID');
  } finally {
    configSaving.value = false;
  }
}

function downloadWifiPlan() {
  const backup = configTrial.value?.record ?? configPlan.value;
  if (!backup) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'respaldo-ssid-huawei.json'; link.click();
  URL.revokeObjectURL(url);
}

async function runWifiTrial(action: 'change' | 'restore' | 'verify') {
  const device = configModalDevice.value;
  if (!device || !canPrepareWifi.value || !configTrial.value?.enabled || configSaving.value) return;
  const network = configSelectedNetwork.value;
  const restore = action === 'restore';
  if (action === 'change' && (!network || network.path !== 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5' ||
    network.ssid === null || !network.timestamp || !configForm.value.wifiSsid.trim())) {
    configError.value = 'Selecciona la instancia 5 y escribe un nuevo nombre WiFi.'; return;
  }
  const payload = action === 'verify' ? {} : restore ? { requestId: crypto.randomUUID(), confirmed: true } : {
    requestId: crypto.randomUUID(), confirmed: true, deviceId: configDeviceId.value, path: network!.path,
    ssid: configForm.value.wifiSsid, expectedSsid: network!.ssid, expectedTimestamp: network!.timestamp,
  };
  const target = restore ? configTrial.value.record?.originalSsid : configForm.value.wifiSsid;
  const message = action === 'verify' ? 'Se consultará únicamente el SSID de la instancia 5 mediante GenieACS. Puede esperar al próximo Inform (hasta 5 minutos).' :
    `Huawei: HWTC1D3691B7\nContrato: CTR-2026-00214\nInstancia: InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID\nActual: ${restore ? configTrial.value.record?.operations.at(-1)?.after : network!.ssid}\nNuevo: ${target}\n${restore ? 'Se restaurará el nombre anterior guardado.' : 'Se guardará el respaldo antes de enviar el cambio real.'}\nNo se cambiarán contraseñas, PPPoE, WAN ni VLAN. Se aplicará en el próximo Inform.`;
  if (!await confirmDialog({ title: action === 'verify' ? 'Verificar resultado' : restore ? 'Restaurar SSID anterior' : 'Confirmar cambio real de SSID',
    confirmLabel: action === 'verify' ? 'Consultar SSID' : restore ? 'Restaurar nombre' : 'Enviar cambio', message, wrapMessage: true })) return;
  if (configModalDevice.value?.id !== device.id) return;
  configSaving.value = true; configError.value = null;
  try {
    configTrial.value = await tr069Store.wifiTrialAction(device.cpe_serial, action, payload);
    configResult.value = configTrial.value.message;
  } catch (e) { configError.value = getErrorMessage(e, 'No se confirmó la operación. Consulta el estado antes de repetir.'); }
  finally { configSaving.value = false; }
}

async function refreshWifiTrial() {
  if (!configModalDevice.value || configSaving.value) return;
  try {
    configTrial.value = await tr069Store.wifiTrialStatus(configModalDevice.value.cpe_serial);
    configResult.value = configTrial.value.message;
    const inventory = await tr069Store.fetchWifiNetworks(configModalDevice.value.cpe_serial);
    configWifiNetworks.value = inventory.networks;
  } catch (e) { configError.value = getErrorMessage(e, 'No se pudo consultar el estado'); }
}

async function verifyWifiCache() {
  const plan = configPlan.value;
  if (!plan) return;
  try {
    const inventory = await tr069Store.fetchWifiNetworks(plan.serial);
    if (configPlan.value !== plan) return;
    configResult.value = compareWifiPlan(plan, inventory);
  } catch (e) { configError.value = getErrorMessage(e, 'No se pudo consultar la caché'); }
}

// ---- Reiniciar / Refrescar (acciones rapidas por fila) ----
const rebootingId = ref<string | null>(null);
const refreshingId = ref<string | null>(null);

async function handleReboot(device: Tr069Device) {
  const ok = await confirmDialog({
    title: 'Reiniciar equipo',
    message: `¿Reiniciar el equipo ${device.cpe_serial}? El cliente va a perder internet unos minutos.`,
  });
  if (!ok) return;
  rebootingId.value = device.id;
  actionError.value = null;
  actionMessage.value = null;
  try {
    const result = await tr069Store.rebootDevice(device.cpe_serial);
    actionMessage.value = result.ok ? `Reinicio encolado para ${device.cpe_serial}.` : null;
    if (!result.ok) actionError.value = result.error ?? 'Error al encolar el reinicio';
  } catch (e) {
    actionError.value = getErrorMessage(e, 'Error al encolar el reinicio');
  } finally {
    rebootingId.value = null;
  }
}

async function handleRefresh(device: Tr069Device) {
  refreshingId.value = device.id;
  actionError.value = null;
  actionMessage.value = null;
  try {
    const result = await tr069Store.refreshDevice(device.cpe_serial);
    actionMessage.value = result.ok
      ? `Pedido de reporte encolado para ${device.cpe_serial} (puede tardar si el equipo no acepta connection request).`
      : null;
    if (!result.ok) actionError.value = result.error ?? 'Error al pedir el refresco';
  } catch (e) {
    actionError.value = getErrorMessage(e, 'Error al pedir el refresco');
  } finally {
    refreshingId.value = null;
  }
}

onMounted(async () => {
  try {
    await tr069Store.fetchDevices();
    await loadOntStatuses();
  } catch (e) {
    actionError.value = getErrorMessage(e, 'Error al cargar los dispositivos TR-069');
  }
});

function formatDate(value: string | null) {
  if (!value) return 'Nunca';
  return new Date(value).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
}

async function handleSync() {
  actionError.value = null;
  actionMessage.value = null;
  try {
    const res = await tr069Store.triggerSync();
    actionMessage.value = `Sincronizado: ${res.total} dispositivos en GenieACS (${res.created} nuevos, ${res.synced} actualizados).`;
    await tr069Store.fetchDevices();
    await loadOntStatuses();
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
        <p class="text-slate-600 text-sm mt-1">{{ tr069Store.devices.length }} CPEs reportados por GenieACS</p>
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

    <p v-if="actionMessage" class="mb-4 text-sm text-emerald-600">{{ actionMessage }}</p>
    <p v-if="actionError" class="mb-4 text-sm text-red-600">{{ actionError }}</p>

    <div class="table-shell">
      <table class="w-full text-sm min-w-[1000px]">
        <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-3">CPE</th>
            <th class="text-left px-4 py-3">Estado ONU</th>
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
            <td colspan="8" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
          </tr>
          <tr v-else-if="!tr069Store.devices.length">
            <td colspan="8" class="px-4 py-6 text-center text-slate-500">
              No hay dispositivos TR-069 sincronizados aún. Verifica que el stack de GenieACS esté corriendo
              (<code class="text-xs">GENIEACS_NBI</code> en el backend) y presiona "Sincronizar con GenieACS".
            </td>
          </tr>
          <template v-for="device in tr069Store.devices" :key="device.id">
            <tr class="border-t border-slate-200 cursor-pointer hover:bg-slate-50" @click="toggleExpand(device)">
              <td class="px-4 py-3">
                <div class="font-mono text-xs">{{ device.cpe_serial }}</div>
                <div class="text-[10px] text-slate-500">{{ device.cpe_oui }}</div>
              </td>
              <td class="px-4 py-3">
                <span
                  v-if="ontStatusBySerial[device.cpe_serial]"
                  class="badge"
                  :title="ontStatusBySerial[device.cpe_serial].telemetry?.outcome === 'expired' ? 'Lectura vencida; estado no confirmado' : ontStatusBySerial[device.cpe_serial].status === 'unknown' ? 'Sin evidencia vigente del serial' : 'Estado verificado por serial'"
                  :class="
                    ontStatusBySerial[device.cpe_serial].status === 'online'
                      ? 'bg-green-500/15 text-green-600'
                      : ontStatusBySerial[device.cpe_serial].status === 'offline'
                        ? 'bg-red-500/15 text-red-600'
                        : 'bg-slate-500/15 text-slate-600'
                  "
                >
                  {{
                    ontStatusBySerial[device.cpe_serial].status === 'online'
                      ? 'En linea'
                      : ontStatusBySerial[device.cpe_serial].status === 'offline'
                        ? 'Desconectada'
                        : 'No confirmado'
                  }}
                </span>
                <span v-else class="text-slate-500 text-xs">Sin dato de OLT</span>
              </td>
              <td class="px-4 py-3">
                <div>{{ device.model_name ?? '—' }}</div>
                <div class="text-[10px] text-slate-500">{{ device.firmware_version ?? '—' }}</div>
              </td>
              <td class="px-4 py-3 font-mono text-xs">{{ device.wan_ip ?? '—' }}</td>
              <td class="px-4 py-3">{{ device.ssid ?? '—' }}</td>
              <td class="px-4 py-3">
                <span v-if="device.contracts" class="badge bg-sky-500/15 text-sky-700">{{ device.contracts.contract_number }}</span>
                <span v-else class="text-slate-500 text-xs">Sin vincular</span>
              </td>
              <td class="px-4 py-3 text-slate-600">{{ formatDate(device.last_seen_at) }}</td>
              <td class="px-4 py-3 text-right space-x-3 whitespace-nowrap text-xs" @click.stop>
                <button class="text-sky-600 hover:underline" @click="openLinkModal(device)">Vincular</button>
                <button class="text-sky-600 hover:underline" @click="openConfigModal(device)">Configurar</button>
                <button class="text-slate-600 hover:underline" :disabled="refreshingId === device.id" @click="handleRefresh(device)">
                  {{ refreshingId === device.id ? 'Pidiendo...' : 'Refrescar' }}
                </button>
                <button class="text-amber-600 hover:underline" :disabled="rebootingId === device.id" @click="handleReboot(device)">
                  {{ rebootingId === device.id ? 'Reiniciando...' : 'Reiniciar' }}
                </button>
                <button class="text-slate-600 hover:underline" @click="toggleExpand(device)">
                  {{ expandedId === device.id ? 'Ocultar' : 'Métricas' }}
                </button>
              </td>
            </tr>
            <tr v-if="expandedId === device.id" class="border-t border-slate-200 bg-slate-50">
              <td colspan="7" class="px-4 py-4">
                <div v-if="metricsLoadingId === device.id" class="text-xs text-slate-500">Consultando...</div>
                <div v-else-if="!metricsById[device.id]" class="flex items-center justify-between">
                  <span class="text-xs text-slate-500">Sin métricas registradas todavía.</span>
                  <button class="text-sky-700 hover:underline text-xs" @click="refreshDeviceMetrics(device)">Recolectar ahora</button>
                </div>
                <div v-else class="flex flex-wrap items-center gap-6 text-xs">
                  <div><span class="text-slate-500">Rx:</span> {{ metricsById[device.id]?.rx_power ?? '—' }} dBm</div>
                  <div><span class="text-slate-500">Tx:</span> {{ metricsById[device.id]?.tx_power ?? '—' }} dBm</div>
                  <div><span class="text-slate-500">Temp:</span> {{ metricsById[device.id]?.temperature ?? '—' }} °C</div>
                  <div><span class="text-slate-500">Uptime:</span> {{ metricsById[device.id]?.uptime ?? '—' }} s</div>
                  <div><span class="text-slate-500">Estado:</span> {{ metricsById[device.id]?.connection_status ?? '—' }}</div>
                  <div class="text-slate-500">{{ formatDate(metricsById[device.id]?.collected_at ?? null) }}</div>
                  <button class="text-sky-600 hover:underline ml-auto" @click="refreshDeviceMetrics(device)">Actualizar</button>
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
            <label class="block text-xs text-slate-600 mb-1">Cliente</label>
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
            <label class="block text-xs text-slate-600 mb-1">Contrato</label>
            <select v-model="linkingContractId" class="field-input" :disabled="!linkingClientId || loadingContracts">
              <option value="">{{ loadingContracts ? 'Cargando...' : 'Selecciona un contrato' }}</option>
              <option v-for="c in clientContracts" :key="c.id" :value="c.id">{{ c.contract_number }}</option>
            </select>
          </div>

          <p v-if="linkError" class="text-sm text-red-600 mb-3">{{ linkError }}</p>

          <div class="flex justify-between gap-2">
            <button
              v-if="linkModalDevice.service_contract_id"
              type="button"
              class="text-red-600 hover:underline text-xs"
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

    <Teleport to="body">
      <div v-if="configModalDevice" class="modal-overlay">
        <form class="w-full max-w-sm modal-panel max-h-[90vh] overflow-y-auto" @submit.prevent="handleSaveConfig">
          <h2 class="text-lg font-semibold mb-1">{{ configTrial?.enabled ? 'Configurar nombre WiFi de prueba' : 'Preparar nombre WiFi' }}</h2>
          <p class="text-xs text-slate-500 mb-4 font-mono">{{ configModalDevice.cpe_serial }}</p>
          <p v-if="configCanonicalSerial" class="text-xs mb-2">Serial GPON completo: {{ configCanonicalSerial }}</p>
          <p v-if="configDeviceId" class="text-xs break-all mb-3">Dispositivo GenieACS: {{ configDeviceId }}</p>

          <p class="text-xs text-slate-500 mb-3">
            {{ configTrial?.enabled ? 'Prueba real habilitada solo para instancia 5, Huawei HWTC1D3691B7, contrato CTR-2026-00214.' : 'Preparación sin aplicar, solo para la Huawei HWTC1D3691B7.' }} PPPoE y contraseñas no se pueden cambiar.
            Estado y banda sin verificar cuando faltan datos. La caché puede ser antigua.
          </p>

          <p v-if="configLoadingCurrent" class="text-xs text-slate-500 mb-3">Consultando GenieACS...</p>


          <div class="mb-3">
            <p class="text-xs font-semibold text-slate-700 mb-2">WiFi</p>
            <p v-if="!configLoadingCurrent && !configWifiNetworks.length" class="text-xs text-amber-700 mb-2">
              No se encontraron redes WiFi en la caché del equipo.
            </p>
            <div v-if="configWifiNetworks.length" class="mb-2">
              <label class="block text-xs text-slate-600 mb-1">Red a cambiar</label>
              <select v-model="configWifiPath" class="field-input">
                <option value="">Selecciona una red</option>
                <option v-for="n in configWifiNetworks" :key="n.path" :value="n.path" :disabled="configTrial?.enabled && n.path !== 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5'">{{ n.ssid ?? 'SSID no disponible' }} — {{ n.band }} — instancia {{ n.path.split('.').pop() }} ({{ n.enabled === null ? 'estado sin verificar' : n.enabled ? 'habilitada' : 'desactivada' }})</option>
              </select>
              <p v-if="configWifiPath" class="text-xs break-all">Instancia: {{ configWifiPath }}</p>
              <p v-if="configWifiPath" class="text-xs">{{ configSelectedNetwork?.band }}. Fecha del SSID (Perú): {{ configSelectedNetwork?.timestamp ? new Date(configSelectedNetwork.timestamp).toLocaleString('es-PE', { timeZone: 'America/Lima' }) : 'Sin fecha verificable' }}.</p>
            </div>
            <div class="mb-2">
              <label class="block text-xs text-slate-600 mb-1">Nuevo SSID</label>
              <input v-model="configForm.wifiSsid" class="field-input" placeholder="Nuevo nombre de esta red" />
            </div>
          </div>

          <p v-if="configError" class="text-sm text-red-600 mb-3">{{ configError }}</p>
          <p v-if="configResult" role="status" class="text-sm text-slate-700 mb-3">{{ configResult }}</p>
          <div v-if="configTrial?.enabled" class="text-xs mb-3 space-y-2">
            <template v-if="configTrial.record">
              <p>Respaldo persistente: {{ configTrial.record.originalSsid }}. Instancia: {{ configTrial.record.path }}. Estado: {{ configTrial.record.operations.at(-1)?.state }}.</p>
              <button type="button" class="btn-secondary" @click="downloadWifiPlan">Descargar respaldo SSID</button>
              <button type="button" class="btn-secondary" :disabled="configSaving" @click="runWifiTrial('verify')">Verificar resultado</button>
              <button type="button" class="btn-secondary" :disabled="configSaving || configTrial.record.operations.at(-1)?.state !== 'verified' || configTrial.record.operations.at(-1)?.kind !== 'change'" @click="runWifiTrial('restore')">Restaurar SSID anterior</button>
            </template>
            <button type="button" class="btn-secondary" :disabled="configSaving" @click="refreshWifiTrial">Consultar estado</button>
          </div>
          <div v-if="configPlan" class="text-xs mb-3">
            <p>Plan confirmado: {{ configPlan.before }} → {{ configPlan.after }}. Instancia: {{ configPlan.path }}.</p>
            <p>Reversión prevista: restaurar «{{ configPlan.before }}» en esa misma instancia, con autorización.</p>
            <button type="button" class="btn-secondary" @click="downloadWifiPlan">Descargar respaldo SSID</button>
            <button type="button" class="btn-secondary" @click="verifyWifiCache">Comparar caché sin refrescar</button>
          </div>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="configModalDevice = null">Cerrar</button>
            <button v-if="canPrepareWifi" type="submit" :disabled="configSaving || configLoadingCurrent || !!configTrial?.record" class="btn-primary">
              {{ configSaving ? 'Procesando...' : configTrial?.enabled ? 'Guardar SSID' : 'Preparar sin aplicar' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
