<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import CrewAssignEditor from '@/components/soporte/CrewAssignEditor.vue';
import { useInstallationsStore } from '@/stores/installations';
import { useClientsStore } from '@/stores/clients';
import { useContractsStore } from '@/stores/contracts';
import { useCatalogsStore } from '@/stores/catalogs';
import { useInventoryStore } from '@/stores/inventory';
import { useInventoryUnitsStore } from '@/stores/inventoryUnits';
import { useClientPhotosStore } from '@/stores/clientPhotos';
import { useInfraElementosStore } from '@/stores/infraElementos';
import { useFoFibraStore } from '@/stores/foFibra';
import { useAuthStore } from '@/stores/auth';
import { useToast } from '@/composables/useToast';
import { getErrorMessage } from '@/lib/errors';
import { PRIORITY_CLASS, PRIORITY_LABEL } from '@/lib/ticketPriority';
import { countOcupadosReales } from '@/lib/napOccupancy';
import { supabase } from '@/lib/supabase';
import { readOrderInventory } from '@/lib/orderInventory';
import { presentInstallationInventoryError } from '@/lib/installationInventoryError';
import type { FieldInventoryMovement, FieldInventoryUnit } from '@/types/fieldInventory';
import {
  NAP_CLIENT_LIMIT,
  type ClientPhotoCategory,
  type ContractServiceType,
  type Installation,
  type InstallationStatus,
  type InventoryUnit,
  type TicketPriority,
} from '@/types/domain';

// Fase 122: detalle dedicado de una instalacion — antes todo esto (materiales,
// equipos, completar) vivia en modales abiertos desde la fila de la tabla en
// InstalacionesView.vue. Un solo lugar evita que "Materiales" y "Completar"
// queden sueltos en el listado (riesgo de doble envio si se abre 2 veces) y
// deja un unico punto de entrada ("Ver orden"), igual que ya existe para
// Tickets (TicketDetailView.vue). La logica de cada seccion es la MISMA que
// tenian los modales — solo se movio, no se reescribio, para no arriesgar
// un comportamiento distinto al ya probado.

const route = useRoute();
const router = useRouter();
const installationsStore = useInstallationsStore();
const clientsStore = useClientsStore();
const contractsStore = useContractsStore();
const catalogsStore = useCatalogsStore();
const inventoryStore = useInventoryStore();
const inventoryUnitsStore = useInventoryUnitsStore();
const clientPhotosStore = useClientPhotosStore();
const infraStore = useInfraElementosStore();
const fibra = useFoFibraStore();
const auth = useAuthStore();
const toast = useToast();

const installationId = computed(() => route.params.id as string);
const installation = ref<Installation | null>(null);
const loading = ref(true);
const notFound = ref(false);

// El tecnico gestiona sus altas desde la App de Campo, no desde el Panel Web
// — igual que TicketDetailView, esta vista queda SOLO LECTURA para
// TECNICO_RED (materiales, equipos, completar, cancelar e instrucciones).
// Antes el tecnico asignado SI podia editar aqui ademas de en la App de
// Campo; se cerro esa puerta para evitar un cierre/edicion duplicado desde
// el Panel Web sin la validacion de permisos administrativos.
const isTecnico = computed(() => auth.role === 'TECNICO_RED');
function canDelete(inst: Installation) {
  return inst.status === 'cancelled' && auth.role !== 'TECNICO_RED';
}

// ---- Fase 151: ordenes cerradas (completed/cancelled) quedan en solo
// lectura por defecto — ADMIN ya no puede escribir ahi ni a nivel de RLS
// (ver supabase/migrations/20261012150000_fase151_proteger_ordenes_cerradas.sql,
// PROPUESTA sin aplicar todavia). SUPERADMIN conserva edicion excepcional,
// pero debe activarla explicitamente aca — por defecto arranca en solo
// lectura igual que todos. "Habilitar edicion" es una confirmacion de UX,
// no un mecanismo de permisos nuevo: SUPERADMIN ya tiene el permiso real
// de por si: lo unico que hace este flag es ocultar los controles hasta
// que decida activarlos, para no editar una orden cerrada sin querer.
const editModeForClosed = ref(false);
const isClosedOrder = computed(() => installation.value?.status === 'completed' || installation.value?.status === 'cancelled');
const closedReadOnly = computed(() => isClosedOrder.value && !(auth.role === 'SUPERADMIN' && editModeForClosed.value));
const canRequestEditMode = computed(() => auth.role === 'SUPERADMIN' && isClosedOrder.value && !editModeForClosed.value);

function requestEditMode() {
  const ok = confirm(
    '⚠️ Esta orden ya está cerrada. Vas a habilitar edición excepcional — ' +
      'se mantiene igual de cerrada para todos los demás roles, y ningún ' +
      'cambio de estado o asignación se hace solo: cada acción sigue ' +
      'pidiendo su propia confirmación. ¿Activar edición excepcional?',
  );
  if (ok) editModeForClosed.value = true;
}
function exitEditMode() {
  editModeForClosed.value = false;
}

const canEditCrew = computed(() => ['SUPERADMIN', 'ADMIN', 'SOPORTE'].includes(auth.role ?? '') && !closedReadOnly.value);
function canEdit(_inst: Installation) {
  if (isTecnico.value) return false;
  if (closedReadOnly.value) return false;
  return auth.role === 'SUPERADMIN' || auth.role === 'ADMIN';
}
function canEditMaterials(inst: Installation) {
  if (closedReadOnly.value) return false;
  if (auth.role === 'SUPERADMIN' || auth.role === 'ADMIN') return true;
  return canEdit(inst) && inst.status !== 'completed';
}
const canEditStatus = computed(() => (auth.role === 'SUPERADMIN' || auth.role === 'ADMIN') && !closedReadOnly.value);
// Fase 148 — antes de que un tecnico tome la orden no hay nada que "usar":
// el formulario de registro de materiales (plantilla + "otro material") es
// flujo de ejecucion en campo, igual que ya pasa con equipos/completar para
// TECNICO_RED mas abajo (isTecnico). Se oculta solo el formulario para
// admin en 'pending' — el listado de lo ya registrado (si hubiera) sigue
// visible, y "Equipos asignados" NO se toca: sirve para que administracion
// reserve/pre-asigne una serie especifica antes de despachar al tecnico
// (inventoryUnitsStore.assignUnit ya soporta esto, es la misma funcion que
// usa la App de Campo — no es una forma nueva ni un flujo distinto).
const isPreDispatch = computed(() => installation.value?.status === 'pending');
const canEditPriority = computed(() => auth.role !== 'TECNICO_RED' && !closedReadOnly.value);

