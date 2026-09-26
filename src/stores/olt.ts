import { acceptHMRUpdate, defineStore } from 'pinia';
import { ref } from 'vue';
import { apiFetch } from '@/lib/api';
import { supabase } from '@/lib/supabase';

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
  lat: number | null;
  lng: number | null;
}

export interface OltOnt {
  id: string;
  olt_device_id: string;
  client_id: string | null;
  /** A que servicio/linea del cliente pertenece este ONT (Fase 37). Opcional: solo viene si server/src/routes/olt.ts ya lo lee/escribe (pendiente). */
  contract_id?: string | null;
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
  plan_id: string | null;
  tr069_enabled: boolean;
  tr069_acs_url: string | null;
  status: 'online' | 'offline' | 'unknown';
  rx_power: number | null;
  tx_power: number | null;
  last_synced_at: string | null;
  created_at: string;
  zone_id: string | null;
  splitter: string | null;
  splitter_port: string | null;
  address_comment: string | null;
  contact: string | null;
  latitude: number | null;
  longitude: number | null;
  clients?: { id: string; first_name: string; last_name: string; phone: string | null; address: string | null } | null;
  zones?: { id: string; name: string } | null;
  plans?: {
    id: string;
    name: string;
    download_speed: number;
    upload_speed: number;
    olt_tcont_profile?: string | null;
    olt_traffic_profile?: string | null;
  } | null;
}

export interface OntPlanChange {
  tcontProfile: string;
  trafficProfile: string;
  planId?: string | null;
}

export interface OntMetaUpdate {
  zone_id?: string | null;
  splitter?: string | null;
  splitter_port?: string | null;
  description?: string | null;
  address_comment?: string | null;
  contact?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  client_id?: string | null;
}

