<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useTr069Store } from '@/stores/tr069';
import { useClientsStore } from '@/stores/clients';
import { useContractsStore } from '@/stores/contracts';
import { useOltStore, type OltOnt } from '@/stores/olt';
import { getErrorMessage } from '@/lib/errors';
import type { ServiceContract, Tr069Device, Tr069PerformanceMetric } from '@/types/domain';
import type { WifiNetwork } from '@/stores/tr069';

const tr069Store = useTr069Store();
const clientsStore = useClientsStore();
const contractsStore = useContractsStore();
const oltStore = useOltStore();

// Estado online/offline real de la ONU (olt_onts.status), por numero de
// serie del CPE — distinto del "ultimo reporte" de GenieACS (ese es TR-069,
// esto es lo que ve la OLT por GPON).
const ontStatusBySerial = ref<Record<string, { status: OltOnt['status']; description: string | null }>>({});

async function loadOntStatuses() {
  const serials = tr069Store.devices.map((d) => d.cpe_serial).filter(Boolean);
  if (!serials.length) return;
  try {
    ontStatusBySerial.value = await oltStore.fetchOntStatusBySerials(serials);
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

// ---- Configurar equipo via TR-069 (PPPoE + WiFi, aprovisionar de una) ----
// Distinto del "Usuario PPPoE" del contrato (ese es el secreto en MikroTik).
// Esto cambia lo que el equipo del cliente realmente usa para conectarse;
// se aplica solo en su proximo Inform (no es instantaneo). Uso exclusivo de
// esta seccion — no se repite en la ficha del cliente.
const configModalDevice = ref<Tr069Device | null>(null);
const configForm = ref({ pppoeUsername: '', pppoePassword: '', wifiSsid: '', wifiPassword: '' });
const configCurrentPppoeUsername = ref<string | null>(null);
const configWifiNetworks = ref<WifiNetwork[]>([]);
const configWifiPath = ref('');
const configLoadingCurrent = ref(false);
const configSaving = ref(false);
const configError = ref<string | null>(null);
const configResult = ref<string | null>(null);

async function openConfigModal(device: Tr069Device) {
  configModalDevice.value = device;
  configForm.value = { pppoeUsername: '', pppoePassword: '', wifiSsid: '', wifiPassword: '' };
  configCurrentPppoeUsername.value = null;
  configWifiNetworks.value = [];
  configWifiPath.value = '';
  configError.value = null;
  configResult.value = null;
  configLoadingCurrent.value = true;
  try {
    const [pppoe, wifi] = await Promise.all([
      tr069Store.fetchPppoeInfo(device.cpe_serial),
      tr069Store.fetchWifiNetworks(device.cpe_serial),
    ]);
    configCurrentPppoeUsername.value = pppoe.username;
    configWifiNetworks.value = wifi.networks;
    configWifiPath.value = wifi.networks[0]?.path ?? '';
    if (!pppoe.found) configError.value = 'El equipo no aparece en GenieACS todavia (nunca informo TR-069, o el ACS URL esta mal).';
  } catch (e) {
    configError.value = getErrorMessage(e, 'Error al consultar GenieACS');
  } finally {
    configLoadingCurrent.value = false;
  }
}

async function handleSaveConfig() {
  if (!configModalDevice.value) return;
  const f = configForm.value;
  if (!f.pppoeUsername.trim() && !f.pppoePassword.trim() && !f.wifiSsid.trim() && !f.wifiPassword.trim()) {
    configError.value = 'Ingresa al menos un campo a cambiar (PPPoE o WiFi)';
    return;
  }
  configSaving.value = true;
  configError.value = null;
  configResult.value = null;
  try {
    const result = await tr069Store.provisionDevice(configModalDevice.value.cpe_serial, {
      pppoeUsername: f.pppoeUsername.trim() || undefined,
      pppoePassword: f.pppoePassword.trim() || undefined,
      wifiSsid: f.wifiSsid.trim() || undefined,
      wifiPassword: f.wifiPassword.trim() || undefined,
      wlanPath: (f.wifiSsid.trim() || f.wifiPassword.trim()) ? configWifiPath.value || undefined : undefined,
    });
    const parts: string[] = [];
    if (result.pppoe) parts.push(result.pppoe.ok ? 'PPPoE: encolado' : `PPPoE: ${result.pppoe.error ?? 'error'}`);
    if (result.wifi) parts.push(result.wifi.ok ? 'WiFi: encolado' : `WiFi: ${result.wifi.error ?? 'error'}`);
    if (result.ok) {
      configResult.value = `${parts.join(' · ')}. Se aplica solo en el proximo Inform del equipo (no es instantaneo).`;
    } else {
      configError.value = parts.join(' · ') || result.error || 'Error al encolar los cambios';
    }
  } catch (e) {
    configError.value = getErrorMessage(e, 'Error al encolar los cambios en GenieACS');
  } finally {
    configSaving.value = false;
  }
}

// ---- Reiniciar / Refrescar (acciones rapidas por fila) ----
const rebootingId = ref<string | null>(null);
const refreshingId = ref<string | null>(null);

async function handleReboot(device: Tr069Device) {
  if (!confirm(`¿Reiniciar el equipo ${device.cpe_serial}? El cliente va a perder internet unos minutos.`)) return;
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
  return new Date(value).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' });
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
                        : 'Desconocido'
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
                <span v-if="device.contracts" class="badge bg-sky-500/15 text-sky-600">{{ device.contracts.contract_number }}</span>
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
                  <button class="text-sky-600 hover:underline text-xs" @click="refreshDeviceMetrics(device)">Recolectar ahora</button>
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
          <h2 class="text-lg font-semibold mb-1">Configurar equipo (TR-069)</h2>
          <p class="text-xs text-slate-500 mb-4 font-mono">{{ configModalDevice.cpe_serial }}</p>

          <p class="text-xs text-slate-500 mb-3">
            Cambia lo que el equipo del cliente usa realmente (PPPoE y/o WiFi), sin ir a la casa del cliente — pero
            no es instantaneo: recien surte efecto en el proximo Inform. Deja en blanco lo que no quieras cambiar.
          </p>

          <p v-if="configLoadingCurrent" class="text-xs text-slate-500 mb-3">Consultando GenieACS...</p>

          <div class="mb-4 pb-4 border-b border-slate-200">
            <p class="text-xs font-semibold text-slate-700 mb-2">PPPoE</p>
            <p v-if="configCurrentPppoeUsername" class="text-xs text-slate-600 mb-2">
              Usuario actual: <span class="font-mono">{{ configCurrentPppoeUsername }}</span>
            </p>
            <div class="mb-2">
              <label class="block text-xs text-slate-600 mb-1">Nuevo usuario</label>
              <input v-model="configForm.pppoeUsername" class="field-input" placeholder="Dejar vacio para no cambiarlo" />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Nueva clave</label>
              <input v-model="configForm.pppoePassword" class="field-input" placeholder="Dejar vacio para no cambiarla" />
            </div>
          </div>

          <div class="mb-3">
            <p class="text-xs font-semibold text-slate-700 mb-2">WiFi</p>
            <p v-if="!configLoadingCurrent && !configWifiNetworks.length" class="text-xs text-amber-600 mb-2">
              No se encontraron redes WiFi activas en el equipo.
            </p>
            <div v-if="configWifiNetworks.length" class="mb-2">
              <label class="block text-xs text-slate-600 mb-1">Red a cambiar</label>
              <select v-model="configWifiPath" class="field-input">
                <option v-for="n in configWifiNetworks" :key="n.path" :value="n.path">{{ n.ssid || n.path }}</option>
              </select>
            </div>
            <div class="mb-2">
              <label class="block text-xs text-slate-600 mb-1">Nuevo SSID</label>
              <input v-model="configForm.wifiSsid" class="field-input" placeholder="Dejar vacio para no cambiarlo" />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Nueva clave</label>
              <input v-model="configForm.wifiPassword" class="field-input" placeholder="Dejar vacio para no cambiarla" />
            </div>
          </div>

          <p v-if="configError" class="text-sm text-red-600 mb-3">{{ configError }}</p>
          <p v-if="configResult" class="text-sm text-green-600 mb-3">{{ configResult }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="configModalDevice = null">Cerrar</button>
            <button type="submit" :disabled="configSaving" class="btn-primary">
              {{ configSaving ? 'Encolando...' : 'Aplicar cambios' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
