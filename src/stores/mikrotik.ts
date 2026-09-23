import { acceptHMRUpdate, defineStore } from 'pinia';
import { ref } from 'vue';
import { apiFetch } from '@/lib/api';

export interface MikrotikDevice {
  id: string;
  name: string;
  host: string;
  port: number;
  use_tls: boolean;
  username: string;
  zone_id: string | null;
  is_active: boolean;
  created_at: string;
  latitude: number | null;
  longitude: number | null;
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
  devicesChecked: number;
  contractsChecked: number;
  profilesUpdated: number;
  mismatches: ReconcileMismatch[];
  errors: { deviceName: string; message: string }[];
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

  function fetchReconcileReport() {
    return apiFetch<ReconcileReport | null>('/api/mikrotik-devices/reconcile/report');
  }

  function runReconcileNow() {
    return apiFetch<ReconcileReport>('/api/mikrotik-devices/reconcile/run', { method: 'POST' });
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
    togglePppSecret,
    setPppSecretProfile,
    fetchPppProfiles,
    fetchPppActive,
    disconnectPppActive,
    fetchDhcpLeases,
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
