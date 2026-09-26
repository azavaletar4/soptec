import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';
import { useInstallationsStore } from '@/stores/installations';
import { useTicketsStore } from '@/stores/tickets';
import { useContractsStore } from '@/stores/contracts';
import { useClientsStore } from '@/stores/clients';
import { useClientPhotosStore } from '@/stores/clientPhotos';
import { useOltStore } from '@/stores/olt';
import { useMikrotikStore } from '@/stores/mikrotik';
import { useTr069Store } from '@/stores/tr069';
import {
  enqueueClosure,
  flushQueue,
  isOnline,
  listQueuedClosures,
  type QueuedClosure,
} from '@/lib/offlineQueue';
import type { ClientPhotoCategory, Installation, JobType, ServiceContract, Ticket } from '@/types/domain';

const BUCKET = 'work-evidence';

export type TrabajoEstadoUi = 'pendiente' | 'en_proceso' | 'completado';

export interface TrabajoItem {
  id: string;
  jobType: JobType;
  estadoUi: TrabajoEstadoUi;
  titulo: string;
  clientId: string;
  clienteNombre: string;
  telefono: string | null;
  direccion: string | null;
  latitude: number | null;
  longitude: number | null;
  fecha: string | null;
  contractId: string | null;
  raw: Installation | Ticket;
}

function installationEstado(i: Installation): TrabajoEstadoUi {
  if (i.status === 'completed') return 'completado';
  return 'pendiente';
}

function ticketEstado(t: Ticket): TrabajoEstadoUi {
  if (t.status === 'resolved' || t.status === 'closed') return 'completado';
  if (t.status === 'in_progress') return 'en_proceso';
  return 'pendiente';
}

function fromInstallation(i: Installation): TrabajoItem {
  return {
    id: i.id,
    jobType: 'installation',
    estadoUi: installationEstado(i),
    titulo: 'Instalación',
    clientId: i.client_id,
    clienteNombre: i.clients ? `${i.clients.first_name} ${i.clients.last_name}` : 'Cliente',
    telefono: i.clients?.phone ?? null,
    direccion: i.clients?.address ?? null,
    latitude: i.clients?.latitude ?? null,
    longitude: i.clients?.longitude ?? null,
    fecha: i.scheduled_date ?? i.created_at,
    contractId: i.contract_id,
    raw: i,
  };
}

function fromTicket(t: Ticket): TrabajoItem {
  return {
    id: t.id,
    jobType: 'ticket',
    estadoUi: ticketEstado(t),
    titulo: t.title || 'Avería',
    clientId: t.client_id,
    clienteNombre: t.clients ? `${t.clients.first_name} ${t.clients.last_name}` : 'Cliente',
    telefono: t.clients?.phone ?? null,
    direccion: null,
    latitude: null,
    longitude: null,
    fecha: t.created_at,
    contractId: t.contract_id,
    raw: t,
  };
}

export interface DiagnosticoResult {
  ont: { found: boolean; rxPower: number | null; txPower: number | null; status?: string; error?: string };
  pppoe: { found: boolean; address: string | null; uptime: string | null; error?: string };
  cpe: { found: boolean; rxPower: number | null; txPower: number | null; temperature: number | null; error?: string };
}

interface ClosurePhotoInput {
  category: string;
  file: File;
}

export interface ClosureInput {
  jobType: JobType;
  jobId: string;
  clientId: string;
  contractId: string | null;
  targetStatus: string;
  latitude: number | null;
  longitude: number | null;
  ontSerial: string | null;
  closureNotes: string | null;
  photos: ClosurePhotoInput[];
  signatureBlob: Blob | null;
  updateClientGps: boolean;
  /** Categorias que ademas de guardarse en work_order_photos deben reflejarse en
   *  el slot fijo de client_photos (fachada/caja NAP/modem/potencia PON). */
  clientPhotoCategories: ClientPhotoCategory[];
}

/**
 * apiFetch/supabase-js no traen timeout propio — si el backend se queda
 * colgado (ej. la OLT no responde al telnet), el await nunca resuelve ni
 * rechaza y el "Consultando..." del Diagnostico Express se queda pegado
 * para siempre. Cada consulta del diagnostico se envuelve con esto para
 * garantizar que SIEMPRE se resuelva dentro de un tiempo razonable.
 */
