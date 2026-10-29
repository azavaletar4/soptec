<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
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
import { plainWifiTrialMessage, type WifiTrialStatus } from '@/lib/tr069WifiTrial';
import { hostConnectionLabel, hostStatusLabel, hostStatusReadAt, hostWifiSignalPresentation, latestHostsReport } from '@/lib/tr069Hosts';
import { createHostsPanelController, emptyHostsPanelState } from '@/lib/tr069HostsPanel';
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
const showSaved = ref(false);

async function handleReadInventory() {
  await tr069Store.fetchDevices();
  await loadOntStatuses();
}

const expandedId = ref<string | null>(null);
const metricsById = ref<Record<string, Tr069PerformanceMetric | null>>({});
const metricsLoadingId = ref<string | null>(null);

// Solo abrir Hosts o Actualizar inicia/comprueba una lectura. El detalle general
// y los renders no consultan Hosts. Otros roles conservan únicamente GET de caché.
const canReadHostsActively = computed(() => ['ADMIN', 'SUPERADMIN'].includes(auth.role ?? ''));
const hostsPanel = reactive(emptyHostsPanelState());
const hostsById = computed(() => hostsPanel.inventory);
const hostsController = createHostsPanelController(hostsPanel, async (serial, active) => {
  if (active) return tr069Store.readHostsOnDemand(serial);
  const inventory = await tr069Store.fetchHosts(serial);
  const at = new Date().toISOString();
  return { state: 'completed', requestedAt: at, checkedAt: at, inventory, message: 'Información guardada. No se consultó al equipo.' };
});
const signalColors = { good: 'text-emerald-700', fair: 'text-amber-600', poor: 'text-red-700' };
// Vista simple: "Todos" (incluye los ya conocidos sin lectura reciente) o solo
// "Conectados" ahora mismo — nunca oculta datos, solo reduce qué se muestra.
const hostsFilter = ref<'all' | 'connected'>('all');
function visibleHosts(deviceId: string) {
  const inventory = hostsById.value[deviceId];
  if (!inventory) return [];
  if (hostsFilter.value === 'all') return inventory.hosts;
  return inventory.hosts.filter(h => hostStatusLabel(h, inventory.lastInform, ontEvidenceNow.value) === 'Conectado');
}
const signalLabels = { good: 'Buena', fair: 'Regular', poor: 'Débil' };

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
const configForm = ref({ wifiSsid: '', wifiPassword: '' });
const configDeviceId = ref<string | null>(null);
const configCanonicalSerial = ref<string | null>(null);
const configPlan = ref<WifiSsidPlan | null>(null);
const configTrial = ref<WifiTrialStatus | null>(null);
const configWifiNetworks = ref<WifiNetwork[]>([]);
const configWifiPath = ref('');
const configSelectedNetwork = computed(() => configWifiNetworks.value.find(n => n.path === configWifiPath.value));
// Al elegir una red se precarga su nombre actual: si el administrador no lo toca, el envío no
// cambia el SSID (puede escribir solo la contraseña nueva), igual que en SmartOLT.
watch(configWifiPath, (path) => {
  configForm.value.wifiSsid = configWifiNetworks.value.find(n => n.path === path)?.ssid ?? '';
});
const configLoadingCurrent = ref(false);
const configSaving = ref(false);
const configError = ref<string | null>(null);
const configResult = ref<string | null>(null);
// Lo que ve el administrador: igual contenido, sin jerga TR-069/GenieACS (regla de usabilidad).
const configDisplayError = computed(() => plainWifiTrialMessage(configError.value));
const configDisplayResult = computed(() => plainWifiTrialMessage(configResult.value));
const WIFI_OPERATION_STATE_LABELS: Record<string, string> = {
  sending: 'Enviando…', queued: 'Enviado, esperando confirmación del equipo',
  uncertain: 'Resultado incierto, no repetir', failed: 'Con error, revisar antes de repetir', verified: 'Confirmado',
  unconfirmed: 'No se puede confirmar por esta vía', stuck: 'Sin respuesta del equipo, sigue pendiente',
};
const configOperationStateLabel = computed(() => {
  const state = configTrial.value?.record?.operations.at(-1)?.state;
  return state ? (WIFI_OPERATION_STATE_LABELS[state] ?? state) : null;
});
const showPassword = ref(false);
// Solo una tarea sin confirmar bloquea un envío nuevo (protección real contra duplicados);
// un cambio ya confirmado (verificado, con error o sin poder confirmarse) no debe dejar el
// botón deshabilitado para siempre — ese fue el bloqueo reportado en producción tras el primer
// cambio de SSID. "stuck" sigue bloqueando: la tarea anterior técnicamente sigue sin resolver.
const configHasPendingOperation = computed(() => {
  const state = configTrial.value?.record?.operations.at(-1)?.state;
  return state === 'sending' || state === 'queued' || state === 'uncertain' || state === 'stuck';
});
// Mensaje principal simplificado (regla de usabilidad): según el resultado REALMENTE confirmado
// por el backend — nunca jerga ni el detalle técnico aquí. "No se pudo confirmar" es un
// resultado real y distinto de un fallo: no hay que mentir diciendo que falló algo que en
// realidad el equipo nunca permite verificar (ver hallazgo del 28/10/2026 en ESTADO_DESARROLLO.md).
const configStatusLabel = computed(() => {
  if (configSaving.value) return 'Guardando cambios…';
  const state = configTrial.value?.record?.operations.at(-1)?.state;
  if (state === 'sending' || state === 'queued') return 'Guardando cambios…';
  if (state === 'stuck') return 'Sigue pendiente: el equipo no respondió todavía';
  if (state === 'verified') return 'Cambio realizado';
  if (state === 'unconfirmed') return 'No se pudo confirmar';
  if (state === 'failed' || state === 'uncertain') return 'No se pudo completar el cambio';
  return null;
});
const configStatusTone = computed<'success' | 'warning' | 'error' | null>(() => {
  const label = configStatusLabel.value;
  if (label === 'Cambio realizado') return 'success';
  if (label === 'No se pudo completar el cambio') return 'error';
  if (label === 'Sigue pendiente: el equipo no respondió todavía' || label === 'No se pudo confirmar') return 'warning';
  return null;
});

