import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiFetch } from '@/lib/api';

export interface OltDevice {
  id: string;
  name: string;
  host: string;
  brand: 'zte' | 'huawei' | 'vsol';
  telnet_port: number;
  username: string;
  zone_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface OltOnt {
  id: string;
  olt_device_id: string;
  client_id: string | null;
  frame: number;
  slot: number;
  port: number;
  ont_id: number;
  serial: string;
  description: string | null;
  onu_type: string | null;
  vlan: number | null;
  tcont_profile: string | null;
  traffic_profile: string | null;
  tr069_enabled: boolean;
  tr069_acs_url: string | null;
  status: 'online' | 'offline' | 'unknown';
  rx_power: number | null;
  tx_power: number | null;
  last_synced_at: string | null;
  clients?: { id: string; first_name: string; last_name: string } | null;
}

export interface OltUptime {
  raw: string;
  totalHours: number;
}

export interface OltSlotTemperature {
  slot: number;
  tempC: number;
}

export interface OltSlotLoad {
  slot: number;
  cpuPercent: number;
  memPercent: number;
}

export interface OltHealth {
  uptime: OltUptime | null;
  temperature: OltSlotTemperature[];
  load: OltSlotLoad[];
  checkedAt: string;
}

export const useOltStore = defineStore('olt', () => {
  const devices = ref<OltDevice[]>([]);
  const onts = ref<OltOnt[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchDevices() {
    loading.value = true;
    error.value = null;
    try {
      devices.value = await apiFetch<OltDevice[]>('/api/olt-devices');
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Error al cargar las OLTs';
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function createDevice(payload: Record<string, unknown>) {
    const device = await apiFetch<OltDevice>('/api/olt-devices', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    devices.value.unshift(device);
    return device;
  }

  async function updateDevice(id: string, payload: Record<string, unknown>) {
    const device = await apiFetch<OltDevice>(`/api/olt-devices/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    const idx = devices.value.findIndex((d) => d.id === id);
    if (idx !== -1) devices.value[idx] = device;
    return device;
  }

  async function deleteDevice(id: string) {
    await apiFetch(`/api/olt-devices/${id}`, { method: 'DELETE' });
    devices.value = devices.value.filter((d) => d.id !== id);
  }

  async function testDevice(id: string) {
    return apiFetch<{ status: string; ms?: number; message?: string }>(`/api/olt-devices/${id}/test`, {
      method: 'POST',
    });
  }

  async function fetchOnts(deviceId: string) {
    onts.value = await apiFetch<OltOnt[]>(`/api/olt-devices/${deviceId}/onts`);
  }

  async function syncOnts(deviceId: string, slot: number, port: number, shelf = 1) {
    return apiFetch<{ synced: number; foundInOlt: number; notInDb: number[]; raw: string }>(
      `/api/olt-devices/${deviceId}/onts/sync`,
      { method: 'POST', body: JSON.stringify({ shelf, slot, port }) },
    );
  }

  async function registerOnt(deviceId: string, payload: Record<string, unknown>) {
    return apiFetch<OltOnt>(`/api/olt-devices/${deviceId}/onts`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async function toggleOnt(deviceId: string, ontDbId: string, activate: boolean) {
    return apiFetch<OltOnt>(`/api/olt-devices/${deviceId}/onts/${ontDbId}/${activate ? 'activate' : 'deactivate'}`, {
      method: 'POST',
    });
  }

  async function deleteOnt(deviceId: string, ontDbId: string) {
    await apiFetch(`/api/olt-devices/${deviceId}/onts/${ontDbId}`, { method: 'DELETE' });
  }

  async function getSignal(deviceId: string, ontDbId: string) {
    return apiFetch<{ rxPower: number | null; txPower: number | null }>(
      `/api/olt-devices/${deviceId}/onts/${ontDbId}/signal`,
    );
  }

  function fetchSummary(deviceId: string) {
    return apiFetch<{
      unconfigured: number;
      online: number;
      offline: number;
      lowSignal: number;
      scanComplete: boolean;
      checkedAt: string;
    }>(`/api/olt-devices/${deviceId}/summary`);
  }

  function fetchHealth(deviceId: string) {
    return apiFetch<OltHealth>(`/api/olt-devices/${deviceId}/health`);
  }

  function fetchProfiles(deviceId: string) {
    return apiFetch<{ tcontProfiles: string[]; trafficProfiles: string[] }>(`/api/olt-devices/${deviceId}/profiles`);
  }

  async function assignTr069(deviceId: string, ontDbId: string, acsUrl: string, veip = 1) {
    const updated = await apiFetch<OltOnt>(`/api/olt-devices/${deviceId}/onts/${ontDbId}/tr069`, {
      method: 'POST',
      body: JSON.stringify({ acsUrl, veip }),
    });
    const idx = onts.value.findIndex((o) => o.id === ontDbId);
    if (idx !== -1) onts.value[idx] = { ...onts.value[idx], ...updated };
    return updated;
  }

  async function removeTr069(deviceId: string, ontDbId: string, veip = 1) {
    const updated = await apiFetch<OltOnt>(`/api/olt-devices/${deviceId}/onts/${ontDbId}/tr069?veip=${veip}`, {
      method: 'DELETE',
    });
    const idx = onts.value.findIndex((o) => o.id === ontDbId);
    if (idx !== -1) onts.value[idx] = { ...onts.value[idx], ...updated };
    return updated;
  }

  return {
    devices,
    onts,
    loading,
    error,
    fetchDevices,
    createDevice,
    updateDevice,
    deleteDevice,
    testDevice,
    fetchOnts,
    syncOnts,
    registerOnt,
    toggleOnt,
    deleteOnt,
    getSignal,
    fetchSummary,
    fetchHealth,
    fetchProfiles,
    assignTr069,
    removeTr069,
  };
});
