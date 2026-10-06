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
import {
  NAP_CLIENT_LIMIT,
  type ClientPhotoCategory,
  type ContractServiceType,
  type Installation,
  type InstallationStatus,
  type InventoryMovement,
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

// Mismas reglas de permiso que tenia InstalacionesView.vue — una instalacion
// (a diferencia de un ticket) SI se puede seguir gestionando desde el Panel
// Web ademas de la App de Campo, por eso el tecnico asignado no queda en
// solo-lectura aqui como si pasa en TicketDetailView.
function canDelete(inst: Installation) {
  return inst.status === 'cancelled' && auth.role !== 'TECNICO_RED';
}
const canEditCrew = computed(() => ['SUPERADMIN', 'ADMIN', 'SOPORTE'].includes(auth.role ?? ''));
function canEdit(inst: Installation) {
  if (auth.role === 'SUPERADMIN' || auth.role === 'ADMIN') return true;
  return auth.role === 'TECNICO_RED' && inst.assigned_to === auth.user?.id;
}
function canEditMaterials(inst: Installation) {
  if (auth.role === 'SUPERADMIN' || auth.role === 'ADMIN') return true;
  return canEdit(inst) && inst.status !== 'completed';
}
const canEditStatus = computed(() => auth.role === 'SUPERADMIN' || auth.role === 'ADMIN');
const canEditPriority = computed(() => auth.role !== 'TECNICO_RED');

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

// ---- Materiales usados (Fase 11b) ----
const materials = ref<InventoryMovement[]>([]);
const loadingMaterials = ref(false);
const materialForm = ref({ productId: '', quantity: 1 });
const savingMaterial = ref(false);
const materialError = ref<string | null>(null);

async function loadMaterialsAndUnits() {
  if (!installation.value) return;
  loadingMaterials.value = true;
  try {
    const [mats, units] = await Promise.all([
      inventoryStore.fetchMovementsByInstallation(installation.value.id),
      inventoryUnitsStore.fetchUnitsByInstallation(installation.value.id),
    ]);
    materials.value = mats;
    assignedUnits.value = units;
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

// ---- Plantilla de materiales de ferreteria (Fase 45/63) ----
interface MaterialTemplateLine {
  key: string;
  label: string;
  match: RegExp;
  defaultQty: number;
}
const MATERIAL_TEMPLATE: MaterialTemplateLine[] = [
  { key: 'drop', label: 'Cable Drop', match: /drop/i, defaultQty: 0 },
  { key: 'roseta', label: 'Roseta Óptica', match: /roseta/i, defaultQty: 0 },
  { key: 'patchcord', label: 'Patchcord', match: /patchcord|patch\s*cord/i, defaultQty: 0 },
  { key: 'conector', label: 'Conector Óptico', match: /conector/i, defaultQty: 0 },
];
const ferreteriaProducts = computed(() => inventoryStore.products.filter((p) => p.is_active && p.inventory_categories?.slug === 'ferreteria'));
const templateProductChoice = ref<Record<string, string>>({});
const templateRows = computed(() =>
  MATERIAL_TEMPLATE.map((line) => {
    const matches = ferreteriaProducts.value.filter((p) => line.match.test(p.name));
    const chosenId = matches.length > 1 ? templateProductChoice.value[line.key] : matches[0]?.id;
    return { ...line, matches, product: matches.find((p) => p.id === chosenId) ?? null };
  }),
);
const templateProductIds = computed(() => new Set(templateRows.value.flatMap((r) => r.matches.map((p) => p.id))));
const otherMaterialProducts = computed(() => inventoryStore.products.filter((p) => !p.is_serialized && !templateProductIds.value.has(p.id)));
const templateQuantities = ref<Record<string, number>>({});
const templateReuse = ref<Record<string, boolean>>({});
function resetTemplateQuantities() {
  templateQuantities.value = Object.fromEntries(MATERIAL_TEMPLATE.map((l) => [l.key, l.defaultQty]));
  templateProductChoice.value = {};
  templateReuse.value = {};
}
const savingTemplate = ref(false);
const templateError = ref<string | null>(null);

async function handleRegisterTemplate() {
  if (!installation.value) return;
  const rowsToRegister = templateRows.value.filter((row) => !templateReuse.value[row.key] && (templateQuantities.value[row.key] ?? 0) > 0 && row.product);
  if (!rowsToRegister.length) {
    toast.info('No hay cantidades para registrar — escribe lo que usaste en cada material.');
    return;
  }
  savingTemplate.value = true;
  templateError.value = null;
  const failures: string[] = [];
  for (const row of rowsToRegister) {
    const qty = templateQuantities.value[row.key] ?? 0;
    try {
      await inventoryStore.registerUsage({
        productId: row.product!.id,
        quantity: qty,
        installationId: installation.value.id,
        reason: `Instalación ${installation.value.contracts?.contract_number ?? installation.value.id} — plantilla`,
      });
    } catch (e) {
      failures.push(`${row.label}: ${getErrorMessage(e)}`);
    }
  }
  materials.value = await inventoryStore.fetchMovementsByInstallation(installation.value.id);
  resetTemplateQuantities();
  if (failures.length) {
    toast.error(`No se pudo registrar: ${failures.join(' · ')}`);
  } else {
    toast.success(`Materiales registrados: ${rowsToRegister.map((r) => r.label).join(', ')}.`);
  }
  templateError.value = failures.length ? failures.join(' · ') : null;
  savingTemplate.value = false;
}

async function handleAddMaterial() {
  if (!installation.value || !materialForm.value.productId || materialForm.value.quantity <= 0) return;
  savingMaterial.value = true;
  materialError.value = null;
  try {
    await inventoryStore.registerUsage({
      productId: materialForm.value.productId,
      quantity: materialForm.value.quantity,
      installationId: installation.value.id,
      reason: `Instalación ${installation.value.contracts?.contract_number ?? installation.value.id}`,
    });
    materialForm.value = { productId: '', quantity: 1 };
    materials.value = await inventoryStore.fetchMovementsByInstallation(installation.value.id);
  } catch (e) {
    materialError.value = getErrorMessage(e, 'Error al registrar el material (revisa el stock disponible)');
  } finally {
    savingMaterial.value = false;
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
const assignedUnits = ref<InventoryUnit[]>([]);
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
    assignedUnits.value = await inventoryUnitsStore.fetchUnitsByInstallation(installation.value.id);
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
  if (inst.status !== 'completed') return canEdit(inst);
  return auth.role === 'SUPERADMIN' || auth.role === 'ADMIN';
});

async function handleUnassignUnit(unit: InventoryUnit) {
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
    assignedUnits.value = await inventoryUnitsStore.fetchUnitsByInstallation(installation.value.id);
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
      const used = puertos.filter((p) => p.estado === 'ocupado').length;
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
    inventoryStore.fetchProducts(),
    infraStore.fetchElementos(),
    fibra.fetchTodosNapPuertos(),
  ]);
  const found = installationsStore.installations.find((i) => i.id === installationId.value);
  installation.value = found ?? null;
  notFound.value = !found;
  loading.value = false;
  if (installation.value) {
    iptvNoteDraft.value = installation.value.iptv_account_note ?? '';
    resetTemplateQuantities();
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

          <div v-if="installation.notes" class="surface p-4 text-sm">
            <div class="text-slate-500 text-xs mb-2">Notas</div>
            <p class="whitespace-pre-wrap">{{ installation.notes }}</p>
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
          <!-- Instalacion ya completada/cancelada: todo lo de abajo queda solo-lectura -->
          <div v-if="installation.status === 'completed'" class="surface p-4 text-sm bg-green-50 border border-green-200">
            <h2 class="text-sm font-semibold mb-1">✅ Instalación completada</h2>
            <p class="text-xs text-slate-600">
              Materiales, equipos y fotos quedan cerrados para evitar un doble envío. Si falta corregir algo, un
              administrador puede regresar el estado a "Programada" desde la columna de la izquierda.
            </p>
          </div>
          <div v-else-if="installation.status === 'cancelled'" class="surface p-4 text-sm bg-slate-50 border border-slate-200">
            <h2 class="text-sm font-semibold mb-1">🚫 Instalación cancelada</h2>
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
            <template v-else>
              <p v-if="!materials.length" class="text-slate-500 text-xs mb-3">Sin materiales registrados en esta instalación.</p>
              <ul v-else class="space-y-1.5 mb-4">
                <li v-for="m in materials" :key="m.id" class="flex justify-between text-xs">
                  <span>{{ m.product?.name ?? 'Producto' }}</span>
                  <span class="text-slate-600">{{ m.quantity }} {{ m.product?.unit }}</span>
                </li>
              </ul>
            </template>

            <template v-if="canEditMaterials(installation)">
              <div class="border border-slate-200 rounded-lg p-3 mb-4">
                <h3 class="text-sm font-semibold mb-1">Plantilla de materiales</h3>
                <p class="text-[11px] text-slate-400 mb-2">
                  Si el cliente regresa y reutiliza lo que ya tenía (ej. el drop tendido), marca esa línea en vez de
                  registrar cantidad — si quedan todas así, no hace falta esta sección: solo Equipos asignados.
                </p>
                <div class="divide-y divide-slate-100">
                  <div v-for="row in templateRows" :key="row.key" class="py-2 first:pt-0 last:pb-0">
                    <div class="flex items-center gap-2">
                      <span class="flex-1 text-xs text-slate-700">{{ row.label }}</span>
                      <label class="flex items-center gap-1 text-[11px] text-slate-500 whitespace-nowrap">
                        <input type="checkbox" v-model="templateReuse[row.key]" />
                        Cliente regresa
                      </label>
                    </div>
                    <template v-if="!templateReuse[row.key]">
                      <select v-if="row.matches.length > 1" v-model="templateProductChoice[row.key]" class="field-input w-full py-1 text-xs mt-1.5">
                        <option value="">Selecciona la medida usada...</option>
                        <option v-for="p in row.matches" :key="p.id" :value="p.id">{{ p.name }}</option>
                      </select>
                      <div v-if="row.product" class="flex items-center gap-2 mt-1.5">
                        <span class="flex-1 text-[11px] text-slate-400">Cantidad</span>
                        <input v-model.number="templateQuantities[row.key]" type="number" min="0" step="1" class="field-input w-20 py-1 text-xs" />
                        <span class="text-[11px] text-slate-400 w-16">{{ row.product.unit }}</span>
                      </div>
                      <p v-else-if="!row.matches.length" class="text-[11px] text-amber-700 mt-1">
                        Falta crear "{{ row.label }}" en <router-link to="/inventario/album/ferreteria" class="underline">Inventario</router-link>
                      </p>
                    </template>
                  </div>
                </div>
                <div class="flex justify-end mt-3">
                  <button type="button" :disabled="savingTemplate" class="btn-secondary text-xs" @click="handleRegisterTemplate">
                    {{ savingTemplate ? 'Registrando...' : 'Registrar plantilla' }}
                  </button>
                </div>
                <p v-if="templateError" class="text-xs text-red-600 mt-2">{{ templateError }}</p>
              </div>

              <form class="flex flex-wrap items-end gap-2" @submit.prevent="handleAddMaterial">
                <div class="flex-1 min-w-[160px]">
                  <label class="block text-xs text-slate-600 mb-1">Otro material</label>
                  <select v-model="materialForm.productId" required class="field-input">
                    <option value="" disabled>Selecciona...</option>
                    <option v-for="p in otherMaterialProducts" :key="p.id" :value="p.id">{{ p.name }} ({{ p.current_stock }} {{ p.unit }} disp.)</option>
                  </select>
                </div>
                <div class="w-24">
                  <label class="block text-xs text-slate-600 mb-1">Cantidad</label>
                  <input v-model.number="materialForm.quantity" type="number" min="1" step="1" class="field-input" />
                </div>
                <button type="submit" :disabled="savingMaterial || !materialForm.productId" class="btn-secondary text-xs">
                  {{ savingMaterial ? 'Registrando...' : '+ Usar' }}
                </button>
              </form>
              <p v-if="materialError" class="text-xs text-red-600 mt-2">{{ materialError }}</p>
            </template>
            <p v-else-if="!canEdit(installation)" class="text-xs text-slate-400">Materiales (solo admin)</p>
          </div>

          <div class="surface p-4 text-sm">
            <h2 class="text-sm font-semibold mb-1">
              Equipos asignados (serie/MAC)
              <span v-if="materialsServiceType === 'internet_combo'" class="text-amber-600 font-normal">— obligatorio</span>
              <span v-else class="text-slate-400 font-normal">— opcional: ONT como puente o TV Box si el TV no es Smart</span>
            </h2>
            <p v-if="!equipmentProducts.length" class="text-xs text-slate-500">
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
