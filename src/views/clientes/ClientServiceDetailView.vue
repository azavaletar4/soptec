<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import ClientSectionCard from '@/components/clientes/ClientSectionCard.vue';
import { useClientsStore } from '@/stores/clients';
import { useContractsStore } from '@/stores/contracts';
import { useCatalogsStore } from '@/stores/catalogs';
import { useTicketsStore } from '@/stores/tickets';
import { useInvoicesStore } from '@/stores/invoices';
import { useMikrotikStore, type PppSecret } from '@/stores/mikrotik';
import { useXuiStore, type XuiLineSummary, type XuiLineAction, type XuiBouquet } from '@/stores/xui';
import { useOltStore, type OltOnt, type UnlinkedOnt } from '@/stores/olt';
import { useInventoryUnitsStore } from '@/stores/inventoryUnits';
import { useInventoryStore } from '@/stores/inventory';
import { usePagosAdelantadosStore } from '@/stores/pagosAdelantados';
import { useDescuentosCompensacionStore } from '@/stores/descuentosCompensacion';
import { useInfraElementosStore } from '@/stores/infraElementos';
import { useFoFibraStore } from '@/stores/foFibra';
import { useClientPhotosStore, type ClientPhotoWithUrl } from '@/stores/clientPhotos';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/lib/errors';
import {
  NAP_CLIENT_LIMIT,
  ZONE_CLIENT_LIMIT,
  type ClientPhotoCategory,
  type ContractPriority,
  type ContractStatus,
  type DescuentoCompensacion,
  type DocumentType,
  type Invoice,
  type InventoryUnit,
  type InventoryUnitStatus,
  type InvoiceStatus,
  type ServiceContract,
  type Ticket,
  type TicketStatus,
} from '@/types/domain';

// Ficha de un solo servicio. Dos formas de usarla (Fase 40):
//  - Standalone (ruta /clientes/:id/servicios/:contractId): cliente con 2+
//    servicios, entra aca desde la tarjeta de servicio elegida en el hub.
//    Con AppLayout, link "volver" y pestañas propias.
//  - `embedded` (dentro de ClientDetailView.vue): cliente con 0 o 1 servicio
//    — la inmensa mayoria — se ve TODO junto en la misma pagina, como antes
//    de la Fase 37, sin navegar a ningun lado ni pestañas que elegir. clientId
//    y contractId los pasa el padre por props en vez de leerlos de la ruta.
const props = defineProps<{
  embedded?: boolean;
  clientIdOverride?: string;
  contractIdOverride?: string;
}>();

const route = useRoute();
const router = useRouter();
const clientsStore = useClientsStore();
const contractsStore = useContractsStore();
const catalogs = useCatalogsStore();
const ticketsStore = useTicketsStore();
const invoicesStore = useInvoicesStore();
const mikrotikStore = useMikrotikStore();
const xuiStore = useXuiStore();
const oltStore = useOltStore();
const inventoryUnitsStore = useInventoryUnitsStore();
const inventoryStore = useInventoryStore();
const pagosAdelantadosStore = usePagosAdelantadosStore();
const descuentosStore = useDescuentosCompensacionStore();
const infraStore = useInfraElementosStore();
const fibra = useFoFibraStore();
const clientPhotosStore = useClientPhotosStore();
const auth = useAuthStore();

const canDeleteContracts = computed(() => auth.role === 'SUPERADMIN');
const canRegisterAdvancePayment = computed(() => ['SUPERADMIN', 'ADMIN', 'FACTURACION'].includes(auth.role ?? ''));
const canApplyAveria = computed(() => auth.role === 'SUPERADMIN' || auth.role === 'ADMIN');
const canCreateTickets = computed(() => auth.role === 'SUPERADMIN' || auth.role === 'ADMIN');
const canChangeOntPlan = computed(() => ['SUPERADMIN', 'ADMIN', 'TECNICO_RED'].includes(auth.role ?? ''));

const clientId = computed(() => props.clientIdOverride ?? (route.params.id as string));
const contractId = computed(() => props.contractIdOverride ?? (route.params.contractId as string));
const client = computed(() => clientsStore.clients.find((c) => c.id === clientId.value));
const contract = ref<ServiceContract | null>(null);
const loadingContract = ref(true);

const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  cedula: 'DNI',
  ruc: 'RUC',
  pasaporte: 'Pasaporte',
};

const STATUS_LABEL: Record<ContractStatus, string> = {
  active: 'Activo',
  suspended: 'Suspendido',
  cancelled: 'Cancelado',
};
const STATUS_CLASS: Record<ContractStatus, string> = {
  active: 'bg-green-500/15 text-green-600',
  suspended: 'bg-red-500/15 text-red-600',
  cancelled: 'bg-slate-500/15 text-slate-600',
};

const PRIORITY_LABEL: Record<ContractPriority, string> = {
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};
const PRIORITY_CLASS: Record<ContractPriority, string> = {
  high: 'bg-red-500/15 text-red-600',
  medium: 'bg-amber-500/15 text-amber-600',
  low: 'bg-slate-500/15 text-slate-600',
};
const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  card: 'Tarjeta',
};

async function loadContract() {
  loadingContract.value = true;
  const all = await contractsStore.fetchContractsByClient(clientId.value);
  contract.value = all.find((c) => c.id === contractId.value) ?? null;
  loadingContract.value = false;
}

type Tab = 'resumen' | 'datos' | 'ubicacion' | 'facturacion' | 'fotos' | 'soporte';
const activeTab = ref<Tab>('resumen');
const TABS: { value: Tab; label: string }[] = [
  { value: 'resumen', label: 'Resumen' },
  { value: 'datos', label: 'Datos del servicio' },
  { value: 'ubicacion', label: 'Ubicación' },
  { value: 'facturacion', label: 'Facturación' },
  { value: 'fotos', label: 'Fotos' },
  { value: 'soporte', label: 'Soporte' },
];

// ---- Tab General + Ubicación: un solo formulario, un solo guardado ----
const savingContract = ref(false);
const contractError = ref<string | null>(null);
const contractForm = ref({
  client_code: '',
  plan_id: '',
  monthly_fee: 0,
  billing_day: 1,
  payment_method: 'cash',
  status: 'active' as ContractStatus,
  priority: 'medium' as ContractPriority,
  mikrotik_device_id: '',
  pppoe_username: '',
  mikrotik_profile: '',
  installation_address: '',
  installation_reference: '',
  latitude: null as number | null,
  longitude: null as number | null,
  zone_id: '',
});
const modalSecrets = ref<PppSecret[]>([]);
const loadingSecrets = ref(false);
const profileNames = ref<string[]>([]);
const loadingProfiles = ref(false);
const profilesError = ref<string | null>(null);

const availableSecrets = computed(() => {
  const linked = new Set(
    contractsStore.contracts
      .filter((c) => c.mikrotik_device_id === contractForm.value.mikrotik_device_id && c.id !== contract.value?.id)
      .map((c) => c.pppoe_username),
  );
  return modalSecrets.value.filter((s) => !linked.has(s.name));
});

async function loadSecretsForModal(deviceId: string) {
  if (!deviceId) {
    modalSecrets.value = [];
    return;
  }
  loadingSecrets.value = true;
  try {
    modalSecrets.value = await mikrotikStore.fetchPppSecrets(deviceId);
  } catch (e) {
    contractError.value = getErrorMessage(e, 'Error al leer usuarios PPPoE del router');
  } finally {
    loadingSecrets.value = false;
  }
}

async function loadPppProfilesForModal(deviceId: string) {
  if (!deviceId) {
    profileNames.value = [];
    return;
  }
  loadingProfiles.value = true;
  profilesError.value = null;
  try {
    const profiles = await mikrotikStore.fetchPppProfiles(deviceId);
    profileNames.value = profiles.map((p) => p.name);
  } catch (e) {
    profilesError.value = getErrorMessage(e, 'No se pudo leer los perfiles del router');
    profileNames.value = [];
  } finally {
    loadingProfiles.value = false;
  }
}

function fillFormFromContract(c: ServiceContract) {
  contractForm.value = {
    client_code: c.client_code ?? '',
    plan_id: c.plan_id ?? '',
    monthly_fee: Number(c.monthly_fee),
    billing_day: c.billing_day,
    payment_method: c.payment_method ?? 'cash',
    status: c.status,
    priority: c.priority ?? 'medium',
    mikrotik_device_id: c.mikrotik_device_id ?? '',
    pppoe_username: c.pppoe_username ?? '',
    mikrotik_profile: c.mikrotik_profile ?? '',
    installation_address: c.installation_address ?? client.value?.address ?? '',
    installation_reference: c.installation_reference ?? '',
    latitude: c.latitude ?? client.value?.latitude ?? null,
    longitude: c.longitude ?? client.value?.longitude ?? null,
    zone_id: c.zone_id ?? client.value?.zone_id ?? '',
  };
  napId.value = findContractNapId(c.id);
  loadSecretsForModal(contractForm.value.mikrotik_device_id);
  loadPppProfilesForModal(contractForm.value.mikrotik_device_id);
}

// ---- Zona + Caja NAP: por servicio (Fase 38) ----
const showNewZone = ref(false);
const newZoneName = ref('');
const savingZone = ref(false);
const napId = ref('');
const zoneNapError = ref<string | null>(null);

function zoneServiceCount(zoneId: string, excludeContractId?: string | null) {
  return contractsStore.contracts.filter((c) => c.zone_id === zoneId && c.id !== excludeContractId).length;
}

const selectedZoneCount = computed(() =>
  contractForm.value.zone_id ? zoneServiceCount(contractForm.value.zone_id, contract.value?.id) : null,
);

// Cajas NAP disponibles, filtradas por la zona ya elegida (primero zona,
// luego NAP, igual que antes en la ficha de cliente).
const napOptionsAll = computed(() =>
  infraStore.elementos
    .filter((e) => e.tipo === 'caja_nap')
    .map((e) => {
      const puertos = fibra.napPuertosPorElemento[e.id] ?? [];
      const used = puertos.filter((p) => p.estado === 'ocupado').length;
      const capacity = e.puertos_total ?? NAP_CLIENT_LIMIT;
      return { id: e.id, name: e.name, used, capacity, zoneId: e.zone_id };
    })
    .sort((a, b) => a.name.localeCompare(b.name)),
);
const napOptions = computed(() => napOptionsAll.value.filter((n) => n.zoneId === contractForm.value.zone_id));

const currentNapMismatch = computed(() => {
  if (!napId.value) return null;
  const nap = napOptionsAll.value.find((n) => n.id === napId.value);
  return nap && nap.zoneId !== contractForm.value.zone_id ? nap : null;
});

