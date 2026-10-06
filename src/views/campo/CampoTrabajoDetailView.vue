<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import CampoLayout from '@/components/campo/CampoLayout.vue';
import SignaturePad from '@/components/campo/SignaturePad.vue';
import QrScannerModal from '@/components/campo/QrScannerModal.vue';
import PhotoLightbox, { type LightboxPhoto } from '@/components/PhotoLightbox.vue';
import { useCampoStore, isNetworkError, type DiagnosticoResult } from '@/stores/campo';
import { useTicketsStore } from '@/stores/tickets';
import { useClientEquipmentPhotosStore, type ClientEquipmentPhotoWithUrl } from '@/stores/clientEquipmentPhotos';
import { useOltStore } from '@/stores/olt';
import { useInventoryStore } from '@/stores/inventory';
import { useInventoryUnitsStore } from '@/stores/inventoryUnits';
import { useInfraElementosStore } from '@/stores/infraElementos';
import { useFoFibraStore } from '@/stores/foFibra';
import { useClientsStore } from '@/stores/clients';
import { useContractsStore } from '@/stores/contracts';
import { useClientPhotosStore, type ClientPhotoWithUrl } from '@/stores/clientPhotos';
import { useAuthStore } from '@/stores/auth';
import { useJobAssigneesStore } from '@/stores/jobAssignees';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import { getErrorMessage } from '@/lib/errors';
import { saveDraft, loadDraft, clearDraft } from '@/lib/formDrafts';
import { MOTIVO_AVERIA_OPTIONS, MOTIVOS_EXIMEN_TECNICO } from '@/lib/ticketMotivoAveria';
import { EQUIPMENT_TYPE_LABEL, EQUIPMENT_TYPE_OPTIONS } from '@/lib/equipmentPhotoType';
import { mapsLink, telLink, waLink, wazeLink } from '@/lib/phone';
import {
  NAP_CLIENT_LIMIT,
  type Client,
  type ClientPhotoCategory,
  type EquipmentPhotoType,
  type Installation,
  type InventoryMovement,
  type InventoryUnit,
  type JobAssignee,
  type JobType,
  type ServiceContract,
  type Ticket,
  type TicketMotivoAveria,
} from '@/types/domain';

const route = useRoute();
const router = useRouter();
const campoStore = useCampoStore();
const ticketsStore = useTicketsStore();
const oltStore = useOltStore();
const inventoryStore = useInventoryStore();
const inventoryUnitsStore = useInventoryUnitsStore();
const infraStore = useInfraElementosStore();
const fibra = useFoFibraStore();
const clientsStore = useClientsStore();
const contractsStore = useContractsStore();
const clientPhotosStore = useClientPhotosStore();
const clientEquipmentPhotosStore = useClientEquipmentPhotosStore();
const auth = useAuthStore();
const jobAssigneesStore = useJobAssigneesStore();
const { confirmDialog } = useConfirm();
const toast = useToast();

// Provisionar (dar de alta desde cero) una ONT en la OLT es tarea de
// administracion, no del tecnico de campo — el backend ya lo exige
// (olt.ts, ONT_PROVISION); esto solo evita mostrarle el formulario a quien
// la API igual va a rechazar.
const canProvisionOnt = computed(() => auth.role !== 'TECNICO_RED');

const jobType = route.params.tipo as JobType;
const jobId = route.params.id as string;
// Fase 116 — clave del borrador local de este cierre (persistencia offline
// ante el sistema matando el proceso, ver seccion de "Borrador local" abajo).
const draftKey = `${jobType}_${jobId}`;

// Fase 98/118: una orden sin tecnico asignado vive en campoStore.available*
// (tickets/installations/routines), no en trabajos (que solo trae lo del
// propio tecnico) — hay que buscar en los 4 para poder abrir su detalle y
// "tomarla". Sin esto, abrir una Alta/Rutina libre desde "Disponibles" se
// quedaba en "Cargando trabajo..." para siempre (trabajo nunca resolvia).
const trabajo = computed(
  () =>
    campoStore.trabajos.find((t) => t.jobType === jobType && t.id === jobId) ??
    campoStore.availableTickets.find((t) => t.jobType === jobType && t.id === jobId) ??
    campoStore.availableInstallations.find((t) => t.jobType === jobType && t.id === jobId) ??
    campoStore.availableRoutines.find((t) => t.jobType === jobType && t.id === jobId),
);

// Una instalacion 'completed' (o una rutina 'completed'/'cancelled', Fase
// 101) queda cerrada para el tecnico (Fase 69, lo mismo que ya rige
// "Materiales" en InstalacionesView.vue) — pero esta pantalla (app de
// campo) tenia el mismo formulario de cierre (fotos, GPS, firma) sin
// ningun candado: un tecnico podia reabrir un trabajo ya completado y
// volver a "completarlo", pisando las fotos/GPS ya guardados. Se oculta
// Materiales y Cierre de trabajo para el tecnico en ese caso; admin/super
// lo siguen viendo siempre.
const isLockedForTecnico = computed(
  () =>
    (jobType === 'installation' || jobType === 'routine') &&
    auth.role === 'TECNICO_RED' &&
    trabajo.value?.estadoUi === 'completado',
);
// Misma idea que isLockedForTecnico pero para tickets: una vez resuelta o
// cerrada la averia, el tecnico ya no puede corregir materiales/equipos/
// fotos/cierre desde la App de Campo — solo administracion/soporte desde el
// panel. La RLS de fondo (tickets_update_staff, Fase 94/88) solo bloqueaba
// 'closed'; esto es ademas un candado de UX para 'resolved'.
const ticketFrozen = computed(() => {
  if (jobType !== 'ticket' || auth.role !== 'TECNICO_RED') return false;
  const status = (trabajo.value?.raw as Ticket | undefined)?.status;
  return status === 'resolved' || status === 'closed';
});
const trabajoDescripcion = computed(() => {
  const raw = trabajo.value?.raw;
  if (!raw) return null;
  return jobType === 'installation' ? (raw as Installation).notes : (raw as Ticket).description;
});

// El GPS de la instalacion (Fase 38) vive en el contrato, no en el cliente —
// importante en clientes con 2+ servicios, para no mostrarle al tecnico la
// ubicacion de la casa equivocada. Si el contrato todavia no tiene GPS
// propio (linea vieja sin backfill), cae a la ficha del cliente y despues al
// join de instalaciones/tickets como ultimo respaldo.
const gps = computed(() => {
  const lat = activeContract.value?.latitude ?? clientDetail.value?.latitude ?? trabajo.value?.latitude ?? null;
  const lng = activeContract.value?.longitude ?? clientDetail.value?.longitude ?? trabajo.value?.longitude ?? null;
  return lat != null && lng != null ? { lat, lng } : null;
});

// ---- Ficha del cliente (solo lectura) — el tecnico necesita ver GPS, PPPoE,
// plan y contrato sin tener que preguntarle al administrador; lo unico que
// puede cambiar en esta pantalla es el GPS/fotos, y eso vive en el cierre. ----
const clientDetail = ref<Client | null>(null);
const activeContract = ref<ServiceContract | null>(null);
const loadingClientInfo = ref(false);

async function loadClientInfo(clientId: string) {
  loadingClientInfo.value = true;
  try {
    const [client, contracts] = await Promise.all([
      clientsStore.fetchClientById(clientId),
      contractsStore.fetchContractsByClient(clientId),
    ]);
    clientDetail.value = client;
    // Si el trabajo ya tiene un contrato puntual (Fase 37/38), es ESE el que
    // hay que mostrar — no "cualquier contrato activo del cliente", que en
    // uno con 2+ servicios podia mostrar el plan/zona de la casa equivocada.
    activeContract.value =
      contracts.find((c) => c.id === trabajo.value?.contractId) ??
      contracts.find((c) => c.status === 'active') ??
      contracts[0] ??
      null;
  } catch {
    // Info de apoyo: si falla, el tecnico igual puede seguir con el trabajo.
  } finally {
    loadingClientInfo.value = false;
  }
}

// ---- Fotos ya registradas del cliente (fachada, posicion del modem, caja
// NAP...) — el tecnico las ve ANTES de ir para no tener que preguntar como
// quedo la instalacion la vez anterior. Solo lectura: cambiarlas es parte
// del cierre de trabajo mas abajo. ----
const PHOTO_LABEL: Record<ClientPhotoCategory, string> = {
  facade: 'Fachada',
  service_sheet: 'Hoja de servicio',
  modem_position: 'Posición del módem',
  nap_box: 'Caja NAP',
  pon_power: 'Potencia Óptica Recibida',
  equipment_sticker: 'Sticker Serie/MAC',
};
const existingPhotos = ref<ClientPhotoWithUrl[]>([]);
const loadingPhotos = ref(false);

async function loadExistingPhotos(contractId: string | null) {
  if (!contractId) {
    existingPhotos.value = [];
    return;
  }
  loadingPhotos.value = true;
  try {
    existingPhotos.value = await clientPhotosStore.fetchPhotos(contractId);
  } catch {
    existingPhotos.value = [];
  } finally {
    loadingPhotos.value = false;
  }
}

// ---- Fotos de serie de equipos (Fase 105): galeria dinamica (modem/tv
// box/mesh/otro) — a diferencia de client_photos (slot unico), un contrato
// puede tener varias filas a la vez. Solo aplica a ticket/installation: una
// rutina no tiene contract_id (Routine en types/domain.ts), asi que
// contractId queda null y estas funciones no hacen nada. ----
const approvedEquipmentPhotos = ref<ClientEquipmentPhotoWithUrl[]>([]);
const loadingEquipmentPhotos = ref(false);

async function loadEquipmentPhotos(contractId: string | null) {
  if (!contractId) {
    approvedEquipmentPhotos.value = [];
    return;
  }
  loadingEquipmentPhotos.value = true;
  try {
    approvedEquipmentPhotos.value = await clientEquipmentPhotosStore.fetchByContract(contractId);
  } catch {
    approvedEquipmentPhotos.value = [];
  } finally {
    loadingEquipmentPhotos.value = false;
  }
}

interface EquipmentPhotoEntry {
  id: string;
  type: EquipmentPhotoType;
  file: File | null;
  previewUrl: string | null;
}
const equipmentEntries = ref<EquipmentPhotoEntry[]>([]);

function addEquipmentEntry() {
  equipmentEntries.value.push({ id: `eq-${Date.now()}-${Math.random().toString(36).slice(2)}`, type: 'modem', file: null, previewUrl: null });
}

