<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import CampoLayout from '@/components/campo/CampoLayout.vue';
import SignaturePad from '@/components/campo/SignaturePad.vue';
import QrScannerModal from '@/components/campo/QrScannerModal.vue';
import { useCampoStore, type DiagnosticoResult } from '@/stores/campo';
import { useOltStore } from '@/stores/olt';
import { useInventoryStore } from '@/stores/inventory';
import { useClientsStore } from '@/stores/clients';
import { useContractsStore } from '@/stores/contracts';
import { useClientPhotosStore, type ClientPhotoWithUrl } from '@/stores/clientPhotos';
import { getErrorMessage } from '@/lib/errors';
import { mapsLink, telLink, waLink, wazeLink } from '@/lib/phone';
import type { Client, ClientPhotoCategory, Installation, InventoryMovement, JobType, ServiceContract, Ticket } from '@/types/domain';

const route = useRoute();
const router = useRouter();
const campoStore = useCampoStore();
const oltStore = useOltStore();
const inventoryStore = useInventoryStore();
const clientsStore = useClientsStore();
const contractsStore = useContractsStore();
const clientPhotosStore = useClientPhotosStore();

const jobType = route.params.tipo as JobType;
const jobId = route.params.id as string;

const trabajo = computed(() => campoStore.trabajos.find((t) => t.jobType === jobType && t.id === jobId));
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
  pon_power: 'Potencia PON',
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

const DOCUMENT_LABEL: Record<string, string> = { cedula: 'Cédula', ruc: 'RUC', pasaporte: 'Pasaporte' };

onMounted(async () => {
  if (!campoStore.trabajos.length) await campoStore.fetchAll();
  oltStore.fetchDevices().catch(() => {});
  inventoryStore.fetchProducts().catch(() => {});
  await loadMaterials();
  if (trabajo.value) {
    await Promise.all([loadClientInfo(trabajo.value.clientId), loadExistingPhotos(trabajo.value.contractId)]);
  }
});

// ---- Diagnostico express ----
const diagnostico = ref<DiagnosticoResult | null>(null);
const diagLoading = ref(false);
const diagError = ref<string | null>(null);

async function runDiagnostico() {
  if (!trabajo.value) return;
  diagLoading.value = true;
  diagError.value = null;
  try {
    diagnostico.value = await campoStore.runDiagnostico(trabajo.value.clientId, trabajo.value.contractId);
  } catch (e) {
    diagError.value = getErrorMessage(e, 'No se pudo ejecutar el diagnóstico');
  } finally {
    diagLoading.value = false;
  }
}

function signalClass(rx: number | null) {
  if (rx == null) return 'text-slate-400';
  if (rx >= -8 || rx <= -27) return 'text-red-600';
  if (rx <= -25) return 'text-amber-600';
  return 'text-green-600';
}

// ---- Escaner QR compartido (provisionamiento y cierre) ----
const qrOpen = ref(false);
const qrTarget = ref<'provision' | 'closure' | null>(null);

function openQr(target: 'provision' | 'closure') {
  qrTarget.value = target;
  qrOpen.value = true;
}
function onQrScan(value: string) {
  if (qrTarget.value === 'provision') provisionForm.value.serial = value;
  if (qrTarget.value === 'closure') closureForm.value.ontSerial = value;
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
    closureForm.value.ontSerial = provisionForm.value.serial;
  } catch (e) {
    provisionError.value = getErrorMessage(e, 'Error al registrar la ONT en la OLT (revisa perfiles y puerto)');
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
  materials.value =
    jobType === 'installation'
      ? await inventoryStore.fetchMovementsByInstallation(jobId)
      : await inventoryStore.fetchMovementsByTicket(jobId);
}

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

// ---- Cierre de trabajo ----
const INSTALL_PHOTO_CATEGORIES: { value: ClientPhotoCategory; label: string }[] = [
  { value: 'facade', label: 'Fachada' },
  { value: 'nap_box', label: 'Caja NAP' },
  { value: 'modem_position', label: 'Posición del módem' },
  { value: 'pon_power', label: 'Potencia PON (medidor)' },
];
const TICKET_PHOTO_CATEGORIES = [
  { value: 'evidencia_1', label: 'Evidencia 1' },
  { value: 'evidencia_2', label: 'Evidencia 2' },
];

const closureForm = ref({ latitude: null as number | null, longitude: null as number | null, ontSerial: '', closureNotes: '' });
const closurePhotos = ref<Record<string, File | undefined>>({});
const signatureBlob = ref<Blob | null>(null);
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

function onPhotoChange(category: string, event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) closurePhotos.value[category] = file;
}

