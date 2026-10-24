import { acceptHMRUpdate, defineStore } from 'pinia';
import { ref } from 'vue';
import { apiFetch } from '@/lib/api';
import type { MikrotikDeviceRole } from '@/lib/mikrotikDeviceRole';

export interface MikrotikDevice {
  id: string;
  name: string;
  host: string;
  port: number;
  use_tls: boolean;
  username: string;
  zone_id: string | null;
  is_active: boolean;
  device_role: MikrotikDeviceRole;
  monitored_interface_name: string | null;
  uplink_interface_name: string | null;
  capacity_download_mbps: number;
  capacity_upload_mbps: number;
  created_at: string;
  latitude: number | null;
  longitude: number | null;
}

// ---- Fase 169: trafico del borde dedicado ----

export type MonitoredLinkStatus = 'ok' | 'not_configured' | 'offline' | 'warming_up';

export interface MikrotikTrafficLive {
  status: MonitoredLinkStatus;
  message?: string;
  fetchedAt?: string;
  monitoredInterfaceName?: string;
  uplinkInterfaceName?: string | null;
  monitoredRunning?: boolean;
  monitoredDisabled?: boolean;
  rxBps?: number;
  txBps?: number;
  version?: string | null;
  boardName?: string | null;
  uptime?: string | null;
  cpuLoadPercent?: number | null;
  freeMemoryBytes?: number | null;
  totalMemoryBytes?: number | null;
}

export interface MikrotikTrafficHistoryPoint {
  bucket_start: string;
  avg_rx_bps: number | null;
  avg_tx_bps: number | null;
  max_rx_bps: number | null;
  max_tx_bps: number | null;
  samples: number;
  online_samples: number;
}

export type TrafficHistoryRange = '15m' | '1h' | '24h' | '7d';

export interface MikrotikTrafficHistoryResponse {
  range: TrafficHistoryRange;
  points: MikrotikTrafficHistoryPoint[];
}

export interface MikrotikSaturationAlert {
  id: string;
  direction: 'download' | 'upload';
  status: 'active' | 'resolved';
  started_at: string;
  resolved_at: string | null;
  peak_bps: number;
  threshold_bps: number;
}

export interface MikrotikInterface {
  '.id': string;
  name: string;
  type: string;
  running: string; // "true" | "false"
  disabled: string; // "true" | "false"
  'rx-byte'?: string;
  'tx-byte'?: string;
  comment?: string;
}

export interface PppSecret {
  '.id': string;
  name: string;
  service: string;
  profile: string;
  disabled: string; // "true" | "false", tal cual lo devuelve RouterOS
  comment?: string;
}

export interface PppProfile {
  '.id': string;
  name: string;
  'local-address'?: string;
  'remote-address'?: string;
  'rate-limit'?: string;
}

export interface PppActive {
  '.id': string;
  name: string;
  address: string;
  uptime: string;
}

export interface DhcpLease {
  '.id': string;
  address: string;
  'mac-address': string;
  'host-name'?: string;
  status: string;
}

export interface IpAddress {
  '.id': string;
  address: string;
  network: string;
  interface: string;
  disabled: string; // "true" | "false", tal cual lo devuelve RouterOS
}

export interface RouterResource {
  'cpu-load': string;
  'free-memory': string;
  'total-memory': string;
  version: string;
  uptime: string;
  'board-name'?: string;
}

export interface ReconcileMismatch {
  contractId: string;
  contractNumber: string;
  deviceName: string;
  pppoeUsername: string;
  kind: 'profile_actualizado' | 'secreto_no_encontrado' | 'estado_inconsistente';
  detail: string;
}

export interface ReconcileReport {
  ranAt: string;
  deviceId: string;
  deviceName: string;
  contractsChecked: number;
  profilesUpdated: number;
  mismatches: ReconcileMismatch[];
  error: string | null;
}