function removeEquipmentEntry(id: string) {
  const entry = equipmentEntries.value.find((e) => e.id === id);
  if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  equipmentEntries.value = equipmentEntries.value.filter((e) => e.id !== id);
}

function onEquipmentFileChange(id: string, event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const entry = equipmentEntries.value.find((e) => e.id === id);
  if (!entry) return;
  if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  entry.file = file;
  entry.previewUrl = URL.createObjectURL(file);
}

// ---- Censo fotografico de una averia (Fase 95): las categorias de la
// ficha tecnica del cliente. Si ya existe una foto de esa categoria se
// ofrece "Actualizar" (reemplazo/historico); si el cliente es antiguo y
// nunca se le tomo, se marca "Pendiente de registro" para que el tecnico
// aproveche la visita. Nunca se aplican directo — quedan 'pending_approval'
// hasta que un admin las apruebe (a diferencia de una instalacion nueva).
// "Sticker de serie/MAC" salio de aca en la Fase 105 — paso a ser una
// galeria dinamica aparte (ver "Fotos de serie de equipos" mas abajo),
// porque un cliente puede tener modem+tv box+mesh a la vez y esto era un
// slot unico que se pisaba solo.
const CENSO_CATEGORIES: { value: ClientPhotoCategory; label: string; icon: string }[] = [
  { value: 'facade', label: 'Fachada de la vivienda', icon: '🏠' },
  { value: 'service_sheet', label: 'Hoja de servicio firmada', icon: '📄' },
  { value: 'modem_position', label: 'Ubicación del módem/ONU/Mesh', icon: '📶' },
  { value: 'nap_box', label: 'Caja NAP y puerto asignado', icon: '📦' },
  { value: 'pon_power', label: 'Medición de potencia óptica (dBm)', icon: '🔋' },
];
const existingPhotoByCategory = computed(() => {
  const map = new Map<ClientPhotoCategory, ClientPhotoWithUrl>();
  for (const p of existingPhotos.value) map.set(p.category, p);
  return map;
});

const DOCUMENT_LABEL: Record<string, string> = { cedula: 'DNI', ruc: 'RUC', pasaporte: 'Pasaporte' };

onMounted(async () => {
  // Fase 116 — guardar el borrador justo antes de que el sistema mate el
  // proceso en 2do plano (el tecnico abre la camara nativa o WhatsApp): el
  // evento 'change' de un <input type=file> dispara DESPUES de que la app
  // ya volvio a 1er plano, pero visibilitychange/pagehide cubren el instante
  // en que se va, que es cuando Android puede matarla sin aviso.
  document.addEventListener('visibilitychange', handleVisibilityOrHide);
  window.addEventListener('pagehide', handleVisibilityOrHide);

  if (!campoStore.trabajos.length) await campoStore.fetchAll();
  oltStore.fetchDevices().catch(() => {});
  inventoryStore.fetchProducts().catch(() => {});
  // Pre-carga del Diagnostico express: se dispara apenas el tecnico ABRE
  // esta orden puntual (una sola, la que esta viendo — no todo su listado),
  // en paralelo, sin bloquear el resto de la pantalla. Para cuando
  // efectivamente toque "Ejecutar" (leyo la ficha, llamo al cliente...) la
  // respuesta de la OLT frecuentemente ya esta lista o casi, en vez de
  // recien arrancar los ~20-60s que tarda leer RX+TX por Telnet.
  runDiagnostico();
  await loadMaterials();
  // Una rutina sin cliente puntual (apunta a zona/caja NAP, Fase 101) no
  // tiene ficha de cliente que cargar.
  if (trabajo.value?.clientId) {
    await Promise.all([
      loadClientInfo(trabajo.value.clientId),
      loadExistingPhotos(trabajo.value.contractId),
      loadEquipmentPhotos(trabajo.value.contractId),
    ]);
  }
  if (jobType === 'ticket') {
    infraStore.fetchElementos().catch(() => {});
    fibra.fetchTodosNapPuertos().catch(() => {});
    await Promise.all([loadEquipos(), loadAssignees()]);
  } else if (jobType === 'installation' || jobType === 'routine') {
    // Fase 118: Altas/Rutinas tambien pueden quedar sin tecnico (pool de
    // "Disponibles" de la App de Campo) — necesitan la misma cuadrilla/lock
    // que ya tenian los tickets libres (Fase 98), sin el resto de carga
    // propia de una averia (equipos, infra NAP).
    await loadAssignees();
  }
  await restoreDraft();
});

// ---- Diagnostico express ----
// Se dispara SOLO una por técnico-trabajo a la vez: la OLT real solo
// tolera 1 sesion Telnet (Fase 77) y leer la señal de una ONU ya son 2
// comandos secuenciales (~hasta 60s en el peor caso) — lanzar una segunda
// consulta en paralelo mientras la primera sigue en vuelo seria tanto un
// desperdicio como el mismo riesgo que withOltLock existe para evitar.
const diagnostico = ref<DiagnosticoResult | null>(null);
const diagLoading = ref(false);
const diagError = ref<string | null>(null);
let diagInFlight: Promise<void> | null = null;

function runDiagnostico(): Promise<void> {
  // Una rutina sin cliente puntual (zona/caja NAP) no tiene a quien
  // consultarle OLT/MikroTik/TR-069.
  const clientId = trabajo.value?.clientId;
  if (!clientId) return Promise.resolve();
  // Ya hay una consulta en curso (manual o la pre-carga automatica de
  // abajo) — el tecnico se "sube" a esa misma respuesta en vez de pedir
  // otra. Si ya habia terminado, esto es null y arranca una nueva (permite
  // refrescar la lectura a mano cuando el tecnico quiera).
  if (diagInFlight) return diagInFlight;

  diagLoading.value = true;
  diagError.value = null;
  diagInFlight = (async () => {
    try {
      diagnostico.value = await campoStore.runDiagnostico(clientId, trabajo.value!.contractId);
    } catch (e) {
      // A diferencia del cierre de trabajo, esto necesita hablar con la OLT en
      // vivo — no se puede "guardar para mas tarde" como las fotos. Lo minimo
      // que si se puede hacer es distinguir "sin señal, reintenta" de un error
      // real, para no mandar al tecnico a buscar un problema que no existe.
      diagError.value = isNetworkError(e)
        ? 'Sin señal por ahora — revisa tu conexión y toca "Diagnóstico express" de nuevo.'
        : getErrorMessage(e, 'No se pudo ejecutar el diagnóstico');
    } finally {
      diagLoading.value = false;
      diagInFlight = null;
    }
  })();
  return diagInFlight;
}

function signalClass(rx: number | null) {
  if (rx == null) return 'text-slate-400';
  if (rx >= -8 || rx <= -27) return 'text-red-600';
  if (rx <= -25) return 'text-amber-600';
  return 'text-green-600';
}

// ---- Escaner QR del serial al provisionar en la OLT ----
// Antes tambien alimentaba un campo "Serial de la ONT" suelto en el cierre
// de trabajo, que quedaba guardado aparte (work_order_closures.ont_serial)
// sin conectarse nunca con el equipo serializado real (inventory_units) que
// ya registra "Equipos asignados" — duplicaba el dato sin ningun uso
// posterior, se quito (Fase 66).
const qrOpen = ref(false);

function openQr() {
  qrOpen.value = true;
}
function onQrScan(value: string) {
  provisionForm.value.serial = value;
}

// ---- Provisionamiento en OLT (solo instalaciones) ----
const provisionForm = ref({
  oltDeviceId: '',
  shelf: 1,
  slot: 1,
  port: 1,
  serial: '',
  onuType: '',
  vlan: 100,
  description: '',
  tcontProfile: '',
  trafficProfile: '',
});
const profiles = ref<{ tcontProfiles: string[]; trafficProfiles: string[] }>({ tcontProfiles: [], trafficProfiles: [] });
const profilesLoading = ref(false);
const provisioning = ref(false);
const provisionError = ref<string | null>(null);
const provisionResult = ref<{ rxPower: number | null; txPower: number | null } | null>(null);

watch(
  () => provisionForm.value.oltDeviceId,
  async (deviceId) => {
    profiles.value = { tcontProfiles: [], trafficProfiles: [] };
    if (!deviceId) return;
    profilesLoading.value = true;
    try {
      profiles.value = await oltStore.fetchProfiles(deviceId);
    } finally {
      profilesLoading.value = false;
    }
  },
);

async function handleProvision() {
  if (!trabajo.value || !provisionForm.value.oltDeviceId) return;
  provisioning.value = true;
  provisionError.value = null;
  try {
    const result = await oltStore.registerOnt(provisionForm.value.oltDeviceId, {
      shelf: provisionForm.value.shelf,
      slot: provisionForm.value.slot,
      port: provisionForm.value.port,
      serial: provisionForm.value.serial,
      onuType: provisionForm.value.onuType,
      vlan: provisionForm.value.vlan,
      description: provisionForm.value.description || trabajo.value.clienteNombre,
      tcontProfile: provisionForm.value.tcontProfile,
      trafficProfile: provisionForm.value.trafficProfile,
      clientId: trabajo.value.clientId,
    });
    provisionResult.value = { rxPower: result.rx_power, txPower: result.tx_power };
  } catch (e) {
    provisionError.value = isNetworkError(e)
      ? 'Sin señal por ahora — el registro en la OLT necesita conexión en el momento, no se puede dejar pendiente. Revisa tu señal y toca "Registrar" de nuevo.'
      : getErrorMessage(e, 'Error al registrar la ONT en la OLT (revisa perfiles y puerto)');
  } finally {
    provisioning.value = false;
  }
}

// ---- Materiales usados ----
const materials = ref<InventoryMovement[]>([]);
const materialForm = ref({ productId: '', quantity: 1 });
const savingMaterial = ref(false);
const materialError = ref<string | null>(null);

async function loadMaterials() {
  // Rutinas V1 no registra materiales (Fase 101, alcance recortado).
  if (jobType === 'routine') return;
  materials.value =
    jobType === 'installation'
      ? await inventoryStore.fetchMovementsByInstallation(jobId)
      : await inventoryStore.fetchMovementsByTicket(jobId);
}

// El Kardex es insert-only (Fase 58, no se borra ninguna fila) — "quitar" o
// "corregir" un material ya registrado significa revertirlo (movimiento
// opuesto, reintegra el stock) y, si corresponde, volver a registrarlo con
// la cantidad correcta. Por eso la lista que ve el tecnico solo muestra los
// egresos TODAVIA vigentes (sin su reversion), no el Kardex crudo completo.
const activeMaterials = computed(() => {
  const revertedIds = new Set(materials.value.filter((m) => m.reverses_movement_id).map((m) => m.reverses_movement_id));
  return materials.value.filter((m) => m.movement_type === 'egreso' && !revertedIds.has(m.id));
});