const technicians = computed(() => catalogsStore.staff.filter((s) => s.role === 'TECNICO_RED'));

const STATUS_LABEL: Record<InstallationStatus, string> = {
  pending: 'Pendiente',
  scheduled: 'Programada',
  in_progress: 'En curso',
  completed: 'Completada',
  cancelled: 'Cancelada',
};
const STATUS_CLASS: Record<InstallationStatus, string> = {
  pending: 'bg-yellow-500/15 text-yellow-600',
  scheduled: 'bg-sky-500/15 text-sky-700',
  in_progress: 'bg-sky-500/15 text-sky-700',
  completed: 'bg-green-500/15 text-green-600',
  cancelled: 'bg-slate-500/15 text-slate-600',
};

// ---- Notas/indicaciones administrativas (Fase 148) ----
// `notes` lo escribe solo administracion (al crear la orden o aqui) — el
// tecnico SOLO lo lee como `trabajoDescripcion` en CampoTrabajoDetailView.vue
// (computed de solo lectura, nunca un v-model), asi que editarlo no pisa
// nada que el tecnico haya escrito. Mismo patron ya probado que
// `handleSaveIptvNote` mas abajo (textarea + updateInstallation).
const editingNotes = ref(false);
const notesDraft = ref('');
const savingNotes = ref(false);
const notesError = ref<string | null>(null);

function startEditNotes() {
  if (!installation.value) return;
  notesDraft.value = installation.value.notes ?? '';
  notesError.value = null;
  editingNotes.value = true;
}
function cancelEditNotes() {
  editingNotes.value = false;
  notesError.value = null;
}
async function handleSaveNotes() {
  if (!installation.value) return;
  savingNotes.value = true;
  notesError.value = null;
  try {
    const updated = await installationsStore.updateInstallation(installation.value.id, { notes: notesDraft.value.trim() || null });
    installation.value.notes = updated.notes;
    editingNotes.value = false;
    toast.success('Notas actualizadas');
  } catch (e) {
    const msg = getErrorMessage(e, 'Error al guardar las notas');
    notesError.value = msg;
    toast.error(msg);
  } finally {
    savingNotes.value = false;
  }
}

// ---- Resumen de coordinación para el técnico (Fase 152) ----
// Antes esto se armaba a mano por WhatsApp (admin copiaba nombre/DNI/
// telefono/direccion/plan de la ficha del cliente y del prospecto). Reusa
// datos ya cargados — ningun fetch nuevo, ninguna tabla nueva:
// instalacion.clients (nombre/telefono/telefono alterno/direccion, ya
// venian del join de installationsStore, aca solo se le agrego phone_2) +
// el contrato ya cargado en contractsStore (DNI, plan, tarifa real
// monthly_fee, zona/PON, direccion de ESTE servicio si difiere de la del
// titular, Fase 37). La tarifa sigue sin mostrarsele al tecnico en ningun
// lado (eso no cambia, Fase 13l) — este resumen es solo para
// administracion/despacho, igual que ya lo era el mensaje de WhatsApp.
const linkedContract = computed(() => contractsStore.contracts.find((c) => c.id === installation.value?.contract_id) ?? null);

interface CoordinationSummary {
  nombre: string;
  dni: string;
  telefono: string;
  telefonoAlterno: string | null;
  direccion: string;
  plan: string;
  tarifa: string;
  zona: string;
  contrato: string;
}
const coordinationSummary = computed<CoordinationSummary | null>(() => {
  const inst = installation.value;
  if (!inst) return null;
  const contract = linkedContract.value;
  const nombre = inst.clients ? `${inst.clients.first_name} ${inst.clients.last_name}`.trim() : '—';
  return {
    nombre: nombre || '—',
    dni: contract?.clients?.document_number || 'Sin registrar',
    telefono: inst.clients?.phone || 'Sin registrar',
    telefonoAlterno: inst.clients?.phone_2 || null,
    direccion: contract?.installation_address || inst.clients?.address || 'Sin registrar',
    plan: contract?.plans?.name || 'Sin plan asignado',
    tarifa: contract ? `S/ ${Number(contract.monthly_fee).toFixed(2)}` : 'Sin registrar',
    zona: contract?.zones?.name || 'Sin zona asignada',
    contrato: contract?.contract_number || inst.contracts?.contract_number || 'Sin contrato',
  };
});
// Visible solo para quien gestiona el despacho — el tecnico ya ve lo mismo
// (menos la tarifa) en su propia App de Campo, no hace falta duplicarlo aca.
const showCoordinationSummary = computed(() => !isTecnico.value && !!coordinationSummary.value);

function coordinationSummaryText(): string {
  const s = coordinationSummary.value;
  if (!s) return '';
  const lines = [
    `📍 Nueva instalación — ${s.nombre}`,
    `DNI: ${s.dni}`,
    `Tel: ${s.telefono}${s.telefonoAlterno ? ` (alterno: ${s.telefonoAlterno})` : ''}`,
    `Dirección: ${s.direccion}`,
    `Plan: ${s.plan} — ${s.tarifa}`,
    `Zona/PON: ${s.zona}`,
    `Orden: ${s.contrato}`,
  ];
  return lines.join('\n');
}

const copyingSummary = ref(false);
async function copyInstallationSummary() {
  const text = coordinationSummaryText();
  if (!text) return;
  copyingSummary.value = true;
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Datos copiados — pégalos en WhatsApp para coordinar con el técnico');
  } catch (e) {
    toast.error(getErrorMessage(e, 'No se pudo copiar — selecciona y copia el texto manualmente'));
  } finally {
    copyingSummary.value = false;
  }
}

