import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';
import type { OltTr069AcsProfile, Tr069Device, Tr069PerformanceMetric } from '@/types/domain';

export interface DeviceChangeResult {
  ok: boolean;
  queued: boolean;
  discovering: boolean;
  taskId?: string;
  error?: string;
}

export interface WifiNetwork {
  path: string;
  ssid: string | null;
}

// tr069_devices, tr069_performance_metrics y olt_tr069_acs_profiles tienen
// policies RLS para staff (ver migraciones fase6d/e/f) — a diferencia de
// olt_devices/olt_onts, se consultan directo via supabase-js igual que
// installations/inventory. El backend (server/src/routes/tr069sync.ts,
// genieacsSync.ts) solo se usa para lo que requiere contactar al NBI de
// GenieACS (sincronizar, recolectar metricas).
export const useTr069Store = defineStore('tr069', () => {
  const devices = ref<Tr069Device[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const syncing = ref(false);

  async function fetchDevices() {
    loading.value = true;
    error.value = null;
    const { data, error: err } = await supabase
      .from('tr069_devices')
      .select('*, contracts:service_contracts(id, contract_number)')
      .order('last_seen_at', { ascending: false, nullsFirst: false });
    loading.value = false;
    if (err) {
      error.value = err.message;
      throw err;
    }
    devices.value = (data ?? []) as unknown as Tr069Device[];
  }

  async function fetchLatestMetric(tr069DeviceId: string) {
    const { data, error: err } = await supabase
      .from('tr069_performance_metrics')
      .select('*')
      .eq('tr069_device_id', tr069DeviceId)
      .order('collected_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (err) throw err;
    return (data as unknown as Tr069PerformanceMetric) ?? null;
  }

  async function linkContract(tr069DeviceId: string, contractId: string | null) {
    const { data, error: err } = await supabase
      .from('tr069_devices')
      .update({ service_contract_id: contractId })
      .eq('id', tr069DeviceId)
      .select('*, contracts:service_contracts(id, contract_number)')
      .single();
    if (err) throw err;
    const idx = devices.value.findIndex((d) => d.id === tr069DeviceId);
    if (idx !== -1) devices.value[idx] = data as unknown as Tr069Device;
    return data as unknown as Tr069Device;
  }

  async function triggerSync() {
    syncing.value = true;
    try {
      return await apiFetch<{ ok: boolean; synced: number; created: number; total: number }>('/api/tr069-sync', {
        method: 'POST',
      });
    } finally {
      syncing.value = false;
    }
  }

  function collectAllMetrics() {
    return apiFetch<{ ok: boolean; collected: number; failed: number; total: number }>('/api/genieacs-sync/metrics', {
      method: 'POST',
    });
  }

  function collectDeviceMetrics(tr069DeviceId: string) {
    return apiFetch<{ ok: boolean; metrics?: Tr069PerformanceMetric; error?: string }>(
      `/api/genieacs-sync/metrics/device/${tr069DeviceId}`,
      { method: 'POST' },
    );
  }

  // ---- Acciones directas sobre la ONT via TR-069 (seccion /tr069, uso exclusivo) ----

  function fetchPppoeInfo(serial: string) {
    return apiFetch<{ found: boolean; username: string | null }>(`/api/genieacs-sync/pppoe/${encodeURIComponent(serial)}`);
  }

  function setPppoe(serial: string, payload: { username?: string; password?: string }) {
    return apiFetch<DeviceChangeResult>(`/api/genieacs-sync/pppoe/${encodeURIComponent(serial)}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  function fetchWifiNetworks(serial: string) {
    return apiFetch<{ found: boolean; networks: WifiNetwork[] }>(`/api/genieacs-sync/wifi/${encodeURIComponent(serial)}`);
  }

  function setWifi(serial: string, payload: { path: string; ssid?: string; password?: string }) {
    return apiFetch<DeviceChangeResult>(`/api/genieacs-sync/wifi/${encodeURIComponent(serial)}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  function rebootDevice(serial: string) {
    return apiFetch<DeviceChangeResult>(`/api/genieacs-sync/reboot/${encodeURIComponent(serial)}`, { method: 'POST' });
  }

  function refreshDevice(serial: string) {
    return apiFetch<DeviceChangeResult>(`/api/genieacs-sync/refresh/${encodeURIComponent(serial)}`, { method: 'POST' });
  }

  function provisionDevice(
    serial: string,
    payload: { pppoeUsername?: string; pppoePassword?: string; wifiSsid?: string; wifiPassword?: string; wlanPath?: string },
  ) {
    return apiFetch<{ ok: boolean; pppoe?: DeviceChangeResult; wifi?: DeviceChangeResult; error?: string }>(
      `/api/genieacs-sync/provision/${encodeURIComponent(serial)}`,
      { method: 'POST', body: JSON.stringify(payload) },
    );
  }

  // ---- Perfil ACS por defecto de una OLT (olt_tr069_acs_profiles) ----

  async function fetchAcsProfile(oltDeviceId: string) {
    const { data, error: err } = await supabase
      .from('olt_tr069_acs_profiles')
      .select('*')
      .eq('olt_device_id', oltDeviceId)
      .eq('is_default', true)
      .maybeSingle();
    if (err) throw err;
    return (data as unknown as OltTr069AcsProfile) ?? null;
  }

  async function saveAcsProfile(oltDeviceId: string, payload: Partial<OltTr069AcsProfile>, existingId?: string) {
    const row = {
      olt_device_id: oltDeviceId,
      profile_name: payload.profile_name || 'genieacs',
      acs_url: payload.acs_url,
      acs_username: payload.acs_username || null,
      acs_password: payload.acs_password || null,
      inform_interval: payload.inform_interval ?? 300,
      is_default: true,
    };
    const query = existingId
      ? supabase.from('olt_tr069_acs_profiles').update(row).eq('id', existingId)
      : supabase.from('olt_tr069_acs_profiles').insert(row);
    const { data, error: err } = await query.select().single();
    if (err) throw err;
    return data as unknown as OltTr069AcsProfile;
  }

  return {
    devices,
    loading,
    error,
    syncing,
    fetchDevices,
    fetchLatestMetric,
    linkContract,
    triggerSync,
    collectAllMetrics,
    collectDeviceMetrics,
    fetchAcsProfile,
    saveAcsProfile,
    fetchPppoeInfo,
    setPppoe,
    fetchWifiNetworks,
    setWifi,
    rebootDevice,
    refreshDevice,
    provisionDevice,
  };
});
