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
  admin_state: 'enable' | 'disable';
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
  contract_id?: string | null;
}

// ---- Aprovisionamiento confiable (Fase 2) — ver server/src/services/
// oltProvisioningService.ts y docs/auditoria/fase-2-aprovisionamiento.html.
// Mismas formas que devuelve POST /:id/onts/provision.

export interface ProvisionMismatch {
  field: string;
  expected: string;
  actual: string | null;
}

export interface ProvisionOutcome {
  kind:
    | 'invalid'
    | 'already_registered'
    | 'registered'
    | 'verify_mismatch'
    | 'conflict_same_position_different_config'
    | 'conflict_elsewhere'
    | 'capacity_full'
    | 'rejected'
    | 'uncertain'
    | 'verify_uncertain'
    | 'scan_unreliable';
  onuId?: number;
  message?: string;
  mismatches?: ProvisionMismatch[];
  at?: { shelf: number; slot: number; port: number; onuId: number };
}

export interface ProvisioningStep {
  stage: string;
  status: string;
  at: string;
  detail: string | null;
}

export interface ProvisioningOperation {
  id: string;
  frame: number;
  serial: string;
  slot: number;
  port: number;
  client_id: string | null;
  contract_id: string | null;
  requested: Record<string, unknown>;
  status: string;
  steps: ProvisioningStep[];
  onu_id: number | null;
  error: string | null;
  ont_db_id: string | null;
}

export interface ProvisionResponse {
  operation: ProvisioningOperation;
  outcome: ProvisionOutcome;
  ont: OltOnt | null;
  persistenceWarning?: string;
  mikrotikOk?: boolean;
  mikrotikError?: string;
  wanOk?: boolean;
  wanError?: string;
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

export interface UnconfiguredOntExistingClient {
  id: string;
  first_name: string;
  last_name: string;
  document_number: string;
}

export interface UnconfiguredOntExistingContract {
  id: string;
  client_id: string;
  contract_number: string | null;
  pppoe_username: string | null;
  installation_address: string | null;
  debt_hold_status: 'none' | 'pending' | 'suspended';
  status: string;
}

export interface UnconfiguredOnt {
  serial: string;
  interfaceRef: string;
  frame: number;
  slot: number | null;
  port: number | null;
  // Si este serial YA existe en olt_onts (ej. un cliente real al que se le
  // desconfiguro la ONU) — el frontend usa esto para separar "Nuevas por
  // Autorizar" de "Desconfiguradas / Por Reconectar".
  existingClient: UnconfiguredOntExistingClient | null;
  existingContract: UnconfiguredOntExistingContract | null;
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

/** ONT en admin-state=disable ('manual'), con cliente en corte por mora ('billing'), o ambos ('both'). */
export interface DisabledOnt extends OltOnt {
  reason: 'manual' | 'billing' | 'both';
}

export interface DisabledOntsResult {
  items: DisabledOnt[];
  checkedAt: string;
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

  // El escaneo previo (serial-existe/ID-libre) puede incluir un "show
  // running-config" de TODO el equipo (hasta 120s de margen en el backend,
  // ver oltProvisioningService.ts) mas la escritura y la relectura de
  // verificacion — varias sesiones Telnet seguidas, no solo una. 170s deja
  // margen bajo el limite real de nginx (proxy_read_timeout 180s, ver
  // deploy/nginx.conf) para que, si algo se atasca de verdad, el aviso
  // venga de aqui con un mensaje claro en vez de un 504 generico silencioso.
  const PROVISION_TIMEOUT_MS = 170_000;

  /**
   * Aprovisiona una ONT de forma idempotente y verificada (Fase 2). El backend reescanea la OLT en vivo antes de
   * escribir, reconoce si esta MISMA solicitud (idempotencyKey) ya se
   * aplico antes, y lee de vuelta lo que quedo en la OLT para confirmar que
   * coincide con lo pedido — ver outcome.kind para el resultado real
   * (nunca asumir "exito" solo porque la llamada no lanzo error).
   */
  async function provisionOnt(deviceId: string, payload: Record<string, unknown> & { idempotencyKey: string }) {
    return apiFetch<ProvisionResponse>(
      `/api/olt-devices/${deviceId}/onts/provision`,
      { method: 'POST', body: JSON.stringify(payload) },
      PROVISION_TIMEOUT_MS,
    );
  }

  /** Reintenta SOLO lo que quedo pendiente de una operacion ya existente (ver reconcile en routes/olt.ts) — nunca repite un alta ya confirmada. */
  async function reconcileProvisioning(deviceId: string, operationId: string, payload: Record<string, unknown> = {}) {
    return apiFetch<ProvisionResponse>(
      `/api/olt-devices/${deviceId}/onts/operations/${operationId}/reconcile`,
      { method: 'POST', body: JSON.stringify(payload) },
      PROVISION_TIMEOUT_MS,
    );
  }