function findContractNapId(cId: string): string {
  for (const puertos of Object.values(fibra.napPuertosPorElemento)) {
    const found = puertos.find((p) => p.contract_id === cId && p.estado === 'ocupado');
    if (found) return found.infra_elemento_id;
  }
  return '';
}

function onZoneChange() {
  if (napId.value && !napOptions.value.some((n) => n.id === napId.value)) napId.value = '';
}

async function handleCreateZone() {
  const name = newZoneName.value.trim();
  if (!name) return;
  savingZone.value = true;
  zoneNapError.value = null;
  try {
    const zone = await catalogs.createZone(name);
    contractForm.value.zone_id = zone.id;
    showNewZone.value = false;
    newZoneName.value = '';
  } catch (e) {
    zoneNapError.value = getErrorMessage(e, 'Error al crear la zona');
  } finally {
    savingZone.value = false;
  }
}

// Se llama despues de guardar el contrato (ya tiene id real). Un fallo aca
// no debe perder los demas datos ya guardados — solo se avisa.
async function syncNap(c: ServiceContract) {
  try {
    if (napId.value) {
      const nap = napOptions.value.find((n) => n.id === napId.value);
      await fibra.assignContractToNap(napId.value, c.id, c.client_id, nap?.capacity ?? NAP_CLIENT_LIMIT);
    } else {
      await fibra.unassignContract(c.id);
    }
  } catch (e) {
    alert(getErrorMessage(e, 'El servicio se guardo, pero no se pudo asignar la caja NAP'));
  }
}

function onMikrotikDeviceChange() {
  contractForm.value.pppoe_username = '';
  loadSecretsForModal(contractForm.value.mikrotik_device_id);
  loadPppProfilesForModal(contractForm.value.mikrotik_device_id);
}

function onPlanChange() {
  const plan = catalogs.plans.find((p) => p.id === contractForm.value.plan_id);
  if (plan) contractForm.value.monthly_fee = Number(plan.price);
}

async function syncMikrotikProfile(c: ServiceContract, previousProfile: string | null) {
  if (c.status !== 'active') return;
  if (!c.mikrotik_device_id || !c.pppoe_username || !c.mikrotik_profile) return;
  const secret = modalSecrets.value.find((s) => s.name === c.pppoe_username);
  if (!secret) return;
  try {
    await mikrotikStore.setPppSecretProfile(c.mikrotik_device_id, secret['.id'], c.mikrotik_profile);
  } catch (e) {
    alert(getErrorMessage(e, 'Se guardo, pero no se pudo sincronizar el profile PPPoE en el MikroTik'));
    return;
  }
  if (c.mikrotik_profile === previousProfile) return;
  try {
    const active = await mikrotikStore.fetchPppActive(c.mikrotik_device_id);
    const session = active.find((a) => a.name === c.pppoe_username);
    if (session) await mikrotikStore.disconnectPppActive(c.mikrotik_device_id, session['.id']);
  } catch (e) {
    alert(getErrorMessage(e, 'El profile se actualizo, pero no se pudo forzar la reconexion PPPoE'));
  }
}

async function syncXuiLineStatus(c: ServiceContract, previousStatus: ContractStatus | null) {
  if (!c.xui_line_id || c.status === previousStatus) return;
  const action: XuiLineAction | null =
    c.status === 'active' ? 'enable' : c.status === 'suspended' || c.status === 'cancelled' ? 'disable' : null;
  if (!action) return;
  try {
    await xuiStore.lineAction(c.xui_line_id, action);
  } catch (e) {
    alert(getErrorMessage(e, 'Se guardo, pero no se pudo sincronizar el estado de la linea IPTV en XUI'));
  }
}

async function handleSaveContract() {
  if (!contract.value) return;
  if (contractForm.value.zone_id) {
    const count = zoneServiceCount(contractForm.value.zone_id, contract.value.id);
    if (count >= ZONE_CLIENT_LIMIT) {
      contractError.value = `Esa zona ya tiene ${count}/${ZONE_CLIENT_LIMIT} servicios (límite alcanzado). Elige otra zona o libera cupo primero.`;
      return;
    }
  }
  savingContract.value = true;
  contractError.value = null;
  const previousProfile = contract.value.mikrotik_profile ?? null;
  const previousStatus = contract.value.status;
  const payload = {
    client_code: contractForm.value.client_code.trim() || null,
    plan_id: contractForm.value.plan_id || null,
    monthly_fee: contractForm.value.monthly_fee,
    billing_day: contractForm.value.billing_day,
    payment_method: contractForm.value.payment_method,
    status: contractForm.value.status,
    priority: contractForm.value.priority,
    mikrotik_device_id: contractForm.value.mikrotik_device_id || null,
    pppoe_username: contractForm.value.pppoe_username || null,
    mikrotik_profile: contractForm.value.mikrotik_profile || null,
    installation_address: contractForm.value.installation_address || null,
    installation_reference: contractForm.value.installation_reference || null,
    latitude: contractForm.value.latitude,
    longitude: contractForm.value.longitude,
    zone_id: contractForm.value.zone_id || null,
  };
  try {
    const saved = await contractsStore.updateContract(contract.value.id, payload);
    contract.value = saved;
    await syncMikrotikProfile(saved, previousProfile);
    await syncXuiLineStatus(saved, previousStatus);
    await syncNap(saved);
  } catch (e) {
    contractError.value = getErrorMessage(e, 'Error al actualizar el contrato');
  } finally {
    savingContract.value = false;
  }
}

async function handleDeleteContract() {
  if (!contract.value) return;
  const ok = confirm(
    `¿Eliminar el contrato ${contract.value.contract_number}? Esta acción no se puede deshacer y también elimina sus facturas e instalación asociadas (no afecta nada en la OLT ni en el router).`,
  );
  if (!ok) return;
  try {
    await contractsStore.deleteContract(contract.value.id);
    router.push(`/clientes/${clientId.value}`);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al eliminar el contrato'));
  }
}

// ---- Equipo: ONT (OLT) + inventario, scoped a este contrato ----
const clientOnts = ref<OltOnt[]>([]);
const loadingOnts = ref(true);
const assignedUnits = ref<InventoryUnit[]>([]);
const loadingUnits = ref(true);

async function loadOnts() {
  loadingOnts.value = true;
  try {
    clientOnts.value = await oltStore.fetchOntsByClient(clientId.value);
  } catch {
    clientOnts.value = [];
  } finally {
    loadingOnts.value = false;
  }
}

async function loadUnits() {
  loadingUnits.value = true;
  assignedUnits.value = await inventoryUnitsStore.fetchUnitsByClient(clientId.value);
  loadingUnits.value = false;
}

const contractOnts = computed(() => clientOnts.value.filter((o) => o.contract_id === contract.value?.id));
const contractOtherOnts = computed(() => clientOnts.value.filter((o) => o.contract_id !== contract.value?.id));
const contractUnits = computed(() => assignedUnits.value.filter((u) => u.contract_id === contract.value?.id));
const contractOtherUnits = computed(() => assignedUnits.value.filter((u) => u.contract_id !== contract.value?.id));

const reassignOntId = ref('');
const reassignUnitId = ref('');
const equipoTabError = ref<string | null>(null);
const equipoTabSaving = ref(false);

async function handleAssignOntToContract() {
  if (!reassignOntId.value || !contract.value) return;
  const ont = clientOnts.value.find((o) => o.id === reassignOntId.value);
  if (!ont) return;
  equipoTabSaving.value = true;
  equipoTabError.value = null;
  try {
    const updated = await oltStore.setOntContract(ont.olt_device_id, ont.id, contract.value.id);
    const idx = clientOnts.value.findIndex((o) => o.id === updated.id);
    if (idx !== -1) clientOnts.value[idx] = { ...clientOnts.value[idx], ...updated };
    reassignOntId.value = '';
  } catch (e) {
    equipoTabError.value = getErrorMessage(e, 'Error al vincular la ONT a este contrato');
  } finally {
    equipoTabSaving.value = false;
  }
}

async function handleUnassignOntFromContract(ont: OltOnt) {
  equipoTabSaving.value = true;
  equipoTabError.value = null;
  try {
    const updated = await oltStore.setOntContract(ont.olt_device_id, ont.id, null);
    const idx = clientOnts.value.findIndex((o) => o.id === updated.id);
    if (idx !== -1) clientOnts.value[idx] = { ...clientOnts.value[idx], ...updated };
  } catch (e) {
    equipoTabError.value = getErrorMessage(e, 'Error al desvincular la ONT de este contrato');
  } finally {
    equipoTabSaving.value = false;
  }
}

async function handleAssignUnitToContract() {
  if (!reassignUnitId.value || !contract.value) return;
  equipoTabSaving.value = true;
  equipoTabError.value = null;
  try {
    const updated = await inventoryUnitsStore.setUnitContract(reassignUnitId.value, contract.value.id);
    const idx = assignedUnits.value.findIndex((u) => u.id === updated.id);
    if (idx !== -1) assignedUnits.value[idx] = updated;
    reassignUnitId.value = '';
  } catch (e) {
    equipoTabError.value = getErrorMessage(e, 'Error al vincular el equipo a este contrato');
  } finally {
    equipoTabSaving.value = false;
  }
}

async function handleUnassignUnitFromContract(unit: InventoryUnit) {
  equipoTabSaving.value = true;
  equipoTabError.value = null;
  try {
    const updated = await inventoryUnitsStore.setUnitContract(unit.id, null);
    const idx = assignedUnits.value.findIndex((u) => u.id === updated.id);
    if (idx !== -1) assignedUnits.value[idx] = updated;
  } catch (e) {
    equipoTabError.value = getErrorMessage(e, 'Error al desvincular el equipo de este contrato');
  } finally {
    equipoTabSaving.value = false;
  }
}

const ontSearchQuery = ref('');
const ontSearchResults = ref<UnlinkedOnt[]>([]);
const searchingOnt = ref(false);
const linkingOntId = ref<string | null>(null);
const ontLinkError = ref<string | null>(null);

async function handleSearchOnt() {
  const q = ontSearchQuery.value.trim();
  if (q.length < 3) {
    ontLinkError.value = 'Ingresa al menos 3 caracteres del numero de serie';
    return;
  }
  searchingOnt.value = true;
  ontLinkError.value = null;
  try {
    ontSearchResults.value = await oltStore.searchUnlinkedOnts(q);
    if (!ontSearchResults.value.length) ontLinkError.value = 'Sin resultados (o ya esta vinculada a otro cliente)';
  } catch (e) {
    ontLinkError.value = getErrorMessage(e, 'Error al buscar en la OLT');
  } finally {
    searchingOnt.value = false;
  }
}

