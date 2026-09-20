<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useClientsStore } from '@/stores/clients';
import { useContractsStore } from '@/stores/contracts';
import { useCatalogsStore } from '@/stores/catalogs';
import { useTicketsStore } from '@/stores/tickets';
import { useInvoicesStore } from '@/stores/invoices';
import { useMikrotikStore, type PppSecret } from '@/stores/mikrotik';
import { useClientPhotosStore, type ClientPhotoWithUrl } from '@/stores/clientPhotos';
import { useInventoryUnitsStore } from '@/stores/inventoryUnits';
import { useInventoryStore } from '@/stores/inventory';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/lib/errors';
import type {
  ClientPhotoCategory,
  ClientStatus,
  ContractStatus,
  DocumentType,
  Invoice,
  InventoryUnit,
  InventoryUnitStatus,
  InvoiceStatus,
  ServiceContract,
  Ticket,
  TicketStatus,
} from '@/types/domain';

const route = useRoute();
const router = useRouter();
const clientsStore = useClientsStore();
const contractsStore = useContractsStore();
const catalogs = useCatalogsStore();
const ticketsStore = useTicketsStore();
const invoicesStore = useInvoicesStore();
const mikrotikStore = useMikrotikStore();
const clientPhotosStore = useClientPhotosStore();
const inventoryUnitsStore = useInventoryUnitsStore();
const inventoryStore = useInventoryStore();
const auth = useAuthStore();

const canCreateTickets = computed(() => auth.role === 'SUPERADMIN' || auth.role === 'ADMIN');

const clientId = computed(() => route.params.id as string);
const client = computed(() => clientsStore.clients.find((c) => c.id === clientId.value));
const contracts = ref<ServiceContract[]>([]);
const loadingContracts = ref(true);
const tickets = ref<Ticket[]>([]);
const loadingTickets = ref(true);
const invoices = ref<Invoice[]>([]);
const loadingInvoices = ref(true);
const updatingClientStatus = ref(false);
const clientStatusError = ref<string | null>(null);

const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  cedula: 'DNI',
  ruc: 'RUC',
  pasaporte: 'Pasaporte',
};

const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = {
  prospect: 'Prospecto',
  active: 'Activo',
  suspended: 'Suspendido',
  retired: 'Baja',
};

async function handleClientStatusChange(status: ClientStatus) {
  if (!client.value) return;
  updatingClientStatus.value = true;
  clientStatusError.value = null;
  try {
    await clientsStore.updateClient(client.value.id, { status });
  } catch (e) {
    clientStatusError.value = getErrorMessage(e, 'Error al cambiar el estado del cliente');
  } finally {
    updatingClientStatus.value = false;
  }
}

const gpsForm = ref({ latitude: null as number | null, longitude: null as number | null });
const savingGps = ref(false);
const gpsError = ref<string | null>(null);
const gpsCopied = ref(false);

const googleMapsUrl = computed(() => {
  if (!client.value?.latitude || !client.value?.longitude) return null;
  return `https://www.google.com/maps?q=${client.value.latitude},${client.value.longitude}`;
});

async function handleGpsSave() {
  if (!client.value) return;
  savingGps.value = true;
  gpsError.value = null;
  try {
    await clientsStore.updateClient(client.value.id, {
      latitude: gpsForm.value.latitude,
      longitude: gpsForm.value.longitude,
    });
  } catch (e) {
    gpsError.value = getErrorMessage(e, 'Error al guardar la ubicacion');
  } finally {
    savingGps.value = false;
  }
}

async function handleCopyMapsLink() {
  if (!googleMapsUrl.value) return;
  await navigator.clipboard.writeText(googleMapsUrl.value);
  gpsCopied.value = true;
  setTimeout(() => (gpsCopied.value = false), 2000);
}

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
    const list = await clientPhotosStore.fetchPhotos(clientId.value);
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
    const updated = await clientPhotosStore.uploadPhoto(clientId.value, category, file, previous?.storage_path);
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

const showContractModal = ref(false);
const editingContract = ref<ServiceContract | null>(null);
const savingContract = ref(false);
const contractError = ref<string | null>(null);
const contractForm = ref({
  plan_id: '',
  monthly_fee: 0,
  billing_day: 1,
  payment_method: 'cash',
  status: 'active' as ContractStatus,
  mikrotik_device_id: '',
  pppoe_username: '',
});
const modalSecrets = ref<PppSecret[]>([]);
const loadingSecrets = ref(false);