// ---- Materiales usados (Fase 11b) ----
// Fase 149: el registro (plantilla + "otro material") se saco de esta
// vista — queda consulta de solo lectura. Es flujo de ejecucion tecnica,
// vive solo en CampoTrabajoDetailView.vue (misma inventoryStore.registerUsage,
// sin duplicar logica, solo se dejo de invocar desde aca).
const materials = ref<FieldInventoryMovement[]>([]);
const loadingMaterials = ref(false);
const inventoryReadError = ref<string | null>(null);

// Lectura por RPC (inventory_order_read): la misma usada por CampoTrabajoDetailView/
// RoutineInventory/TicketDetailView — autoriza por asignacion vigente en SQL, nunca
// asume el rol desde el navegador. Un tecnico retirado de la cuadrilla recibe un
// 403 aqui (lo mismo que ya le pasaria en la App de Campo), no ve ni deja ver datos.
async function loadMaterialsAndUnits() {
  if (!installation.value || !auth.user) return;
  const actorId = auth.user.id, jobId = installation.value.id;
  const current = () => auth.user?.id === actorId && installation.value?.id === jobId;
  loadingMaterials.value = true;
  inventoryReadError.value = null;
  try {
    const [mats, units] = await Promise.all([
      readOrderInventory<FieldInventoryMovement>(supabase, actorId, 'installation', jobId, 'materials', current),
      readOrderInventory<FieldInventoryUnit>(supabase, actorId, 'installation', jobId, 'assigned', current),
    ]);
    materials.value = mats.items;
    assignedUnits.value = units.items;
  } catch (e) {
    materials.value = [];
    assignedUnits.value = [];
    inventoryReadError.value = presentInstallationInventoryError(installation.value?.status, e);
  } finally {
    loadingMaterials.value = false;
  }
}

// ---- Tipo de servicio (Fase 45) — vive en el contrato, no en la instalacion ----
const serviceTypeSaving = ref(false);
const serviceTypeError = ref<string | null>(null);
const materialsServiceType = computed<ContractServiceType>(() => installation.value?.contracts?.service_type ?? 'internet_combo');
const canChangeServiceType = computed(() => !!installation.value?.contract_id);

async function setServiceType(type: ContractServiceType) {
  const inst = installation.value;
  const contractId = inst?.contract_id;
  if (!inst || !contractId || materialsServiceType.value === type) return;
  serviceTypeSaving.value = true;
  serviceTypeError.value = null;
  try {
    await contractsStore.updateContract(contractId, { service_type: type });
    if (inst.contracts) inst.contracts.service_type = type;
  } catch (e) {
    serviceTypeError.value = getErrorMessage(e, 'Error al cambiar el tipo de servicio');
  } finally {
    serviceTypeSaving.value = false;
  }
}

// ---- Nota IPTV (Fase 45) ----
const iptvNoteDraft = ref('');
const savingIptvNote = ref(false);
const iptvNoteError = ref<string | null>(null);

async function handleSaveIptvNote() {
  if (!installation.value) return;
  savingIptvNote.value = true;
  iptvNoteError.value = null;
  try {
    const updated = await installationsStore.updateInstallation(installation.value.id, { iptv_account_note: iptvNoteDraft.value.trim() || null });
    installation.value.iptv_account_note = updated.iptv_account_note;
  } catch (e) {
    iptvNoteError.value = getErrorMessage(e, 'Error al guardar la nota');
  } finally {
    savingIptvNote.value = false;
  }
}

// ---- Equipos serializados ----
const serializedProducts = computed(() => inventoryStore.products.filter((p) => p.is_serialized));
const soloIptvEquipmentProducts = computed(() =>
  inventoryStore.products.filter((p) => p.is_serialized && (p.inventory_categories?.slug === 'onu' || p.inventory_categories?.slug === 'tvbox')),
);
const assignedOntUnit = computed(() => assignedUnits.value.find((u) => u.product?.inventory_categories?.slug === 'onu'));
const equipmentProducts = computed(() => {
  const base = materialsServiceType.value === 'solo_iptv' ? soloIptvEquipmentProducts.value : serializedProducts.value;
  return assignedOntUnit.value ? base.filter((p) => p.inventory_categories?.slug !== 'onu') : base;
});

watch(materialsServiceType, () => {
  unitForm.value = { productId: '', unitId: '' };
  availableUnits.value = [];
});
const assignedUnits = ref<FieldInventoryUnit[]>([]);
const availableUnits = ref<InventoryUnit[]>([]);
const loadingAvailableUnits = ref(false);
const unitForm = ref({ productId: '', unitId: '' });
const savingUnit = ref(false);
const unitError = ref<string | null>(null);

async function onUnitProductChange() {
  unitForm.value.unitId = '';
  availableUnits.value = [];
  if (!unitForm.value.productId) return;
  loadingAvailableUnits.value = true;
  try {
    const units = await inventoryUnitsStore.fetchUnitsByProduct(unitForm.value.productId);
    availableUnits.value = units.filter((u) => u.status === 'in_stock');
  } finally {
    loadingAvailableUnits.value = false;
  }
}

async function handleAssignUnit() {
  if (!installation.value || !unitForm.value.unitId) return;
  savingUnit.value = true;
  unitError.value = null;
  try {
    await inventoryUnitsStore.assignUnit(unitForm.value.unitId, installation.value.client_id, {
      installationId: installation.value.id,
      contractId: installation.value.contract_id ?? undefined,
      reason: `Instalación ${installation.value.contracts?.contract_number ?? installation.value.id}`,
    });
    await loadMaterialsAndUnits();
    await onUnitProductChange();
  } catch (e) {
    unitError.value = getErrorMessage(e, 'Error al asignar el equipo');
  } finally {
    savingUnit.value = false;
  }
}

const removingUnitId = ref<string | null>(null);
const canRemoveUnit = computed(() => {
  const inst = installation.value;
  if (!inst) return false;
  if (closedReadOnly.value) return false;
  if (inst.status !== 'completed') return canEdit(inst);
  return auth.role === 'SUPERADMIN' || auth.role === 'ADMIN';
});