const editingMaterialId = ref<string | null>(null);
const editMaterialQty = ref(1);
const materialActionBusy = ref<string | null>(null);

async function handleAddMaterial() {
  if (!materialForm.value.productId || materialForm.value.quantity <= 0) return;
  savingMaterial.value = true;
  materialError.value = null;
  try {
    await inventoryStore.registerUsage({
      productId: materialForm.value.productId,
      quantity: materialForm.value.quantity,
      installationId: jobType === 'installation' ? jobId : undefined,
      ticketId: jobType === 'ticket' ? jobId : undefined,
      reason: `Campo — ${trabajo.value?.clienteNombre ?? jobId}`,
    });
    materialForm.value = { productId: '', quantity: 1 };
    await loadMaterials();
  } catch (e) {
    materialError.value = getErrorMessage(e, 'Error al registrar el material (revisa el stock disponible)');
  } finally {
    savingMaterial.value = false;
  }
}

function startEditMaterial(m: InventoryMovement) {
  editingMaterialId.value = m.id;
  editMaterialQty.value = m.quantity;
  materialError.value = null;
}

async function handleSaveMaterialQty(m: InventoryMovement) {
  const newQty = editMaterialQty.value;
  editingMaterialId.value = null;
  if (!newQty || newQty === m.quantity) return;
  materialActionBusy.value = m.id;
  materialError.value = null;
  try {
    await inventoryStore.revertMovement(m);
    if (newQty > 0) {
      await inventoryStore.registerUsage({
        productId: m.product_id,
        quantity: newQty,
        installationId: jobType === 'installation' ? jobId : undefined,
        ticketId: jobType === 'ticket' ? jobId : undefined,
        reason: `Corrección de cantidad (antes ${m.quantity})`,
      });
    }
    await loadMaterials();
  } catch (e) {
    materialError.value = getErrorMessage(e, 'Error al corregir la cantidad');
  } finally {
    materialActionBusy.value = null;
  }
}

async function handleRemoveMaterial(m: InventoryMovement) {
  materialActionBusy.value = m.id;
  materialError.value = null;
  try {
    await inventoryStore.revertMovement(m);
    await loadMaterials();
  } catch (e) {
    materialError.value = getErrorMessage(e, 'Error al quitar el material');
  } finally {
    materialActionBusy.value = null;
  }
}

// ---- Registro / Cambio de equipos (Fase 95, solo averias) ----
// "Saliente" se libera de inmediato (ya salio fisicamente de la casa). El
// "entrante" NO queda oficialmente asignado al cliente todavia — se guarda
// 'pending_approval' y un admin lo aprueba desde TicketDetailView (la BD ya
// rechaza que un tecnico lo deje 'assigned' directo desde un ticket).
const assignedUnits = ref<InventoryUnit[]>([]);
const pendingUnits = ref<InventoryUnit[]>([]);
const loadingUnits = ref(false);

async function loadEquipos() {
  if (jobType !== 'ticket' || !trabajo.value) return;
  loadingUnits.value = true;
  try {
    const [assigned, pending] = await Promise.all([
      trabajo.value.contractId
        ? inventoryUnitsStore.fetchUnitsByContract(trabajo.value.contractId)
        : // clientId nunca es null aqui: esta funcion retorna arriba si jobType !== 'ticket', y un ticket siempre tiene cliente.
          inventoryUnitsStore.fetchUnitsByClient(trabajo.value.clientId!),
      inventoryUnitsStore.fetchUnitsByTicket(jobId),
    ]);
    assignedUnits.value = assigned.filter((u) => u.status === 'assigned');
    pendingUnits.value = pending.filter((u) => u.status === 'pending_approval');
  } finally {
    loadingUnits.value = false;
  }
}

// Desvincular un equipo entrante pendiente de aprobacion (serie/MAC
// equivocada): vuelve a 'in_stock' (bodega, libre para reasignar) y se
// suelta del ticket/cliente. Solo aplica al entrante — el saliente ya salio
// fisicamente de la casa y corregirlo es trabajo de administracion (ver
// InventarioProductoView.vue, "forzar a bodega").
const unlinkingUnitId = ref<string | null>(null);
const unlinkError = ref<string | null>(null);

async function handleUnlinkPendingUnit(unit: InventoryUnit) {
  unlinkingUnitId.value = unit.id;
  unlinkError.value = null;
  try {
    await inventoryUnitsStore.rejectUnit(unit.id, 'Desvinculado por el técnico (serie/MAC equivocada)');
    await loadEquipos();
  } catch (e) {
    unlinkError.value = getErrorMessage(e, 'Error al desvincular el equipo');
  } finally {
    unlinkingUnitId.value = null;
  }
}

// ---- Tecnico(s) asignados / auto-asignacion de una orden libre (Fase 98,
// extendido a Altas/Rutinas en la Fase 118) ----
const assignees = ref<JobAssignee[]>([]);
const loadingAssignees = ref(false);
const selfAssigning = ref(false);
const selfAssignError = ref<string | null>(null);

// Mientras la orden no tiene a nadie asignado, el formulario completo
// (materiales, equipos, cierre) queda bloqueado — un tecnico que todavia no
// "tomo" la orden no deberia poder cerrarla (la BD lo rechazaria igual, ver
// tickets_update_staff/sus equivalentes, pero asi queda claro en la UI antes
// de intentarlo). Se mantiene el nombre "isUnassignedTicket" en el resto del
// archivo (Censo fotografico, Cierre de trabajo) porque esas secciones solo
// aplican a tickets de todos modos.
const isUnassignedTicket = computed(
  () => (jobType === 'ticket' || jobType === 'installation' || jobType === 'routine') && !loadingAssignees.value && !assignees.value.length,
);
const TOMAR_LABEL: Record<JobType, string> = { ticket: 'Tomar este ticket', installation: 'Tomar esta instalación', routine: 'Tomar esta rutina' };

async function loadAssignees() {
  loadingAssignees.value = true;
  try {
    assignees.value = await jobAssigneesStore.fetchAssignees(jobType, jobId);
  } finally {
    loadingAssignees.value = false;
  }
}

async function handleTakeTicket() {
  // Una rutina puede no tener cliente puntual (Fase 101, apunta a zona/caja
  // NAP) — preguntar "¿ya coordinaste con el cliente?" no aplica ahi.
  if (jobType !== 'routine') {
    const ok = await confirmDialog({
      title: '¿Ya coordinaste con el cliente?',
      message: 'Asegúrate de haber contactado al cliente para verificar que se encuentra en su domicilio antes de asumir la orden.',
      confirmLabel: 'Sí, ya coordiné',
      cancelLabel: 'Cancelar',
    });
    if (!ok) return;
  }

  selfAssigning.value = true;
  selfAssignError.value = null;
  try {
    if (jobType === 'ticket') await campoStore.selfAssignTicket(jobId);
    else if (jobType === 'installation') await campoStore.selfAssignInstallation(jobId);
    else await campoStore.selfAssignRoutine(jobId);
    await Promise.all([loadAssignees(), jobType === 'ticket' ? loadEquipos() : Promise.resolve()]);
    toast.success('¡Asignado con éxito! Ya puedes iniciar la atención.');
  } catch (e) {
    selfAssignError.value = getErrorMessage(e, 'No se pudo asignar la orden (puede que alguien ya la haya tomado)');
  } finally {
    selfAssigning.value = false;
  }
}

// ---- Devolver un ticket ya tomado (Fase 99): el tecnico no puede
// continuar (emergencia, se equivoco de orden, etc). Deja una nota
// obligatoria (ticket_comments) y el ticket vuelve a la bolsa de
// "Disponibles" para que CUALQUIER tecnico lo tome — a diferencia de
// "Cliente Ausente" (Fase 102, mas abajo), que reprograma y se lo queda el
// mismo tecnico. ----
const isMyAssignment = computed(() => assignees.value.some((a) => a.technician_id === auth.user?.id));
const showReturnForm = ref(false);
const returnReason = ref('');
const returning = ref(false);
const returnError = ref<string | null>(null);

function toggleReturnForm() {
  showReturnForm.value = !showReturnForm.value;
  returnError.value = null;
}

async function handleReturnTicket() {
  if (!returnReason.value.trim()) {
    returnError.value = 'Escribe el motivo de la devolución.';
    return;
  }
  returning.value = true;
  returnError.value = null;
  try {
    await campoStore.returnTicket(jobId, returnReason.value.trim());
    toast.success('Orden devuelta. Vuelve a la bolsa de disponibles.');
    router.push('/campo');
  } catch (e) {
    returnError.value = getErrorMessage(e, 'No se pudo devolver la orden');
  } finally {
    returning.value = false;
  }
}

// ---- Cliente Ausente / re-agendamiento prioritario (Fase 102): el tecnico
// llego y no habia nadie. A diferencia de "Devolver orden", el ticket SIGUE
// asignado al mismo tecnico — solo se reprograma (status='rescheduled',
// priority sube a 'urgent' automaticamente) para una fecha/hora puntual.
// El "desvincular el temporizador" del pedido pasa solo: el chip de
// cronometro en OperacionesHoyView.vue/CampoDashboardView solo se muestra con
// status 'in_progress', que este update deja atras. ----
const canMarkAusente = computed(
  () => jobType === 'ticket' && isMyAssignment.value && (trabajo.value?.raw as Ticket | undefined)?.status === 'in_progress',
);
const showAusenteForm = ref(false);
const ausenteDate = ref('');
const ausenteReason = ref('');
const savingAusente = ref(false);
const ausenteError = ref<string | null>(null);

function defaultAusenteDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toggleAusenteForm() {
  showAusenteForm.value = !showAusenteForm.value;
  if (showAusenteForm.value && !ausenteDate.value) ausenteDate.value = defaultAusenteDate();
  ausenteError.value = null;
}

async function handleMarkAusente() {
  if (!ausenteDate.value) {
    ausenteError.value = 'Elige la fecha de reprogramación.';
    return;
  }
  savingAusente.value = true;
  ausenteError.value = null;
  try {
    await ticketsStore.updateTicket(jobId, {
      status: 'rescheduled',
      priority: 'urgent',
      rescheduled_to: new Date(ausenteDate.value).toISOString(),
      reschedule_reason: ausenteReason.value.trim() || null,
    });
    toast.success('Marcado como Cliente Ausente — reprogramado y subido a prioridad urgente.');
    router.push('/campo');
  } catch (e) {
    ausenteError.value = getErrorMessage(e, 'No se pudo reprogramar el ticket');
  } finally {
    savingAusente.value = false;
  }
}