async function handleLinkOnt(unlinked: UnlinkedOnt) {
  if (!contract.value) return;
  linkingOntId.value = unlinked.id;
  ontLinkError.value = null;
  try {
    await oltStore.linkOntToClient(unlinked.olt_device_id, unlinked.id, clientId.value, contract.value.id);
    ontSearchQuery.value = '';
    ontSearchResults.value = [];
    await loadOnts();
  } catch (e) {
    ontLinkError.value = getErrorMessage(e, 'Error al vincular la ONT');
  } finally {
    linkingOntId.value = null;
  }
}

// ---- Cambio de plan (ancho de banda real, OLT) — solo afecta ESTE contrato ----
const plansWithOltProfile = computed(() => catalogs.plans.filter((p) => p.olt_tcont_profile && p.olt_traffic_profile));
const showOntPlanModal = ref(false);
const ontPlanTarget = ref<OltOnt | null>(null);
const ontPlanValue = ref('');
const savingOntPlan = ref(false);
const ontPlanError = ref<string | null>(null);

function openOntPlanModal(ont: OltOnt) {
  ontPlanTarget.value = ont;
  ontPlanValue.value = ont.plan_id ?? '';
  ontPlanError.value = null;
  showOntPlanModal.value = true;
}

async function handleSaveOntPlan() {
  if (!ontPlanTarget.value || !contract.value) return;
  const plan = catalogs.plans.find((p) => p.id === ontPlanValue.value);
  if (!plan?.olt_tcont_profile || !plan?.olt_traffic_profile) {
    ontPlanError.value = 'Selecciona un plan con perfiles OLT configurados (ver seccion Planes)';
    return;
  }
  savingOntPlan.value = true;
  ontPlanError.value = null;
  try {
    const updated = await oltStore.changeOntPlan(ontPlanTarget.value.olt_device_id, ontPlanTarget.value.id, {
      tcontProfile: plan.olt_tcont_profile,
      trafficProfile: plan.olt_traffic_profile,
      planId: plan.id,
    });
    const idx = clientOnts.value.findIndex((o) => o.id === updated.id);
    if (idx !== -1) clientOnts.value[idx] = updated;

    // A diferencia de la version anterior (que sincronizaba TODOS los
    // contratos activos del cliente, arrastrando un bug real en clientes
    // multi-servicio), aca solo se actualiza ESTE contrato — es el unico en
    // alcance de esta pagina.
    if (plan.id !== contract.value.plan_id) {
      try {
        contract.value = await contractsStore.updateContract(contract.value.id, { plan_id: plan.id, monthly_fee: Number(plan.price) });
        fillFormFromContract(contract.value);
      } catch (e) {
        alert(getErrorMessage(e, 'El plan se aplico en la OLT, pero no se pudo actualizar el contrato'));
      }
    }
    showOntPlanModal.value = false;
  } catch (e) {
    ontPlanError.value = getErrorMessage(e, 'Error al cambiar el plan en la OLT');
  } finally {
    savingOntPlan.value = false;
  }
}

// ---- Equipo de inventario: agregar equipo nuevo directo a este contrato ----
const UNIT_STATUS_LABEL: Record<InventoryUnitStatus, string> = {
  in_stock: 'En bodega',
  assigned: 'Asignado',
  damaged: 'Dañado',
  in_repair: 'En reparación',
  retired: 'Dado de baja',
};
const UNIT_STATUS_CLASS: Record<InventoryUnitStatus, string> = {
  in_stock: 'bg-green-500/15 text-green-600',
  assigned: 'bg-sky-500/15 text-sky-600',
  damaged: 'bg-red-500/15 text-red-600',
  in_repair: 'bg-amber-500/15 text-amber-600',
  retired: 'bg-slate-500/15 text-slate-600',
};

const showReturnModal = ref(false);
const returnUnitTarget = ref<InventoryUnit | null>(null);
const returnForm = ref({ condition: 'in_stock' as 'in_stock' | 'damaged' | 'in_repair', reason: '' });
const returnSaving = ref(false);
const returnError = ref<string | null>(null);

function openReturn(unit: InventoryUnit) {
  returnUnitTarget.value = unit;
  returnForm.value = { condition: 'in_stock', reason: '' };
  returnError.value = null;
  showReturnModal.value = true;
}

async function handleReturn() {
  if (!returnUnitTarget.value) return;
  returnSaving.value = true;
  returnError.value = null;
  try {
    await inventoryUnitsStore.returnUnit(returnUnitTarget.value.id, returnForm.value.condition, returnForm.value.reason || undefined);
    showReturnModal.value = false;
    await loadUnits();
  } catch (e) {
    returnError.value = getErrorMessage(e, 'Error al registrar la devolución');
  } finally {
    returnSaving.value = false;
  }
}

const showAddUnitModal = ref(false);
const addUnitForm = ref({ product_id: '', serial_number: '', mac_address: '' });
const addUnitSaving = ref(false);
const addUnitError = ref<string | null>(null);

function openAddUnit() {
  addUnitForm.value = { product_id: inventoryStore.products[0]?.id ?? '', serial_number: '', mac_address: '' };
  addUnitError.value = null;
  showAddUnitModal.value = true;
}

async function handleAddUnit() {
  if (!contract.value) return;
  if (!addUnitForm.value.product_id) {
    addUnitError.value = 'Selecciona el modelo del equipo';
    return;
  }
  if (!addUnitForm.value.serial_number.trim() && !addUnitForm.value.mac_address.trim()) {
    addUnitError.value = 'Ingresa al menos el número de serie o la dirección MAC';
    return;
  }
  addUnitSaving.value = true;
  addUnitError.value = null;
  try {
    const unit = await inventoryUnitsStore.createUnit({
      productId: addUnitForm.value.product_id,
      serialNumber: addUnitForm.value.serial_number.trim(),
      macAddress: addUnitForm.value.mac_address.trim(),
    });
    await inventoryUnitsStore.assignUnit(unit.id, clientId.value, {
      contractId: contract.value.id,
      reason: 'Asignacion directa desde ficha de servicio',
    });
    showAddUnitModal.value = false;
    await loadUnits();
  } catch (e) {
    addUnitError.value = getErrorMessage(e, 'Error al registrar el equipo (revisa que la serie/MAC no esté repetida)');
  } finally {
    addUnitSaving.value = false;
  }
}

// ---- Descuentos: pendientes que aplicarian a la SIGUIENTE factura de este contrato ----
const contractDiscounts = ref<DescuentoCompensacion[]>([]);
const loadingContractDiscounts = ref(false);
const contractApplicableDiscounts = computed(() =>
  contractDiscounts.value.filter((d) => d.estado === 'pendiente' && (d.contract_id === contract.value?.id || d.contract_id === null)),
);

async function loadContractDiscounts() {
  loadingContractDiscounts.value = true;
  try {
    contractDiscounts.value = await descuentosStore.fetchPendientesByClient(clientId.value);
  } finally {
    loadingContractDiscounts.value = false;
  }
}

const contractAveriaForm = ref({ monto: 0, motivo: '' });
const contractAveriaSaving = ref(false);
const contractAveriaError = ref<string | null>(null);

async function handleContractAveriaSubmit() {
  if (!contract.value || contractAveriaForm.value.monto <= 0 || !contractAveriaForm.value.motivo.trim()) return;
  contractAveriaSaving.value = true;
  contractAveriaError.value = null;
  try {
    await descuentosStore.createIndividual(clientId.value, contractAveriaForm.value.monto, contractAveriaForm.value.motivo.trim(), contract.value.id);
    contractAveriaForm.value = { monto: 0, motivo: '' };
    await loadContractDiscounts();
  } catch (e) {
    contractAveriaError.value = getErrorMessage(e, 'Error al registrar el descuento');
  } finally {
    contractAveriaSaving.value = false;
  }
}

// ---- Fotos de instalacion de esta línea (Fase 38) ----
const PHOTO_CATEGORIES: { value: ClientPhotoCategory; label: string }[] = [
  { value: 'facade', label: 'Fachada' },
  { value: 'service_sheet', label: 'Hoja de servicio' },
  { value: 'modem_position', label: 'Posicion del modem' },
  { value: 'nap_box', label: 'Caja NAP' },
];
const photos = ref<Partial<Record<ClientPhotoCategory, ClientPhotoWithUrl>>>({});
const loadingPhotos = ref(true);
const uploadingCategory = ref<ClientPhotoCategory | null>(null);
const photoError = ref<string | null>(null);

async function loadPhotos() {
  loadingPhotos.value = true;
  try {
    const list = await clientPhotosStore.fetchPhotos(contractId.value);
    photos.value = Object.fromEntries(list.map((p) => [p.category, p]));
  } catch (e) {
    photoError.value = getErrorMessage(e, 'Error al cargar las fotos');
  } finally {
    loadingPhotos.value = false;
  }
}

async function handlePhotoChange(category: ClientPhotoCategory, event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  uploadingCategory.value = category;
  photoError.value = null;
  try {
    const previous = photos.value[category];
    const updated = await clientPhotosStore.uploadPhoto(clientId.value, contractId.value, category, file, previous?.storage_path);
    photos.value[category] = updated;
  } catch (e) {
    photoError.value = getErrorMessage(e, 'Error al subir la foto');
  } finally {
    uploadingCategory.value = null;
    input.value = '';
  }
}

async function handleDeletePhoto(category: ClientPhotoCategory) {
  const photo = photos.value[category];
  if (!photo) return;
  const ok = confirm('¿Eliminar esta foto?');
  if (!ok) return;
  try {
    await clientPhotosStore.deletePhoto(photo.id, photo.storage_path);
    delete photos.value[category];
  } catch (e) {
    photoError.value = getErrorMessage(e, 'Error al eliminar la foto');
  }
}

// ---- Tickets de esta línea ----
const tickets = ref<Ticket[]>([]);
const loadingTickets = ref(true);
const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Abierto',
  in_progress: 'En progreso',
  resolved: 'Resuelto',
  closed: 'Cerrado',
};
const TICKET_STATUS_CLASS: Record<TicketStatus, string> = {
  open: 'bg-yellow-500/15 text-yellow-600',
  in_progress: 'bg-sky-500/15 text-sky-600',
  resolved: 'bg-green-500/15 text-green-600',
  closed: 'bg-slate-500/15 text-slate-600',
};