export interface UnlinkedOnt {
  id: string;
  olt_device_id: string;
  serial: string;
  description: string | null;
  ont_id: number;
  slot: number;
  port: number;
  status: 'online' | 'offline' | 'unknown';
  olt_devices?: { id: string; name: string } | null;
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

export interface UnconfiguredOnt {
  serial: string;
  interfaceRef: string;
  frame: number;
  slot: number | null;
  port: number | null;
}

export interface UnconfiguredOntsResult {
  items: UnconfiguredOnt[];
  checkedAt: string | null;
  live: boolean;
}

export interface OltSyncStatus {
  running: boolean;
  lastFullSyncAt: string | null;
}

export const useOltStore = defineStore('olt', () => {
  const devices = ref<OltDevice[]>([]);
  const onts = ref<OltOnt[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Tiempo real (Fase 40): Server-Sent Events desde el backend, no Supabase
  // Realtime directo — olt_onts es de acceso exclusivo del backend (RLS sin
  // policies a proposito). Se usa fetch()+ReadableStream en vez de
  // EventSource nativo porque este necesita mandar el token via header
  // Authorization (igual que apiFetch), y EventSource no permite headers
  // custom.
  let eventsAbortController: AbortController | null = null;

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

  async function updateCoords(id: string, lat: number, lng: number) {
    const device = await apiFetch<OltDevice>(`/api/olt-devices/${id}/coords`, {
      method: 'PUT',
      body: JSON.stringify({ lat, lng }),
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

  function importExistingOnts(deviceId: string) {
    return apiFetch<{ ok: boolean; scanned: number; imported: number; ports: number; failedPorts: string[] }>(
      `/api/olt-devices/${deviceId}/onts/import-existing`,
      { method: 'POST' },
    );
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

  // Por defecto lee la cache (instantaneo). live:true fuerza un escaneo
  // Telnet en vivo — usar justo antes de registrar una ONT nueva.
  function fetchUnconfiguredOnts(deviceId: string, opts: { live?: boolean } = {}) {
    const query = opts.live ? '?live=1' : '';
    return apiFetch<UnconfiguredOntsResult>(`/api/olt-devices/${deviceId}/onts/unconfigured${query}`);
  }

  // "Actualizar ahora": encola un sync completo en background (202
  // inmediato); el resultado llega despues via connectOltEvents o sondeando
  // fetchSyncStatus.
  function triggerFullSync(deviceId: string) {
    return apiFetch<{ status: 'queued' | 'already_running' }>(`/api/olt-devices/${deviceId}/sync/full`, {
      method: 'POST',
    });
  }

  function fetchSyncStatus(deviceId: string) {
    return apiFetch<OltSyncStatus>(`/api/olt-devices/${deviceId}/sync/status`);
  }

  /**
   * Conecta al SSE de la OLT: parchea `onts` en vivo con cada cambio de
   * estado/senal (sync en background o una accion manual de otra pestana) y
   * llama a `onSummaryChanged` cuando el resumen/salud cacheados cambiaron
   * (para que la vista los vuelva a pedir). Idempotente: llamar de nuevo
   * cierra la conexion anterior antes de abrir una nueva.
   */
  async function connectOltEvents(deviceId: string, onSummaryChanged?: () => void) {
    disconnectOltEvents();
    const controller = new AbortController();
    eventsAbortController = controller;

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    try {
      const res = await fetch(`/api/olt-devices/${deviceId}/events`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
      if (!res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIndex = buffer.indexOf('\n\n');
        while (sepIndex !== -1) {
          const rawEvent = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);

          let eventName = 'message';
          const dataLines: string[] = [];
          for (const line of rawEvent.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          const payload = dataLines.join('\n');

          if (eventName === 'ontChanged') {
            try {
              const patch = JSON.parse(payload) as Partial<OltOnt> & { id: string; deleted?: boolean };
              if (patch.deleted) {
                onts.value = onts.value.filter((o) => o.id !== patch.id);
              } else {
                const idx = onts.value.findIndex((o) => o.id === patch.id);
                if (idx !== -1) onts.value[idx] = { ...onts.value[idx], ...patch };
              }
            } catch {
              // ignorar payloads malformados
            }
          } else if (eventName === 'summaryChanged') {
            onSummaryChanged?.();
          }

          sepIndex = buffer.indexOf('\n\n');
        }
      }
    } catch (e) {
      if (controller.signal.aborted) return; // desconexion intencional (unmount)
      // eslint-disable-next-line no-console
      console.error('Error en la conexion de eventos de la OLT:', e);
    }
  }

  function disconnectOltEvents() {
    eventsAbortController?.abort();
    eventsAbortController = null;
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

  function fetchRunningConfig(deviceId: string, ontDbId: string) {
    return apiFetch<{ raw: string }>(`/api/olt-devices/${deviceId}/onts/${ontDbId}/running-config`);
  }

  // Ubica la(s) ONT de un cliente sin conocer de antemano a que OLT
  // pertenece — usado por la ficha de Cliente para el cambio rapido de plan.
  function fetchOntsByClient(clientId: string) {
    return apiFetch<OltOnt[]>(`/api/olt-devices/onts/by-client/${clientId}`);
  }

  // Busca ONTs sin cliente vinculado por numero de serie (parcial) — la
  // mayoria de las ONTs vienen de un import masivo que nunca asigna cliente.
  function searchUnlinkedOnts(serial: string) {
    return apiFetch<UnlinkedOnt[]>(`/api/olt-devices/onts/search?serial=${encodeURIComponent(serial)}`);
  }

  // Estado online/offline por numero de serie, sin filtrar por cliente
  // vinculado (a diferencia de searchUnlinkedOnts) — usado desde /tr069.
  function fetchOntStatusBySerials(serials: string[]) {
    if (!serials.length) return Promise.resolve({} as Record<string, { status: OltOnt['status']; description: string | null }>);
    return apiFetch<Record<string, { status: OltOnt['status']; description: string | null }>>(
      `/api/olt-devices/onts/status?serials=${encodeURIComponent(serials.join(','))}`,
    );
  }

  function linkOntToClient(deviceId: string, ontDbId: string, clientId: string, contractId?: string) {
    return apiFetch<OltOnt>(`/api/olt-devices/${deviceId}/onts/${ontDbId}/meta`, {
      method: 'PUT',
      body: JSON.stringify({ client_id: clientId, contract_id: contractId ?? null }),
    });
  }

  // Reasigna una ONT ya vinculada al cliente a otro de sus contratos (Fase
  // 37) — no cambia client_id, solo a que servicio pertenece.
  function setOntContract(deviceId: string, ontDbId: string, contractId: string | null) {
    return apiFetch<OltOnt>(`/api/olt-devices/${deviceId}/onts/${ontDbId}/meta`, {
      method: 'PUT',
      body: JSON.stringify({ contract_id: contractId }),
    });
  }

  // El ancho de banda real del cliente lo aplica la OLT (tcont/traffic); esto
  // reconfigura una ONT ya registrada, sin recrearla.
  async function changeOntPlan(deviceId: string, ontDbId: string, payload: OntPlanChange) {
    const updated = await apiFetch<OltOnt>(`/api/olt-devices/${deviceId}/onts/${ontDbId}/plan`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    const idx = onts.value.findIndex((o) => o.id === ontDbId);
    if (idx !== -1) onts.value[idx] = { ...onts.value[idx], ...updated };
    return updated;
  }

  async function updateOntMeta(deviceId: string, ontDbId: string, payload: OntMetaUpdate) {
    const updated = await apiFetch<OltOnt>(`/api/olt-devices/${deviceId}/onts/${ontDbId}/meta`, {
      method: 'PUT',
      body: JSON.stringify(payload),
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
    updateCoords,
    deleteDevice,
    testDevice,
    fetchOnts,
    importExistingOnts,
    syncOnts,
    registerOnt,
    toggleOnt,
    deleteOnt,
    getSignal,
    fetchSummary,
    fetchHealth,
    fetchProfiles,
    fetchUnconfiguredOnts,
    triggerFullSync,
    fetchSyncStatus,
    connectOltEvents,
    disconnectOltEvents,
    assignTr069,
    removeTr069,
    fetchRunningConfig,
    updateOntMeta,
    fetchOntsByClient,
    changeOntPlan,
    searchUnlinkedOnts,
    fetchOntStatusBySerials,
    setOntContract,
    linkOntToClient,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useOltStore, import.meta.hot));
}