async function handleCloseSubmit() {
  if (!trabajo.value) return;
  closing.value = true;
  closeError.value = null;
  closeResult.value = null;
  try {
    const categories = jobType === 'installation' ? INSTALL_PHOTO_CATEGORIES.map((c) => c.value) : TICKET_PHOTO_CATEGORIES.map((c) => c.value);
    const photos = categories
      .filter((cat) => closurePhotos.value[cat])
      .map((cat) => ({ category: cat, file: closurePhotos.value[cat]! }));

    const result = await campoStore.submitClosure({
      jobType,
      jobId,
      clientId: trabajo.value.clientId,
      contractId: trabajo.value.contractId,
      targetStatus: jobType === 'installation' ? 'completed' : 'resolved',
      latitude: closureForm.value.latitude,
      longitude: closureForm.value.longitude,
      ontSerial: closureForm.value.ontSerial || null,
      closureNotes: closureForm.value.closureNotes || null,
      photos,
      signatureBlob: signatureBlob.value,
      updateClientGps: jobType === 'installation',
      clientPhotoCategories: jobType === 'installation' ? (INSTALL_PHOTO_CATEGORIES.map((c) => c.value) as ClientPhotoCategory[]) : [],
    });
    closeResult.value = result.queued ? 'queued' : 'ok';
    if (!result.queued) setTimeout(() => router.push('/campo'), 1200);
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
          :class="jobType === 'installation' ? 'bg-sky-500/15 text-sky-700' : 'bg-orange-500/15 text-orange-700'"
        >
          {{ jobType === 'installation' ? 'Instalación' : 'Avería' }}
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

      <!-- Fotos ya registradas del cliente -->
      <section v-if="loadingPhotos || existingPhotos.length" class="surface p-3.5 mb-3">
        <h2 class="text-sm font-semibold mb-2">Fotos anteriores</h2>
        <p v-if="loadingPhotos" class="text-xs text-slate-400">Cargando fotos...</p>
        <p v-else-if="!existingPhotos.length" class="text-xs text-slate-400">Sin fotos registradas todavía.</p>
        <div v-else class="grid grid-cols-2 gap-2">
          <a v-for="p in existingPhotos" :key="p.id" :href="p.url ?? undefined" target="_blank" rel="noopener" class="block">
            <img :src="p.url ?? undefined" :alt="PHOTO_LABEL[p.category]" class="w-full h-28 object-cover rounded-lg border border-slate-200" />
            <p class="text-[11px] text-slate-500 mt-1 text-center">{{ PHOTO_LABEL[p.category] }}</p>
          </a>
        </div>
      </section>

      <!-- Diagnostico express -->
      <section class="surface p-3.5 mb-3">
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

      <!-- Provisionamiento OLT (solo instalaciones) -->
      <section v-if="jobType === 'installation'" class="surface p-3.5 mb-3">
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
            <button type="button" class="btn-secondary text-xs shrink-0" @click="openQr('provision')">📷 QR</button>
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
      <section class="surface p-3.5 mb-3">
        <h2 class="text-sm font-semibold mb-2">Materiales usados</h2>
        <ul v-if="materials.length" class="space-y-1 mb-2.5 text-xs">
          <li v-for="m in materials" :key="m.id" class="flex justify-between">
            <span>{{ m.product?.name ?? 'Producto' }}</span>
            <span class="text-slate-600">{{ m.quantity }} {{ m.product?.unit }}</span>
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

      <!-- Cierre de trabajo -->
      <section class="surface p-3.5 mb-3">
        <h2 class="text-sm font-semibold mb-2">Cierre de trabajo</h2>

        <div class="flex gap-2 mb-2.5">
          <input v-model="closureForm.ontSerial" placeholder="Serial de la ONT" class="field-input text-sm font-mono flex-1" />
          <button type="button" class="btn-secondary text-xs shrink-0" @click="openQr('closure')">📷 QR</button>
        </div>

        <button type="button" :disabled="gettingLocation" class="text-xs text-sky-600 mb-2.5 block" @click="useCurrentLocation">
          {{ gettingLocation ? 'Obteniendo ubicación...' : `📍 ${closureForm.latitude ? 'Ubicación capturada' : 'Usar mi ubicación actual'}` }}
        </button>

        <div class="grid grid-cols-2 gap-2 mb-3">
          <div v-for="cat in jobType === 'installation' ? INSTALL_PHOTO_CATEGORIES : TICKET_PHOTO_CATEGORIES" :key="cat.value">
            <label class="block text-center px-2 py-2 rounded-lg bg-slate-100 text-[11px] cursor-pointer truncate">
              {{ closurePhotos[cat.value] ? '✓ ' + cat.label : cat.label }}
              <input type="file" accept="image/*" capture="environment" class="hidden" @change="onPhotoChange(cat.value, $event)" />
            </label>
          </div>
        </div>

        <textarea v-model="closureForm.closureNotes" rows="2" placeholder="Notas del cierre..." class="field-input text-sm mb-3"></textarea>

        <SignaturePad @change="(b) => (signatureBlob = b)" />

        <p v-if="closeError" class="text-sm text-red-600 mt-3">{{ closeError }}</p>
        <p v-if="closeResult === 'queued'" class="text-sm text-amber-600 mt-3">
          Sin señal: el cierre quedó guardado en el dispositivo y se sincronizará automáticamente.
        </p>
        <p v-if="closeResult === 'ok'" class="text-sm text-green-600 mt-3">Trabajo cerrado correctamente.</p>

        <button type="button" :disabled="closing" class="btn-primary w-full text-sm mt-3" @click="handleCloseSubmit">
          {{ closing ? 'Guardando...' : jobType === 'installation' ? 'Completar instalación' : 'Resolver avería' }}
        </button>
      </section>
    </template>

    <QrScannerModal :open="qrOpen" @close="qrOpen = false" @scan="onQrScan" />
  </CampoLayout>
</template>