async function loadTickets() {
  loadingTickets.value = true;
  tickets.value = await ticketsStore.fetchTicketsByContract(contractId.value);
  loadingTickets.value = false;
}

// ---- Facturas de esta línea ----
const invoices = ref<Invoice[]>([]);
const loadingInvoices = ref(true);
const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  pending: 'Pendiente',
  paid: 'Pagada',
  cancelled: 'Cancelada',
};
const INVOICE_STATUS_CLASS: Record<InvoiceStatus, string> = {
  pending: 'bg-yellow-500/15 text-yellow-600',
  paid: 'bg-green-500/15 text-green-600',
  cancelled: 'bg-slate-500/15 text-slate-600',
};

async function loadInvoices() {
  loadingInvoices.value = true;
  invoices.value = await invoicesStore.fetchInvoicesByContract(contractId.value);
  loadingInvoices.value = false;
}

// ---- Pago adelantado (3+1) — ya contextualizado a este contrato ----
const showAdvanceModal = ref(false);
const advanceForm = ref({ montoTotal: 0, paymentMethod: '' });
const advanceSaving = ref(false);
const advanceError = ref<string | null>(null);
const advanceResult = ref<number | null>(null);

function openAdvanceModal() {
  if (!contract.value) return;
  advanceForm.value = { montoTotal: Number(contract.value.monthly_fee) * 3, paymentMethod: '' };
  advanceError.value = null;
  advanceResult.value = null;
  showAdvanceModal.value = true;
}

async function handleAdvanceSubmit() {
  if (!contract.value) return;
  advanceSaving.value = true;
  advanceError.value = null;
  try {
    const pago = await pagosAdelantadosStore.create({
      contractId: contract.value.id,
      clientId: clientId.value,
      montoTotal: advanceForm.value.montoTotal,
      paymentMethod: advanceForm.value.paymentMethod || undefined,
    });
    advanceResult.value = pago.invoice_ids?.length ?? 0;
    await loadInvoices();
  } catch (e) {
    advanceError.value = getErrorMessage(e, 'Error al registrar el pago adelantado');
  } finally {
    advanceSaving.value = false;
  }
}

// ---- IPTV (línea en XUI) ----
const showIptvModal = ref(false);
const iptvDetail = ref<XuiLineSummary | null>(null);
const iptvLoadingDetail = ref(false);
const iptvSaving = ref(false);
const iptvError = ref<string | null>(null);
const iptvSearchQuery = ref('');
const iptvSearchResults = ref<XuiLineSummary[]>([]);
const iptvSearching = ref(false);
const iptvCreateForm = ref({ username: '', password: '', maxConnections: '2', noExpire: true, expDate: '' });
const iptvEditForm = ref({ username: '', password: '', maxConnections: '1', noExpire: true, expDate: '', bouquetIds: [] as number[] });
const iptvBouquets = ref<XuiBouquet[]>([]);
const iptvBouquetsLoading = ref(false);
const iptvSelectedBouquets = ref<number[]>([]);

function parseBouquetIds(raw: string): number[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(Number).filter((n) => Number.isFinite(n)) : [];
  } catch {
    return [];
  }
}

async function loadIptvBouquets() {
  if (iptvBouquets.value.length || iptvBouquetsLoading.value) return;
  iptvBouquetsLoading.value = true;
  try {
    iptvBouquets.value = await xuiStore.listBouquets();
  } catch (e) {
    iptvError.value = getErrorMessage(e, 'Error al cargar los bouquets de XUI');
  } finally {
    iptvBouquetsLoading.value = false;
  }
}

function toggleIptvBouquet(id: number) {
  const idx = iptvSelectedBouquets.value.indexOf(id);
  if (idx === -1) iptvSelectedBouquets.value.push(id);
  else iptvSelectedBouquets.value.splice(idx, 1);
}

function toggleIptvEditBouquet(id: number) {
  const idx = iptvEditForm.value.bouquetIds.indexOf(id);
  if (idx === -1) iptvEditForm.value.bouquetIds.push(id);
  else iptvEditForm.value.bouquetIds.splice(idx, 1);
}

async function loadIptvDetail() {
  if (!contract.value?.xui_line_id) return;
  iptvLoadingDetail.value = true;
  iptvError.value = null;
  try {
    const [form, matches] = await Promise.all([
      xuiStore.getLine(contract.value.xui_line_id),
      contract.value.xui_username ? xuiStore.searchLines(contract.value.xui_username) : Promise.resolve([]),
      loadIptvBouquets(),
    ]);
    iptvDetail.value = matches.find((l) => l.id === contract.value?.xui_line_id) ?? null;
    iptvEditForm.value = {
      username: form.username,
      password: form.password,
      maxConnections: form.max_connections,
      noExpire: form.no_expire,
      expDate: form.exp_date,
      bouquetIds: parseBouquetIds(form.bouquets_selected),
    };
  } catch (e) {
    iptvError.value = getErrorMessage(e, 'Error al consultar la linea en XUI');
  } finally {
    iptvLoadingDetail.value = false;
  }
}

function openIptvModal() {
  if (!contract.value) return;
  iptvError.value = null;
  iptvDetail.value = null;
  iptvSearchQuery.value = '';
  iptvSearchResults.value = [];
  iptvCreateForm.value = {
    username: contract.value?.client_code ?? '',
    password: '',
    maxConnections: '2',
    noExpire: true,
    expDate: '',
  };
  iptvSelectedBouquets.value = [];
  showIptvModal.value = true;
  loadIptvBouquets();
  if (contract.value.xui_line_id) loadIptvDetail();
}

async function handleIptvSearch() {
  const q = iptvSearchQuery.value.trim();
  if (q.length < 2) {
    iptvError.value = 'Ingresa al menos 2 caracteres para buscar';
    return;
  }
  iptvSearching.value = true;
  iptvError.value = null;
  try {
    iptvSearchResults.value = await xuiStore.searchLines(q);
  } catch (e) {
    iptvError.value = getErrorMessage(e, 'Error al buscar en XUI');
  } finally {
    iptvSearching.value = false;
  }
}

async function handleIptvLink(line: XuiLineSummary) {
  if (!contract.value) return;
  iptvSaving.value = true;
  iptvError.value = null;
  try {
    contract.value = await contractsStore.updateContract(contract.value.id, { xui_line_id: line.id, xui_username: line.username });
    showIptvModal.value = false;
  } catch (e) {
    iptvError.value = getErrorMessage(e, 'Error al vincular la linea');
  } finally {
    iptvSaving.value = false;
  }
}

async function handleIptvCreate() {
  if (!contract.value) return;
  if (!iptvSelectedBouquets.value.length) {
    iptvError.value = 'Elegi al menos un bouquet (si no, el cliente no tiene canales)';
    return;
  }
  iptvSaving.value = true;
  iptvError.value = null;
  try {
    const result = await xuiStore.createLine({
      username: iptvCreateForm.value.username.trim() || undefined,
      password: iptvCreateForm.value.password.trim() || undefined,
      maxConnections: iptvCreateForm.value.maxConnections,
      noExpire: iptvCreateForm.value.noExpire,
      expDate: iptvCreateForm.value.noExpire ? undefined : iptvCreateForm.value.expDate,
      contact: client.value ? `${client.value.first_name} ${client.value.last_name}`.trim() : undefined,
      bouquetIds: iptvSelectedBouquets.value,
    });
    if (!result.id) throw new Error('XUI no devolvio el id de la nueva linea');
    const created = await xuiStore.getLine(result.id);
    contract.value = await contractsStore.updateContract(contract.value.id, { xui_line_id: result.id, xui_username: created.username });
    showIptvModal.value = false;
  } catch (e) {
    iptvError.value = getErrorMessage(e, 'Error al crear la linea en XUI');
  } finally {
    iptvSaving.value = false;
  }
}

async function handleIptvSave() {
  if (!contract.value?.xui_line_id) return;
  if (!iptvEditForm.value.bouquetIds.length) {
    iptvError.value = 'Elegi al menos un bouquet (si no, el cliente se queda sin canales)';
    return;
  }
  const lineId = contract.value.xui_line_id;
  const requestedUsername = iptvEditForm.value.username.trim();
  iptvSaving.value = true;
  iptvError.value = null;
  try {
    await xuiStore.updateLine(lineId, {
      username: requestedUsername || undefined,
      password: iptvEditForm.value.password.trim() || undefined,
      maxConnections: iptvEditForm.value.maxConnections,
      noExpire: iptvEditForm.value.noExpire,
      expDate: iptvEditForm.value.noExpire ? undefined : iptvEditForm.value.expDate,
      bouquetIds: iptvEditForm.value.bouquetIds,
    });

    const actual = await xuiStore.getLine(lineId);
    if (actual.username !== contract.value.xui_username) {
      contract.value = await contractsStore.updateContract(contract.value.id, { xui_username: actual.username });
    }
    await loadIptvDetail();

    const notApplied: string[] = [];
    if (requestedUsername && actual.username !== requestedUsername) notApplied.push(`usuario (pediste "${requestedUsername}")`);
    if (actual.max_connections !== iptvEditForm.value.maxConnections) notApplied.push('conexiones simultaneas');
    if (!iptvEditForm.value.noExpire && actual.exp_date !== iptvEditForm.value.expDate) notApplied.push('vencimiento');
    if (notApplied.length) {
      iptvError.value = `XUI dijo que guardo, pero no aplico: ${notApplied.join(', ')}. No es un bug de SmartRayco — probalo de nuevo en un rato.`;
    }
  } catch (e) {
    iptvError.value = getErrorMessage(e, 'Error al guardar los cambios de la linea');
  } finally {
    iptvSaving.value = false;
  }
}

async function handleIptvAction(action: XuiLineAction) {
  if (!contract.value?.xui_line_id) return;
  iptvSaving.value = true;
  iptvError.value = null;
  try {
    await xuiStore.lineAction(contract.value.xui_line_id, action);
    await loadIptvDetail();
  } catch (e) {
    iptvError.value = getErrorMessage(e, 'Error al ejecutar la accion sobre la linea');
  } finally {
    iptvSaving.value = false;
  }
}

async function handleIptvUnlink() {
  if (!contract.value) return;
  if (!confirm('¿Desvincular esta linea IPTV del contrato? La linea sigue existiendo en XUI, solo se quita la referencia aqui.')) return;
  iptvSaving.value = true;
  iptvError.value = null;
  try {
    contract.value = await contractsStore.updateContract(contract.value.id, { xui_line_id: null, xui_username: null });
    showIptvModal.value = false;
  } catch (e) {
    iptvError.value = getErrorMessage(e, 'Error al desvincular');
  } finally {
    iptvSaving.value = false;
  }
}