async function handleUnassignUnit(unit: FieldInventoryUnit) {
  if (!installation.value) return;
  const isCompletedCorrection = installation.value.status === 'completed';
  let reason = 'Corrección en campo: equipo incorrecto retirado de la instalación';
  if (isCompletedCorrection) {
    const typed = prompt('Esta instalación ya está completada. Escribe el motivo de la corrección (queda registrado en el historial del equipo):');
    if (!typed || !typed.trim()) return;
    reason = typed.trim();
  } else if (!confirm(`¿Quitar "${unit.product?.name ?? 'este equipo'}" de la instalación? Vuelve a bodega disponible.`)) {
    return;
  }
  removingUnitId.value = unit.id;
  unitError.value = null;
  try {
    await inventoryUnitsStore.markRepaired(unit.id, reason);
    await loadMaterialsAndUnits();
    await onUnitProductChange();
  } catch (e) {
    unitError.value = getErrorMessage(e, 'Error al quitar el equipo');
  } finally {
    removingUnitId.value = null;
  }
}

// ---- Estado / Prioridad (correccion administrativa directa) ----
const showReopenConfirm = ref(false);
const reopenTarget = ref<InstallationStatus | null>(null);

async function handleStatusChange(status: InstallationStatus) {
  if (!installation.value) return;
  if (installation.value.status === 'completed' && (status === 'pending' || status === 'scheduled')) {
    reopenTarget.value = status;
    showReopenConfirm.value = true;
    return;
  }
  await applyStatusChange(status);
}
async function applyStatusChange(status: InstallationStatus) {
  if (!installation.value) return;
  try {
    installation.value = await installationsStore.updateStatus(installation.value.id, status);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al cambiar el estado'));
  }
}
async function confirmReopen() {
  const status = reopenTarget.value;
  showReopenConfirm.value = false;
  reopenTarget.value = null;
  if (status) await applyStatusChange(status);
}
function cancelReopen() {
  showReopenConfirm.value = false;
  reopenTarget.value = null;
}

async function handlePriorityChange(priority: TicketPriority) {
  if (!installation.value) return;
  try {
    installation.value = await installationsStore.updateInstallation(installation.value.id, { priority });
  } catch (e) {
    alert(getErrorMessage(e, 'Error al cambiar la prioridad'));
  }
}

// ---- Completar instalación (Fase 64b/73) ----
const completeSaving = ref(false);
const completeError = ref<string | null>(null);
const gettingLocation = ref(false);
const completeGps = ref<{ latitude: number | null; longitude: number | null }>({ latitude: null, longitude: null });
const completePhotos = ref<Partial<Record<ClientPhotoCategory, File>>>({});
const completeZoneId = ref('');
const completeNapId = ref('');

const napOptionsAll = computed(() =>
  infraStore.elementos
    .filter((e) => e.tipo === 'caja_nap')
    .map((e) => {
      const puertos = fibra.napPuertosPorElemento[e.id] ?? [];
      const used = countOcupadosReales(puertos);
      const capacity = e.puertos_total ?? NAP_CLIENT_LIMIT;
      return { id: e.id, name: e.name, used, capacity, zoneId: e.zone_id };
    })
    .sort((a, b) => a.name.localeCompare(b.name)),
);
const napOptions = computed(() => napOptionsAll.value.filter((n) => n.zoneId === completeZoneId.value));

function findContractNapId(contractId: string): string {
  for (const puertos of Object.values(fibra.napPuertosPorElemento)) {
    const found = puertos.find((p) => p.contract_id === contractId && p.estado === 'ocupado');
    if (found) return found.infra_elemento_id;
  }
  return '';
}
function onCompleteZoneChange() {
  if (completeNapId.value && !napOptions.value.some((n) => n.id === completeNapId.value)) completeNapId.value = '';
}

const COMPLETE_PHOTO_CATEGORIES: { value: ClientPhotoCategory; label: string }[] = [
  { value: 'facade', label: 'Fachada' },
  { value: 'service_sheet', label: 'Hoja de servicio' },
  { value: 'nap_box', label: 'Caja NAP' },
  { value: 'modem_position', label: 'Posición del módem' },
  { value: 'pon_power', label: 'Potencia Óptica Recibida' },
];

function initCompleteForm() {
  if (!installation.value) return;
  completeGps.value = { latitude: installation.value.clients?.latitude ?? null, longitude: installation.value.clients?.longitude ?? null };
  completePhotos.value = {};
  completeError.value = null;
  const contract = contractsStore.contracts.find((c) => c.id === installation.value?.contract_id);
  completeZoneId.value = contract?.zone_id ?? '';
  completeNapId.value = installation.value.contract_id ? findContractNapId(installation.value.contract_id) : '';
}

function useCurrentLocation() {
  if (!navigator.geolocation) {
    completeError.value = 'Este navegador no soporta geolocalización';
    return;
  }
  gettingLocation.value = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      completeGps.value = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      gettingLocation.value = false;
    },
    (err) => {
      completeError.value = `No se pudo obtener la ubicación: ${err.message}`;
      gettingLocation.value = false;
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}
const gpsMapsLink = computed(() => {
  const { latitude, longitude } = completeGps.value;
  return latitude != null && longitude != null ? `https://www.google.com/maps/@${latitude},${longitude},18z` : 'https://www.google.com/maps';
});
function onCompletePhotoChange(category: ClientPhotoCategory, event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) completePhotos.value[category] = file;
}

const MISSING_EQUIPMENT_MESSAGE = 'Para instalaciones de internet/combo debes asignar al menos un equipo por Serie/MAC';
const MISSING_CONTRACT_MESSAGE =
  'Esta instalación no tiene un contrato vinculado — pide a un administrador que lo asocie antes de completarla (se necesita para mapear la Zona y la Caja NAP).';
const MISSING_ZONE_NAP_MESSAGE = 'Debes asignar la Zona y la Caja NAP antes de completar la instalación.';