const availableSecrets = computed(() => {
  const linked = new Set(
    contractsStore.contracts
      .filter((c) => c.mikrotik_device_id === contractForm.value.mikrotik_device_id && c.id !== editingContract.value?.id)
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

async function loadContracts() {
  loadingContracts.value = true;
  contracts.value = await contractsStore.fetchContractsByClient(clientId.value);
  loadingContracts.value = false;
}

async function loadTickets() {
  loadingTickets.value = true;
  tickets.value = await ticketsStore.fetchTicketsByClient(clientId.value);
  loadingTickets.value = false;
}

async function loadInvoices() {
  loadingInvoices.value = true;
  invoices.value = await invoicesStore.fetchInvoicesByClient(clientId.value);
  loadingInvoices.value = false;
}

async function loadUnits() {
  loadingUnits.value = true;
  assignedUnits.value = await inventoryUnitsStore.fetchUnitsByClient(clientId.value);
  loadingUnits.value = false;
}

onMounted(async () => {
  if (!clientsStore.clients.length) await clientsStore.fetchClients();
  gpsForm.value = { latitude: client.value?.latitude ?? null, longitude: client.value?.longitude ?? null };
  await Promise.all([
    catalogs.fetchPlans(),
    loadContracts(),
    loadTickets(),
    loadInvoices(),
    loadPhotos(),
    loadUnits(),
    mikrotikStore.fetchDevices(),
    inventoryStore.products.length ? Promise.resolve() : inventoryStore.fetchProducts(),
  ]);
});

// ---- Equipos asignados (control por serie/MAC, Fase 11c) ----
const assignedUnits = ref<InventoryUnit[]>([]);
const loadingUnits = ref(true);

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
    await inventoryUnitsStore.assignUnit(unit.id, clientId.value, undefined, 'Asignacion directa desde ficha de cliente');
    showAddUnitModal.value = false;
    await loadUnits();
  } catch (e) {
    addUnitError.value = getErrorMessage(e, 'Error al registrar el equipo (revisa que la serie/MAC no esté repetida)');
  } finally {
    addUnitSaving.value = false;
  }
}

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

function openContractModal() {
  editingContract.value = null;
  const firstPlan = catalogs.plans[0];
  contractForm.value = {
    plan_id: firstPlan?.id ?? '',
    monthly_fee: firstPlan ? Number(firstPlan.price) : 0,
    billing_day: 1,
    payment_method: 'cash',
    status: 'active',
    mikrotik_device_id: '',
    pppoe_username: '',
  };
  modalSecrets.value = [];
  contractError.value = null;
  showContractModal.value = true;
}

function openEditContract(contract: ServiceContract) {
  editingContract.value = contract;
  contractForm.value = {
    plan_id: contract.plan_id ?? '',
    monthly_fee: Number(contract.monthly_fee),
    billing_day: contract.billing_day,
    payment_method: contract.payment_method ?? 'cash',
    status: contract.status,
    mikrotik_device_id: contract.mikrotik_device_id ?? '',
    pppoe_username: contract.pppoe_username ?? '',
  };
  contractError.value = null;
  loadSecretsForModal(contractForm.value.mikrotik_device_id);
  showContractModal.value = true;
}

function onMikrotikDeviceChange() {
  contractForm.value.pppoe_username = '';
  loadSecretsForModal(contractForm.value.mikrotik_device_id);
}

function onPlanChange() {
  const plan = catalogs.plans.find((p) => p.id === contractForm.value.plan_id);
  if (plan) contractForm.value.monthly_fee = Number(plan.price);
}

async function handleCreateContract() {
  savingContract.value = true;
  contractError.value = null;
  const payload = {
    plan_id: contractForm.value.plan_id || null,
    monthly_fee: contractForm.value.monthly_fee,
    billing_day: contractForm.value.billing_day,
    payment_method: contractForm.value.payment_method,
    mikrotik_device_id: contractForm.value.mikrotik_device_id || null,
    pppoe_username: contractForm.value.pppoe_username || null,
  };
  try {
    if (editingContract.value) {
      await contractsStore.updateContract(editingContract.value.id, { ...payload, status: contractForm.value.status });
    } else {
      await contractsStore.createContract({ ...payload, client_id: clientId.value });
    }
    showContractModal.value = false;
    await loadContracts();
  } catch (e) {
    contractError.value = getErrorMessage(e, editingContract.value ? 'Error al actualizar el contrato' : 'Error al crear el contrato');
  } finally {
    savingContract.value = false;
  }
}
</script>

<template>
  <AppLayout>
    <button class="text-sm text-slate-600 hover:text-slate-900 mb-4" @click="router.push('/clientes')">
      ← Volver a clientes
    </button>

    <div v-if="!client" class="text-slate-500">Cliente no encontrado.</div>
    <template v-else>
      <div class="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 class="text-2xl font-semibold">
            {{ client.first_name }} {{ client.last_name }}
            <span v-if="client.client_code" class="text-slate-400 font-normal text-lg">· {{ client.client_code }}</span>
          </h1>
          <p class="text-slate-600 text-sm mt-1">
            {{ DOCUMENT_TYPE_LABEL[client.document_type] }} {{ client.document_number }} · {{ client.phone || 'sin telefono' }}
          </p>
        </div>
        <button class="btn-primary" @click="openContractModal">
          + Nuevo contrato
        </button>
      </div>

      <div class="grid gap-4 mb-8 text-sm" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))">
        <div class="surface p-4">
          <div class="text-slate-500 text-xs mb-1">Correo</div>
          <div>{{ client.email || '—' }}</div>
        </div>
        <div class="surface p-4">
          <div class="text-slate-500 text-xs mb-1">Direccion</div>
          <div>{{ client.address || '—' }}</div>
        </div>
        <div class="surface p-4">
          <div class="text-slate-500 text-xs mb-1">Zona</div>
          <div>{{ client.zones?.name || '—' }}</div>
        </div>
        <div class="surface p-4">
          <div class="text-slate-500 text-xs mb-2">Estado del cliente</div>
          <select
            :value="client.status"
            :disabled="updatingClientStatus"
            class="field-input"
            @change="handleClientStatusChange(($event.target as HTMLSelectElement).value as ClientStatus)"
          >
            <option v-for="(label, value) in CLIENT_STATUS_LABEL" :key="value" :value="value">{{ label }}</option>
          </select>
          <p v-if="clientStatusError" class="text-xs text-red-600 mt-1">{{ clientStatusError }}</p>
        </div>
      </div>

      <h2 class="text-lg font-semibold mb-3">Ubicacion GPS</h2>
      <div class="rounded-xl border border-slate-200 bg-slate-100 p-4 mb-8 text-sm">
        <div class="grid gap-3 mb-3" style="grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))">
          <div>
            <label class="block text-xs text-slate-600 mb-1">Latitud</label>
            <input
              v-model.number="gpsForm.latitude"
              type="number"
              step="0.000001"
              placeholder="-2.170998"
              class="field-input"
            />
          </div>
          <div>
            <label class="block text-xs text-slate-600 mb-1">Longitud</label>
            <input
              v-model.number="gpsForm.longitude"
              type="number"
              step="0.000001"
              placeholder="-79.922359"
              class="field-input"
            />
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <button
            :disabled="savingGps"
            class="px-3 py-2 rounded-lg bg-sky-500 text-slate-950 text-sm font-semibold disabled:opacity-60"
            @click="handleGpsSave"
          >
            {{ savingGps ? 'Guardando...' : 'Guardar ubicacion' }}
          </button>
          <a
            v-if="googleMapsUrl"
            :href="googleMapsUrl"
            target="_blank"
            rel="noopener"
            class="text-sky-600 hover:underline text-sm"
          >
            Abrir en Google Maps →
          </a>
          <button v-if="googleMapsUrl" type="button" class="text-slate-600 hover:text-slate-900 text-sm" @click="handleCopyMapsLink">
            {{ gpsCopied ? 'Copiado ✓' : 'Copiar enlace para el tecnico' }}
          </button>
        </div>
        <p v-if="gpsError" class="text-xs text-red-600 mt-2">{{ gpsError }}</p>
      </div>

      <h2 class="text-lg font-semibold mb-3">Fotos de instalacion</h2>
      <p v-if="photoError" class="mb-3 text-sm text-red-600">{{ photoError }}</p>
      <div class="grid gap-4 mb-8" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))">
        <div v-for="cat in PHOTO_CATEGORIES" :key="cat.value" class="surface p-4">
          <div class="text-slate-500 text-xs mb-2">{{ cat.label }}</div>
          <a v-if="photos[cat.value]?.url" :href="photos[cat.value]!.url!" target="_blank" rel="noopener">
            <img :src="photos[cat.value]!.url!" class="w-full h-32 object-cover rounded-lg mb-2" />
          </a>
          <div v-else class="w-full h-32 rounded-lg border border-dashed border-slate-300 flex items-center justify-center text-xs text-slate-400 mb-2">
            Sin foto
          </div>
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

      <h2 class="text-lg font-semibold mb-3">Contratos e historial</h2>
      <p v-if="loadingContracts" class="text-slate-500 text-sm">Cargando...</p>
      <p v-else-if="!contracts.length" class="text-slate-500 text-sm">Este cliente aun no tiene contratos.</p>
      <div v-else class="table-shell">
        <table class="w-full text-sm min-w-[560px]">
          <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
            <tr>
              <th class="text-left px-4 py-3">Contrato</th>
              <th class="text-left px-4 py-3">Plan</th>
              <th class="text-left px-4 py-3">Mensualidad</th>
              <th class="text-left px-4 py-3">Inicio</th>
              <th class="text-left px-4 py-3">PPPoE</th>
              <th class="text-left px-4 py-3">Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="ct in contracts"
              :key="ct.id"
              class="border-t border-slate-200 hover:bg-slate-50 cursor-pointer"
              @click="openEditContract(ct)"
            >
              <td class="px-4 py-3 font-mono text-xs">{{ ct.contract_number }}</td>
              <td class="px-4 py-3">{{ ct.plans?.name || '—' }}</td>
              <td class="px-4 py-3">S/ {{ Number(ct.monthly_fee).toFixed(2) }}</td>
              <td class="px-4 py-3 text-slate-600">{{ ct.start_date }}</td>
              <td class="px-4 py-3 font-mono text-xs text-sky-600/80">{{ ct.pppoe_username || '—' }}</td>
              <td class="px-4 py-3">
                <span class="badge" :class="STATUS_CLASS[ct.status]">
                  {{ STATUS_LABEL[ct.status] }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex items-center justify-between mb-3">
        <h2 class="text-lg font-semibold">Equipos asignados</h2>
        <button class="text-sm text-sky-600 hover:text-sky-700" @click="openAddUnit">+ Agregar equipo</button>
      </div>
      <p v-if="loadingUnits" class="text-slate-500 text-sm">Cargando...</p>
      <p v-else-if="!assignedUnits.length" class="text-slate-500 text-sm mb-8">Este cliente no tiene equipos asignados.</p>
      <div v-else class="table-shell mb-8">
        <table class="w-full text-sm min-w-[560px]">
          <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
            <tr>
              <th class="text-left px-4 py-3">Equipo</th>
              <th class="text-left px-4 py-3">Serie</th>
              <th class="text-left px-4 py-3">MAC</th>
              <th class="text-left px-4 py-3">Estado</th>
              <th class="text-left px-4 py-3">Notas</th>
              <th class="text-right px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in assignedUnits" :key="u.id" class="border-t border-slate-200">
              <td class="px-4 py-3">{{ u.product?.name ?? 'Equipo' }}</td>
              <td class="px-4 py-3 font-mono text-xs">{{ u.serial_number || '—' }}</td>
              <td class="px-4 py-3 font-mono text-xs">{{ u.mac_address || '—' }}</td>
              <td class="px-4 py-3">
                <span class="badge" :class="UNIT_STATUS_CLASS[u.status]">{{ UNIT_STATUS_LABEL[u.status] }}</span>
              </td>
              <td class="px-4 py-3 text-slate-600 text-xs max-w-[220px] truncate" :title="u.notes ?? ''">{{ u.notes || '—' }}</td>
              <td class="px-4 py-3 text-right">
                <button v-if="u.status === 'assigned'" class="text-xs text-amber-600 hover:text-amber-700" @click="openReturn(u)">
                  Registrar devolución
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex items-center justify-between mb-3">
        <h2 class="text-lg font-semibold">Tickets de soporte</h2>
        <router-link v-if="canCreateTickets" to="/soporte" class="text-sm text-sky-600 hover:text-sky-700">+ Nuevo ticket</router-link>
      </div>
      <p v-if="loadingTickets" class="text-slate-500 text-sm">Cargando...</p>
      <p v-else-if="!tickets.length" class="text-slate-500 text-sm">Este cliente aun no tiene tickets.</p>
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
            <tr
              v-for="t in tickets"
              :key="t.id"
              class="border-t border-slate-200 hover:bg-slate-50 cursor-pointer"
              @click="router.push(`/soporte/${t.id}`)"
            >
              <td class="px-4 py-3 font-mono text-xs">{{ t.ticket_number }}</td>
              <td class="px-4 py-3">{{ t.title }}</td>
              <td class="px-4 py-3 text-slate-600">{{ t.created_at.slice(0, 10) }}</td>
              <td class="px-4 py-3">
                <span class="badge" :class="TICKET_STATUS_CLASS[t.status]">
                  {{ TICKET_STATUS_LABEL[t.status] }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex items-center justify-between mb-3">
        <h2 class="text-lg font-semibold">Facturas</h2>
        <router-link to="/facturacion" class="text-sm text-sky-600 hover:text-sky-700">+ Nueva factura</router-link>
      </div>
      <p v-if="loadingInvoices" class="text-slate-500 text-sm">Cargando...</p>
      <p v-else-if="!invoices.length" class="text-slate-500 text-sm">Este cliente aun no tiene facturas.</p>
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
            <tr
              v-for="inv in invoices"
              :key="inv.id"
              class="border-t border-slate-200 hover:bg-slate-50 cursor-pointer"
              @click="router.push('/facturacion')"
            >
              <td class="px-4 py-3 font-mono text-xs">{{ inv.invoice_number }}</td>
              <td class="px-4 py-3 text-slate-600 text-xs">{{ inv.period_start }} → {{ inv.period_end }}</td>
              <td class="px-4 py-3">S/ {{ Number(inv.amount).toFixed(2) }}</td>
              <td class="px-4 py-3 text-slate-600">{{ inv.due_date }}</td>
              <td class="px-4 py-3">
                <span class="badge" :class="INVOICE_STATUS_CLASS[inv.status]">
                  {{ INVOICE_STATUS_LABEL[inv.status] }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <Teleport to="body">
      <div v-if="showContractModal" class="modal-overlay">
        <form class="w-full max-w-md modal-panel" @submit.prevent="handleCreateContract">
          <h2 class="text-lg font-semibold mb-4">{{ editingContract ? 'Editar contrato' : 'Nuevo contrato' }}</h2>

          <div v-if="editingContract" class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Estado</label>
            <select v-model="contractForm.status" class="field-input">
              <option v-for="(label, value) in STATUS_LABEL" :key="value" :value="value">{{ label }}</option>
            </select>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Plan</label>
            <select
              v-model="contractForm.plan_id"
              required
              class="field-input"
              @change="onPlanChange"
            >
              <option value="" disabled>Selecciona un plan</option>
              <option v-for="p in catalogs.plans" :key="p.id" :value="p.id">
                {{ p.name }} — ↓{{ p.download_speed }}/↑{{ p.upload_speed }} Mbps — S/ {{ Number(p.price).toFixed(2) }}
              </option>
            </select>
            <p v-if="!catalogs.plans.length" class="text-xs text-amber-600 mt-1">
              No hay planes activos. Crea uno primero en Supabase (tabla <code>plans</code>).
            </p>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Mensualidad (S/)</label>
              <input
                v-model.number="contractForm.monthly_fee"
                type="number"
                step="0.01"
                min="0"
                required
                class="field-input"
              />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Dia de corte</label>
              <input
                v-model.number="contractForm.billing_day"
                type="number"
                min="1"
                max="28"
                required
                class="field-input"
              />
            </div>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Metodo de pago</label>
            <select v-model="contractForm.payment_method" class="field-input">
              <option value="cash">Efectivo</option>
              <option value="transfer">Transferencia</option>
              <option value="card">Tarjeta</option>
            </select>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Router MikroTik</label>
              <select
                v-model="contractForm.mikrotik_device_id"
                class="field-input"
                @change="onMikrotikDeviceChange"
              >
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

          <p v-if="contractError" class="text-sm text-red-600 mb-3">{{ contractError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showContractModal = false">
              Cancelar
            </button>
            <button type="submit" :disabled="savingContract" class="btn-primary">
              {{ savingContract ? 'Guardando...' : editingContract ? 'Guardar cambios' : 'Crear contrato' }}
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
  </AppLayout>
</template>