function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label}: tiempo de espera agotado`)), ms)),
  ]);
}

function isNetworkError(e: unknown) {
  if (e instanceof TypeError) return true;
  if (e instanceof Error) return /network|fetch|failed to fetch|internet/i.test(e.message);
  return false;
}

export const useCampoStore = defineStore('campo', () => {
  const auth = useAuthStore();
  const installationsStore = useInstallationsStore();
  const ticketsStore = useTicketsStore();
  const contractsStore = useContractsStore();
  const clientsStore = useClientsStore();
  const clientPhotosStore = useClientPhotosStore();
  const oltStore = useOltStore();
  const mikrotikStore = useMikrotikStore();
  const tr069Store = useTr069Store();

  const loading = ref(false);
  const queuedCount = ref(0);
  const syncing = ref(false);

  const trabajos = computed<TrabajoItem[]>(() => {
    const soloPropios = auth.role === 'TECNICO_RED';
    const uid = auth.user?.id;
    const instalaciones = installationsStore.installations
      .filter((i) => i.status !== 'cancelled')
      .filter((i) => !soloPropios || i.assigned_to === uid)
      .map(fromInstallation);
    const tickets = ticketsStore.tickets
      .filter((t) => !soloPropios || t.assigned_to === uid)
      .map(fromTicket);
    return [...instalaciones, ...tickets].sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? '') * -1);
  });

  async function fetchAll() {
    loading.value = true;
    try {
      await Promise.all([installationsStore.fetchInstallations(), ticketsStore.fetchTickets()]);
    } finally {
      loading.value = false;
    }
    await refreshQueuedCount();
  }

  async function refreshQueuedCount() {
    queuedCount.value = (await listQueuedClosures()).length;
  }

  // ---- Diagnostico express: combina OLT (Rx/Tx), MikroTik (sesion PPPoE) y
  // TR-069/GenieACS (Rx/Tx + temperatura del CPE). Cada pata falla de forma
  // independiente para no perder las otras dos si una fuente no responde. ----
  async function runDiagnostico(clientId: string, contractId: string | null): Promise<DiagnosticoResult> {
    const result: DiagnosticoResult = {
      ont: { found: false, rxPower: null, txPower: null },
      pppoe: { found: false, address: null, uptime: null },
      cpe: { found: false, rxPower: null, txPower: null, temperature: null },
    };

    const ontLeg = (async () => {
      try {
        const onts = await withTimeout(oltStore.fetchOntsByClient(clientId), 10000, 'Búsqueda de ONT');
        const ont = onts.find((o) => o.status === 'online') ?? onts[0];
        if (!ont) return;
        const signal = await withTimeout(oltStore.getSignal(ont.olt_device_id, ont.id), 20000, 'Lectura de señal OLT');
        result.ont = { found: true, rxPower: signal.rxPower, txPower: signal.txPower, status: ont.status };
      } catch (e) {
        result.ont.error = e instanceof Error ? e.message : 'Error al leer la OLT';
      }
    })();

    let contract: ServiceContract | null = null;
    try {
      const contracts = await withTimeout(contractsStore.fetchContractsByClient(clientId), 10000, 'Contrato');
      contract = (contractId ? contracts.find((c) => c.id === contractId) : contracts[0]) ?? null;
    } catch {
      contract = null;
    }

    const pppoeLeg = (async () => {
      if (!contract?.mikrotik_device_id || !contract.pppoe_username) {
        result.pppoe.error = 'El contrato no tiene un dispositivo MikroTik o usuario PPPoE configurado';
        return;
      }
      try {
        const active = await withTimeout(mikrotikStore.fetchPppActive(contract.mikrotik_device_id), 10000, 'MikroTik');
        const session = active.find((a) => a.name === contract!.pppoe_username);
        result.pppoe = { found: !!session, address: session?.address ?? null, uptime: session?.uptime ?? null };
      } catch (e) {
        result.pppoe.error = e instanceof Error ? e.message : 'Error al consultar MikroTik';
      }
    })();

    const cpeLeg = (async () => {
      if (!contract) return;
      try {
        const { data: device } = await withTimeout(
          supabase.from('tr069_devices').select('id').eq('service_contract_id', contract.id).maybeSingle(),
          10000,
          'Búsqueda TR-069',
        );
        if (!device) {
          result.cpe.error = 'Sin dispositivo TR-069 vinculado a este contrato';
          return;
        }
        const res = await withTimeout(tr069Store.collectDeviceMetrics(device.id), 20000, 'Métricas TR-069');
        if (res.ok && res.metrics) {
          result.cpe = {
            found: true,
            rxPower: res.metrics.rx_power,
            txPower: res.metrics.tx_power,
            temperature: res.metrics.temperature,
          };
        } else {
          result.cpe.error = res.error || 'El CPE no respondió';
        }
      } catch (e) {
        result.cpe.error = e instanceof Error ? e.message : 'Error al consultar TR-069';
      }
    })();

    await Promise.all([ontLeg, pppoeLeg, cpeLeg]);
    return result;
  }

  // ---- Cierre de trabajo (fotos + firma + GPS + serial ONT), con cola
  // offline como respaldo cuando no hay señal en el sitio del cliente. ----
  async function performClosureSubmit(input: ClosureInput) {
    if (input.updateClientGps && input.latitude != null && input.longitude != null) {
      await clientsStore.updateClient(input.clientId, { latitude: input.latitude, longitude: input.longitude });
      if (input.contractId) {
        await contractsStore.updateContract(input.contractId, { latitude: input.latitude, longitude: input.longitude });
      }
    }

    for (const photo of input.photos) {
      const ext = photo.file.name.includes('.') ? photo.file.name.split('.').pop() : 'jpg';
      const path = `${input.jobType}/${input.jobId}/${photo.category}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, photo.file, { upsert: false });
      if (upErr) throw upErr;
      const { error: rowErr } = await supabase
        .from('work_order_photos')
        .insert({ job_type: input.jobType, job_id: input.jobId, category: photo.category, storage_path: path });
      if (rowErr) throw rowErr;

      if (input.contractId && input.clientPhotoCategories.includes(photo.category as ClientPhotoCategory)) {
        await clientPhotosStore.uploadPhoto(input.clientId, input.contractId, photo.category as ClientPhotoCategory, photo.file);
      }
    }

    let signaturePath: string | null = null;
    if (input.signatureBlob) {
      signaturePath = `${input.jobType}/${input.jobId}/signature-${Date.now()}.png`;
      const { error: sigErr } = await supabase.storage
        .from(BUCKET)
        .upload(signaturePath, input.signatureBlob, { upsert: false, contentType: 'image/png' });
      if (sigErr) throw sigErr;
    }

    const { error: closureErr } = await supabase.from('work_order_closures').upsert(
      {
        job_type: input.jobType,
        job_id: input.jobId,
        client_id: input.clientId,
        latitude: input.latitude,
        longitude: input.longitude,
        ont_serial: input.ontSerial,
        closure_notes: input.closureNotes,
        signature_path: signaturePath,
      },
      { onConflict: 'job_type,job_id' },
    );
    if (closureErr) throw closureErr;

    if (input.jobType === 'installation') {
      await installationsStore.updateStatus(input.jobId, 'completed');
    } else {
      await ticketsStore.updateTicketStatus(input.jobId, input.targetStatus as Ticket['status']);
    }
  }

  async function submitFromQueued(item: QueuedClosure) {
    await performClosureSubmit({
      jobType: item.jobType,
      jobId: item.jobId,
      clientId: item.clientId,
      contractId: item.contractId,
      targetStatus: item.targetStatus,
      latitude: item.latitude,
      longitude: item.longitude,
      ontSerial: item.ontSerial,
      closureNotes: item.closureNotes,
      photos: item.photos.map((p) => ({ category: p.category, file: new File([p.blob], p.fileName, { type: p.blob.type }) })),
      signatureBlob: item.signatureBlob,
      updateClientGps: true,
      clientPhotoCategories: item.clientPhotoCategories as ClientPhotoCategory[],
    });
  }

  async function submitClosure(input: ClosureInput): Promise<{ queued: boolean }> {
    if (!isOnline()) {
      await enqueueClosure({
        jobType: input.jobType,
        jobId: input.jobId,
        clientId: input.clientId,
        contractId: input.contractId,
        targetStatus: input.targetStatus,
        latitude: input.latitude,
        longitude: input.longitude,
        ontSerial: input.ontSerial,
        closureNotes: input.closureNotes,
        photos: input.photos.map((p) => ({ category: p.category, blob: p.file, fileName: p.file.name })),
        signatureBlob: input.signatureBlob,
        clientPhotoCategories: input.clientPhotoCategories,
      });
      await refreshQueuedCount();
      return { queued: true };
    }

    try {
      await performClosureSubmit(input);
      return { queued: false };
    } catch (e) {
      if (isNetworkError(e)) {
        await enqueueClosure({
          jobType: input.jobType,
          jobId: input.jobId,
          clientId: input.clientId,
          contractId: input.contractId,
          targetStatus: input.targetStatus,
          latitude: input.latitude,
          longitude: input.longitude,
          ontSerial: input.ontSerial,
          closureNotes: input.closureNotes,
          photos: input.photos.map((p) => ({ category: p.category, blob: p.file, fileName: p.file.name })),
          signatureBlob: input.signatureBlob,
          clientPhotoCategories: input.clientPhotoCategories,
        });
        await refreshQueuedCount();
        return { queued: true };
      }
      throw e;
    }
  }

  async function syncQueued() {
    syncing.value = true;
    try {
      const result = await flushQueue(submitFromQueued);
      await fetchAll();
      return result;
    } finally {
      syncing.value = false;
    }
  }

  return {
    loading,
    syncing,
    queuedCount,
    trabajos,
    fetchAll,
    refreshQueuedCount,
    runDiagnostico,
    submitClosure,
    syncQueued,
  };
});