async function openConfigModal(device: Tr069Device) {
  configModalDevice.value = device;
  configForm.value = { wifiSsid: '', wifiPassword: '' };
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

async function runWifiTrial(action: 'change' | 'restore') {
  const device = configModalDevice.value;
  if (!device || !canPrepareWifi.value || !configTrial.value?.enabled || configSaving.value) return;
  const network = configSelectedNetwork.value;
  const restore = action === 'restore';
  if (action === 'change' && (!network || network.path !== 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5' ||
    network.ssid === null || !network.timestamp || !configForm.value.wifiSsid.trim())) {
    configError.value = 'Selecciona la red WiFi de prueba y escribe un nuevo nombre.'; return;
  }
  const wantsPassword = !restore && configForm.value.wifiPassword.trim().length > 0;
  const payload = restore ? { requestId: crypto.randomUUID(), confirmed: true } : {
    requestId: crypto.randomUUID(), confirmed: true, deviceId: configDeviceId.value, path: network!.path,
    ssid: configForm.value.wifiSsid, expectedSsid: network!.ssid, expectedTimestamp: network!.timestamp,
    ...(wantsPassword ? { password: configForm.value.wifiPassword } : {}),
  };
  configForm.value.wifiPassword = ''; // Nunca se conserva en el formulario una vez armado el envío.
  const target = restore ? configTrial.value.record?.originalSsid : configForm.value.wifiSsid;
  const message = `Actual: ${restore ? configTrial.value.record?.operations.at(-1)?.after : network!.ssid}\nNuevo nombre: ${target}\n` +
    (restore ? 'Se restaurará el nombre anterior guardado.' : 'Se guardará el nombre actual como respaldo antes de enviar el cambio.') +
    (wantsPassword ? '\nTambién se cambiará la contraseña WiFi. Los dispositivos ya conectados a esta red perderán la conexión hasta que se les escriba la contraseña nueva manualmente. SmartRayco no guarda la contraseña anterior: si necesitas deshacer este cambio, deberás volver a escribirla aquí.' : '') +
    '\nNo se cambiarán PPPoE, WAN ni VLAN. El equipo lo aplicará en los próximos minutos.';
  if (!await confirmDialog({ title: restore ? 'Restaurar nombre WiFi anterior' : wantsPassword ? 'Aplicar cambio de WiFi' : 'Aplicar cambio de nombre WiFi',
    confirmLabel: restore ? 'Restaurar nombre' : 'Aplicar cambios', message, wrapMessage: true })) return;
  if (configModalDevice.value?.id !== device.id) return;
  configSaving.value = true; configError.value = null;
  try {
    configTrial.value = await tr069Store.wifiTrialAction(device.cpe_serial, action, payload);
    configResult.value = configTrial.value.message;
  } catch (e) { configError.value = getErrorMessage(e, 'No se confirmó la operación. Consulta el estado antes de repetir.'); }
  finally { configSaving.value = false; }
}

/** Un único botón "Comprobar estado": combina la lectura de estado y, si corresponde, la
 * confirmación puntual del SSID. Nunca encola una tarea nueva si no hace falta (ver wifiTrial.verify). */
async function checkWifiTrialStatus() {
  const device = configModalDevice.value;
  if (!device || configSaving.value) return;
  configSaving.value = true; configError.value = null;
  try {
    configTrial.value = await tr069Store.wifiTrialAction(device.cpe_serial, 'verify');
    configResult.value = configTrial.value.message;
    const inventory = await tr069Store.fetchWifiNetworks(device.cpe_serial);
    if (configModalDevice.value?.id === device.id) configWifiNetworks.value = inventory.networks;
  } catch (e) { configError.value = getErrorMessage(e, 'No se pudo comprobar el estado'); }
  finally { configSaving.value = false; }
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

function formatHostDate(value: string | null) {
  if (!value) return 'Sin confirmar';
  return new Date(value).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Lima' });
}

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
    hostsController.close(device.id);
    return;
  }
  if (expandedId.value) hostsController.close(expandedId.value);
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
        <p class="text-slate-600 text-sm mt-1">{{ tr069Store.inventory ? `${tr069Store.devices.length} CPE registrados en la última comprobación de GenieACS` : 'Inventario actual de GenieACS sin verificar' }}</p>
        <p v-if="tr069Store.inventory" class="text-xs text-slate-500">Comprobado: {{ formatDate(tr069Store.inventory.checkedAt) }} · Estar registrado no confirma que el CPE esté conectado ahora.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn-ghost" :disabled="tr069Store.loading" @click="handleReadInventory">Actualizar lista</button>
        <button class="btn-ghost" :disabled="collectingAll || !tr069Store.devices.length || !!tr069Store.inventoryWarning" @click="handleCollectAll">
          {{ collectingAll ? 'Recolectando...' : 'Recolectar métricas' }}
        </button>
        <button class="btn-primary" :disabled="tr069Store.syncing" @click="handleSync">
          {{ tr069Store.syncing ? 'Sincronizando...' : 'Sincronizar con GenieACS' }}
        </button>
      </div>
    </div>

    <p v-if="actionMessage" class="mb-4 text-sm text-emerald-600">{{ actionMessage }}</p>
    <p v-if="actionError" class="mb-4 text-sm text-red-600">{{ actionError }}</p>
    <p v-if="tr069Store.inventoryWarning" role="status" class="mb-4 text-sm text-amber-700">{{ tr069Store.inventoryWarning }}</p>
    <p v-if="tr069Store.error" role="status" class="mb-4 text-sm text-amber-700">{{ tr069Store.error }}</p>

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
              {{ tr069Store.inventory ? 'La última consulta completa de GenieACS no contiene CPE registrados.' : 'No se ha podido confirmar el inventario actual. Los registros guardados se muestran por separado.' }}
            </td>
          </tr>
          <template v-for="device in tr069Store.devices" :key="device.id">
            <tr class="border-t border-slate-200 hover:bg-slate-50" @click="device.registeredLocally && toggleExpand(device)">
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
                <span v-else-if="!device.registeredLocally" class="text-slate-500 text-xs">Pendiente de sincronizar · sin contrato asignado</span>
                <span v-else class="text-slate-500 text-xs">Sin vincular</span>
              </td>
              <td class="px-4 py-3 text-slate-600">{{ formatDate(device.last_seen_at) }}</td>
              <td class="px-4 py-3 text-right space-x-3 whitespace-nowrap text-xs" @click.stop>
                <span v-if="!device.registeredLocally" class="text-slate-500">Sincroniza para gestionar este CPE</span>
                <template v-else>
                <button class="text-sky-600 hover:underline" @click="openLinkModal(device)">Vincular</button>
                <button class="text-sky-600 hover:underline" @click="openConfigModal(device)">Configurar</button>
                <button class="text-slate-600 hover:underline" :disabled="refreshingId === device.id" @click="handleRefresh(device)">
                  {{ refreshingId === device.id ? 'Pidiendo...' : 'Refrescar' }}
                </button>
                <button class="text-amber-600 hover:underline" :disabled="rebootingId === device.id" @click="handleReboot(device)">
                  {{ rebootingId === device.id ? 'Reiniciando...' : 'Reiniciar' }}
                </button>
                <button class="text-slate-600 hover:underline" @click="toggleExpand(device)">
                  {{ expandedId === device.id ? 'Ocultar' : 'Detalle' }}
                </button>
                </template>
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

                <div class="mt-4 pt-4 border-t border-slate-200">
                  <div class="flex items-center justify-between mb-2">
                    <button type="button" class="text-sm font-semibold text-slate-700 hover:underline" :aria-expanded="!!hostsPanel.opened[device.id]" @click="hostsController.toggle(device.id, device.cpe_serial, canReadHostsActively)">
                      Dispositivos conectados · {{ hostsPanel.opened[device.id] ? 'Ocultar' : 'Mostrar' }}
                    </button>
                    <button v-if="hostsPanel.opened[device.id]" type="button" class="text-sky-600 hover:underline text-xs" :disabled="hostsPanel.loading[device.id]" @click="hostsController.refresh(device.id, device.cpe_serial, canReadHostsActively)">
                      {{ hostsPanel.loading[device.id] ? 'Consultando...' : 'Actualizar' }}
                    </button>
                  </div>
                  <template v-if="hostsPanel.opened[device.id]">
                  <p v-if="hostsPanel.errors[device.id]" role="alert" class="text-xs text-red-600">{{ hostsPanel.errors[device.id] }}</p>
                  <p v-if="hostsPanel.loading[device.id]" role="status" class="text-xs text-slate-500">Consultando al equipo. La lista anterior puede seguir visible mientras responde.</p>
                  <p v-if="hostsPanel.result[device.id]" role="status" class="text-xs text-slate-500 mb-2">
                    Última solicitud: {{ formatHostDate(hostsPanel.result[device.id]!.requestedAt) }}.
                    {{ hostsPanel.result[device.id]!.message }}
                  </p>
                  <template v-if="hostsById[device.id]">
                    <p v-if="!hostsById[device.id]!.found" class="text-xs text-amber-700">No se pudo identificar este equipo en GenieACS para leer sus dispositivos conectados.</p>
                    <template v-else>
                      <p v-if="!hostsById[device.id]!.hosts.length" class="text-xs text-slate-500">Este equipo no reportó ningún dispositivo conectado.</p>
                      <template v-else>
                        <div class="flex items-center justify-between mb-2 gap-2 flex-wrap">
                          <p class="text-xs text-slate-500">
                            Última información de la lista: {{ formatHostDate(latestHostsReport(hostsById[device.id]!, ontEvidenceNow)) }}.
                            «Sin confirmar» indica información histórica o insuficiente: hace falta una lectura válida de los últimos 10 minutos.
                          </p>
                          <div class="flex gap-1 text-xs shrink-0" role="group" aria-label="Filtrar dispositivos">
                            <button type="button" class="px-2 py-0.5 rounded border" :class="hostsFilter === 'all' ? 'bg-slate-700 text-white border-slate-700' : 'border-slate-300 text-slate-600'" @click="hostsFilter = 'all'">Todos ({{ hostsById[device.id]!.hosts.length }})</button>
                            <button type="button" class="px-2 py-0.5 rounded border" :class="hostsFilter === 'connected' ? 'bg-slate-700 text-white border-slate-700' : 'border-slate-300 text-slate-600'" @click="hostsFilter = 'connected'">Conectados ({{ visibleHosts(device.id).length }})</button>
                          </div>
                        </div>
                        <p v-if="!visibleHosts(device.id).length" class="text-xs text-slate-500">Ningún dispositivo conocido está conectado ahora mismo.</p>
                        <div v-else class="overflow-x-auto">
                          <table class="w-full text-xs">
                            <thead class="text-slate-500">
                              <tr>
                                <th class="text-left py-1 pr-3">Dispositivo</th>
                                <th class="text-left py-1 pr-3">IP</th>
                                <th class="text-left py-1 pr-3">MAC</th>
                                <th class="text-left py-1 pr-3">Conexión</th>
                                <th class="text-left py-1 pr-3">Estado</th>
                                <th class="text-left py-1 pr-3">Señal WiFi</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr v-for="(host, i) in visibleHosts(device.id)" :key="i" class="border-t border-slate-100">
                                <td class="py-1 pr-3">{{ host.hostName ?? 'No disponible' }}</td>
                                <td class="py-1 pr-3 font-mono">{{ host.ipAddress ?? 'No disponible' }}</td>
                                <td class="py-1 pr-3 font-mono">{{ host.macAddress ?? 'No disponible' }}</td>
                                <td class="py-1 pr-3">{{ hostConnectionLabel(host, hostsById[device.id]!.lastInform, ontEvidenceNow) }}</td>
                                <td class="py-1 pr-3">
                                  {{ hostStatusLabel(host, hostsById[device.id]!.lastInform, ontEvidenceNow) }}
                                  <span class="block text-[11px] text-slate-500">{{ hostStatusReadAt(host, ontEvidenceNow) ? `Última lectura: ${formatHostDate(hostStatusReadAt(host, ontEvidenceNow))}` : 'Lectura sin fecha' }}</span>
                                </td>
                                <td class="py-1 pr-3">
                                  <span v-if="hostWifiSignalPresentation(host, hostsById[device.id]!.lastInform, ontEvidenceNow).level" :class="signalColors[hostWifiSignalPresentation(host, hostsById[device.id]!.lastInform, ontEvidenceNow).level!]" aria-hidden="true">● </span>
                                  {{ hostWifiSignalPresentation(host, hostsById[device.id]!.lastInform, ontEvidenceNow).label }}
                                  <span v-if="hostWifiSignalPresentation(host, hostsById[device.id]!.lastInform, ontEvidenceNow).level"> · {{ signalLabels[hostWifiSignalPresentation(host, hostsById[device.id]!.lastInform, ontEvidenceNow).level!] }}</span>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </template>
                    </template>
                  </template>
                  </template>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <section class="surface p-4 mt-4" aria-label="Registros históricos de TR-069">
      <button class="btn-ghost" :aria-expanded="showSaved" @click="showSaved = !showSaved">{{ showSaved ? 'Ocultar' : 'Ver' }} registros guardados ({{ tr069Store.historicalDevices.length + tr069Store.unverifiedDevices.length }})</button>
      <div v-if="showSaved" class="mt-3 space-y-3">
        <p class="text-sm text-slate-600">Se conservan contratos, asociaciones y métricas. No se borra ni desvincula ningún equipo automáticamente.</p>
        <p v-if="!tr069Store.historicalDevices.length && !tr069Store.unverifiedDevices.length" class="text-sm text-slate-500">Sin registros guardados fuera del inventario comprobado.</p>
        <article v-for="device in tr069Store.historicalDevices" :key="device.id" class="border-t pt-3 text-sm">
          <p class="font-mono break-all">{{ device.cpe_serial }} · {{ device.model_name || device.cpe_product_class || 'Modelo no registrado' }}</p>
          <p class="text-amber-700">Histórico: ausente en la última consulta completa del ACS</p>
          <p>Contrato conservado: {{ device.contracts?.contract_number || 'Sin vincular' }}</p>
          <p class="text-slate-500">Último reporte guardado: {{ formatDate(device.last_seen_at) }}</p>
        </article>
        <article v-for="device in tr069Store.unverifiedDevices" :key="device.id" class="border-t pt-3 text-sm">
          <p class="font-mono break-all">{{ device.cpe_serial }} · {{ device.model_name || device.cpe_product_class || 'Modelo no registrado' }}</p>
          <p class="text-amber-700">Presencia sin verificar: no se acredita que esté retirado</p>
          <p>Contrato conservado: {{ device.contracts?.contract_number || 'Sin vincular' }}</p>
        </article>
      </div>
    </section>

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
          <h2 class="text-lg font-semibold mb-1">Configurar WiFi</h2>
          <p class="text-xs text-slate-500 mb-3">
            {{ configTrial?.enabled ? 'Puedes cambiar el nombre y, si quieres, también la contraseña de esta red.' : 'Preparación sin aplicar; solo guarda un plan descargable.' }}
            PPPoE y otras redes no se tocan desde aquí.
          </p>

          <p v-if="configLoadingCurrent" class="text-xs text-slate-500 mb-3">Consultando el equipo...</p>

          <div class="mb-3">
            <p v-if="!configLoadingCurrent && !configWifiNetworks.length" class="text-xs text-amber-700 mb-2">
              No se encontraron redes WiFi para este equipo.
            </p>
            <div v-if="configWifiNetworks.length" class="mb-2">
              <label class="block text-xs text-slate-600 mb-1">Red WiFi</label>
              <select v-model="configWifiPath" class="field-input">
                <option value="">Selecciona una red</option>
                <option v-for="n in configWifiNetworks" :key="n.path" :value="n.path" :disabled="configTrial?.enabled && n.path !== 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5'">{{ n.ssid ?? 'Nombre no disponible' }} — {{ n.band }}</option>
              </select>
            </div>
            <div class="mb-2">
              <label class="block text-xs text-slate-600 mb-1">Nombre de la red</label>
              <input v-model="configForm.wifiSsid" class="field-input" placeholder="Nombre de esta red" />
            </div>
            <div class="mb-2">
              <label class="block text-xs text-slate-600 mb-1">Nueva contraseña (opcional)</label>
              <div class="flex gap-2">
                <input
                  v-model="configForm.wifiPassword"
                  :type="showPassword ? 'text' : 'password'"
                  autocomplete="new-password"
                  class="field-input"
                  disabled
                  placeholder="No disponible por ahora"
                />
                <button type="button" class="btn-ghost text-xs whitespace-nowrap" @click="showPassword = !showPassword">{{ showPassword ? 'Ocultar' : 'Mostrar' }}</button>
              </div>
              <p class="text-xs text-amber-700 mt-1">Cambio de contraseña: no disponible por ahora. Este equipo no confirma de forma confiable que una contraseña nueva se aplique.</p>
            </div>
          </div>

          <p v-if="configDisplayError" class="text-sm text-red-600 mb-3">{{ configDisplayError }}</p>
          <p v-if="!configTrial?.enabled && configDisplayResult" role="status" class="text-sm text-slate-700 mb-3">{{ configDisplayResult }}</p>
          <div v-if="configTrial?.enabled && configStatusLabel" class="flex items-center gap-2 mb-3">
            <p role="status" class="text-sm" :class="configStatusTone === 'error' ? 'text-red-600' : configStatusTone === 'warning' ? 'text-amber-700' : configStatusTone === 'success' ? 'text-emerald-700' : 'text-slate-700'">{{ configStatusLabel }}</p>
            <button v-if="configTrial.record" type="button" class="text-xs text-sky-600 hover:underline" :disabled="configSaving" @click="checkWifiTrialStatus">Actualizar estado</button>
          </div>

          <details class="text-xs text-slate-500 mb-3">
            <summary class="cursor-pointer select-none">Detalles técnicos y recuperación</summary>
            <div class="mt-2 space-y-1">
              <p class="font-mono">Serial TR-069: {{ configModalDevice.cpe_serial }}</p>
              <p v-if="configCanonicalSerial">Serial GPON completo: {{ configCanonicalSerial }}</p>
              <p v-if="configDeviceId" class="break-all">Dispositivo GenieACS: {{ configDeviceId }}</p>
              <p v-if="configWifiPath" class="break-all">Instancia TR-069: {{ configWifiPath }}</p>
              <p v-if="configWifiPath">Fecha del nombre en caché (Perú): {{ configSelectedNetwork?.timestamp ? new Date(configSelectedNetwork.timestamp).toLocaleString('es-PE', { timeZone: 'America/Lima' }) : 'Sin fecha verificable' }}.</p>
              <p v-if="configTrial?.enabled && configDisplayResult">{{ configDisplayResult }}</p>
              <template v-if="configTrial?.record">
                <p>Nombre anterior: {{ configTrial.record.operations.at(-1)?.before }}. Nombre enviado: {{ configTrial.record.operations.at(-1)?.after }}.</p>
                <p v-if="configTrial.record.operations.at(-1)?.passwordChanged">También se incluyó una contraseña nueva en esta operación.</p>
                <p>Respaldo persistente: {{ configTrial.record.originalSsid }}. Instancia: {{ configTrial.record.path }}. Estado interno: {{ configOperationStateLabel }}.</p>
                <p v-if="configTrial.record.operations.at(-1)?.afterPasswordHash" class="break-all">Huella de la contraseña enviada (SHA-256, nunca el valor real): {{ configTrial.record.operations.at(-1)?.afterPasswordHash }}</p>
                <p v-if="configTrial.record.operations.at(-1)?.passwordChanged" class="text-amber-700">
                  Restaurar solo recupera el nombre anterior; la contraseña no se revierte automáticamente.
                </p>
                <div class="flex flex-wrap gap-2 pt-1">
                  <button type="button" class="btn-secondary" :disabled="configSaving || configTrial.record.operations.at(-1)?.state !== 'verified' || configTrial.record.operations.at(-1)?.kind !== 'change'" @click="runWifiTrial('restore')">Restaurar nombre anterior</button>
                  <button type="button" class="btn-secondary" @click="downloadWifiPlan">Descargar respaldo</button>
                </div>
              </template>
              <template v-if="configPlan">
                <p>Plan preparado: {{ configPlan.before }} → {{ configPlan.after }}. No se envió al equipo.</p>
                <div class="flex flex-wrap gap-2 pt-1">
                  <button type="button" class="btn-secondary" @click="downloadWifiPlan">Descargar respaldo</button>
                  <button type="button" class="btn-secondary" @click="verifyWifiCache">Comparar con la caché actual</button>
                </div>
              </template>
            </div>
          </details>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="configModalDevice = null">Cerrar</button>
            <button v-if="canPrepareWifi" type="submit" :disabled="configSaving || configLoadingCurrent || configHasPendingOperation" class="btn-primary">
              {{ configSaving ? 'Guardando…' : configTrial?.enabled ? 'Guardar cambios' : 'Preparar sin aplicar' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
