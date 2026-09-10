import { defineStore } from 'pinia';
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
}

export interface PppSecret {
  '.id': string;
  name: string;
  service: string;
  profile: string;
  disabled: string; // "true" | "false", tal cual lo devuelve RouterOS
  comment?: string;
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

  function fetchPppActive(id: string) {
    return apiFetch<PppActive[]>(`/api/mikrotik-devices/${id}/ppp-active`);
  }

  function fetchDhcpLeases(id: string) {
    return apiFetch<DhcpLease[]>(`/api/mikrotik-devices/${id}/dhcp-leases`);
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
    fetchPppActive,
    fetchDhcpLeases,
  };
});