const outgoingForm = ref({ unitId: '', condition: 'in_stock' as 'in_stock' | 'damaged' | 'in_repair', reason: '' });
const savingOutgoing = ref(false);
const outgoingError = ref<string | null>(null);

async function handleOutgoingUnit() {
  if (!trabajo.value || !outgoingForm.value.unitId) return;
  savingOutgoing.value = true;
  outgoingError.value = null;
  try {
    // clientId nunca es null aqui: este formulario solo se muestra para jobType === 'ticket'.
    await inventoryUnitsStore.returnUnit(
      outgoingForm.value.unitId,
      outgoingForm.value.condition,
      outgoingForm.value.reason || 'Retirado en averia',
      trabajo.value.clientId!,
      jobId,
    );
    outgoingForm.value = { unitId: '', condition: 'in_stock', reason: '' };
    await loadEquipos();
  } catch (e) {
    outgoingError.value = getErrorMessage(e, 'Error al retirar el equipo');
  } finally {
    savingOutgoing.value = false;
  }
}

const incomingForm = ref({ productId: '', unitId: '', reason: '' });
const availableIncomingUnits = ref<InventoryUnit[]>([]);
const loadingIncomingUnits = ref(false);
const savingIncoming = ref(false);
const incomingError = ref<string | null>(null);

async function onIncomingProductChange() {
  incomingForm.value.unitId = '';
  availableIncomingUnits.value = [];
  if (!incomingForm.value.productId) return;
  loadingIncomingUnits.value = true;
  try {
    const units = await inventoryUnitsStore.fetchUnitsByProduct(incomingForm.value.productId);
    availableIncomingUnits.value = units.filter((u) => u.status === 'in_stock');
  } finally {
    loadingIncomingUnits.value = false;
  }
}

async function handleIncomingUnit() {
  if (!trabajo.value || !incomingForm.value.unitId) return;
  savingIncoming.value = true;
  incomingError.value = null;
  try {
    // clientId nunca es null aqui: este formulario solo se muestra para jobType === 'ticket'.
    await inventoryUnitsStore.stageUnitFromTicket(incomingForm.value.unitId, trabajo.value.clientId!, {
      contractId: trabajo.value.contractId ?? undefined,
      ticketId: jobId,
      reason: incomingForm.value.reason || 'Equipo entrante registrado en averia',
    });
    incomingForm.value = { productId: '', unitId: '', reason: '' };
    availableIncomingUnits.value = [];
    await loadEquipos();
  } catch (e) {
    incomingError.value = getErrorMessage(e, 'Error al registrar el equipo entrante');
  } finally {
    savingIncoming.value = false;
  }
}

// ---- dBm + cambio de puerto NAP opcionales (Fase 95, solo averias) ----
const napOptions = computed(() =>
  infraStore.elementos
    .filter((e) => e.tipo === 'caja_nap')
    .map((e) => {
      const puertos = fibra.napPuertosPorElemento[e.id] ?? [];
      const used = puertos.filter((p) => p.estado === 'ocupado').length;
      return { id: e.id, name: e.name, used, capacity: e.puertos_total ?? NAP_CLIENT_LIMIT };
    })
    .sort((a, b) => a.name.localeCompare(b.name)),
);

// ---- Cierre de trabajo ----
const INSTALL_PHOTO_CATEGORIES: { value: ClientPhotoCategory; label: string }[] = [
  { value: 'facade', label: 'Fachada' },
  { value: 'service_sheet', label: 'Hoja de servicio' },
  { value: 'nap_box', label: 'Caja NAP' },
  { value: 'modem_position', label: 'Posición del módem' },
  { value: 'pon_power', label: 'Potencia Óptica Recibida' },
];
const TICKET_PHOTO_CATEGORIES = [
  { value: 'evidencia_1', label: 'Evidencia 1' },
  { value: 'evidencia_2', label: 'Evidencia 2' },
];

const closureForm = ref({
  latitude: null as number | null,
  longitude: null as number | null,
  closureNotes: '',
  motivoAveria: '' as TicketMotivoAveria | '',
  // Fase 103 — texto libre cuando motivoAveria = 'other'.
  motivoAveriaDetalle: '',
  justificacion: '',
  // Fase 95 — opcionales, solo si la averia exigio recablear/revisar fibra.
  potenciaDbm: null as number | null,
  napElementoId: '',
});
// Causa preliminar (Fase 103): si admin/soporte dejo una sospecha al crear
// el ticket, se pre-carga aca apenas se conoce el ticket — el tecnico la ve
// ya seleccionada pero puede cambiarla libremente antes de cerrar.
watch(
  () => trabajo.value?.raw,
  (raw) => {
    if (jobType !== 'ticket' || !raw || closureForm.value.motivoAveria) return;
    const preliminar = (raw as Ticket).motivo_preliminar;
    if (preliminar) closureForm.value.motivoAveria = preliminar;
  },
  { immediate: true },
);
const requiresJustification = computed(
  () => jobType === 'ticket' && MOTIVOS_EXIMEN_TECNICO.includes(closureForm.value.motivoAveria as TicketMotivoAveria),
);
const justificacionMissing = ref(false);
const closurePhotos = ref<Record<string, File | undefined>>({});
const signatureBlob = ref<Blob | null>(null);
const signaturePadRef = ref<InstanceType<typeof SignaturePad> | null>(null);
const signatureMissing = ref(false);
const gettingLocation = ref(false);
const closing = ref(false);
const closeError = ref<string | null>(null);
const closeResult = ref<'ok' | 'queued' | null>(null);

function useCurrentLocation() {
  if (!navigator.geolocation) {
    closeError.value = 'Este navegador no soporta geolocalización';
    return;
  }
  gettingLocation.value = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      closureForm.value.latitude = pos.coords.latitude;
      closureForm.value.longitude = pos.coords.longitude;
      gettingLocation.value = false;
    },
    (err) => {
      closeError.value = `No se pudo obtener la ubicación: ${err.message}`;
      gettingLocation.value = false;
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

// Vista previa local (object URL) de una foto recien capturada, con boton
// "Repetir foto" para descartarla y volver a tomarla antes de enviarla —
// antes solo se veia un check de texto, sin forma de confirmar visualmente
// ni de corregir una foto borrosa/equivocada sin cerrar y reabrir la app.
const photoPreviewUrls = ref<Record<string, string>>({});

function onPhotoChange(category: string, event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  closurePhotos.value[category] = file;
  if (photoPreviewUrls.value[category]) URL.revokeObjectURL(photoPreviewUrls.value[category]);
  photoPreviewUrls.value[category] = URL.createObjectURL(file);
}

function clearPhoto(category: string) {
  delete closurePhotos.value[category];
  if (photoPreviewUrls.value[category]) {
    URL.revokeObjectURL(photoPreviewUrls.value[category]);
    delete photoPreviewUrls.value[category];
  }
}

onBeforeUnmount(() => {
  for (const url of Object.values(photoPreviewUrls.value)) URL.revokeObjectURL(url);
  for (const entry of equipmentEntries.value) if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  document.removeEventListener('visibilitychange', handleVisibilityOrHide);
  window.removeEventListener('pagehide', handleVisibilityOrHide);
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
});

// ---- Borrador local del cierre de trabajo (Fase 116) ----
// Censo fotografico + Cierre de trabajo + Equipos/firma comparten esta misma
// pantalla y los mismos refs (closureForm/closurePhotos/equipmentEntries/
// signatureBlob) — un solo borrador por job alcanza para las tres "partes"
// del formulario. Se guarda en IndexedDB (ver lib/formDrafts.ts) en cada
// cambio (debounced) y de forma inmediata al perder visibilidad, y se borra
// solo cuando el cierre de verdad llega a Supabase (no si quedo en la cola
// offline — ahi sigue siendo el unico respaldo de esos datos hasta que
// sincronice, ver campoStore.submitClosure).
interface ClosureDraft {
  closureForm: typeof closureForm.value;
  closurePhotos: Record<string, File>;
  equipmentEntries: { id: string; type: EquipmentPhotoType; file: File }[];
  signatureBlob: Blob | null;
}
let restoringDraft = false;
let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;

function buildDraftSnapshot(): ClosureDraft {
  const photos: Record<string, File> = {};
  for (const [cat, file] of Object.entries(closurePhotos.value)) {
    if (file) photos[cat] = file;
  }
  return {
    closureForm: { ...closureForm.value },
    closurePhotos: photos,
    equipmentEntries: equipmentEntries.value
      .filter((e): e is EquipmentPhotoEntry & { file: File } => !!e.file)
      .map((e) => ({ id: e.id, type: e.type, file: e.file })),
    signatureBlob: signatureBlob.value,
  };
}

function draftHasContent(draft: ClosureDraft): boolean {
  const f = draft.closureForm;
  return (
    !!f.closureNotes ||
    !!f.motivoAveria ||
    !!f.motivoAveriaDetalle ||
    !!f.justificacion ||
    f.potenciaDbm != null ||
    !!f.napElementoId ||
    Object.keys(draft.closurePhotos).length > 0 ||
    draft.equipmentEntries.length > 0 ||
    !!draft.signatureBlob
  );
}

async function persistDraft() {
  if (restoringDraft || isLockedForTecnico.value || ticketFrozen.value) return;
  const snapshot = buildDraftSnapshot();
  if (!draftHasContent(snapshot)) {
    await clearDraft(draftKey);
    return;
  }
  await saveDraft(draftKey, snapshot);
}

function scheduleDraftSave() {
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    persistDraft();
  }, 600);
}

// Guardado inmediato (sin esperar el debounce) ante visibilitychange/
// pagehide — el momento exacto en que Android puede matar el proceso sin
// avisar, a diferencia de un simple cambio de input que si puede esperar.
// Se dispara en ambos sentidos (tambien al volver a 1er plano) a proposito:
// es una escritura idempotente y barata, mejor de mas que arriesgar perder
// el guardado por una lectura de visibilityState que no calzo justo a tiempo.
function handleVisibilityOrHide() {
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  persistDraft();
}

watch([closureForm, closurePhotos, equipmentEntries, signatureBlob], scheduleDraftSave, { deep: true });