onMounted(async () => {
  if (!clientsStore.clients.length) await clientsStore.fetchClients();
  await Promise.all([
    catalogs.fetchPlans(),
    catalogs.fetchZones(),
    contractsStore.fetchContracts(),
    loadContract(),
    loadTickets(),
    loadInvoices(),
    loadUnits(),
    loadOnts(),
    loadPhotos(),
    mikrotikStore.fetchDevices(),
    oltStore.fetchDevices().catch(() => {}),
    inventoryStore.products.length ? Promise.resolve() : inventoryStore.fetchProducts(),
    infraStore.fetchElementos(),
    fibra.fetchTodosNapPuertos(),
  ]);
  if (contract.value) fillFormFromContract(contract.value);
});
</script>

<template>
  <component :is="embedded ? 'div' : AppLayout">
    <router-link
      v-if="!embedded"
      :to="`/clientes/${clientId}`"
      class="text-sm text-slate-600 hover:text-slate-900 mb-2 inline-block"
    >
      ← {{ client?.first_name }} {{ client?.last_name }}
      <span v-if="client">· {{ DOCUMENT_TYPE_LABEL[client.document_type] }} {{ client.document_number }}</span>
      · otros servicios
    </router-link>

    <p v-if="loadingContract" class="text-slate-500">Cargando...</p>
    <div v-else-if="!contract" class="text-slate-500">Servicio no encontrado.</div>
    <template v-else>
      <div class="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h2 class="font-mono" :class="embedded ? 'text-sm text-slate-500' : 'text-2xl font-semibold'">{{ contract.contract_number }}</h2>
          <p class="text-slate-600 text-sm mt-1">
            {{ contract.installation_address || 'Sin dirección registrada' }}
            <span v-if="contract.installation_reference"> · {{ contract.installation_reference }}</span>
          </p>
        </div>
        <div class="flex items-center gap-2">
          <span class="badge" :class="STATUS_CLASS[contract.status]">{{ STATUS_LABEL[contract.status] }}</span>
          <button v-if="canDeleteContracts" type="button" class="text-xs text-red-500/80 hover:text-red-600" @click="handleDeleteContract">
            Eliminar
          </button>
        </div>
      </div>

      <nav class="flex gap-1 border-b border-slate-200 mb-6 overflow-x-auto">
        <button
          v-for="tab in TABS"
          :key="tab.value"
          type="button"
          class="px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap"
          :class="
            activeTab === tab.value
              ? 'border-sky-500 text-sky-600 font-medium'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          "
          @click="activeTab = tab.value"
        >
          {{ tab.label }}
        </button>
      </nav>

      <!-- ---- Resumen ---- -->
      <div v-if="activeTab === 'resumen'">
        <ClientSectionCard title="Datos del servicio" icon="🛠️">
          <template #actions>
            <button type="button" class="text-xs text-sky-600 hover:underline" @click="activeTab = 'datos'">Editar</button>
          </template>
          <div class="grid gap-4 text-sm" style="grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))">
            <div>
              <div class="text-xs text-slate-500 mb-1">Estado</div>
              <span class="badge" :class="STATUS_CLASS[contract.status]">{{ STATUS_LABEL[contract.status] }}</span>
            </div>
            <div>
              <div class="text-xs text-slate-500 mb-1">Prioridad</div>
              <span class="badge" :class="PRIORITY_CLASS[contract.priority]">{{ PRIORITY_LABEL[contract.priority] }}</span>
            </div>
            <div>
              <div class="text-xs text-slate-500 mb-1">Plan</div>
              <div class="font-medium">{{ contract.plans?.name || 'Sin plan' }}</div>
            </div>
            <div>
              <div class="text-xs text-slate-500 mb-1">Mensualidad</div>
              <div class="font-medium">S/ {{ Number(contract.monthly_fee).toFixed(2) }}</div>
            </div>
            <div>
              <div class="text-xs text-slate-500 mb-1">Método de pago</div>
              <div class="font-medium">{{ contract.payment_method ? (PAYMENT_METHOD_LABEL[contract.payment_method] ?? contract.payment_method) : '—' }}</div>
            </div>
            <div>
              <div class="text-xs text-slate-500 mb-1">Código de cliente</div>
              <div class="font-mono">{{ contract.client_code || '—' }}</div>
            </div>
            <div>
              <div class="text-xs text-slate-500 mb-1">IPTV</div>
              <div :class="contract.xui_line_id ? 'text-emerald-600 font-mono' : 'text-slate-400'">{{ contract.xui_username || 'Sin vincular' }}</div>
            </div>
          </div>
        </ClientSectionCard>

        <ClientSectionCard title="Ubicación" icon="📍">
          <template #actions>
            <button type="button" class="text-xs text-sky-600 hover:underline" @click="activeTab = 'ubicacion'">Editar</button>
          </template>
          <p class="text-sm">
            {{ contract.installation_address || 'Sin dirección registrada' }}
            <span v-if="contract.installation_reference"> · {{ contract.installation_reference }}</span>
          </p>
        </ClientSectionCard>
      </div>

      <!-- ---- Datos del servicio ---- -->
      <div v-if="activeTab === 'datos'">
      <ClientSectionCard title="Datos generales" icon="⚙️">
      <div class="max-w-lg">
        <div class="mb-3">
          <label class="block text-xs text-slate-600 mb-1">Prioridad</label>
          <select v-model="contractForm.priority" class="field-input">
            <option v-for="(label, value) in PRIORITY_LABEL" :key="value" :value="value">{{ label }}</option>
          </select>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div>
            <label class="block text-xs text-slate-600 mb-1">Router MikroTik</label>
            <select v-model="contractForm.mikrotik_device_id" class="field-input" @change="onMikrotikDeviceChange">
              <option value="">Sin vincular</option>
              <option v-for="d in mikrotikStore.devices" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-slate-600 mb-1">Usuario PPPoE</label>
            <select
              v-model="contractForm.pppoe_username"
              :disabled="!contractForm.mikrotik_device_id || loadingSecrets"
              class="field-input disabled:opacity-60"
            >
              <option value="">{{ loadingSecrets ? 'Cargando...' : 'Sin vincular' }}</option>
              <option v-for="s in availableSecrets" :key="s['.id']" :value="s.name">{{ s.name }}</option>
            </select>
          </div>
        </div>

        <div class="mb-4">
          <div class="flex items-center justify-between mb-1">
            <label class="block text-xs text-slate-600">Perfil PPPoE (MikroTik)</label>
            <button
              v-if="contractForm.mikrotik_device_id"
              type="button"
              class="text-xs text-sky-600 hover:underline whitespace-nowrap"
              :disabled="loadingProfiles"
              @click="loadPppProfilesForModal(contractForm.mikrotik_device_id)"
            >
              {{ loadingProfiles ? 'Sincronizando...' : 'Sincronizar perfiles' }}
            </button>
          </div>
          <input
            v-model="contractForm.mikrotik_profile"
            list="contract-mikrotik-profile-options"
            :disabled="!contractForm.mikrotik_device_id"
            class="field-input disabled:opacity-60"
            placeholder="Nombre del profile en RouterOS"
          />
          <datalist id="contract-mikrotik-profile-options">
            <option v-for="name in profileNames" :key="name" :value="name" />
          </datalist>
          <p class="text-xs text-slate-500 mt-1">
            Solo cambia el profile PPPoE en MikroTik (el ancho de banda del cliente se controla desde la OLT).
          </p>
          <p v-if="profilesError" class="text-xs text-amber-600 mt-1">{{ profilesError }} — puedes escribir el nombre manualmente.</p>
        </div>

        <div
          class="mb-4 flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
          :class="contract.xui_line_id ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-slate-50'"
        >
          <div class="flex items-center gap-3">
            <span
              class="w-11 h-11 rounded-full flex items-center justify-center text-2xl shrink-0"
              :class="contract.xui_line_id ? 'bg-emerald-500/15 text-emerald-600' : 'bg-slate-300/50 text-slate-500'"
            >
              📺
            </span>
            <div>
              <div class="text-sm font-semibold" :class="contract.xui_line_id ? 'text-emerald-700' : 'text-slate-500'">IPTV</div>
              <div class="text-sm" :class="contract.xui_line_id ? 'text-slate-700 font-mono' : 'text-slate-400'">
                {{ contract.xui_username || 'Sin vincular' }}
              </div>
            </div>
          </div>
          <button type="button" class="btn-secondary text-xs whitespace-nowrap" @click="openIptvModal">
            {{ contract.xui_line_id ? 'Gestionar' : 'Vincular' }}
          </button>
        </div>

        <div class="mb-3">
          <label class="block text-xs text-slate-600 mb-1">Código de cliente (de este servicio)</label>
          <input v-model="contractForm.client_code" placeholder="Ej. CL-0001" class="field-input" />
          <p class="text-xs text-slate-400 mt-1">Un mismo titular puede tener varios servicios, cada uno con su propio código.</p>
        </div>

        <div class="mb-3">
          <label class="block text-xs text-slate-600 mb-1">Estado</label>
          <select v-model="contractForm.status" class="field-input">
            <option v-for="(label, value) in STATUS_LABEL" :key="value" :value="value">{{ label }}</option>
          </select>
        </div>

        <div class="mb-3">
          <label class="block text-xs text-slate-600 mb-1">Plan</label>
          <select v-model="contractForm.plan_id" required class="field-input" @change="onPlanChange">
            <option value="" disabled>Selecciona un plan</option>
            <option v-for="p in catalogs.plans" :key="p.id" :value="p.id">
              {{ p.name }} — ↓{{ p.download_speed }}/↑{{ p.upload_speed }} Mbps — S/ {{ Number(p.price).toFixed(2) }}
            </option>
          </select>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label class="block text-xs text-slate-600 mb-1">Mensualidad (S/)</label>
            <input v-model.number="contractForm.monthly_fee" type="number" step="0.01" min="0" required class="field-input" />
          </div>
          <div>
            <label class="block text-xs text-slate-600 mb-1">Dia de corte</label>
            <input v-model.number="contractForm.billing_day" type="number" min="1" max="28" required class="field-input" />
          </div>
        </div>

        <div>
          <label class="block text-xs text-slate-600 mb-1">Metodo de pago</label>
          <select v-model="contractForm.payment_method" class="field-input">
            <option value="cash">Efectivo</option>
            <option value="transfer">Transferencia</option>
            <option value="card">Tarjeta</option>
          </select>
        </div>
      </div>
      </ClientSectionCard>
      </div>

      <!-- ---- Ubicación ---- -->
      <div v-if="activeTab === 'ubicacion'">
      <ClientSectionCard title="Ubicación, zona y NAP" icon="📍">
      <div class="max-w-lg">
        <p class="text-xs text-slate-500 mb-3">
          Ubicación de ESTA instalación — si el cliente tiene más de un servicio, cada uno tiene su propia dirección/GPS.
        </p>
        <div class="mb-3">
          <label class="block text-xs text-slate-600 mb-1">Dirección</label>
          <input v-model="contractForm.installation_address" class="field-input" placeholder="Calle, número, sector" />
        </div>
        <div class="mb-3">
          <label class="block text-xs text-slate-600 mb-1">Referencia</label>
          <input v-model="contractForm.installation_reference" class="field-input" placeholder="Ej. casa azul, portón negro" />
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
          <div>
            <label class="block text-xs text-slate-600 mb-1">Latitud</label>
            <input v-model.number="contractForm.latitude" type="number" step="any" class="field-input" />
          </div>
          <div>
            <label class="block text-xs text-slate-600 mb-1">Longitud</label>
            <input v-model.number="contractForm.longitude" type="number" step="any" class="field-input" />
          </div>
        </div>
        <a
          v-if="contractForm.latitude && contractForm.longitude"
          :href="`https://www.google.com/maps?q=${contractForm.latitude},${contractForm.longitude}`"
          target="_blank"
          rel="noopener"
          class="text-xs text-sky-600 hover:underline mb-4 inline-block"
        >
          Ver en Google Maps
        </a>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3 pt-3 border-t border-slate-200">
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="block text-xs text-slate-600">Zona</label>
              <button type="button" class="text-xs text-sky-600 hover:text-sky-700" @click="showNewZone = !showNewZone">
                {{ showNewZone ? 'Cancelar' : '+ Nueva zona' }}
              </button>
            </div>
            <select v-if="!showNewZone" v-model="contractForm.zone_id" class="field-input" @change="onZoneChange">
              <option value="">Sin asignar</option>
              <option v-for="z in catalogs.zones" :key="z.id" :value="z.id">{{ z.name }}</option>
            </select>
            <p
              v-if="selectedZoneCount !== null"
              class="text-xs mt-1"
              :class="selectedZoneCount >= ZONE_CLIENT_LIMIT ? 'text-red-600' : selectedZoneCount >= ZONE_CLIENT_LIMIT * 0.9 ? 'text-amber-600' : 'text-slate-400'"
            >
              {{ selectedZoneCount }} / {{ ZONE_CLIENT_LIMIT }} servicios en esa zona
              <span v-if="selectedZoneCount >= ZONE_CLIENT_LIMIT">— límite alcanzado</span>
            </p>
            <div v-if="showNewZone" class="flex gap-2 mt-1">
              <input
                v-model="newZoneName"
                placeholder="Nombre de la zona"
                class="flex-1 min-w-0 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                @keydown.enter.prevent="handleCreateZone"
              />
              <button
                type="button"
                :disabled="savingZone || !newZoneName.trim()"
                class="px-3 py-2 rounded-lg bg-sky-500 text-slate-950 text-sm font-semibold disabled:opacity-60"
                @click="handleCreateZone"
              >
                {{ savingZone ? '...' : 'Agregar' }}
              </button>
            </div>
          </div>
          <div>
            <label class="block text-xs text-slate-600 mb-1">Caja NAP</label>
            <select v-model="napId" class="field-input" :disabled="!contractForm.zone_id">
              <option value="">Sin asignar</option>
              <option v-for="n in napOptions" :key="n.id" :value="n.id">
                {{ n.name }} — {{ n.used }}/{{ n.capacity }}{{ n.used >= n.capacity ? ' (LLENA)' : '' }}
              </option>
            </select>
            <p v-if="!contractForm.zone_id" class="text-xs text-slate-400 mt-1">Elige primero una zona para ver sus cajas NAP.</p>
            <p v-else-if="!napOptions.length" class="text-xs text-slate-400 mt-1">Esa zona no tiene cajas NAP asignadas (ver /mapa/red).</p>
            <p v-if="currentNapMismatch" class="text-xs text-amber-600 mt-1">
              ⚠ Sigue asignado a "{{ currentNapMismatch.name }}", que ya no pertenece a esta zona.
            </p>
          </div>
        </div>
        <p v-if="zoneNapError" class="text-sm text-red-600 mb-3">{{ zoneNapError }}</p>
      </div>
      </ClientSectionCard>
      </div>

      <!-- ---- Equipo (parte de "Datos del servicio") ---- -->
      <div v-if="activeTab === 'datos'">
      <ClientSectionCard title="ONT y equipo asignado" icon="📡">
      <div class="max-w-2xl">
        <p v-if="equipoTabError" class="text-sm text-red-600 mb-3">{{ equipoTabError }}</p>

        <h3 class="text-sm font-semibold mb-2">ONT (OLT)</h3>
        <p v-if="loadingOnts" class="text-sm text-slate-500 mb-3">Cargando...</p>
        <template v-else>
          <div
            v-for="ont in contractOnts"
            :key="ont.id"
            class="flex items-center justify-between text-sm border border-slate-200 rounded-lg px-3 py-2 mb-2"
          >
            <div>
              <span class="font-mono text-xs">{{ ont.serial }}</span>
              <span class="text-slate-500 text-xs ml-2">{{ ont.plans?.name || 'Sin plan asignado' }}</span>
              <span
                class="badge ml-2"
                :class="ont.status === 'online' ? 'bg-green-500/15 text-green-600' : ont.status === 'offline' ? 'bg-red-500/15 text-red-600' : 'bg-slate-500/15 text-slate-600'"
              >
                {{ ont.status === 'online' ? 'En linea' : ont.status === 'offline' ? 'Desconectada' : 'Desconocido' }}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <button v-if="canChangeOntPlan" type="button" class="text-xs text-sky-600 hover:underline" @click="openOntPlanModal(ont)">
                Cambiar plan
              </button>
              <button type="button" class="text-xs text-red-600 hover:underline" :disabled="equipoTabSaving" @click="handleUnassignOntFromContract(ont)">
                Quitar
              </button>
            </div>
          </div>
          <p v-if="!contractOnts.length" class="text-sm text-slate-500 mb-2">Sin ONT vinculada a esta línea.</p>

          <div v-if="contractOtherOnts.length" class="flex gap-2 mb-4">
            <select v-model="reassignOntId" class="field-input">
              <option value="">Vincular una ONT del cliente...</option>
              <option v-for="ont in contractOtherOnts" :key="ont.id" :value="ont.id">
                {{ ont.serial }} {{ ont.contract_id ? '(en otra línea)' : '(sin línea asignada)' }}
              </option>
            </select>
            <button type="button" class="btn-ghost whitespace-nowrap" :disabled="!reassignOntId || equipoTabSaving" @click="handleAssignOntToContract">
              Asignar
            </button>
          </div>

          <div v-if="canChangeOntPlan" class="mb-6">
            <p class="text-xs text-slate-500 mb-2">
              O busca una ONT nueva ya registrada en la OLT (la mayoría vienen de un import masivo sin cliente asignado):
            </p>
            <div class="flex gap-2 mb-2 max-w-md">
              <input v-model="ontSearchQuery" placeholder="Numero de serie (min. 3 caracteres)" class="field-input" @keyup.enter="handleSearchOnt" />
              <button type="button" class="btn-secondary whitespace-nowrap" :disabled="searchingOnt" @click="handleSearchOnt">
                {{ searchingOnt ? 'Buscando...' : 'Buscar' }}
              </button>
            </div>
            <p v-if="ontLinkError" class="text-xs text-amber-600 mb-2">{{ ontLinkError }}</p>
            <div v-if="ontSearchResults.length" class="table-shell max-w-lg">
              <table class="w-full text-sm">
                <tbody>
                  <tr v-for="r in ontSearchResults" :key="r.id" class="border-t border-slate-200">
                    <td class="px-3 py-2 font-mono text-xs">{{ r.serial }}</td>
                    <td class="px-3 py-2 text-xs text-slate-600">{{ r.olt_devices?.name }} · {{ r.slot }}/{{ r.port }}</td>
                    <td class="px-3 py-2 text-right">
                      <button type="button" class="text-xs text-sky-600 hover:underline" :disabled="linkingOntId === r.id" @click="handleLinkOnt(r)">
                        {{ linkingOntId === r.id ? 'Vinculando...' : 'Vincular a esta línea' }}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>

        <div class="flex items-center justify-between mb-2">
          <h3 class="text-sm font-semibold">Equipo de inventario (router/ONU)</h3>
          <button type="button" class="text-xs text-sky-600 hover:text-sky-700" @click="openAddUnit">+ Agregar equipo</button>
        </div>
        <p v-if="loadingUnits" class="text-sm text-slate-500">Cargando...</p>
        <template v-else>
          <div v-for="u in contractUnits" :key="u.id" class="flex items-center justify-between text-sm border border-slate-200 rounded-lg px-3 py-2 mb-2">
            <div>
              <span class="font-mono text-xs">{{ u.serial_number || u.mac_address }}</span>
              <span class="text-slate-500 text-xs ml-2">{{ u.product?.name ?? 'Equipo' }}</span>
              <span class="badge ml-2" :class="UNIT_STATUS_CLASS[u.status]">{{ UNIT_STATUS_LABEL[u.status] }}</span>
            </div>
            <div class="flex items-center gap-2">
              <button v-if="u.status === 'assigned'" type="button" class="text-xs text-amber-600 hover:text-amber-700" @click="openReturn(u)">
                Devolución
              </button>
              <button type="button" class="text-xs text-red-600 hover:underline" :disabled="equipoTabSaving" @click="handleUnassignUnitFromContract(u)">
                Quitar
              </button>
            </div>
          </div>
          <p v-if="!contractUnits.length" class="text-sm text-slate-500 mb-2">Sin equipo de inventario vinculado a esta línea.</p>

          <div v-if="contractOtherUnits.length" class="flex gap-2">
            <select v-model="reassignUnitId" class="field-input">
              <option value="">Vincular un equipo del cliente...</option>
              <option v-for="u in contractOtherUnits" :key="u.id" :value="u.id">
                {{ u.serial_number || u.mac_address }} {{ u.contract_id ? '(en otra línea)' : '(sin línea asignada)' }}
              </option>
            </select>
            <button type="button" class="btn-ghost whitespace-nowrap" :disabled="!reassignUnitId || equipoTabSaving" @click="handleAssignUnitToContract">
              Asignar
            </button>
          </div>
        </template>
      </div>
      </ClientSectionCard>
      </div>

      <!-- Barra de guardado (Datos del servicio / Ubicación comparten el mismo contractForm) -->
      <div
        v-if="activeTab === 'datos' || activeTab === 'ubicacion'"
        class="sticky bottom-0 z-10 -mx-4 sm:mx-0 mt-2 mb-6 border-t border-slate-200 bg-white/95 backdrop-blur px-4 sm:px-0 py-3 flex items-center justify-between gap-3"
      >
        <p v-if="contractError" class="text-sm text-red-600">{{ contractError }}</p>
        <p v-else class="text-xs text-slate-400">Los cambios se guardan para todo el servicio (no solo esta pestaña).</p>
        <button type="button" :disabled="savingContract" class="btn-primary shrink-0" @click="handleSaveContract">
          {{ savingContract ? 'Guardando...' : 'Guardar cambios' }}
        </button>
      </div>

      <!-- ---- Facturación: Descuentos ---- -->
      <div v-if="activeTab === 'facturacion'">
      <ClientSectionCard title="Descuentos" icon="🏷️">
      <div class="max-w-lg">
        <h3 class="text-sm font-semibold mb-2">Descuentos que aplican a la próxima factura</h3>
        <p v-if="loadingContractDiscounts" class="text-sm text-slate-500 mb-2">Cargando...</p>
        <p v-else-if="!contractApplicableDiscounts.length" class="text-sm text-slate-500 mb-2">Sin descuentos pendientes.</p>
        <div v-for="d in contractApplicableDiscounts" :key="d.id" class="text-sm border border-slate-200 rounded-lg px-3 py-2 mb-2">
          <div class="flex items-center justify-between">
            <span>{{ d.motivo }}</span>
            <span class="font-mono">S/ {{ Number(d.monto).toFixed(2) }}</span>
          </div>
          <span class="text-[11px] text-slate-500">{{ d.contract_id ? 'Solo esta línea' : 'Todo el cliente' }}</span>
        </div>

        <h3 v-if="canApplyAveria" class="text-sm font-semibold mt-6 mb-2">Nuevo descuento para esta línea</h3>
        <template v-if="canApplyAveria">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
            <input v-model.number="contractAveriaForm.monto" type="number" step="0.01" min="0.01" placeholder="Monto (S/)" class="field-input" />
            <button
              type="button"
              class="btn-primary"
              :disabled="contractAveriaSaving || contractAveriaForm.monto <= 0 || !contractAveriaForm.motivo.trim()"
              @click="handleContractAveriaSubmit"
            >
              {{ contractAveriaSaving ? 'Guardando...' : 'Aplicar' }}
            </button>
          </div>
          <input v-model="contractAveriaForm.motivo" placeholder="Motivo (ej. avería fibra 12/09)" class="field-input mb-2" />
          <p v-if="contractAveriaError" class="text-sm text-red-600">{{ contractAveriaError }}</p>
          <p class="text-xs text-slate-500 mt-1">Solo afecta las facturas de esta línea, no las demás del cliente.</p>
        </template>
      </div>
      </ClientSectionCard>

      <!-- ---- Facturación: Facturas ---- -->
      <ClientSectionCard title="Facturas" icon="🧾">
        <template #actions>
          <div class="flex items-center gap-3">
            <button v-if="canRegisterAdvancePayment" type="button" class="text-xs text-sky-600 hover:text-sky-700" @click="openAdvanceModal">
              Pago adelantado (3+1)
            </button>
            <router-link to="/facturacion" class="text-xs text-sky-600 hover:text-sky-700">+ Nueva factura</router-link>
          </div>
        </template>
        <p v-if="loadingInvoices" class="text-slate-500 text-sm">Cargando...</p>
        <p v-else-if="!invoices.length" class="text-slate-500 text-sm">Esta línea aun no tiene facturas.</p>
        <div v-else class="table-shell">
          <table class="w-full text-sm min-w-[560px]">
            <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
              <tr>
                <th class="text-left px-4 py-3">Factura</th>
                <th class="text-left px-4 py-3">Periodo</th>
                <th class="text-left px-4 py-3">Monto</th>
                <th class="text-left px-4 py-3">Vence</th>
                <th class="text-left px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="inv in invoices" :key="inv.id" class="border-t border-slate-200 hover:bg-slate-50 cursor-pointer" @click="router.push('/facturacion')">
                <td class="px-4 py-3 font-mono text-xs">{{ inv.invoice_number }}</td>
                <td class="px-4 py-3 text-slate-600 text-xs">{{ inv.period_start }} → {{ inv.period_end }}</td>
                <td class="px-4 py-3">S/ {{ Number(inv.amount).toFixed(2) }}</td>
                <td class="px-4 py-3 text-slate-600">{{ inv.due_date }}</td>
                <td class="px-4 py-3">
                  <span class="badge" :class="INVOICE_STATUS_CLASS[inv.status]">{{ INVOICE_STATUS_LABEL[inv.status] }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </ClientSectionCard>
      </div>

      <!-- ---- Fotos ---- -->
      <div v-if="activeTab === 'fotos'">
      <ClientSectionCard title="Fotos de instalación" icon="📷">
        <p v-if="photoError" class="mb-3 text-sm text-red-600">{{ photoError }}</p>
        <div class="grid gap-4" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))">
          <div v-for="cat in PHOTO_CATEGORIES" :key="cat.value" class="surface p-4">
            <div class="text-slate-500 text-xs mb-2">{{ cat.label }}</div>
            <a v-if="photos[cat.value]?.url" :href="photos[cat.value]!.url!" target="_blank" rel="noopener">
              <img :src="photos[cat.value]!.url!" class="w-full h-32 object-cover rounded-lg mb-2" />
            </a>
            <label
              v-else
              class="w-full h-32 rounded-lg border-2 border-dashed border-slate-300 flex flex-col items-center justify-center gap-1 text-xs text-slate-400 mb-2 cursor-pointer transition-colors hover:border-sky-400 hover:bg-sky-50/50 hover:text-sky-600"
              :class="{ 'opacity-60 pointer-events-none': uploadingCategory === cat.value }"
            >
              <span class="text-2xl">📷</span>
              <span>{{ uploadingCategory === cat.value ? 'Subiendo...' : 'Sin foto' }}</span>
              <input type="file" accept="image/*" class="hidden" @change="handlePhotoChange(cat.value, $event)" />
            </label>
            <div class="flex gap-2">
              <label
                class="flex-1 text-center px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs cursor-pointer"
                :class="{ 'opacity-60 pointer-events-none': uploadingCategory === cat.value }"
              >
                {{ uploadingCategory === cat.value ? 'Subiendo...' : photos[cat.value] ? 'Reemplazar' : 'Subir foto' }}
                <input type="file" accept="image/*" class="hidden" @change="handlePhotoChange(cat.value, $event)" />
              </label>
              <button
                v-if="photos[cat.value]"
                class="px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-red-500/20 text-red-600 text-xs"
                @click="handleDeletePhoto(cat.value)"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      </ClientSectionCard>
      </div>

      <!-- ---- Soporte ---- -->
      <div v-if="activeTab === 'soporte'">
      <ClientSectionCard title="Tickets de soporte" icon="🎫">
        <template #actions>
          <router-link
            v-if="canCreateTickets"
            :to="`/soporte?client_id=${clientId}&contract_id=${contractId}`"
            class="text-xs text-sky-600 hover:text-sky-700"
          >
            + Nuevo ticket
          </router-link>
        </template>
        <p v-if="loadingTickets" class="text-slate-500 text-sm">Cargando...</p>
        <p v-else-if="!tickets.length" class="text-slate-500 text-sm">Esta línea aun no tiene tickets.</p>
        <div v-else class="table-shell">
          <table class="w-full text-sm min-w-[560px]">
            <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
              <tr>
                <th class="text-left px-4 py-3">Ticket</th>
                <th class="text-left px-4 py-3">Título</th>
                <th class="text-left px-4 py-3">Creado</th>
                <th class="text-left px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in tickets" :key="t.id" class="border-t border-slate-200 hover:bg-slate-50 cursor-pointer" @click="router.push(`/soporte/${t.id}`)">
                <td class="px-4 py-3 font-mono text-xs">{{ t.ticket_number }}</td>
                <td class="px-4 py-3">{{ t.title }}</td>
                <td class="px-4 py-3 text-slate-600">{{ t.created_at.slice(0, 10) }}</td>
                <td class="px-4 py-3">
                  <span class="badge" :class="TICKET_STATUS_CLASS[t.status]">{{ TICKET_STATUS_LABEL[t.status] }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </ClientSectionCard>
      </div>
    </template>

    <Teleport to="body">
      <div v-if="showIptvModal" class="modal-overlay">
        <div class="w-full max-w-md modal-panel max-h-[90vh] overflow-y-auto">
          <h2 class="text-lg font-semibold mb-1">IPTV (XUI)</h2>
          <p class="text-xs text-slate-500 mb-4 font-mono">{{ contract?.contract_number }}</p>

          <p v-if="iptvError" class="text-sm text-red-600 mb-3">{{ iptvError }}</p>

          <template v-if="contract?.xui_line_id">
            <p v-if="iptvLoadingDetail" class="text-sm text-slate-500 mb-3">Consultando XUI...</p>
            <div v-else-if="iptvDetail" class="mb-4 text-sm space-y-1">
              <p><span class="text-slate-500">Usuario:</span> <span class="font-mono">{{ iptvDetail.username }}</span></p>
              <p><span class="text-slate-500">Password:</span> <span class="font-mono">{{ iptvDetail.password }}</span></p>
              <p><span class="text-slate-500">Estado:</span> {{ iptvDetail.status || '—' }}</p>
              <p><span class="text-slate-500">Conexiones max:</span> {{ iptvDetail.maxConnections || '—' }}</p>
              <p><span class="text-slate-500">Vencimiento:</span> {{ iptvDetail.expiration || 'Sin vencimiento' }}</p>
              <p><span class="text-slate-500">Ultima conexion:</span> {{ iptvDetail.lastConnection || '—' }}</p>
            </div>
            <p v-else class="text-sm text-amber-600 mb-3">No se pudo cargar el detalle de la linea.</p>

            <div class="flex flex-wrap gap-2 mb-4">
              <button type="button" class="btn-ghost text-xs" :disabled="iptvSaving" @click="handleIptvAction('disable')">Suspender</button>
              <button type="button" class="btn-ghost text-xs" :disabled="iptvSaving" @click="handleIptvAction('enable')">Reactivar</button>
              <button type="button" class="btn-ghost text-xs" :disabled="iptvSaving" @click="handleIptvAction('kill')">Matar conexiones</button>
            </div>

            <form class="mb-4 border-t border-slate-200 pt-3 space-y-2" @submit.prevent="handleIptvSave">
              <label class="block text-xs text-slate-600 mb-1">Editar linea</label>
              <div>
                <label class="block text-xs text-slate-500 mb-1">Usuario</label>
                <input v-model="iptvEditForm.username" class="field-input" />
              </div>
              <div>
                <label class="block text-xs text-slate-500 mb-1">Password</label>
                <input v-model="iptvEditForm.password" class="field-input" />
              </div>
              <div>
                <label class="block text-xs text-slate-500 mb-1">Conexiones simultaneas</label>
                <input v-model="iptvEditForm.maxConnections" type="number" min="1" class="field-input" />
              </div>
              <div>
                <label class="block text-xs text-slate-500 mb-1">Bouquets (canales)</label>
                <p v-if="iptvBouquetsLoading" class="text-xs text-slate-500">Cargando bouquets...</p>
                <p v-else-if="!iptvBouquets.length" class="text-xs text-amber-600">No hay bouquets configurados en XUI.</p>
                <div v-else class="space-y-1 border border-slate-200 rounded p-2">
                  <label v-for="bq in iptvBouquets" :key="bq.id" class="flex items-center gap-2 text-xs">
                    <input type="checkbox" :checked="iptvEditForm.bouquetIds.includes(bq.id)" @change="toggleIptvEditBouquet(bq.id)" />
                    {{ bq.name }} <span class="text-slate-400">({{ bq.streamCount }} canales)</span>
                  </label>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <input id="iptv-no-expire" v-model="iptvEditForm.noExpire" type="checkbox" />
                <label for="iptv-no-expire" class="text-xs text-slate-600">Sin vencimiento</label>
              </div>
              <input v-if="!iptvEditForm.noExpire" v-model="iptvEditForm.expDate" type="text" placeholder="YYYY-MM-DD HH:MM:SS" class="field-input" />
              <button type="submit" :disabled="iptvSaving" class="btn-primary text-xs w-full">
                {{ iptvSaving ? 'Guardando...' : 'Guardar cambios' }}
              </button>
            </form>

            <button type="button" class="text-xs text-red-600 hover:underline" @click="handleIptvUnlink">Desvincular del contrato</button>
          </template>

          <template v-else>
            <div class="mb-4">
              <label class="block text-xs text-slate-600 mb-1">Buscar linea existente por usuario</label>
              <div class="flex gap-2">
                <input v-model="iptvSearchQuery" class="field-input" placeholder="usuario XUI" @keyup.enter="handleIptvSearch" />
                <button type="button" class="btn-ghost text-xs whitespace-nowrap" :disabled="iptvSearching" @click="handleIptvSearch">
                  {{ iptvSearching ? 'Buscando...' : 'Buscar' }}
                </button>
              </div>
              <ul v-if="iptvSearchResults.length" class="mt-2 divide-y divide-slate-200 border border-slate-200 rounded">
                <li v-for="line in iptvSearchResults" :key="line.id" class="flex items-center justify-between px-2 py-1.5 text-xs">
                  <span class="font-mono">{{ line.username }} <span class="text-slate-400">({{ line.owner }})</span></span>
                  <button type="button" class="text-sky-600 hover:underline" :disabled="iptvSaving" @click="handleIptvLink(line)">Vincular</button>
                </li>
              </ul>
            </div>

            <div class="border-t border-slate-200 pt-3">
              <p class="text-xs text-slate-600 mb-2">O crear una linea nueva</p>
              <form class="space-y-2" @submit.prevent="handleIptvCreate">
                <input v-model="iptvCreateForm.username" class="field-input" placeholder="Usuario (vacio = autogenerar)" />
                <input v-model="iptvCreateForm.password" class="field-input" placeholder="Password (vacio = autogenerar)" />
                <input v-model="iptvCreateForm.maxConnections" type="number" min="1" class="field-input" placeholder="Conexiones simultaneas" />
                <div class="flex items-center gap-2">
                  <input id="iptv-create-no-expire" v-model="iptvCreateForm.noExpire" type="checkbox" />
                  <label for="iptv-create-no-expire" class="text-xs text-slate-600">Sin vencimiento</label>
                </div>
                <input v-if="!iptvCreateForm.noExpire" v-model="iptvCreateForm.expDate" type="text" placeholder="YYYY-MM-DD HH:MM:SS" class="field-input" />
                <div>
                  <label class="block text-xs text-slate-600 mb-1">Bouquets (canales a asignar)</label>
                  <p v-if="iptvBouquetsLoading" class="text-xs text-slate-500">Cargando bouquets...</p>
                  <p v-else-if="!iptvBouquets.length" class="text-xs text-amber-600">No hay bouquets configurados en XUI.</p>
                  <div v-else class="space-y-1 border border-slate-200 rounded p-2">
                    <label v-for="bq in iptvBouquets" :key="bq.id" class="flex items-center gap-2 text-xs">
                      <input type="checkbox" :checked="iptvSelectedBouquets.includes(bq.id)" @change="toggleIptvBouquet(bq.id)" />
                      {{ bq.name }} <span class="text-slate-400">({{ bq.streamCount }} canales)</span>
                    </label>
                  </div>
                </div>
                <button type="submit" :disabled="iptvSaving" class="btn-primary text-xs w-full">
                  {{ iptvSaving ? 'Creando...' : 'Crear linea' }}
                </button>
              </form>
            </div>
          </template>

          <div class="flex justify-end mt-4">
            <button type="button" class="btn-ghost" @click="showIptvModal = false">Cerrar</button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showOntPlanModal" class="modal-overlay">
        <form class="w-full max-w-sm modal-panel" @submit.prevent="handleSaveOntPlan">
          <h2 class="text-lg font-semibold mb-1">Cambiar plan</h2>
          <p class="text-xs text-slate-500 mb-4 font-mono">ONT {{ ontPlanTarget?.serial }}</p>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Plan</label>
            <select v-model="ontPlanValue" required class="field-input">
              <option value="" disabled>Selecciona un plan</option>
              <option v-for="p in plansWithOltProfile" :key="p.id" :value="p.id">
                {{ p.name }} — ↓{{ p.download_speed }}/↑{{ p.upload_speed }} Mbps
              </option>
            </select>
            <p v-if="!plansWithOltProfile.length" class="text-xs text-amber-600 mt-1">
              Ningun plan tiene perfiles OLT configurados todavia (ver seccion Planes → Perfiles de ancho de banda).
            </p>
            <p class="text-xs text-slate-500 mt-1">
              Aplica de inmediato el ancho de banda real en la OLT (perfiles tcont/traffic del plan elegido).
            </p>
          </div>

          <p v-if="ontPlanError" class="text-sm text-red-600 mb-3">{{ ontPlanError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showOntPlanModal = false">Cancelar</button>
            <button type="submit" :disabled="savingOntPlan || !plansWithOltProfile.length" class="btn-primary">
              {{ savingOntPlan ? 'Aplicando...' : 'Aplicar plan' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showReturnModal" class="modal-overlay">
        <form class="w-full max-w-sm modal-panel" @submit.prevent="handleReturn">
          <h2 class="text-lg font-semibold mb-1">Registrar devolución</h2>
          <p class="text-xs text-slate-500 mb-4 font-mono">{{ returnUnitTarget?.serial_number || returnUnitTarget?.mac_address }}</p>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Condición del equipo</label>
            <select v-model="returnForm.condition" class="field-input">
              <option value="in_stock">Buen estado — listo para reasignar</option>
              <option value="damaged">Dañado</option>
              <option value="in_repair">Enviar a reparación</option>
            </select>
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-600 mb-1">Motivo</label>
            <input v-model="returnForm.reason" class="field-input" placeholder="ej. Baja del servicio, cambio de equipo..." />
          </div>

          <p v-if="returnError" class="text-sm text-red-600 mb-3">{{ returnError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showReturnModal = false">Cancelar</button>
            <button type="submit" :disabled="returnSaving" class="btn-primary">
              {{ returnSaving ? 'Guardando...' : 'Registrar devolución' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showAddUnitModal" class="modal-overlay">
        <form class="w-full max-w-sm modal-panel" @submit.prevent="handleAddUnit">
          <h2 class="text-lg font-semibold mb-3">Agregar equipo</h2>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Modelo</label>
            <select v-model="addUnitForm.product_id" class="field-input">
              <option value="" disabled>Selecciona un modelo</option>
              <option v-for="p in inventoryStore.products" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Número de serie</label>
            <input v-model="addUnitForm.serial_number" class="field-input" placeholder="ej. ZTEGC1234567" />
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-600 mb-1">Dirección MAC</label>
            <input v-model="addUnitForm.mac_address" class="field-input" placeholder="ej. AA:BB:CC:DD:EE:FF" />
          </div>

          <p v-if="addUnitError" class="text-sm text-red-600 mb-3">{{ addUnitError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showAddUnitModal = false">Cancelar</button>
            <button type="submit" :disabled="addUnitSaving" class="btn-primary">
              {{ addUnitSaving ? 'Guardando...' : 'Agregar y asignar' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showAdvanceModal" class="modal-overlay" @click.self="showAdvanceModal = false">
        <form class="w-full max-w-sm modal-panel" @submit.prevent="handleAdvanceSubmit">
          <h2 class="text-lg font-semibold mb-1">Pago adelantado (3+1)</h2>
          <p class="text-xs text-slate-500 mb-4">Paga 3 mensualidades y la 4ta se genera gratis.</p>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Monto total recibido (S/)</label>
            <input v-model.number="advanceForm.montoTotal" type="number" step="0.01" min="0" required class="field-input" />
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-600 mb-1">Método de pago</label>
            <input v-model="advanceForm.paymentMethod" placeholder="ej. Efectivo, transferencia..." class="field-input" />
          </div>

          <p v-if="advanceError" class="text-sm text-red-600 mb-3">{{ advanceError }}</p>
          <p v-if="advanceResult !== null" class="text-sm text-green-600 mb-3">
            Listo: se generaron {{ advanceResult }} facturas (3 pagadas + el 4to mes gratis).
          </p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showAdvanceModal = false">
              {{ advanceResult !== null ? 'Cerrar' : 'Cancelar' }}
            </button>
            <button v-if="advanceResult === null" type="submit" :disabled="advanceSaving" class="btn-primary">
              {{ advanceSaving ? 'Registrando...' : 'Registrar pago' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </component>
</template>