  function fetchProvisioningOperationByKey(deviceId: string, key: string) {
    return apiFetch<ProvisioningOperation | null>(`/api/olt-devices/${deviceId}/onts/provisioning-operation?key=${encodeURIComponent(key)}`);
  }

  function fetchProvisioningOperation(deviceId: string, operationId: string) {
    return apiFetch<ProvisioningOperation>(`/api/olt-devices/${deviceId}/onts/operations/${operationId}`);
  }

  async function toggleOnt(deviceId: string, ontDbId: string, activate: boolean) {
    return apiFetch<OltOnt>(`/api/olt-devices/${deviceId}/onts/${ontDbId}/${activate ? 'activate' : 'deactivate'}`, {
      method: 'POST',
    });
  }

  /** Empuja el WAN/PPPoE por OMCI (pon-onu-mng/wan-ip) — ver advertencia en la ruta backend /wan-pppoe. */
  async function configureWanPppoe(
    deviceId: string,
    ontDbId: string,
    payload: { username: string; password: string; vlanProfile: string },
  ) {
    return apiFetch<OltOnt>(`/api/olt-devices/${deviceId}/onts/${ontDbId}/wan-pppoe`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async function deleteOnt(deviceId: string, ontDbId: string) {
    await apiFetch(`/api/olt-devices/${deviceId}/onts/${ontDbId}`, { method: 'DELETE' });
  }

  // "Consultar señal" hace DOS sesiones Telnet completas y seguidas contra la
  // OLT real (Rx y Tx, ver readOntSignal() en server/src/routes/olt.ts), cada
  // una con hasta 30s de timeout propio del backend, mas lo que haga falta
  // esperar en la cola compartida (oltTelnetLock.ts) si el sync automatico u
  // otra accion esta en curso. 90s da margen de sobra para el caso lento
  // pero sano (hasta 60s de Telnet + holgura de cola) sin esperar los 180s
  // completos que tolera nginx (deploy/nginx.conf) — bug real reportado:
  // sin este limite, la ficha se quedaba en "Consultando..." sin ninguna
  // señal de si seguia viva o estaba realmente colgada.
  const SIGNAL_TIMEOUT_MS = 90_000;

  async function getSignal(deviceId: string, ontDbId: string) {
    return apiFetch<{ rxPower: number | null; txPower: number | null }>(
      `/api/olt-devices/${deviceId}/onts/${ontDbId}/signal`,
      {},
      SIGNAL_TIMEOUT_MS,
    );
  }

  /**
   * Aplica rx/tx YA LEIDOS (ej. la respuesta de getSignal(), que el backend
   * ya persistio en Supabase antes de responder) sobre la ONU en memoria,
   * sin ninguna llamada de red. Evita recargar el listado COMPLETO del
   * dispositivo (fetchOnts) solo para reflejar el cambio de una sola fila —
   * esa llamada llego a pesar 627KB en produccion para ~700 ONTs, y
   * `refreshSignal()` en OntDetailModal.vue la esperaba antes de soltar el
   * boton "Consultar señal", dejando "Consultando..." visible mucho mas de
   * lo necesario (bug real reportado tras la Fase 1 Telnet).
   *
   * Muta el objeto EXISTENTE dentro de `onts.value` (no lo reemplaza) para
   * que una prop como `:ont="detailOnt"` en OltDetailView.vue (un computed
   * que busca por id dentro de este mismo array) vea el cambio de inmediato
   * sin que el componente necesite re-suscribirse a nada nuevo.
   */
  function patchOntSignal(ontDbId: string, rxPower: number | null, txPower: number | null) {
    const ont = onts.value.find((o) => o.id === ontDbId);
    if (ont) {
      ont.rx_power = rxPower;
      ont.tx_power = txPower;
    }
  }

  function fetchSummary(deviceId: string) {
    return apiFetch<{
      unconfigured: number;
      online: number;
      offline: number;
      disabled: number;
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

  // ONTs deshabilitadas/cortadas (admin-state=disable y/o corte por mora) —
  // 100% cache, instantaneo (ver GET /:id/onts/disabled en server/src/routes/olt.ts).
  function fetchDisabledOnts(deviceId: string) {
    return apiFetch<DisabledOntsResult>(`/api/olt-devices/${deviceId}/onts/disabled`);
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
    provisionOnt,
    reconcileProvisioning,
    fetchProvisioningOperation,
    fetchProvisioningOperationByKey,
    toggleOnt,
    configureWanPppoe,
    deleteOnt,
    getSignal,
    patchOntSignal,
    fetchSummary,
    fetchHealth,
    fetchProfiles,
    fetchUnconfiguredOnts,
    fetchDisabledOnts,
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
