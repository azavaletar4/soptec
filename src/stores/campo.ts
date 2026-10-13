import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';
import { useInstallationsStore } from '@/stores/installations';
import { useTicketsStore } from '@/stores/tickets';
import { useRoutinesStore } from '@/stores/routines';
import { useContractsStore } from '@/stores/contracts';
import { useClientsStore } from '@/stores/clients';
import { useClientPhotosStore } from '@/stores/clientPhotos';
import { useClientEquipmentPhotosStore } from '@/stores/clientEquipmentPhotos';
import { useOltStore } from '@/stores/olt';
import { useMikrotikStore } from '@/stores/mikrotik';
import { useTr069Store } from '@/stores/tr069';
import { useFoFibraStore } from '@/stores/foFibra';
import { useInfraElementosStore } from '@/stores/infraElementos';
import { useJobAssigneesStore } from '@/stores/jobAssignees';
import { compressImage } from '@/lib/imageCompression';
import {
  describeOntZoneSyncOutcome,
  resolveClosureTargetZoneId,
  shouldUseTransactionalNapSync,
  type OntZoneRpcResult,
} from '@/lib/ontZoneSync';
import {
  isUniqueViolation,
  photosAlreadyUploaded,
  equipmentTypesAlreadyUploaded,
  createJobClosureGuard,
} from '@/lib/jobClosureIdempotency';
import {
  enqueueClosure,
  flushQueue,
  isOnline,
  listQueuedClosures,
  type QueuedClosure,
} from '@/lib/offlineQueue';
import {
  NAP_CLIENT_LIMIT,
  type ClientPhotoCategory,
  type EquipmentPhotoType,
  type Installation,
  type JobType,
  type Routine,
  type ServiceContract,
  type Ticket,
  type TicketMotivoAveria,
} from '@/types/domain';
import type { ActiveJobRef } from '@/lib/singleActiveJob';

const BUCKET = 'work-evidence';
// Evita que el boton manual y el auto-sync de la cola offline (syncQueued)
// cierren el MISMO trabajo a la vez — ver incidencia Violeta Garcia Silva,
// 2026-10-13, jobClosureIdempotency.ts.
const closureGuard = createJobClosureGuard();

export type TrabajoEstadoUi = 'pendiente' | 'en_proceso' | 'completado';

export interface TrabajoItem {
  id: string;
  jobType: JobType;
  estadoUi: TrabajoEstadoUi;
  titulo: string;
  /** Null en una rutina sin cliente puntual (apunta a una zona/caja NAP, Fase 101). */
  clientId: string | null;
  clienteNombre: string;
  telefono: string | null;
  direccion: string | null;
  latitude: number | null;
  longitude: number | null;
  fecha: string | null;
  contractId: string | null;
  raw: Installation | Ticket | Routine;
}