async function restoreDraft() {
  if (isLockedForTecnico.value || ticketFrozen.value) return;
  const draft = await loadDraft<ClosureDraft>(draftKey);
  if (!draft) return;
  restoringDraft = true;
  try {
    // Merge selectivo (no Object.assign liso): closureForm ya puede traer un
    // motivo_preliminar precargado por el watcher de arriba cuando se abrio
    // el ticket (Fase 103) — si el borrador nunca llego a tocar ese campo
    // (sigue en su default ''/null), no lo queremos pisar con vacio.
    for (const [key, value] of Object.entries(draft.closureForm) as [keyof typeof closureForm.value, unknown][]) {
      if (value !== null && value !== '') (closureForm.value as Record<string, unknown>)[key] = value;
    }
    for (const [cat, file] of Object.entries(draft.closurePhotos)) {
      closurePhotos.value[cat] = file;
      if (photoPreviewUrls.value[cat]) URL.revokeObjectURL(photoPreviewUrls.value[cat]);
      photoPreviewUrls.value[cat] = URL.createObjectURL(file);
    }
    equipmentEntries.value = draft.equipmentEntries.map((eq) => ({ ...eq, previewUrl: URL.createObjectURL(eq.file) }));
    if (draft.signatureBlob) {
      signatureBlob.value = draft.signatureBlob;
      await nextTick();
      await signaturePadRef.value?.loadImage(draft.signatureBlob);
    }
    toast.info('Se recuperó un borrador guardado de este cierre de trabajo.');
  } finally {
    restoringDraft = false;
  }
}

// ---- Lightbox (Fase 105): visor a pantalla completa para cualquier galeria
// de solo lectura de esta pantalla (fotos anteriores, censo, equipos). ----
const lightboxPhotos = ref<LightboxPhoto[]>([]);
const lightboxIndex = ref(0);

function openLightbox(photos: LightboxPhoto[], startId: string) {
  lightboxPhotos.value = photos;
  lightboxIndex.value = Math.max(0, photos.findIndex((p) => p.id === startId));
}

async function handleCloseSubmit() {
  if (!trabajo.value) return;
  // Prueba de servicio entregado: en una instalacion NUEVA la firma del
  // cliente es obligatoria (sin ella no queda constancia de que acepto el
  // trabajo). En una averia/soporte sigue siendo opcional — a veces se
  // resuelve remoto o el cliente no esta presente.
  if (jobType === 'installation' && !signatureBlob.value) {
    closeError.value = 'Falta la firma del cliente para completar la instalación.';
    signatureMissing.value = true;
    signaturePadRef.value?.scrollIntoView();
    return;
  }
  signatureMissing.value = false;

  // Averia: el motivo de cierre es obligatorio para poder liquidarla (alimenta
  // el ranking de puntos, Fase 49) — no aplica a instalaciones ni a rutinas.
  // Si el motivo exime al tecnico, ademas exige justificacion y al menos una
  // foto de evidencia como respaldo.
  if (jobType === 'ticket') {
    if (!closureForm.value.motivoAveria) {
      closeError.value = 'Selecciona la causa técnica encontrada en campo para poder cerrar la avería.';
      return;
    }
    if (closureForm.value.motivoAveria === 'other' && !closureForm.value.motivoAveriaDetalle.trim()) {
      closeError.value = 'Describe la causa encontrada (seleccionaste "Otra causa").';
      return;
    }
    if (requiresJustification.value) {
      if (!closureForm.value.justificacion.trim()) {
        closeError.value = 'Falta la justificación del motivo seleccionado.';
        justificacionMissing.value = true;
        return;
      }
      if (!TICKET_PHOTO_CATEGORIES.some((c) => closurePhotos.value[c.value])) {
        closeError.value = 'Agrega al menos una foto de evidencia para respaldar el motivo seleccionado.';
        return;
      }
    }
  }
  justificacionMissing.value = false;

  closing.value = true;
  closeError.value = null;
  closeResult.value = null;
  try {
    const censoYActa = jobType === 'ticket' ? CENSO_CATEGORIES.map((c) => c.value) : [];
    const categories =
      jobType === 'installation'
        ? INSTALL_PHOTO_CATEGORIES.map((c) => c.value)
        : jobType === 'ticket'
          ? [...TICKET_PHOTO_CATEGORIES.map((c) => c.value), ...censoYActa]
          : TICKET_PHOTO_CATEGORIES.map((c) => c.value);
    const photos = categories
      .filter((cat) => closurePhotos.value[cat])
      .map((cat) => ({ category: cat, file: closurePhotos.value[cat]! }));
    const equipmentPhotos = equipmentEntries.value
      .filter((e): e is EquipmentPhotoEntry & { file: File } => !!e.file)
      .map((e) => ({ equipmentType: e.type, file: e.file }));

    const result = await campoStore.submitClosure({
      jobType,
      jobId,
      clientId: trabajo.value.clientId,
      contractId: trabajo.value.contractId,
      targetStatus: jobType === 'ticket' ? 'resolved' : 'completed',
      latitude: closureForm.value.latitude,
      longitude: closureForm.value.longitude,
      ontSerial: null,
      closureNotes: closureForm.value.closureNotes || null,
      photos,
      equipmentPhotos,
      signatureBlob: signatureBlob.value,
      updateClientGps: jobType === 'installation',
      clientPhotoCategories: jobType === 'installation' ? (INSTALL_PHOTO_CATEGORIES.map((c) => c.value) as ClientPhotoCategory[]) : [],
      pendingApprovalCategories: censoYActa,
      motivoAveria: jobType === 'ticket' ? closureForm.value.motivoAveria || null : null,
      motivoAveriaDetalle:
        jobType === 'ticket' && closureForm.value.motivoAveria === 'other' ? closureForm.value.motivoAveriaDetalle.trim() || null : null,
      justificacionCierre: jobType === 'ticket' ? closureForm.value.justificacion.trim() || null : null,
      potenciaDbm: jobType === 'ticket' ? closureForm.value.potenciaDbm : null,
      napElementoId: jobType === 'ticket' ? closureForm.value.napElementoId || null : null,
    });
    closeResult.value = result.queued ? 'queued' : 'ok';
    // El borrador solo se borra cuando el cierre de verdad llego a Supabase —
    // si quedo en la cola offline sigue siendo el unico respaldo de fotos/
    // firma/notas hasta que haya señal y sincronice (Fase 116).
    if (!result.queued) {
      await clearDraft(draftKey);
      setTimeout(() => router.push('/campo'), 1200);
    }
  } catch (e) {
    closeError.value = getErrorMessage(e, 'Error al cerrar el trabajo');
  } finally {
    closing.value = false;
  }
}
</script>