async function handleCompleteSubmit() {
  if (!installation.value) return;
  completeSaving.value = true;
  completeError.value = null;
  try {
    const svcType = installation.value.contracts?.service_type ?? 'internet_combo';
    if (svcType === 'internet_combo') {
      const units = await inventoryUnitsStore.fetchUnitsByInstallation(installation.value.id);
      if (!units.length) {
        completeError.value = MISSING_EQUIPMENT_MESSAGE;
        completeSaving.value = false;
        return;
      }
    }

    const clientId = installation.value.client_id;
    const contractId = installation.value.contract_id;
    if (!contractId) {
      completeError.value = MISSING_CONTRACT_MESSAGE;
      completeSaving.value = false;
      return;
    }
    if (!completeZoneId.value || !completeNapId.value) {
      completeError.value = MISSING_ZONE_NAP_MESSAGE;
      completeSaving.value = false;
      return;
    }
    await contractsStore.updateContract(contractId, { zone_id: completeZoneId.value });
    const nap = napOptionsAll.value.find((n) => n.id === completeNapId.value);
    await fibra.assignContractToNap(completeNapId.value, contractId, clientId, nap?.capacity ?? NAP_CLIENT_LIMIT);

    if (completeGps.value.latitude != null && completeGps.value.longitude != null) {
      await clientsStore.updateClient(clientId, { latitude: completeGps.value.latitude, longitude: completeGps.value.longitude });
      if (contractId) {
        await contractsStore.updateContract(contractId, { latitude: completeGps.value.latitude, longitude: completeGps.value.longitude });
      }
    }
    for (const cat of COMPLETE_PHOTO_CATEGORIES.map((c) => c.value)) {
      const file = completePhotos.value[cat];
      if (file && contractId) await clientPhotosStore.uploadPhoto(clientId, contractId, cat, file);
    }
    installation.value = await installationsStore.updateStatus(installation.value.id, 'completed');
    toast.success('Instalación completada correctamente');
  } catch (e) {
    completeError.value = getErrorMessage(e, 'Error al completar la instalación');
  } finally {
    completeSaving.value = false;
  }
}

async function handleCancel() {
  if (!installation.value) return;
  const ok = confirm(`¿Cancelar la instalación de ${installation.value.clients?.first_name} ${installation.value.clients?.last_name}?`);
  if (!ok) return;
  try {
    installation.value = await installationsStore.updateStatus(installation.value.id, 'cancelled');
  } catch (e) {
    alert(getErrorMessage(e, 'Error al cancelar la instalación'));
  }
}

async function handleDelete() {
  if (!installation.value) return;
  const ok = confirm(`¿Eliminar definitivamente la instalación de ${installation.value.clients?.first_name} ${installation.value.clients?.last_name}? Esta acción no se puede deshacer.`);
  if (!ok) return;
  try {
    await installationsStore.deleteInstallation(installation.value.id);
    router.push('/soporte/instalaciones');
  } catch (e) {
    alert(getErrorMessage(e, 'Error al eliminar la instalación'));
  }
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}

onMounted(async () => {
  if (!installationsStore.installations.length) await installationsStore.fetchInstallations();
  await Promise.all([
    contractsStore.fetchContracts(),
    catalogsStore.fetchStaff(),
    catalogsStore.fetchZones(),
    // Catalogo completo de productos: solo ADMIN/SUPERADMIN lo necesitan (eligen
    // que equipo asignar) — el resto de roles son solo lectura aqui y
    // stores/inventory.ts ya rechaza este fetch fuera de esos dos roles.
    ['ADMIN', 'SUPERADMIN'].includes(auth.role ?? '') ? inventoryStore.fetchProducts() : Promise.resolve(),
    infraStore.fetchElementos(),
    fibra.fetchTodosNapPuertos(),
  ]);
  const found = installationsStore.installations.find((i) => i.id === installationId.value);
  installation.value = found ?? null;
  notFound.value = !found;
  loading.value = false;
  if (installation.value) {
    iptvNoteDraft.value = installation.value.iptv_account_note ?? '';
    initCompleteForm();
    await loadMaterialsAndUnits();
  }
});
</script>