function installationEstado(i: Installation): TrabajoEstadoUi {
  if (i.status === 'completed') return 'completado';
  // Antes 'scheduled' caia junto con 'pending' en 'pendiente', asi que una
  // instalacion YA programada por la oficina (InstalacionesView.vue la
  // distingue con su propio estado "Programada") se veia identica a una sin
  // tocar todavia en la app de Campo — el tecnico no podia distinguirlas.
  // 'en_proceso' ya existe para tickets "en curso"; es el bucket mas cercano
  // a "esto ya esta en marcha" para una instalacion agendada o que el
  // tecnico ya marco "Iniciar Orden" (Fase 126, mismo boton que en tickets).
  if (i.status === 'scheduled' || i.status === 'in_progress') return 'en_proceso';
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

function routineEstado(r: Routine): TrabajoEstadoUi {
  if (r.status === 'completed' || r.status === 'cancelled') return 'completado';
  if (r.status === 'in_progress') return 'en_proceso';
  return 'pendiente';
}

function routineTargetLabel(r: Routine): string {
  if (r.clients) return `${r.clients.first_name} ${r.clients.last_name}`;
  if (r.nap_elemento) return `Caja NAP · ${r.nap_elemento.name}`;
  if (r.zones) return `Zona · ${r.zones.name}`;
  if (r.direccion_destino) return r.direccion_destino;
  return r.title;
}

function fromRoutine(r: Routine): TrabajoItem {
  return {
    id: r.id,
    jobType: 'routine',
    estadoUi: routineEstado(r),
    titulo: r.title || 'Rutina',
    clientId: r.client_id,
    clienteNombre: routineTargetLabel(r),
    telefono: r.clients?.phone ?? null,
    direccion: r.direccion_destino,
    latitude: r.clients?.latitude ?? null,
    longitude: r.clients?.longitude ?? null,
    fecha: r.scheduled_date ?? r.created_at,
    // Fase 159 — null en casi toda rutina (sigue sin ser un dato puntual,
    // Fase 101); el subtipo "Traslado de servicio" (Fase 3 OLT, Fase C,
    // ver ESTADO_DESARROLLO.md 13an/13ao) es la unica excepcion real y SI
    // lo trae — necesario para que performClosureSubmitInner sepa a que
    // contract_id exacto sincronizar zona/NAP/ONT al cerrar.
    contractId: r.contract_id ?? null,
    raw: r,
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

/** Fase 105 — fotos de serie de equipos (galeria dinamica, no un slot unico). */
export interface ClosureEquipmentPhotoInput {
  equipmentType: EquipmentPhotoType;
  file: File;
}

export interface ClosureInput {
  jobType: JobType;
  jobId: string;
  /** Null en una rutina sin cliente puntual (Fase 101). */
  clientId: string | null;
  contractId: string | null;
  targetStatus: string;
  latitude: number | null;
  longitude: number | null;
  ontSerial: string | null;
  closureNotes: string | null;
  photos: ClosurePhotoInput[];
  /** Fase 105 — fotos de serie de equipos (Modem/TV Box/Mesh/Otro), lista dinamica. */
  equipmentPhotos: ClosureEquipmentPhotoInput[];
  signatureBlob: Blob | null;
  updateClientGps: boolean;
  /** Categorias que ademas de guardarse en work_order_photos deben reflejarse en
   *  el slot fijo de client_photos (fachada/caja NAP/modem/potencia PON). */
  clientPhotoCategories: ClientPhotoCategory[];
  /** Fase 95 — censo fotografico de una averia: categorias que quedan
   *  work_order_photos.status='pending_approval' en vez de aplicarse directo
   *  a client_photos (las aprueba un admin desde TicketDetailView). */
  pendingApprovalCategories: ClientPhotoCategory[];
  /** Fase 49 — solo aplica a tickets (averias), null en instalaciones. */
  motivoAveria: TicketMotivoAveria | null;
  /** Fase 103 — texto libre cuando motivoAveria = 'other'. */
  motivoAveriaDetalle: string | null;
  /** Justificacion obligatoria cuando motivoAveria es client_damage o external_factor. */
  justificacionCierre: string | null;
  /** Fase 95 — lectura manual de potencia optica (dBm), solo tickets. */
  potenciaDbm: number | null;
  /** Fase 95 (tickets, opcional) / obligatoria al completar una instalación — caja NAP asignada al servicio. */
  napElementoId: string | null;
  /** Zona/Sector de la Planta Externa, obligatoria al completar una instalación — se guarda en contracts.zone_id. */
  zoneId: string | null;
  /** Fase 159 — Rutina de traslado: el tecnico marco "ONT reemplazada" (equipo fisico distinto). Si es true, se omite la sincronizacion automatica de zona de la ONT en la OLT (Fase 158) aunque haya napElementoId — nunca se asume que el vinculo contract_id->olt_onts sigue siendo el equipo correcto sin que un administrador lo revise. false en el resto de cierres (tickets/instalaciones no la usan). */
  ontReplaced: boolean;
  /** Fase 159 — Rutina de traslado: direccion NUEVA confirmada por el tecnico (reusa service_contracts.installation_address, columna ya existente). Null = no se toca (resto de cierres). */
  installationAddress: string | null;
  /** Fase 139 — codigo de cliente / cintillo Drop, reusa contracts.client_code (Fase 39). Obligatorio al completar una instalacion, opcional en tickets/reconexiones. Null/vacio = no tocar (evita sobrescribir con blanco). */
  clientCode: string | null;
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

export function isNetworkError(e: unknown) {
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
  const clientEquipmentPhotosStore = useClientEquipmentPhotosStore();
  const oltStore = useOltStore();
  const mikrotikStore = useMikrotikStore();
  const tr069Store = useTr069Store();
  const fibra = useFoFibraStore();
  const infraStore = useInfraElementosStore();
  const jobAssigneesStore = useJobAssigneesStore();
  const routinesStore = useRoutinesStore();

  const loading = ref(false);
  const queuedCount = ref(0);
  const syncing = ref(false);

  // Fase 121: job_assignees.assigned_to solo refleja al LIDER (ver trigger
  // sync_assigned_to_from_job_assignees) — un tecnico sumado como APOYO
  // nunca aparece ahi, asi que sin esto una orden en cuadrilla era invisible
  // en la propia App de Campo del apoyo (solo la veia el lider).
  const myAssignments = ref<{ job_type: JobType; job_id: string }[]>([]);
  function isMyCrewJob(jobType: JobType, jobId: string): boolean {
    return myAssignments.value.some((a) => a.job_type === jobType && a.job_id === jobId);
  }

  const trabajos = computed<TrabajoItem[]>(() => {
    const soloPropios = auth.role === 'TECNICO_RED';
    const uid = auth.user?.id;
    const instalaciones = installationsStore.installations
      .filter((i) => i.status !== 'cancelled')
      .filter((i) => !soloPropios || i.assigned_to === uid || isMyCrewJob('installation', i.id))
      .map(fromInstallation);
    const tickets = ticketsStore.tickets
      .filter((t) => !soloPropios || t.assigned_to === uid || isMyCrewJob('ticket', t.id))
      .map(fromTicket);
    const rutinas = routinesStore.routines
      .filter((r) => r.status !== 'cancelled')
      .filter((r) => !soloPropios || r.assigned_to === uid || isMyCrewJob('routine', r.id))
      .map(fromRoutine);
    return [...instalaciones, ...tickets, ...rutinas].sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? '') * -1);
  });

  // ---- Fase 137: un tecnico solo puede tener UN trabajo "en ejecucion"
  // (status='in_progress') a la vez, global a los 3 tipos — ver la
  // migracion 20261010140000 (trigger enforce_single_active_job) para la
  // regla real, que se aplica siempre en el backend. Este computed solo
  // sirve para avisar ANTES de intentarlo (bloquear el boton, mostrar a cual
  // ticket pertenece la atencion activa) — reusa `trabajos`, que ya viene
  // filtrado a "lo mio + mi cuadrilla" para TECNICO_RED. ----
  const myActiveJob = computed<ActiveJobRef | null>(() => {
    if (auth.role !== 'TECNICO_RED') return null;
    const activo = trabajos.value.find((t) => (t.raw as { status: string }).status === 'in_progress');
    if (!activo) return null;
    const number =
      activo.jobType === 'ticket' ? (activo.raw as Ticket).ticket_number : activo.jobType === 'routine' ? (activo.raw as Routine).routine_number : null;
    return { jobType: activo.jobType, id: activo.id, number };
  });

  // ---- Tickets libres (Fase 98): averias 'open' sin ningun tecnico
  // asignado todavia — visibles para CUALQUIER tecnico (no solo el que las
  // creo/tiene asignadas) para que pueda "tomarlas" el que este libre, sin
  // esperar a que despacho se las reparta a mano. ----
  const availableTickets = computed<TrabajoItem[]>(() =>
    ticketsStore.tickets.filter((t) => t.status === 'open' && !t.assigned_to).map(fromTicket),
  );

  // Fase 118: mismo pool de "Disponibles" que las Averias (Fase 98), ahora
  // tambien para Altas y Rutinas sin tecnico — antes quedaban invisibles
  // para cualquier tecnico hasta que despacho las asignara a mano.
  const availableInstallations = computed<TrabajoItem[]>(() =>
    installationsStore.installations
      .filter((i) => !i.assigned_to && (i.status === 'pending' || i.status === 'scheduled'))
      .map(fromInstallation),
  );
  const availableRoutines = computed<TrabajoItem[]>(() =>
    routinesStore.routines.filter((r) => !r.assigned_to && (r.status === 'pending' || r.status === 'scheduled')).map(fromRoutine),
  );

  async function selfAssignTicket(ticketId: string) {
    await jobAssigneesStore.selfAssignTicket(ticketId);
    await ticketsStore.fetchTickets();
  }

  async function selfAssignInstallation(installationId: string) {
    await jobAssigneesStore.selfAssignInstallation(installationId);
    await installationsStore.fetchInstallations();
  }

  async function selfAssignRoutine(routineId: string) {
    await jobAssigneesStore.selfAssignRoutine(routineId);
    await routinesStore.fetchRoutines();
  }

  async function returnTicket(ticketId: string, reason: string) {
    await jobAssigneesStore.returnTicket(ticketId, reason);
    await ticketsStore.fetchTickets();
  }

  async function fetchAll() {
    loading.value = true;
    try {
      const tasks: Promise<unknown>[] = [installationsStore.fetchInstallations(), ticketsStore.fetchTickets(), routinesStore.fetchRoutines()];
      if (auth.role === 'TECNICO_RED' && auth.user?.id) {
        tasks.push(jobAssigneesStore.fetchMyAssignments(auth.user.id).then((rows) => (myAssignments.value = rows)));
      }
      await Promise.all(tasks);
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
        // El backend lee RX y TX con 2 comandos Telnet SECUENCIALES, 30s de
        // tope CADA UNO (readOntSignal en server/src/routes/olt.ts) — hasta
        // 60s en el peor caso, mas lo que tarde en salir de la cola del
        // mutex de la OLT (withOltLock) si el sync automatico esta activo.
        // Con 20s aca, el frontend se rendia ANTES de que el backend
        // terminara (o incluso antes de que fallara con su propio error
        // real) — por eso "siempre" se veia timeout/502 sin detalle.
        const signal = await withTimeout(oltStore.getSignal(ont.olt_device_id, ont.id), 65000, 'Lectura de señal OLT');
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
  async function performClosureSubmit(input: ClosureInput): Promise<{ ontZoneWarning: string | null }> {
    if (!closureGuard.tryEnter(input.jobType, input.jobId)) {
      throw new Error('Ya hay un cierre en curso para este trabajo — espera a que termine antes de reintentar.');
    }
    try {
      return await performClosureSubmitInner(input);
    } finally {
      closureGuard.exit(input.jobType, input.jobId);
    }
  }

  async function performClosureSubmitInner(input: ClosureInput): Promise<{ ontZoneWarning: string | null }> {
    // Codigo de cliente / cintillo Drop (Fase 139) — PRIMERO, antes de subir
    // cualquier foto/firma: si el codigo ya pertenece a OTRO contrato (UNIQUE
    // real en service_contracts.client_code, Fase 39 — nunca se toca), que
    // falle AHORA, antes de dejar evidencia a medio guardar (incidencia
    // Violeta Garcia Silva, 2026-10-13: antes este paso corria AL FINAL,
    // asi que un cierre fallido igual dejaba fotos/firma ya subidas).
    const trimmedClientCode = input.clientCode?.trim();
    if (trimmedClientCode && input.contractId) {
      try {
        await contractsStore.updateContract(input.contractId, { client_code: trimmedClientCode });
      } catch (e) {
        if (isUniqueViolation(e, 'client_code')) {
          throw new Error(
            `El código de cliente "${trimmedClientCode}" ya está asignado a otro contrato — verifica el cintillo/código e ingresa uno distinto.`,
          );
        }
        throw e;
      }
    }

    if (input.updateClientGps && input.clientId && input.latitude != null && input.longitude != null) {
      await clientsStore.updateClient(input.clientId, { latitude: input.latitude, longitude: input.longitude });
      if (input.contractId) {
        await contractsStore.updateContract(input.contractId, { latitude: input.latitude, longitude: input.longitude });
      }
    }

    // Si un intento anterior de este mismo cierre subio algunas fotos y
    // fallo a mitad de camino (red cortada), reintentar volvia a subir TODAS
    // las fotos de nuevo — las que ya habian quedado guardadas terminaban
    // duplicadas (insert, no upsert, sin tope de una fila por categoria).
    // Este chequeo hace el reintento idempotente: una foto cuya categoria ya
    // quedo guardada se salta.
    const { data: existingPhotos } = await supabase
      .from('work_order_photos')
      .select('category, storage_path')
      .eq('job_type', input.jobType)
      .eq('job_id', input.jobId);
    const alreadyUploaded = photosAlreadyUploaded(existingPhotos ?? []);

    // Foto de respaldo del motivo de cierre (Fase 49): la primera evidencia
    // subida, ya sea en este intento o en uno anterior si el cierre se esta
    // reintentando. Solo aplica a tickets (evidencia_1/evidencia_2).
    const isEvidenceCategory = (cat: string) => cat === 'evidencia_1' || cat === 'evidencia_2';
    let evidenciaPath: string | null = null;

    for (const photo of input.photos) {
      if (alreadyUploaded.has(photo.category)) {
        if (isEvidenceCategory(photo.category) && !evidenciaPath) evidenciaPath = alreadyUploaded.get(photo.category)!;
        continue;
      }
      const compressedFile = await compressImage(photo.file);
      const ext = compressedFile.name.includes('.') ? compressedFile.name.split('.').pop() : 'jpg';
      const path = `${input.jobType}/${input.jobId}/${photo.category}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, compressedFile, { upsert: false });
      if (upErr) throw upErr;

      // Censo fotografico de una averia (Fase 95): queda guardada con status
      // 'pending_approval' — NO se aplica a client_photos todavia, un admin
      // la aprueba desde TicketDetailView (copia el archivo, marca 'approved').
      const isPendingApproval = input.pendingApprovalCategories.includes(photo.category as ClientPhotoCategory);
      const { error: rowErr } = await supabase.from('work_order_photos').insert({
        job_type: input.jobType,
        job_id: input.jobId,
        category: photo.category,
        storage_path: path,
        status: isPendingApproval ? 'pending_approval' : 'approved',
      });
      if (rowErr) throw rowErr;

      if (isEvidenceCategory(photo.category) && !evidenciaPath) evidenciaPath = path;

      if (
        !isPendingApproval &&
        input.clientId &&
        input.contractId &&
        input.clientPhotoCategories.includes(photo.category as ClientPhotoCategory)
      ) {
        // clientPhotosStore.uploadPhoto comprime de nuevo por su cuenta, pero
        // ya recibe la version liviana (compressImage no vuelve a pisar un
        // archivo que ya salio mas chico que el original, ver su propio
        // chequeo de tamaño), asi que no hay doble costo real de red.
        await clientPhotosStore.uploadPhoto(input.clientId, input.contractId, photo.category as ClientPhotoCategory, compressedFile);
      }
    }

    // Fotos de serie de equipos (Fase 105) — galeria dinamica, no un slot
    // unico: cada entrada es su propia fila, nunca pisa a otra DENTRO del
    // mismo intento (2 equipos del mismo tipo adjuntados a la vez siguen
    // subiendo ambos). Pero un REINTENTO del cierre completo (ej. tras el
    // error de client_code, incidencia Violeta Garcia Silva) volvia a subir
    // las mismas fotos de equipo ya guardadas en el intento anterior — este
    // snapshot (tomado UNA vez, antes del loop) evita repetir esas.
    const { data: existingEquipmentPhotos } = input.jobType === 'installation' && input.contractId
      ? await supabase.from('client_equipment_photos').select('equipment_type').eq('job_type', input.jobType).eq('job_id', input.jobId)
      : { data: null };
    const equipmentAlreadyUploaded = equipmentTypesAlreadyUploaded(existingEquipmentPhotos ?? []);

    for (const eq of input.equipmentPhotos) {
      if (input.jobType === 'ticket') {
        if (alreadyUploaded.has(`equipment_sticker__${eq.equipmentType}`)) continue;
        const compressedFile = await compressImage(eq.file);
        const ext = compressedFile.name.includes('.') ? compressedFile.name.split('.').pop() : 'jpg';
        const path = `${input.jobType}/${input.jobId}/equipment-${eq.equipmentType}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, compressedFile, { upsert: false });
        if (upErr) throw upErr;
        const { error: rowErr } = await supabase.from('work_order_photos').insert({
          job_type: input.jobType,
          job_id: input.jobId,
          category: `equipment_sticker__${eq.equipmentType}`,
          storage_path: path,
          status: 'pending_approval',
        });
        if (rowErr) throw rowErr;
      } else if (input.jobType === 'installation' && input.clientId && input.contractId) {
        if (equipmentAlreadyUploaded.has(eq.equipmentType)) continue;
        const compressedFile = await compressImage(eq.file);
        await clientEquipmentPhotosStore.uploadDirect(
          input.clientId,
          input.contractId,
          eq.equipmentType,
          compressedFile,
          'installation',
          input.jobId,
        );
      }
    }

    // Firma: si un intento anterior de ESTE cierre ya la subio (closure row
    // ya existe con signature_path), se reusa en vez de subir un archivo
    // nuevo en cada reintento — evita dejar firmas huerfanas en Storage
    // (incidencia Violeta Garcia Silva: 2 archivos de firma para el mismo
    // cierre, el primero sin ninguna fila que lo referencie ya).
    const { data: existingClosure } = await supabase
      .from('work_order_closures')
      .select('signature_path')
      .eq('job_type', input.jobType)
      .eq('job_id', input.jobId)
      .maybeSingle();
    let signaturePath: string | null = existingClosure?.signature_path ?? null;
    if (input.signatureBlob && !signaturePath) {
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
        potencia_dbm: input.potenciaDbm,
      },
      { onConflict: 'job_type,job_id' },
    );
    if (closureErr) throw closureErr;

    // Zona/Sector de Planta Externa: obligatoria al completar una instalacion
    // (input.zoneId siempre viene de closureForm en ese caso) — queda en el
    // contrato, igual que ya hacia InstalacionDetailView.vue desde el Panel
    // Web. Un traslado/recableado cerrado como TICKET (categoria
    // reconnection_relocation) no tiene selector de zona propio en el
    // formulario de cierre, pero SI puede elegir una caja NAP distinta — esa
    // caja ya tiene su propia zona (infra_elementos.zone_id, misma fuente
    // que usa ZonasView), asi que se usa esa como la zona "confirmada" en
    // vez de pedirle el mismo dato 2 veces al tecnico (Fase 3 OLT, Fase C —
    // ver ESTADO_DESARROLLO.md 13am). Si no hay ni zona explicita ni caja
    // NAP elegida (averia normal, sin recableado), no se toca nada.
    let napElemento: { id: string; zone_id?: string | null; puertos_total?: number | null } | undefined;
    if (input.napElementoId) {
      if (!infraStore.elementos.length) await infraStore.fetchElementos();
      napElemento = infraStore.elementos.find((e) => e.id === input.napElementoId);
    }
    const effectiveZoneId = resolveClosureTargetZoneId({
      explicitZoneId: input.zoneId,
      napElementoId: input.napElementoId,
      napZoneId: napElemento?.zone_id ?? null,
    });
    // Fase 159 — Traslado de servicio: la direccion nueva viaja junto con la
    // zona en la MISMA escritura al contrato (reusa installation_address,
    // columna ya existente) — no es una escritura aparte.
    const contractPatch: { zone_id?: string; installation_address?: string } = {};
    if (effectiveZoneId) contractPatch.zone_id = effectiveZoneId;
    if (input.installationAddress) contractPatch.installation_address = input.installationAddress;
    if (Object.keys(contractPatch).length && input.contractId) {
      await contractsStore.updateContract(input.contractId, contractPatch);
    }

    // Codigo de cliente / cintillo Drop: movido al principio de la funcion
    // (ver mas arriba) — se valida/aplica ANTES de subir evidencia.

    // Cambio de puerto NAP (Fase 95, solo si la averia exigio recablear) u
    // obligatoria al completar una instalacion — libera el puerto anterior
    // del contrato (si tenia) y ocupa uno en la caja elegida. Fase C: en
    // tickets/rutinas (nunca en Altas, que siguen exactamente igual que
    // antes — Fase 2 ya esta cerrada y probada, fuera de alcance aqui) y
    // solo para los 3 roles que la propia funcion SQL exige, se reusa la via
    // TRANSACCIONAL de Fase 158 (NAP + zona de la ONT vinculada por
    // contract_id, en una sola transaccion) en vez de la version que solo
    // asigna NAP — asi un traslado cerrado en campo ya no deja la zona de
    // la ONT en la OLT desactualizada hasta que alguien la corrija a mano
    // despues (gap real confirmado, ver 13am). Si el rol no alcanza o es
    // una instalacion, sigue el camino de siempre (igual que antes de esta
    // fase, sin ningun cambio de comportamiento).
    // Fase 159 — Rutina de traslado: "ONT reemplazada" (input.ontReplaced)
    // nunca debe disparar la sincronizacion automatica de zona de la ONT en
    // la OLT — el vinculo contract_id->olt_onts quedaria apuntando a un
    // equipo que ya no es el mismo hasta que un administrador lo revise y
    // relacione el nuevo serial (aprovisionamiento aparte, fuera de alcance
    // aqui: "no ejecutar aprovisionamiento ni cambios en la OLT"). El
    // puerto NAP SI se reasigna igual (es un hecho fisico real,
    // independiente de cual ONT haya en el otro extremo).
    let ontZoneSyncOutcome: OntZoneRpcResult | null = null;
    let ontReplacedSkipped = false;
    if (input.napElementoId && input.contractId && input.clientId) {
      const capacity = napElemento?.puertos_total ?? NAP_CLIENT_LIMIT;
      if (shouldUseTransactionalNapSync({ jobType: input.jobType, ontReplaced: input.ontReplaced, role: auth.role })) {
        const { ontZone } = await fibra.assignContractToNapAndSyncOntZone(input.napElementoId, input.contractId, input.clientId);
        ontZoneSyncOutcome = ontZone;
      } else {
        await fibra.assignContractToNap(input.napElementoId, input.contractId, input.clientId, capacity);
        if (input.ontReplaced) ontReplacedSkipped = true;
      }
    }
    const ontZoneWarning = ontReplacedSkipped
      ? 'ONT marcada como reemplazada — la zona de la ONT en la OLT NO se sincronizó automáticamente; un administrador debe actualizar el vínculo (serial) desde el panel OLT.'
      : describeOntZoneSyncOutcome(ontZoneSyncOutcome);

    if (input.jobType === 'installation') {
      await installationsStore.updateStatus(input.jobId, 'completed');
    } else if (input.jobType === 'routine') {
      await routinesStore.updateRoutine(input.jobId, {
        status: 'completed',
        closure_notes: input.closureNotes,
      });
    } else {
      // Fase 106: si el ticket llega a resolverse sin haber tenido hora
      // agendada, se le asigna la hora real de atencion — si no, quedaba
      // invisible para siempre en el Cronograma (ya no cae en "Sin horario
      // asignado" porque esta resuelto, Fase 106 punto 1, pero tampoco
      // aparecia en ninguna fila de la matriz).
      const { data: currentTicket } = await supabase
        .from('tickets')
        .select('scheduled_start_at')
        .eq('id', input.jobId)
        .single();
      const now = new Date();
      const autoSchedule = currentTicket?.scheduled_start_at
        ? {}
        : { scheduled_start_at: now.toISOString(), scheduled_end_at: new Date(now.getTime() + 60 * 60000).toISOString() };

      // imputable_a_tecnico se deriva del motivo en un trigger de BD (Fase
      // 49) — no se manda desde aca, para que quede una sola fuente de verdad.
      await ticketsStore.updateTicket(input.jobId, {
        status: input.targetStatus as Ticket['status'],
        motivo_averia: input.motivoAveria,
        motivo_averia_detalle: input.motivoAveriaDetalle,
        observacion_cierre: input.justificacionCierre,
        evidencia_url: evidenciaPath,
        ...autoSchedule,
      });
    }

    return { ontZoneWarning };
  }

  async function submitFromQueued(item: QueuedClosure) {
    // Reintento en segundo plano (sin tecnico mirando la pantalla en ese
    // momento) — un aviso de zona/NAP ambiguo aqui solo se deja en consola
    // para no perderlo, igual que el resto de avisos best-effort de este
    // store; el cierre interactivo (submitClosure, abajo) si lo devuelve
    // para mostrarlo en pantalla.
    const { ontZoneWarning } = await performClosureSubmit({
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
      equipmentPhotos: item.equipmentPhotos.map((p) => ({
        equipmentType: p.equipmentType,
        file: new File([p.blob], p.fileName, { type: p.blob.type }),
      })),
      signatureBlob: item.signatureBlob,
      updateClientGps: true,
      clientPhotoCategories: item.clientPhotoCategories as ClientPhotoCategory[],
      pendingApprovalCategories: item.pendingApprovalCategories as ClientPhotoCategory[],
      motivoAveria: item.motivoAveria as TicketMotivoAveria | null,
      motivoAveriaDetalle: item.motivoAveriaDetalle,
      justificacionCierre: item.justificacionCierre,
      potenciaDbm: item.potenciaDbm,
      napElementoId: item.napElementoId,
      zoneId: item.zoneId,
      ontReplaced: item.ontReplaced,
      installationAddress: item.installationAddress,
      clientCode: item.clientCode,
    });
    if (ontZoneWarning) {
      // eslint-disable-next-line no-console
      console.warn(`[zona-ont] cierre en cola (${item.jobType}/${item.jobId}): ${ontZoneWarning}`);
    }
  }

  async function submitClosure(input: ClosureInput): Promise<{ queued: boolean; ontZoneWarning?: string | null }> {
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
        equipmentPhotos: input.equipmentPhotos.map((p) => ({ equipmentType: p.equipmentType, blob: p.file, fileName: p.file.name })),
        signatureBlob: input.signatureBlob,
        clientPhotoCategories: input.clientPhotoCategories,
        pendingApprovalCategories: input.pendingApprovalCategories,
        motivoAveria: input.motivoAveria,
        motivoAveriaDetalle: input.motivoAveriaDetalle,
        justificacionCierre: input.justificacionCierre,
        potenciaDbm: input.potenciaDbm,
        napElementoId: input.napElementoId,
        zoneId: input.zoneId,
        ontReplaced: input.ontReplaced,
        installationAddress: input.installationAddress,
        clientCode: input.clientCode,
      });
      await refreshQueuedCount();
      return { queued: true };
    }

    try {
      const { ontZoneWarning } = await performClosureSubmit(input);
      return { queued: false, ontZoneWarning };
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
          equipmentPhotos: input.equipmentPhotos.map((p) => ({ equipmentType: p.equipmentType, blob: p.file, fileName: p.file.name })),
          signatureBlob: input.signatureBlob,
          clientPhotoCategories: input.clientPhotoCategories,
          pendingApprovalCategories: input.pendingApprovalCategories,
          motivoAveria: input.motivoAveria,
          motivoAveriaDetalle: input.motivoAveriaDetalle,
          justificacionCierre: input.justificacionCierre,
          potenciaDbm: input.potenciaDbm,
          napElementoId: input.napElementoId,
          zoneId: input.zoneId,
          ontReplaced: input.ontReplaced,
          installationAddress: input.installationAddress,
          clientCode: input.clientCode,
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
    myActiveJob,
    availableTickets,
    availableInstallations,
    availableRoutines,
    selfAssignTicket,
    selfAssignInstallation,
    selfAssignRoutine,
    returnTicket,
    fetchAll,
    refreshQueuedCount,
    runDiagnostico,
    submitClosure,
    syncQueued,
  };
});