export const useMikrotikStore = defineStore('mikrotik', () => {
  const devices = ref<MikrotikDevice[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchDevices() {
    loading.value = true;
    error.value = null;
    try {
      devices.value = await apiFetch<MikrotikDevice[]>('/api/mikrotik-devices');
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Error al cargar los routers';
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function createDevice(payload: Record<string, unknown>) {
    const device = await apiFetch<MikrotikDevice>('/api/mikrotik-devices', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    devices.value.unshift(device);
    return device;
  }

  async function updateDevice(id: string, payload: Record<string, unknown>) {
    const device = await apiFetch<MikrotikDevice>(`/api/mikrotik-devices/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    const idx = devices.value.findIndex((d) => d.id === id);
    if (idx !== -1) devices.value[idx] = device;
    return device;
  }

  async function deleteDevice(id: string) {
    await apiFetch(`/api/mikrotik-devices/${id}`, { method: 'DELETE' });
    devices.value = devices.value.filter((d) => d.id !== id);
  }

  async function testDevice(id: string) {
    return apiFetch<{ status: string; ms?: number; message?: string; resource?: RouterResource }>(
      `/api/mikrotik-devices/${id}/test`,
      { method: 'POST' },
    );
  }

  function fetchResource(id: string) {
    return apiFetch<RouterResource>(`/api/mikrotik-devices/${id}/resource`);
  }

  function fetchPppSecrets(id: string) {
    return apiFetch<PppSecret[]>(`/api/mikrotik-devices/${id}/ppp-secrets`);
  }

  // Alta de un secreto PPPoE nuevo (antes solo se creaba a mano en Winbox) —
  // usado por AuthorizeOnuModal.vue para activar el servicio del cliente.
  function createPppSecret(id: string, payload: { name: string; password: string; profile: string; comment?: string }) {
    return apiFetch<PppSecret>(`/api/mikrotik-devices/${id}/ppp-secrets`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  function togglePppSecret(id: string, secretId: string, disabled: boolean) {
    return apiFetch<PppSecret>(`/api/mikrotik-devices/${id}/ppp-secrets/${secretId}`, {
      method: 'PUT',
      body: JSON.stringify({ disabled }),
    });
  }

  // El ancho de banda se maneja en la OLT; esto solo cambia el profile del
  // secreto PPPoE (usado, por ejemplo, para reflejar el plan del contrato).
  function setPppSecretProfile(id: string, secretId: string, profile: string) {
    return apiFetch<PppSecret>(`/api/mikrotik-devices/${id}/ppp-secrets/${secretId}`, {
      method: 'PUT',
      body: JSON.stringify({ profile }),
    });
  }

  function fetchPppProfiles(id: string) {
    return apiFetch<PppProfile[]>(`/api/mikrotik-devices/${id}/ppp-profiles`);
  }

  function fetchPppActive(id: string) {
    return apiFetch<PppActive[]>(`/api/mikrotik-devices/${id}/ppp-active`);
  }

  // Fuerza la reconexion de una sesion PPPoE activa (RouterOS no aplica un
  // cambio de profile del secreto a una sesion ya conectada).
  function disconnectPppActive(id: string, activeId: string) {
    return apiFetch<{ ok: true }>(`/api/mikrotik-devices/${id}/ppp-active/${activeId}`, { method: 'DELETE' });
  }

  function fetchDhcpLeases(id: string) {
    return apiFetch<DhcpLease[]>(`/api/mikrotik-devices/${id}/dhcp-leases`);
  }

  function fetchIpAddresses(id: string) {
    return apiFetch<IpAddress[]>(`/api/mikrotik-devices/${id}/ip-addresses`);
  }

  function fetchInterfaces(id: string) {
    return apiFetch<MikrotikInterface[]>(`/api/mikrotik-devices/${id}/interfaces`);
  }

  function fetchTrafficLive(id: string) {
    return apiFetch<MikrotikTrafficLive>(`/api/mikrotik-devices/${id}/traffic-live`);
  }

  function fetchTrafficHistory(id: string, range: TrafficHistoryRange) {
    return apiFetch<MikrotikTrafficHistoryResponse>(`/api/mikrotik-devices/${id}/traffic-history?range=${range}`);
  }

  function fetchSaturationAlerts(id: string) {
    return apiFetch<MikrotikSaturationAlert[]>(`/api/mikrotik-devices/${id}/saturation-alerts`);
  }

  // Fase 170: la reconciliacion es por router (nunca "todos" en una sola
  // llamada) — se consulta/corre desde el detalle de CADA router administrador.
  function fetchReconcileReport(id: string) {
    return apiFetch<ReconcileReport | null>(`/api/mikrotik-devices/${id}/reconcile/report`);
  }

  function runReconcileNow(id: string) {
    return apiFetch<ReconcileReport>(`/api/mikrotik-devices/${id}/reconcile/run`, { method: 'POST' });
  }

  return {
    devices,
    loading,
    error,
    fetchDevices,
    createDevice,
    updateDevice,
    deleteDevice,
    testDevice,
    fetchResource,
    fetchPppSecrets,
    createPppSecret,
    togglePppSecret,
    setPppSecretProfile,
    fetchPppProfiles,
    fetchPppActive,
    disconnectPppActive,
    fetchDhcpLeases,
    fetchIpAddresses,
    fetchInterfaces,
    fetchTrafficLive,
    fetchTrafficHistory,
    fetchSaturationAlerts,
    fetchReconcileReport,
    runReconcileNow,
  };
});

// Sin esto, Vite recarga el modulo del store en caliente pero Pinia sigue
// devolviendo la instancia vieja ya creada (acciones nuevas quedan como
// "is not a function" hasta un refresh completo del navegador).
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useMikrotikStore, import.meta.hot));
}