<template>
  <CampoLayout :title="trabajo?.clienteNombre ?? 'Trabajo'" show-back>
    <template v-if="!trabajo">
      <p class="text-center text-sm text-slate-500 py-8">Cargando trabajo...</p>
    </template>

    <template v-else>
      <!-- Cliente -->
      <section class="surface p-3.5 mb-3">
        <span
          class="badge text-[10px] mb-2"
          :class="{
            'bg-sky-500/15 text-sky-700': jobType === 'installation',
            'bg-orange-500/15 text-orange-700': jobType === 'ticket',
            'bg-amber-500/15 text-amber-700': jobType === 'routine',
          }"
        >
          {{ jobType === 'installation' ? 'Instalación' : jobType === 'routine' ? 'Rutina' : 'Avería' }}
        </span>
        <p class="font-semibold">{{ trabajo.clienteNombre }}</p>
        <p v-if="trabajo.direccion" class="text-xs text-slate-500 mt-0.5">{{ trabajo.direccion }}</p>
        <p v-if="trabajoDescripcion" class="text-xs text-slate-600 mt-2">{{ trabajoDescripcion }}</p>

        <div class="grid grid-cols-2 gap-2 mt-3">
          <a v-if="trabajo.telefono" :href="telLink(trabajo.telefono)" class="btn-secondary text-xs">📞 Llamar</a>
          <a v-if="trabajo.telefono" :href="waLink(trabajo.telefono)" target="_blank" rel="noopener" class="btn-secondary text-xs">💬 WhatsApp</a>
          <a v-if="gps" :href="mapsLink(gps.lat, gps.lng)" target="_blank" rel="noopener" class="btn-secondary text-xs">🗺️ Maps</a>
          <a v-if="gps" :href="wazeLink(gps.lat, gps.lng)" target="_blank" rel="noopener" class="btn-secondary text-xs">🚗 Waze</a>
        </div>

        <!-- Ficha de datos (solo lectura) -->
        <p v-if="loadingClientInfo" class="text-xs text-slate-400 mt-3">Cargando ficha del cliente...</p>
        <dl v-else-if="clientDetail" class="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs mt-3 pt-3 border-t border-slate-100">
          <dt class="text-slate-400">Documento</dt>
          <dd class="text-slate-700 text-right font-mono">{{ DOCUMENT_LABEL[clientDetail.document_type] }} {{ clientDetail.document_number }}</dd>

          <dt class="text-slate-400">Teléfonos</dt>
          <dd class="text-slate-700 text-right">{{ [clientDetail.phone, clientDetail.phone_2].filter(Boolean).join(' / ') || '—' }}</dd>

          <dt v-if="clientDetail.email" class="text-slate-400">Email</dt>
          <dd v-if="clientDetail.email" class="text-slate-700 text-right truncate">{{ clientDetail.email }}</dd>

          <dt class="text-slate-400">Zona</dt>
          <dd class="text-slate-700 text-right">{{ activeContract?.zones?.name ?? '—' }}</dd>

          <dt class="text-slate-400">GPS registrado</dt>
          <dd class="text-right font-mono">
            <a v-if="gps" :href="mapsLink(gps.lat, gps.lng)" target="_blank" rel="noopener" class="text-sky-600 hover:underline">
              {{ gps.lat.toFixed(6) }}, {{ gps.lng.toFixed(6) }}
            </a>
            <span v-else class="text-slate-700">Sin registrar</span>
          </dd>

          <template v-if="activeContract">
            <dt class="text-slate-400">Contrato</dt>
            <dd class="text-slate-700 text-right font-mono">{{ activeContract.contract_number ?? '—' }}</dd>

            <dt class="text-slate-400">Plan</dt>
            <dd class="text-slate-700 text-right">
              {{ activeContract.plans?.name ?? '—' }}
              <span v-if="activeContract.plans" class="text-slate-400">({{ activeContract.plans.download_speed }}/{{ activeContract.plans.upload_speed }} Mbps)</span>
            </dd>

            <dt class="text-slate-400">Usuario PPPoE</dt>
            <dd class="text-slate-700 text-right font-mono">{{ activeContract.pppoe_username ?? '—' }}</dd>

            <dt v-if="activeContract.mikrotik_profile" class="text-slate-400">Perfil MikroTik</dt>
            <dd v-if="activeContract.mikrotik_profile" class="text-slate-700 text-right">{{ activeContract.mikrotik_profile }}</dd>

            <dt v-if="activeContract.xui_username" class="text-slate-400">Usuario IPTV</dt>
            <dd v-if="activeContract.xui_username" class="text-slate-700 text-right font-mono">{{ activeContract.xui_username }}</dd>
          </template>
        </dl>
        <p v-else class="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-100">Sin ficha adicional disponible.</p>
      </section>

      <!-- Tecnico asignado / auto-asignacion de una orden libre (Fase 98/118) -->
      <section v-if="jobType === 'ticket' || jobType === 'installation' || jobType === 'routine'" class="surface p-3.5 mb-3">
        <h2 class="text-sm font-semibold mb-2">Técnico asignado</h2>
        <p v-if="loadingAssignees" class="text-xs text-slate-400">Cargando...</p>
        <template v-else>
          <div v-if="assignees.length" class="flex flex-wrap gap-2">
            <span
              v-for="a in assignees"
              :key="a.technician_id"
              class="badge text-[11px]"
              :class="a.role === 'leader' ? 'bg-sky-500/15 text-sky-700' : 'bg-slate-500/15 text-slate-600'"
            >
              {{ a.profile?.full_name || a.profile?.email || 'Técnico' }} {{ a.role === 'leader' ? '(líder)' : '(apoyo)' }}
            </span>
          </div>
          <button
            v-else-if="auth.role === 'TECNICO_RED'"
            type="button"
            class="btn-primary w-full text-sm"
            :disabled="selfAssigning"
            @click="handleTakeTicket"
          >
            {{ selfAssigning ? 'Asignando...' : `🙋‍♂️ ${TOMAR_LABEL[jobType]}` }}
          </button>
          <p v-else class="text-xs text-slate-400">Sin técnicos asignados.</p>
          <p v-if="selfAssignError" class="text-xs text-red-600 mt-2">{{ selfAssignError }}</p>

          <div v-if="canMarkAusente" class="mt-3 pt-3 border-t border-slate-100">
            <button v-if="!showAusenteForm" type="button" class="btn-secondary w-full text-xs !bg-amber-500/15 !text-amber-700 !border-amber-300" @click="toggleAusenteForm">
              🏠 Cliente Ausente
            </button>
            <div v-else class="space-y-2">
              <label class="block text-xs text-slate-600 mb-1">Fecha de reprogramación</label>
              <input v-model="ausenteDate" type="datetime-local" class="field-input text-sm" />
              <label class="block text-xs text-slate-600 mb-1">Motivo (opcional)</label>
              <textarea v-model="ausenteReason" rows="2" placeholder="Ej. no contesta, casa cerrada..." class="field-input text-sm"></textarea>
              <div class="flex gap-2">
                <button type="button" class="btn-secondary text-xs flex-1" :disabled="savingAusente" @click="toggleAusenteForm">
                  Cancelar
                </button>
                <button type="button" class="btn-primary text-xs flex-1 !bg-amber-500" :disabled="savingAusente" @click="handleMarkAusente">
                  {{ savingAusente ? 'Guardando...' : 'Confirmar reprogramación' }}
                </button>
              </div>
              <p v-if="ausenteError" class="text-xs text-red-600">{{ ausenteError }}</p>
            </div>
          </div>

          <div v-if="jobType === 'ticket' && isMyAssignment && !ticketFrozen" class="mt-3 pt-3 border-t border-slate-100">
            <button v-if="!showReturnForm" type="button" class="btn-danger text-xs" @click="toggleReturnForm">
              ↩️ Devolver orden (no puedo continuar)
            </button>
            <div v-else class="space-y-2">
              <textarea
                v-model="returnReason"
                rows="2"
                placeholder="Motivo de la devolución (ej. cliente salió, no contesta...)"
                class="field-input text-sm"
              ></textarea>
              <div class="flex gap-2">
                <button type="button" class="btn-secondary text-xs flex-1" :disabled="returning" @click="toggleReturnForm">
                  Cancelar
                </button>
                <button type="button" class="btn-destructive text-xs flex-1" :disabled="returning" @click="handleReturnTicket">
                  {{ returning ? 'Devolviendo...' : 'Confirmar devolución' }}
                </button>
              </div>
              <p v-if="returnError" class="text-xs text-red-600">{{ returnError }}</p>
            </div>
          </div>
        </template>
      </section>

      <!-- Orden libre (Fase 98/118): el formulario de materiales/equipos/cierre
           queda bloqueado hasta que el tecnico la tome (boton de arriba). -->
      <section v-if="isUnassignedTicket" class="surface p-3.5 mb-3 bg-amber-50 border border-amber-200">
        <p class="text-xs text-amber-700">{{ TOMAR_LABEL[jobType] }} para habilitar materiales, equipos y cierre de trabajo.</p>
      </section>

      <!-- Fotos ya registradas del cliente (instalaciones: solo lectura) -->
      <section v-if="jobType === 'installation' && (loadingPhotos || existingPhotos.length)" class="surface p-3.5 mb-3">
        <h2 class="text-sm font-semibold mb-2">Fotos anteriores</h2>
        <p v-if="loadingPhotos" class="text-xs text-slate-400">Cargando fotos...</p>
        <p v-else-if="!existingPhotos.length" class="text-xs text-slate-400">Sin fotos registradas todavía.</p>
        <div v-else class="grid grid-cols-2 gap-2">
          <button
            v-for="p in existingPhotos"
            :key="p.id"
            type="button"
            class="block text-left"
            @click="
              openLightbox(
                existingPhotos.map((ep) => ({ id: ep.id, url: ep.url ?? '', label: PHOTO_LABEL[ep.category] })),
                p.id,
              )
            "
          >
            <img :src="p.url ?? undefined" :alt="PHOTO_LABEL[p.category]" class="w-full h-28 object-cover rounded-lg border border-slate-200" />
            <p class="text-[11px] text-slate-500 mt-1 text-center">{{ PHOTO_LABEL[p.category] }}</p>
          </button>
        </div>
      </section>

      <!-- Censo fotografico (averias): "Actualizar" si ya existe, "Pendiente
           de registro" si es un cliente antiguo sin censar. Las fotos nuevas
           quedan pendientes de aprobacion del admin (Fase 95). -->
      <section v-if="jobType === 'ticket' && !isLockedForTecnico && !isUnassignedTicket && !ticketFrozen" class="surface p-3.5 mb-3">
        <h2 class="text-sm font-semibold mb-1">📋 Censo fotográfico</h2>
        <p class="text-[11px] text-slate-500 mb-3">
          Aprovecha la visita para completar la ficha del cliente. Las fotos nuevas quedan pendientes de aprobación del administrador.
        </p>
        <p v-if="loadingPhotos" class="text-xs text-slate-400">Cargando...</p>
        <div v-else class="space-y-2.5">
          <div v-for="cat in CENSO_CATEGORIES" :key="cat.value" class="flex items-center gap-2.5">
            <div class="relative w-12 h-12 shrink-0">
              <img
                v-if="photoPreviewUrls[cat.value]"
                :src="photoPreviewUrls[cat.value]"
                class="w-12 h-12 object-cover rounded-lg border border-sky-300 cursor-pointer"
                @click="openLightbox([{ id: cat.value, url: photoPreviewUrls[cat.value], label: cat.label }], cat.value)"
              />
              <img
                v-else-if="existingPhotoByCategory.get(cat.value)?.url"
                :src="existingPhotoByCategory.get(cat.value)!.url ?? undefined"
                class="w-12 h-12 object-cover rounded-lg border border-slate-200 cursor-pointer"
                @click="openLightbox([{ id: cat.value, url: existingPhotoByCategory.get(cat.value)!.url ?? '', label: cat.label }], cat.value)"
              />
              <div
                v-else
                class="w-12 h-12 rounded-lg border border-dashed border-amber-300 bg-amber-50 flex items-center justify-center text-base"
              >
                ⚠️
              </div>
              <button
                v-if="photoPreviewUrls[cat.value]"
                type="button"
                class="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-white border border-slate-300 flex items-center justify-center text-sm shadow-sm"
                title="Repetir foto"
                @click="clearPhoto(cat.value)"
              >
                🔄
              </button>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium text-slate-700 truncate">{{ cat.icon }} {{ cat.label }}</p>
              <p v-if="!existingPhotoByCategory.get(cat.value)" class="text-[11px] text-amber-600">Pendiente de registro</p>
              <p v-else class="text-[11px] text-slate-400">Ya registrada</p>
            </div>
            <label class="shrink-0 text-center px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] cursor-pointer whitespace-nowrap">
              {{ closurePhotos[cat.value] ? '✓ Lista' : existingPhotoByCategory.get(cat.value) ? '📷 Actualizar' : '📷 Capturar' }}
              <input type="file" accept="image/*" capture="environment" class="hidden" @change="onPhotoChange(cat.value, $event)" />
            </label>
          </div>
        </div>
      </section>

      <!-- Fotos de serie de equipos (Fase 105): galeria dinamica, no un
           slot unico — ticket e installation, solo si hay contrato. -->
      <section
        v-if="(jobType === 'ticket' || jobType === 'installation') && !isLockedForTecnico && !isUnassignedTicket && !ticketFrozen && trabajo.contractId"
        class="surface p-3.5 mb-3"
      >
        <h2 class="text-sm font-semibold mb-1">📦 Fotos de serie de equipos</h2>
        <p class="text-[11px] text-slate-500 mb-3">
          Una foto por cada equipo del cliente (módem, TV Box, mesh...).
          {{ jobType === 'ticket' ? 'Quedan pendientes de aprobación del administrador.' : '' }}
        </p>

        <p v-if="loadingEquipmentPhotos" class="text-xs text-slate-400 mb-2">Cargando...</p>
        <div v-else-if="approvedEquipmentPhotos.length" class="grid grid-cols-3 gap-2 mb-3">
          <button
            v-for="p in approvedEquipmentPhotos"
            :key="p.id"
            type="button"
            @click="
              openLightbox(
                approvedEquipmentPhotos.map((ep) => ({ id: ep.id, url: ep.url ?? '', label: EQUIPMENT_TYPE_LABEL[ep.equipment_type] })),
                p.id,
              )
            "
          >
            <img :src="p.url ?? undefined" class="w-full h-16 object-cover rounded-lg border border-slate-200" />
            <p class="text-[10px] text-slate-500 mt-0.5 truncate">{{ EQUIPMENT_TYPE_LABEL[p.equipment_type] }}</p>
          </button>
        </div>

        <div v-for="entry in equipmentEntries" :key="entry.id" class="flex items-center gap-2.5 mb-2">
          <div class="relative w-12 h-12 shrink-0">
            <img
              v-if="entry.previewUrl"
              :src="entry.previewUrl"
              class="w-12 h-12 object-cover rounded-lg border border-sky-300 cursor-pointer"
              @click="openLightbox([{ id: entry.id, url: entry.previewUrl, label: EQUIPMENT_TYPE_LABEL[entry.type] }], entry.id)"
            />
            <div v-else class="w-12 h-12 rounded-lg border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center text-base">
              🏷️
            </div>
          </div>
          <select v-model="entry.type" class="field-input text-sm flex-1 py-1.5">
            <option v-for="opt in EQUIPMENT_TYPE_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
          <label class="shrink-0 text-center px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] cursor-pointer whitespace-nowrap">
            {{ entry.file ? '✓ Lista' : '📷 Capturar' }}
            <input type="file" accept="image/*" capture="environment" class="hidden" @change="onEquipmentFileChange(entry.id, $event)" />
          </label>
          <button
            type="button"
            class="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-red-500/10 text-base"
            title="Quitar"
            @click="removeEquipmentEntry(entry.id)"
          >
            🗑️
          </button>
        </div>

        <button type="button" class="btn-secondary text-xs w-full" @click="addEquipmentEntry">
          + Agregar foto de serie de otro equipo
        </button>
      </section>

      <!-- Diagnostico express (no aplica a una rutina sin cliente puntual) -->
      <section v-if="trabajo.clientId" class="surface p-3.5 mb-3">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-sm font-semibold">Diagnóstico express</h2>
          <button class="btn-primary text-xs py-1.5" :disabled="diagLoading" @click="runDiagnostico">
            {{ diagLoading ? 'Consultando...' : 'Ejecutar' }}
          </button>
        </div>
        <p v-if="diagError" class="text-xs text-red-600 mb-2">{{ diagError }}</p>
        <div v-if="diagnostico" class="space-y-2 text-xs">
          <div class="flex justify-between items-center py-1.5 border-t border-slate-100">
            <span class="text-slate-500">Señal óptica (OLT)</span>
            <span v-if="diagnostico.ont.found" :class="signalClass(diagnostico.ont.rxPower)" class="font-mono font-semibold">
              Rx {{ diagnostico.ont.rxPower ?? '—' }} dBm / Tx {{ diagnostico.ont.txPower ?? '—' }} dBm
            </span>
            <span v-else class="text-slate-400">{{ diagnostico.ont.error || 'Sin ONT registrada' }}</span>
          </div>
          <div class="flex justify-between items-center py-1.5 border-t border-slate-100">
            <span class="text-slate-500">Sesión PPPoE (MikroTik)</span>
            <span v-if="diagnostico.pppoe.found" class="font-mono font-semibold text-green-600">{{ diagnostico.pppoe.address }}</span>
            <span v-else class="text-slate-400">{{ diagnostico.pppoe.error || 'Sin sesión activa' }}</span>
          </div>
          <div class="flex justify-between items-center py-1.5 border-t border-slate-100">
            <span class="text-slate-500">CPE / TR-069</span>
            <span v-if="diagnostico.cpe.found" :class="signalClass(diagnostico.cpe.rxPower)" class="font-mono font-semibold">
              Rx {{ diagnostico.cpe.rxPower ?? '—' }} dBm · {{ diagnostico.cpe.temperature ?? '—' }}°C
            </span>
            <span v-else class="text-slate-400">{{ diagnostico.cpe.error || 'Sin dato' }}</span>
          </div>
        </div>
      </section>

      <!-- Provisionamiento OLT (solo instalaciones, solo admin/super) -->
      <section v-if="jobType === 'installation' && canProvisionOnt" class="surface p-3.5 mb-3">
        <h2 class="text-sm font-semibold mb-2">Provisionar en OLT</h2>
        <form class="space-y-2.5" @submit.prevent="handleProvision">
          <select v-model="provisionForm.oltDeviceId" required class="field-input text-sm">
            <option value="" disabled>Selecciona la OLT...</option>
            <option v-for="d in oltStore.devices" :key="d.id" :value="d.id">{{ d.name }}</option>
          </select>

          <div class="grid grid-cols-3 gap-2">
            <input v-model.number="provisionForm.shelf" type="number" min="1" placeholder="Shelf" class="field-input text-sm" />
            <input v-model.number="provisionForm.slot" type="number" min="1" required placeholder="Slot" class="field-input text-sm" />
            <input v-model.number="provisionForm.port" type="number" min="1" required placeholder="Puerto" class="field-input text-sm" />
          </div>

          <div class="flex gap-2">
            <input v-model="provisionForm.serial" required placeholder="Serial de la ONT" class="field-input text-sm font-mono flex-1" />
            <button type="button" class="btn-secondary text-xs shrink-0" @click="openQr()">📷 QR</button>
          </div>

          <input v-model="provisionForm.onuType" required placeholder="Tipo de ONU (ej. ZTE-F660)" class="field-input text-sm" />
          <input v-model.number="provisionForm.vlan" type="number" placeholder="VLAN" class="field-input text-sm" />
          <input v-model="provisionForm.description" placeholder="Descripción (nombre del cliente)" class="field-input text-sm" />

          <select v-model="provisionForm.tcontProfile" required class="field-input text-sm" :disabled="profilesLoading">
            <option value="" disabled>{{ profilesLoading ? 'Cargando perfiles...' : 'Perfil de subida (tcont)' }}</option>
            <option v-for="p in profiles.tcontProfiles" :key="p" :value="p">{{ p }}</option>
          </select>
          <select v-model="provisionForm.trafficProfile" required class="field-input text-sm" :disabled="profilesLoading">
            <option value="" disabled>{{ profilesLoading ? 'Cargando perfiles...' : 'Perfil de bajada (traffic)' }}</option>
            <option v-for="p in profiles.trafficProfiles" :key="p" :value="p">{{ p }}</option>
          </select>

          <p v-if="provisionError" class="text-xs text-red-600">{{ provisionError }}</p>
          <p v-if="provisionResult" class="text-xs text-green-600">
            Registrada. Señal inicial: Rx {{ provisionResult.rxPower ?? '—' }} dBm
          </p>

          <button type="submit" :disabled="provisioning || !provisionForm.oltDeviceId" class="btn-primary w-full text-sm">
            {{ provisioning ? 'Registrando en la OLT...' : 'Registrar ONT' }}
          </button>
        </form>
      </section>

      <!-- Materiales -->
      <section v-if="isLockedForTecnico" class="surface p-3.5 mb-3 bg-slate-50">
        <h2 class="text-sm font-semibold mb-1">✅ {{ jobType === 'routine' ? 'Rutina completada' : 'Instalación completada' }}</h2>
        <p class="text-xs text-slate-500">
          {{
            jobType === 'routine'
              ? 'Esta rutina ya fue completada — materiales, fotos y cierre quedan cerrados para técnicos. Si falta corregir algo, pide a administración/soporte que la reabra desde el panel.'
              : 'Esta instalación ya fue completada — materiales, fotos, GPS y firma quedan cerrados para técnicos. Si falta corregir algo, pide a un administrador que la regrese a "Programada" para poder editarla de nuevo.'
          }}
        </p>
      </section>

      <section v-else-if="ticketFrozen" class="surface p-3.5 mb-3 bg-slate-50">
        <h2 class="text-sm font-semibold mb-1">🔒 Avería resuelta</h2>
        <p class="text-xs text-slate-500">
          Esta avería ya fue marcada como resuelta — materiales, equipos, fotos y cierre quedan cerrados para
          técnicos. Si falta corregir algo, pide a administración/soporte que lo ajuste desde el panel.
        </p>
      </section>

      <template v-else-if="!isUnassignedTicket">
        <!-- Rutinas V1 no registra materiales/equipos (Fase 101) — alcance
             recortado a proposito, ver migracion. -->
        <section v-if="jobType !== 'routine'" class="surface p-3.5 mb-3">
          <h2 class="text-sm font-semibold mb-2">Materiales usados</h2>
          <ul v-if="activeMaterials.length" class="space-y-2 mb-3 text-xs">
            <li v-for="m in activeMaterials" :key="m.id" class="flex items-center justify-between gap-2 py-0.5">
              <span class="flex-1 min-w-0 truncate">{{ m.product?.name ?? 'Producto' }}</span>
              <template v-if="editingMaterialId === m.id">
                <input v-model.number="editMaterialQty" type="number" min="1" class="field-input text-sm w-16 py-1.5 shrink-0" />
                <button
                  type="button"
                  class="shrink-0 px-3 py-2 rounded-lg bg-sky-500/15 text-sky-700 text-xs font-medium"
                  @click="handleSaveMaterialQty(m)"
                >
                  Guardar
                </button>
                <button
                  type="button"
                  class="shrink-0 px-3 py-2 rounded-lg bg-slate-100 text-slate-500 text-xs font-medium"
                  @click="editingMaterialId = null"
                >
                  Cancelar
                </button>
              </template>
              <template v-else>
                <span class="text-slate-600 shrink-0">{{ m.quantity }} {{ m.product?.unit }}</span>
                <button
                  type="button"
                  class="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-sky-500/10 text-base disabled:opacity-50"
                  :disabled="materialActionBusy === m.id"
                  title="Corregir cantidad"
                  @click="startEditMaterial(m)"
                >
                  ✏️
                </button>
                <button
                  type="button"
                  class="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-red-500/10 text-base disabled:opacity-50"
                  :disabled="materialActionBusy === m.id"
                  title="Quitar material"
                  @click="handleRemoveMaterial(m)"
                >
                  🗑️
                </button>
              </template>
            </li>
          </ul>
          <form class="flex gap-2" @submit.prevent="handleAddMaterial">
            <select v-model="materialForm.productId" required class="field-input text-sm flex-1">
              <option value="" disabled>Producto...</option>
              <option v-for="p in inventoryStore.products" :key="p.id" :value="p.id">{{ p.name }} ({{ p.current_stock }})</option>
            </select>
            <input v-model.number="materialForm.quantity" type="number" min="1" class="field-input text-sm w-16" />
            <button type="submit" :disabled="savingMaterial" class="btn-secondary text-xs shrink-0">+</button>
          </form>
          <p v-if="materialError" class="text-xs text-red-600 mt-1.5">{{ materialError }}</p>
        </section>

        <!-- Registro / Cambio de equipos (averias) -->
        <section v-if="jobType === 'ticket'" class="surface p-3.5 mb-3">
          <h2 class="text-sm font-semibold mb-2">🔧 Registro / Cambio de equipos</h2>
          <p v-if="loadingUnits" class="text-xs text-slate-400">Cargando...</p>
          <template v-else>
            <div class="mb-3">
              <p class="text-xs font-medium text-slate-600 mb-1.5">Equipo saliente (dar de baja / garantía)</p>
              <p v-if="!assignedUnits.length" class="text-[11px] text-slate-400">El cliente no tiene equipos asignados.</p>
              <form v-else class="space-y-1.5" @submit.prevent="handleOutgoingUnit">
                <select v-model="outgoingForm.unitId" class="field-input text-sm">
                  <option value="">Selecciona el equipo...</option>
                  <option v-for="u in assignedUnits" :key="u.id" :value="u.id">
                    {{ u.product?.name ?? 'Equipo' }} — {{ u.serial_number || u.mac_address }}
                  </option>
                </select>
                <div class="flex gap-2">
                  <select v-model="outgoingForm.condition" class="field-input text-sm flex-1">
                    <option value="in_stock">Volver a bodega (buen estado)</option>
                    <option value="in_repair">Enviar a garantía/reparación</option>
                    <option value="damaged">Dar de baja (dañado)</option>
                  </select>
                  <button type="submit" :disabled="savingOutgoing || !outgoingForm.unitId" class="btn-secondary text-xs shrink-0">
                    Retirar
                  </button>
                </div>
                <input v-model="outgoingForm.reason" placeholder="Motivo (opcional)" class="field-input text-sm" />
              </form>
              <p v-if="outgoingError" class="text-xs text-red-600 mt-1">{{ outgoingError }}</p>
            </div>

            <div class="pt-3 border-t border-slate-100">
              <p class="text-xs font-medium text-slate-600 mb-1.5">Equipo entrante (del stock asignado)</p>
              <form class="space-y-1.5" @submit.prevent="handleIncomingUnit">
                <select v-model="incomingForm.productId" class="field-input text-sm" @change="onIncomingProductChange">
                  <option value="">Producto...</option>
                  <option v-for="p in inventoryStore.products.filter((prod) => prod.is_serialized)" :key="p.id" :value="p.id">
                    {{ p.name }}
                  </option>
                </select>
                <select v-model="incomingForm.unitId" class="field-input text-sm" :disabled="!incomingForm.productId || loadingIncomingUnits">
                  <option value="">{{ loadingIncomingUnits ? 'Cargando...' : 'Serie/MAC disponible...' }}</option>
                  <option v-for="u in availableIncomingUnits" :key="u.id" :value="u.id">{{ u.serial_number || u.mac_address }}</option>
                </select>
                <p v-if="incomingForm.productId && !loadingIncomingUnits && !availableIncomingUnits.length" class="text-[11px] text-amber-700">
                  Sin unidades disponibles en bodega para este producto.
                </p>
                <input v-model="incomingForm.reason" placeholder="Motivo (opcional)" class="field-input text-sm" />
                <button type="submit" :disabled="savingIncoming || !incomingForm.unitId" class="btn-secondary text-xs w-full">
                  {{ savingIncoming ? 'Registrando...' : 'Registrar (pendiente de aprobación)' }}
                </button>
              </form>
              <p v-if="incomingError" class="text-xs text-red-600 mt-1">{{ incomingError }}</p>
            </div>

            <div v-if="pendingUnits.length" class="pt-3 mt-3 border-t border-slate-100">
              <p class="text-xs font-medium text-amber-700 mb-1.5">⏳ Pendientes de aprobación</p>
              <ul class="space-y-2 text-xs">
                <li v-for="u in pendingUnits" :key="u.id" class="flex items-center justify-between gap-2 py-0.5">
                  <div class="flex-1 min-w-0">
                    <p class="truncate">{{ u.product?.name ?? 'Equipo' }}</p>
                    <p class="text-slate-500 font-mono">{{ u.serial_number || u.mac_address }}</p>
                  </div>
                  <button
                    type="button"
                    class="shrink-0 px-3 py-2 rounded-lg bg-red-500/10 text-red-600 text-xs font-medium disabled:opacity-50"
                    :disabled="unlinkingUnitId === u.id"
                    title="Desvincular (serie/MAC equivocada)"
                    @click="handleUnlinkPendingUnit(u)"
                  >
                    ✕ Desvincular
                  </button>
                </li>
              </ul>
              <p v-if="unlinkError" class="text-xs text-red-600 mt-1.5">{{ unlinkError }}</p>
            </div>
          </template>
        </section>

        <!-- Cierre de trabajo -->
        <section class="surface p-3.5 mb-3">
          <h2 class="text-sm font-semibold mb-2">Cierre de trabajo</h2>

          <button type="button" :disabled="gettingLocation" class="text-xs text-sky-700 mb-2.5 block" @click="useCurrentLocation">
            {{ gettingLocation ? 'Obteniendo ubicación...' : `📍 ${closureForm.latitude ? 'Ubicación capturada' : 'Usar mi ubicación actual'}` }}
          </button>

          <div class="grid grid-cols-2 gap-2 mb-3">
            <div
              v-for="cat in jobType === 'installation' ? INSTALL_PHOTO_CATEGORIES : TICKET_PHOTO_CATEGORIES"
              :key="cat.value"
              class="relative"
            >
              <img
                v-if="photoPreviewUrls[cat.value]"
                :src="photoPreviewUrls[cat.value]"
                class="w-full h-20 object-cover rounded-lg border border-sky-300 mb-1"
              />
              <label
                class="block text-center px-2 py-2 rounded-lg text-[11px] cursor-pointer truncate"
                :class="closurePhotos[cat.value] ? 'bg-sky-500/15 text-sky-700' : 'bg-slate-100'"
              >
                {{ closurePhotos[cat.value] ? '✓ ' + cat.label : cat.label }}
                <input type="file" accept="image/*" capture="environment" class="hidden" @change="onPhotoChange(cat.value, $event)" />
              </label>
              <button
                v-if="photoPreviewUrls[cat.value]"
                type="button"
                class="absolute top-1 right-1 w-8 h-8 rounded-full bg-white/90 border border-slate-300 flex items-center justify-center text-sm shadow-sm"
                title="Repetir foto"
                @click="clearPhoto(cat.value)"
              >
                🔄
              </button>
            </div>
          </div>

          <textarea v-model="closureForm.closureNotes" rows="2" placeholder="Notas del cierre..." class="field-input text-sm mb-3"></textarea>

          <template v-if="jobType === 'ticket'">
            <p class="text-xs font-medium text-slate-600 mb-1">Parámetros de red (opcional, si recableaste)</p>
            <div class="grid grid-cols-2 gap-2 mb-3">
              <input
                v-model.number="closureForm.potenciaDbm"
                type="number"
                step="0.1"
                placeholder="Potencia (dBm)"
                class="field-input text-sm"
              />
              <select v-model="closureForm.napElementoId" class="field-input text-sm">
                <option value="">Caja NAP (sin cambio)</option>
                <option v-for="n in napOptions" :key="n.id" :value="n.id">
                  {{ n.name }} — {{ n.used }}/{{ n.capacity }}
                </option>
              </select>
            </div>
          </template>

          <template v-if="jobType === 'ticket'">
            <label class="block text-xs text-slate-600 mb-1">
              Causa técnica encontrada en campo<span class="text-red-500"> * <span class="text-slate-400 font-normal">(obligatorio)</span></span>
            </label>
            <select v-model="closureForm.motivoAveria" class="field-input text-sm mb-1.5">
              <option value="" disabled>Selecciona la causa...</option>
              <option v-for="m in MOTIVO_AVERIA_OPTIONS" :key="m.value" :value="m.value">{{ m.label }}</option>
            </select>
            <p v-if="(trabajo?.raw as Ticket)?.motivo_preliminar" class="text-[11px] text-slate-400 mb-1.5">
              Sospecha inicial de despacho: {{ MOTIVO_AVERIA_OPTIONS.find((m) => m.value === (trabajo?.raw as Ticket)?.motivo_preliminar)?.label }}
              — cámbiala si en campo encontraste algo distinto.
            </p>
            <input
              v-if="closureForm.motivoAveria === 'other'"
              v-model="closureForm.motivoAveriaDetalle"
              placeholder="Describe la causa encontrada..."
              class="field-input text-sm mb-3"
            />

            <template v-if="requiresJustification">
              <label class="block text-xs text-slate-600 mb-1">
                Justificación<span class="text-red-500"> * <span class="text-slate-400 font-normal">(obligatoria, no cuenta contra tus puntos)</span></span>
              </label>
              <textarea
                v-model="closureForm.justificacion"
                rows="2"
                placeholder="Explica qué pasó..."
                class="field-input text-sm mb-1"
                :class="justificacionMissing ? 'border-red-400' : ''"
              ></textarea>
              <p class="text-[11px] text-slate-500 mb-3">Agrega también una foto de evidencia arriba (Evidencia 1 o 2).</p>
            </template>
          </template>

          <label class="block text-xs text-slate-600 mb-1">
            Firma del cliente<span v-if="jobType === 'installation'" class="text-red-500"> * <span class="text-slate-400 font-normal">(obligatoria)</span></span>
          </label>
          <SignaturePad
            ref="signaturePadRef"
            :required="jobType === 'installation'"
            :invalid="signatureMissing"
            @change="(b) => { signatureBlob = b; if (b) signatureMissing = false; }"
          />

          <p v-if="closeError" class="text-sm text-red-600 mt-3">{{ closeError }}</p>
          <p v-if="closeResult === 'queued'" class="text-sm text-amber-600 mt-3">
            Sin señal: el cierre quedó guardado en el dispositivo y se sincronizará automáticamente.
          </p>
          <p v-if="closeResult === 'ok'" class="text-sm text-green-600 mt-3">Trabajo cerrado correctamente.</p>

          <button type="button" :disabled="closing" class="btn-primary w-full text-sm mt-3" @click="handleCloseSubmit">
            {{
              closing
                ? 'Guardando...'
                : jobType === 'installation'
                  ? 'Completar instalación'
                  : jobType === 'routine'
                    ? 'Completar rutina'
                    : 'Resolver avería'
            }}
          </button>
        </section>
      </template>
    </template>

    <QrScannerModal :open="qrOpen" @close="qrOpen = false" @scan="onQrScan" />
    <PhotoLightbox v-if="lightboxPhotos.length" :photos="lightboxPhotos" :start-index="lightboxIndex" @close="lightboxPhotos = []" />
  </CampoLayout>
</template>