<template>
  <AppLayout>
    <button class="text-sm text-slate-600 hover:text-slate-900 mb-4" @click="router.push('/soporte/instalaciones')">
      ← Volver a instalaciones
    </button>

    <p v-if="loading" class="text-slate-500 text-sm">Cargando...</p>
    <div v-else-if="notFound || !installation" class="text-slate-500">Instalación no encontrada.</div>
    <template v-else>
      <div class="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 class="text-2xl font-semibold">
            {{ installation.clients ? `${installation.clients.first_name} ${installation.clients.last_name}` : 'Instalación' }}
          </h1>
          <p class="text-slate-600 text-sm mt-1">
            <span class="font-mono">{{ installation.contracts?.contract_number ?? 'Sin contrato' }}</span>
            · {{ formatDate(installation.scheduled_date) }}
            <span v-if="installation.scheduled_time"> · {{ installation.scheduled_time.slice(0, 5) }}</span>
          </p>
        </div>
        <div class="flex items-center gap-2">
          <span class="badge" :class="STATUS_CLASS[installation.status]">{{ STATUS_LABEL[installation.status] }}</span>
          <router-link :to="`/clientes/${installation.client_id}`" class="btn-secondary text-sm">👤 Ver cliente</router-link>
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <!-- Columna izquierda: estado, prioridad, cuadrilla, acciones -->
        <div class="flex flex-col gap-4">
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div class="surface p-4">
              <div class="text-slate-500 text-xs mb-2">Estado</div>
              <select v-if="canEditStatus" :value="installation.status" class="field-input" @change="handleStatusChange(($event.target as HTMLSelectElement).value as InstallationStatus)">
                <option v-for="(label, value) in STATUS_LABEL" :key="value" :value="value">{{ label }}</option>
              </select>
              <span v-else class="badge" :class="STATUS_CLASS[installation.status]">{{ STATUS_LABEL[installation.status] }}</span>
            </div>
            <div class="surface p-4">
              <div class="text-slate-500 text-xs mb-2">Prioridad</div>
              <select v-if="canEditPriority" :value="installation.priority" class="field-input" @change="handlePriorityChange(($event.target as HTMLSelectElement).value as TicketPriority)">
                <option v-for="(label, value) in PRIORITY_LABEL" :key="value" :value="value">{{ label }}</option>
              </select>
              <span v-else class="badge" :class="PRIORITY_CLASS[installation.priority]">{{ PRIORITY_LABEL[installation.priority] }}</span>
            </div>
          </div>

          <div class="surface p-4 text-sm">
            <h2 class="text-sm font-semibold mb-2">Cuadrilla asignada</h2>
            <CrewAssignEditor job-type="installation" :job-id="installation.id" :technicians="technicians" :readonly="!canEditCrew" />
          </div>

          <div v-if="installation.notes || canEdit(installation)" class="surface p-4 text-sm">
            <div class="flex items-center justify-between mb-2">
              <div class="text-slate-500 text-xs">Notas</div>
              <button
                v-if="canEdit(installation) && !editingNotes"
                type="button"
                class="text-xs text-sky-700 hover:underline"
                @click="startEditNotes"
              >
                {{ installation.notes ? 'Editar notas' : '+ Agregar notas' }}
              </button>
            </div>
            <template v-if="editingNotes">
              <textarea v-model="notesDraft" rows="4" class="field-input" placeholder="Indicaciones para el técnico..."></textarea>
              <p v-if="notesError" class="text-xs text-red-600 mt-2">{{ notesError }}</p>
              <div class="flex justify-end gap-2 mt-2">
                <button type="button" class="btn-ghost text-xs" :disabled="savingNotes" @click="cancelEditNotes">Cancelar</button>
                <button type="button" class="btn-primary text-xs" :disabled="savingNotes" @click="handleSaveNotes">
                  {{ savingNotes ? 'Guardando...' : 'Guardar' }}
                </button>
              </div>
            </template>
            <p v-else-if="installation.notes" class="whitespace-pre-wrap">{{ installation.notes }}</p>
            <p v-else class="text-slate-400 text-xs">Sin notas todavía.</p>
          </div>

          <!-- Fase 152: resumen de coordinacion — reemplaza el mensaje que
               antes se armaba a mano por WhatsApp. Mismos datos que ya
               llegaron del prospecto convertido (13j/13k/13l): nombre, DNI,
               telefonos, direccion, plan, tarifa y zona/PON. -->
          <div v-if="showCoordinationSummary" class="surface p-4 text-sm">
            <div class="flex items-center justify-between mb-2">
              <h2 class="text-sm font-semibold">📋 Resumen de instalación</h2>
              <button type="button" class="btn-secondary text-xs" :disabled="copyingSummary" @click="copyInstallationSummary">
                {{ copyingSummary ? 'Copiando...' : '📋 Copiar datos de instalación' }}
              </button>
            </div>
            <dl class="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
              <dt class="text-slate-500">Cliente</dt>
              <dd class="text-slate-900">{{ coordinationSummary!.nombre }}</dd>
              <dt class="text-slate-500">DNI</dt>
              <dd class="text-slate-900">{{ coordinationSummary!.dni }}</dd>
              <dt class="text-slate-500">Teléfono</dt>
              <dd class="text-slate-900">
                {{ coordinationSummary!.telefono }}<span v-if="coordinationSummary!.telefonoAlterno"> (alterno: {{ coordinationSummary!.telefonoAlterno }})</span>
              </dd>
              <dt class="text-slate-500">Dirección</dt>
              <dd class="text-slate-900">{{ coordinationSummary!.direccion }}</dd>
              <dt class="text-slate-500">Plan</dt>
              <dd class="text-slate-900">{{ coordinationSummary!.plan }} — {{ coordinationSummary!.tarifa }}</dd>
              <dt class="text-slate-500">Zona/PON</dt>
              <dd class="text-slate-900">{{ coordinationSummary!.zona }}</dd>
              <dt class="text-slate-500">Orden</dt>
              <dd class="text-slate-900 font-mono">{{ coordinationSummary!.contrato }}</dd>
            </dl>
          </div>

          <div v-if="canEdit(installation) && installation.status !== 'completed' && installation.status !== 'cancelled'" class="surface p-4 text-sm">
            <h2 class="text-sm font-semibold mb-2">Acciones</h2>
            <button type="button" class="btn-destructive text-xs" @click="handleCancel">Cancelar instalación</button>
          </div>
          <div v-if="canDelete(installation)" class="surface p-4 text-sm">
            <button type="button" class="btn-ghost text-red-500/80 hover:text-red-600 text-xs" @click="handleDelete">Eliminar definitivamente</button>
          </div>
        </div>

        <!-- Columna derecha: tipo de servicio, materiales, equipos, completar -->
        <div class="flex flex-col gap-4">
          <!-- Fase 151 (propuesta): ordenes cerradas quedan en solo lectura
               por defecto para TODOS — SUPERADMIN es el unico que puede
               pedir edicion excepcional, con confirmacion explicita. -->
          <div v-if="isClosedOrder && !editModeForClosed" class="surface p-4 text-sm" :class="installation.status === 'completed' ? 'bg-green-50 border border-green-200' : 'bg-slate-50 border border-slate-200'">
            <h2 class="text-sm font-semibold mb-1">
              {{ installation.status === 'completed' ? '✅ Instalación completada' : '🚫 Instalación cancelada' }} — solo lectura
            </h2>
            <p class="text-xs text-slate-600">
              Estado, prioridad, notas, cuadrilla, materiales y equipos quedan cerrados para evitar una edición accidental.
            </p>
            <button v-if="canRequestEditMode" type="button" class="btn-ghost text-xs mt-2" @click="requestEditMode">
              🔓 Habilitar edición (excepcional, solo Super admin)
            </button>
          </div>
          <div v-else-if="isClosedOrder && editModeForClosed" class="surface p-4 text-sm bg-amber-50 border border-amber-300">
            <h2 class="text-sm font-semibold mb-1">⚠️ Editando una orden cerrada — modo excepcional activo</h2>
            <p class="text-xs text-slate-600">
              Cada acción (cambiar estado, quitar un equipo, etc.) sigue pidiendo su propia confirmación — esto solo
              deja visibles los controles, no ejecuta ningún cambio por sí solo.
            </p>
            <button type="button" class="btn-ghost text-xs mt-2" @click="exitEditMode">🔒 Salir del modo edición</button>
          </div>
          <div v-else-if="isTecnico" class="surface p-4 text-sm bg-sky-50 border border-sky-200">
            <h2 class="text-sm font-semibold mb-1">🔒 Vista de solo lectura</h2>
            <p class="text-xs text-slate-600">Gestiona esta orden (materiales, equipos, completar) desde la App de Campo.</p>
          </div>

          <div class="surface p-4 text-sm">
            <div class="text-slate-500 text-xs mb-2">Tipo de instalación / servicio</div>
            <div class="flex gap-2">
              <button
                type="button"
                class="flex-1 px-3 py-2 rounded-lg text-xs font-medium border"
                :class="materialsServiceType === 'internet_combo' ? 'bg-sky-500 text-slate-950 border-sky-500' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'"
                :disabled="serviceTypeSaving || !canEditMaterials(installation)"
                @click="setServiceType('internet_combo')"
              >
                🌐 Internet / Combo
              </button>
              <button
                type="button"
                class="flex-1 px-3 py-2 rounded-lg text-xs font-medium border"
                :class="materialsServiceType === 'solo_iptv' ? 'bg-sky-500 text-slate-950 border-sky-500' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'"
                :disabled="serviceTypeSaving || !canChangeServiceType || !canEditMaterials(installation)"
                @click="setServiceType('solo_iptv')"
              >
                📺 Solo IPTV (App Smart TV)
              </button>
            </div>
            <p v-if="!canChangeServiceType" class="text-[11px] text-amber-700 mt-1">
              Esta instalación no tiene un contrato/servicio vinculado — vincula uno para poder marcarla como Solo IPTV.
            </p>
            <p v-if="serviceTypeError" class="text-xs text-red-600 mt-1">{{ serviceTypeError }}</p>
          </div>

          <div v-if="materialsServiceType === 'internet_combo'" class="surface p-4 text-sm">
            <h2 class="text-sm font-semibold mb-2">Materiales usados</h2>
            <p v-if="loadingMaterials" class="text-slate-500 text-xs">Cargando...</p>
            <p v-else-if="inventoryReadError" class="text-xs text-red-600 mb-2">{{ inventoryReadError }}</p>
            <template v-else>
              <p v-if="!materials.length" class="text-slate-500 text-xs mb-3">Sin materiales registrados en esta instalación.</p>
              <ul v-else class="space-y-1.5 mb-4">
                <li v-for="m in materials" :key="m.id" class="flex justify-between text-xs">
                  <span>{{ m.product?.name ?? 'Producto' }}</span>
                  <span class="text-slate-600">{{ m.quantity }} {{ m.product?.unit }}</span>
                </li>
              </ul>
            </template>

            <!-- Fase 149: el registro (plantilla/otro material) se saco de
                 esta vista para TODOS los roles y estados — es flujo de
                 ejecucion tecnica, vive solo en la App de Campo. Aca queda
                 unicamente la consulta de lo ya registrado (arriba). -->
            <p v-if="canEdit(installation)" class="text-xs text-slate-400">
              Los materiales se registran desde la App de Campo al tomar la orden.
            </p>
            <p v-else-if="closedReadOnly" class="text-xs text-slate-400">Solo lectura — orden cerrada</p>
            <p v-else-if="isTecnico" class="text-xs text-slate-400">Gestiona materiales desde la App de Campo</p>
            <p v-else class="text-xs text-slate-400">Materiales (solo admin)</p>
          </div>

          <div class="surface p-4 text-sm">
            <h2 class="text-sm font-semibold mb-1">
              Equipos asignados (serie/MAC)
              <span v-if="materialsServiceType === 'internet_combo'" class="text-amber-600 font-normal">— obligatorio</span>
              <span v-else class="text-slate-400 font-normal">— opcional: ONT como puente o TV Box si el TV no es Smart</span>
            </h2>
            <p v-if="isPreDispatch && canEditMaterials(installation)" class="text-[11px] text-slate-400 mb-2">
              Puedes reservar aquí un equipo específico antes de despachar al técnico; si no, el técnico también puede
              asignarlo él mismo desde la App de Campo al tomar la orden.
            </p>
            <p v-if="loadingMaterials" class="text-slate-500 text-xs">Cargando...</p>
            <p v-else-if="inventoryReadError" class="text-xs text-red-600">{{ inventoryReadError }}</p>
            <p v-else-if="!equipmentProducts.length && !assignedUnits.length" class="text-xs text-slate-500">
              {{ materialsServiceType === 'solo_iptv' ? 'No hay productos de ONT o TV Box configurados en Inventario.' : 'No hay productos con control por serie/MAC configurados en Inventario.' }}
            </p>
            <template v-else>
              <ul v-if="assignedUnits.length" class="space-y-1.5 mb-3">
                <li v-for="u in assignedUnits" :key="u.id" class="text-xs">
                  <div class="flex justify-between items-center gap-2">
                    <span>{{ u.product?.name ?? 'Equipo' }} — {{ u.serial_number || u.mac_address }}</span>
                    <button v-if="canRemoveUnit" type="button" :disabled="removingUnitId === u.id" class="text-red-500/80 hover:text-red-600 shrink-0" @click="handleUnassignUnit(u)">
                      {{ removingUnitId === u.id ? 'Quitando...' : 'Quitar' }}
                    </button>
                  </div>
                  <p v-if="u.notes" class="text-slate-500 mt-0.5">Notas: {{ u.notes }}</p>
                </li>
              </ul>
              <p v-else class="text-xs mb-3" :class="materialsServiceType === 'internet_combo' ? 'text-amber-600' : 'text-slate-500'">
                Sin equipos asignados a esta instalación todavía.
              </p>
              <p v-if="assignedOntUnit" class="text-xs text-slate-500 mb-3">
                Ya tiene un Módem/ONT asignado ({{ assignedOntUnit.serial_number || assignedOntUnit.mac_address }}) — solo se permite 1 por
                instalación. Si te equivocaste de serie, presiona "Quitar" en el equipo actual antes de agregar uno nuevo. (TV Box y repetidores sí
                pueden ser más de uno.)
              </p>
              <form v-if="canEditMaterials(installation)" class="flex flex-wrap items-end gap-2" @submit.prevent="handleAssignUnit">
                <div class="flex-1 min-w-[160px]">
                  <label class="block text-xs text-slate-600 mb-1">Producto</label>
                  <select v-model="unitForm.productId" required class="field-input" @change="onUnitProductChange">
                    <option value="" disabled>Selecciona...</option>
                    <option v-for="p in equipmentProducts" :key="p.id" :value="p.id">{{ p.name }}</option>
                  </select>
                </div>
                <div class="flex-1 min-w-[180px]">
                  <label class="block text-xs text-slate-600 mb-1">Equipo disponible</label>
                  <select v-model="unitForm.unitId" required class="field-input" :disabled="!unitForm.productId || loadingAvailableUnits">
                    <option value="" disabled>{{ loadingAvailableUnits ? 'Cargando...' : 'Selecciona...' }}</option>
                    <option v-for="u in availableUnits" :key="u.id" :value="u.id">{{ u.serial_number || u.mac_address }}</option>
                  </select>
                  <p v-if="unitForm.productId && !loadingAvailableUnits && !availableUnits.length" class="text-xs text-amber-700 mt-1">
                    Sin unidades disponibles en bodega para este producto.
                  </p>
                </div>
                <button type="submit" :disabled="savingUnit || !unitForm.unitId" class="btn-secondary text-xs">
                  {{ savingUnit ? 'Asignando...' : '+ Asignar' }}
                </button>
              </form>
              <p v-if="unitError" class="text-xs text-red-600 mt-2">{{ unitError }}</p>
            </template>
          </div>

          <div v-if="materialsServiceType === 'solo_iptv' && canEditMaterials(installation)" class="surface p-4 text-sm">
            <label class="block text-xs text-slate-600 mb-1">Cuenta / usuario IPTV asignado (opcional)</label>
            <textarea v-model="iptvNoteDraft" rows="2" class="field-input" placeholder="ej. Usuario X en Smart TV Samsung del cliente"></textarea>
            <div class="flex justify-end mt-2">
              <button type="button" :disabled="savingIptvNote" class="btn-secondary text-xs" @click="handleSaveIptvNote">
                {{ savingIptvNote ? 'Guardando...' : 'Guardar nota' }}
              </button>
            </div>
            <p v-if="iptvNoteError" class="text-xs text-red-600 mt-2">{{ iptvNoteError }}</p>
          </div>

          <!-- Completar instalación — solo mientras no este completada/cancelada y el usuario pueda editarla. -->
          <form
            v-if="canEdit(installation) && installation.status !== 'completed' && installation.status !== 'cancelled'"
            class="surface p-4 text-sm"
            @submit.prevent="handleCompleteSubmit"
          >
            <h2 class="text-sm font-semibold mb-2">Completar instalación</h2>

            <h3 class="text-xs font-semibold text-slate-500 uppercase mb-2">Ubicación GPS</h3>
            <div class="grid grid-cols-2 gap-3 mb-2">
              <div>
                <label class="block text-xs text-slate-600 mb-1">Latitud</label>
                <input v-model.number="completeGps.latitude" type="number" step="any" class="field-input" />
              </div>
              <div>
                <label class="block text-xs text-slate-600 mb-1">Longitud</label>
                <input v-model.number="completeGps.longitude" type="number" step="any" class="field-input" />
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-3 mb-4">
              <button type="button" :disabled="gettingLocation" class="text-xs text-sky-700 hover:text-sky-700" @click="useCurrentLocation">
                {{ gettingLocation ? 'Obteniendo ubicación...' : '📍 Usar mi ubicación actual' }}
              </button>
              <a :href="gpsMapsLink" target="_blank" rel="noopener" class="text-xs text-sky-700 hover:underline">🗺️ Ubicar en Google Maps</a>
            </div>

            <h3 class="text-xs font-semibold text-slate-500 uppercase mb-2">
              Datos de red / Planta externa<span class="text-red-500"> * <span class="text-slate-400 font-normal">(obligatorio)</span></span>
            </h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div>
                <label class="block text-xs text-slate-600 mb-1">Zona / Sector</label>
                <select v-model="completeZoneId" required class="field-input" @change="onCompleteZoneChange">
                  <option value="" disabled>Selecciona...</option>
                  <option v-for="z in catalogsStore.zones" :key="z.id" :value="z.id">{{ z.name }}</option>
                </select>
              </div>
              <div>
                <label class="block text-xs text-slate-600 mb-1">Caja NAP</label>
                <select v-model="completeNapId" required class="field-input" :disabled="!completeZoneId">
                  <option value="" disabled>{{ completeZoneId ? 'Selecciona...' : 'Elige primero una zona' }}</option>
                  <option v-for="n in napOptions" :key="n.id" :value="n.id">
                    {{ n.name }} — {{ n.used }}/{{ n.capacity }}{{ n.used >= n.capacity && n.id !== completeNapId ? ' (LLENA)' : '' }}
                  </option>
                </select>
                <p v-if="completeZoneId && !napOptions.length" class="text-xs text-amber-700 mt-1">
                  Esa zona no tiene cajas NAP registradas — pide a un administrador que cree una en el Mapa de Red.
                </p>
              </div>
            </div>

            <h3 class="text-xs font-semibold text-slate-500 uppercase mb-2">Fotos de instalación</h3>
            <div class="grid gap-3 mb-4" style="grid-template-columns: repeat(auto-fit, minmax(140px, 1fr))">
              <div v-for="cat in COMPLETE_PHOTO_CATEGORIES" :key="cat.value">
                <label class="block text-xs text-slate-600 mb-1">{{ cat.label }}</label>
                <label class="block text-center px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs cursor-pointer">
                  {{ completePhotos[cat.value] ? completePhotos[cat.value]!.name : 'Subir foto' }}
                  <input type="file" accept="image/*" class="hidden" @change="onCompletePhotoChange(cat.value, $event)" />
                </label>
              </div>
            </div>

            <p v-if="completeError" class="text-sm text-red-600 mb-3">{{ completeError }}</p>
            <button type="submit" :disabled="completeSaving" class="btn-primary w-full text-sm">
              {{ completeSaving ? 'Guardando...' : 'Completar instalación' }}
            </button>
          </form>
        </div>
      </div>

      <Teleport to="body">
        <div v-if="showReopenConfirm" class="modal-overlay" @click.self="cancelReopen">
          <div class="w-full max-w-sm modal-panel">
            <p class="text-sm mb-4">
              ⚠️ ¿Estás seguro de reabrir esta orden? Se mantendrán guardados los equipos y materiales previamente asignados.
            </p>
            <div class="flex justify-end gap-2">
              <button type="button" class="btn-ghost" @click="cancelReopen">Cancelar</button>
              <button type="button" class="btn-primary" @click="confirmReopen">Sí, reabrir</button>
            </div>
          </div>
        </div>
      </Teleport>
    </template>
  </AppLayout>
</template>
