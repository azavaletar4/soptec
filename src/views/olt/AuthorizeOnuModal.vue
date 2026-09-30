<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useOltStore, type OltOnt } from '@/stores/olt';
import { useClientsStore } from '@/stores/clients';
import { useContractsStore } from '@/stores/contracts';
import { useCatalogsStore } from '@/stores/catalogs';
import { useMikrotikStore, type PppSecret } from '@/stores/mikrotik';
import { useInfraElementosStore } from '@/stores/infraElementos';
import { useFoFibraStore } from '@/stores/foFibra';
import { NAP_CLIENT_LIMIT, type ServiceContract } from '@/types/domain';
import { getErrorMessage } from '@/lib/errors';

const props = defineProps<{
  deviceId: string;
  oltName?: string;
  prefill?: { serial: string; slot: number; port: number } | null;
}>();
const emit = defineEmits<{ close: []; authorized: [] }>();

const oltStore = useOltStore();
const clientsStore = useClientsStore();
const contractsStore = useContractsStore();
const catalogs = useCatalogsStore();
const mikrotikStore = useMikrotikStore();
const infraStore = useInfraElementosStore();
const fibra = useFoFibraStore();

// ---- 1) Identificacion (heredada del escaneo, bloqueada cuando viene de una
// fila de "Sin Configurar"; editable solo en el fallback manual "+ Registrar
// ONT" para una ONT que el escaneo no detecto) ----
// Bloqueado solo cuando el serial viene de una fila realmente escaneada — el
// modo manual ("+ Registrar ONT") puede traer slot/port heredados del
// selector PON pero el serial siempre se escribe a mano.
const isLocked = computed(() => !!props.prefill?.serial);
const slot = ref(props.prefill?.slot ?? 1);
const port = ref(props.prefill?.port ?? 1);
const serial = ref(props.prefill?.serial ?? '');

// Limite de hardware GPON tipico en tarjetas ZTE (onu-id 1-128 por puerto
// PON) — puramente informativo, nunca bloquea el registro (la OLT real es la
// que decide si acepta o no el onu-id).
const PON_PORT_MAX_ONUS = 128;
const ponUsed = computed(
  () => oltStore.onts.filter((o) => o.olt_device_id === props.deviceId && o.slot === slot.value && o.port === port.value).length,
);

// ---- 2) Red / OLT ----
const onuId = ref<number | ''>('');
const onuType = ref('');
const description = ref('');
const vlan = ref(100);
const tcontProfile = ref('');
const trafficProfile = ref('');
const profiles = ref<{ tcontProfiles: string[]; trafficProfiles: string[] }>({ tcontProfiles: [], trafficProfiles: [] });
const profilesLoading = ref(false);
const profilesError = ref<string | null>(null);
// true cuando tcont/traffic vienen fijos del plan contratado (caso normal) —
// false obliga a elegir a mano, ya sea porque el plan no tiene perfiles OLT
// configurados (ver Planes) o porque el tecnico pidio explicitamente usar
// otro perfil ("avanzado"). Mantener el plan y la OLT sincronizados es el
// objetivo: nunca se deja elegir un perfil "a ciegas" desconectado de lo que
// el cliente realmente contrato.
const manualProfiles = ref(false);

// Antes esto se llamaba siempre al abrir el modal (un show gpon profile ...
// por Telnet contra la OLT en vivo) — lento y, si la OLT esta ocupada con
// el sync periodico (show running-config completo, ver
// project_olt_bulk_import), podia tardar mas que el timeout del proxy y
// devolver 504 incluso antes de llegar a elegir cliente/plan. Ahora solo se
// llama bajo demanda (perfil "avanzado" o plan sin perfiles configurados).
async function loadProfiles() {
  if (profiles.value.tcontProfiles.length) return;
  profilesLoading.value = true;
  profilesError.value = null;
  try {
    profiles.value = await oltStore.fetchProfiles(props.deviceId);
  } catch (e) {
    profilesError.value = getErrorMessage(e, 'Error al consultar los perfiles de ancho de banda de la OLT');
  } finally {
    profilesLoading.value = false;
  }
}

function toggleManualProfiles() {
  manualProfiles.value = !manualProfiles.value;
  if (manualProfiles.value) {
    void loadProfiles();
  } else {
    const plan = selectedContract.value?.plans;
    tcontProfile.value = plan?.olt_tcont_profile ?? '';
    trafficProfile.value = plan?.olt_traffic_profile ?? '';
  }
}

// ---- 3) Cliente (mismo patron de busqueda que TicketsView.vue/InstalacionesView.vue) ----
const clientFilter = ref('');
const selectedClientId = ref('');
const filteredClients = computed(() => {
  const q = clientFilter.value.trim().toLowerCase();
  const list = clientsStore.clients;
  if (!q) return list.slice(0, 30);
  return list.filter((c) => `${c.first_name} ${c.last_name} ${c.document_number}`.toLowerCase().includes(q)).slice(0, 30);
});

// ---- 4) Contrato/servicio (debe existir, este modal no crea contratos) ----
const contracts = ref<ServiceContract[]>([]);
const loadingContracts = ref(false);
const selectedContractId = ref('');
const selectedContract = computed(() => contracts.value.find((c) => c.id === selectedContractId.value) ?? null);

async function onClientChange() {
  selectedContractId.value = '';
  contracts.value = [];
  zoneId.value = '';
  napId.value = '';
  if (!selectedClientId.value) return;
  loadingContracts.value = true;
  try {
    contracts.value = await contractsStore.fetchContractsByClient(selectedClientId.value);
    if (contracts.value.length === 1) selectedContractId.value = contracts.value[0].id;
  } catch (e) {
    submitError.value = getErrorMessage(e, 'Error al consultar los servicios del cliente');
  } finally {
    loadingContracts.value = false;
  }
}

// Busca la caja NAP donde YA esta ocupado un puerto por este contrato
// (mismo criterio que findContractNapId en ClientServiceDetailView.vue) —
// requiere fibra.napPuertosPorElemento cargado.
function findContractNapId(contractId: string): string {
  for (const puertos of Object.values(fibra.napPuertosPorElemento)) {
    const found = puertos.find((p) => p.contract_id === contractId && p.estado === 'ocupado');
    if (found) return found.infra_elemento_id;
  }
  return '';
}

// Al elegir el servicio/contrato (el "primer filtro", como en SmartOLT: el
// contrato ya trae NAP/MikroTik/PPPoE cargados desde que se creo el cliente
// — ver ClientServiceDetailView.vue) se jala todo lo que ya existe, para que
// este modal sea solo "activar" y no repetir datos que el tecnico ya cargo
// antes. Si algo no esta configurado en el contrato, se deja el campo
// editable (ver "manualNap"/"manualMikrotik" en el template) como fallback.
watch(selectedContractId, async () => {
  const contract = selectedContract.value;
  zoneId.value = contract?.zone_id ?? '';

  const plan = contract?.plans;
  if (plan?.olt_tcont_profile && plan?.olt_traffic_profile) {
    tcontProfile.value = plan.olt_tcont_profile;
    trafficProfile.value = plan.olt_traffic_profile;
    manualProfiles.value = false;
  } else {
    tcontProfile.value = '';
    trafficProfile.value = '';
    manualProfiles.value = true;
    void loadProfiles();
  }

  napId.value = '';
  manualNap.value = true;
  if (contract) {
    await fibra.fetchTodosNapPuertos();
    const foundNapId = findContractNapId(contract.id);
    if (foundNapId) {
      napId.value = foundNapId;
      manualNap.value = false;
    }
  }

  if (contract?.mikrotik_device_id && contract?.pppoe_username) {
    mikrotikDeviceId.value = contract.mikrotik_device_id;
    secretMode.value = 'existing';
    manualMikrotik.value = false;
    await onMikrotikDeviceChange();
    selectedSecretName.value = contract.pppoe_username;
    mikrotikProfile.value = contract.mikrotik_profile || plan?.mikrotik_profile || '';
  } else {
    mikrotikDeviceId.value = '';
    secretMode.value = 'create';
    manualMikrotik.value = true;
    mikrotikProfile.value = plan?.mikrotik_profile ?? '';
  }
});

// ---- 5) Zona ----
const zoneId = ref('');
const showNewZone = ref(false);
const newZoneName = ref('');
const savingZone = ref(false);

async function handleCreateZone() {
  const name = newZoneName.value.trim();
  if (!name) return;
  savingZone.value = true;
  try {
    const zone = await catalogs.createZone(name);
    zoneId.value = zone.id;
    showNewZone.value = false;
    newZoneName.value = '';
  } catch (e) {
    submitError.value = getErrorMessage(e, 'Error al crear la zona');
  } finally {
    savingZone.value = false;
  }
}

// ---- 6) Caja NAP (opcional) — mismo sistema real de capacidad que
// ClientServiceDetailView.vue, no los campos de texto libre de olt_onts ----
const napId = ref('');
// true cuando no hay caja NAP ya asignada en el contrato (o el tecnico pidio
// cambiarla) — mismo patron que manualProfiles.
const manualNap = ref(true);
function toggleManualNap() {
  manualNap.value = !manualNap.value;
  if (!manualNap.value) napId.value = findContractNapId(selectedContract.value?.id ?? '');
}
const napOptionsAll = computed(() =>
  infraStore.elementos
    .filter((e) => e.tipo === 'caja_nap')
    .map((e) => {
      const puertos = fibra.napPuertosPorElemento[e.id] ?? [];
      const used = puertos.filter((p) => p.estado === 'ocupado').length;
      const capacity = e.puertos_total ?? NAP_CLIENT_LIMIT;
      return { id: e.id, name: e.name, used, capacity, zoneId: e.zone_id };
    }),
);
const napOptions = computed(() => napOptionsAll.value.filter((n) => n.zoneId === zoneId.value));

// ---- 7) Modo ONU — solo Bridging por ahora (ver plan: no hay ni un comando
// OMCI de servicio implementado en este proyecto) ----

// ---- 8) MikroTik ----
const mikrotikDeviceId = ref('');
// true cuando el contrato NO trae ya router+usuario PPPoE (o el tecnico pidio
// cambiarlo) — mismo patron que manualProfiles/manualNap: si el contrato ya
// tiene todo, esta seccion solo se muestra como resumen de solo lectura.
const manualMikrotik = ref(true);
async function toggleManualMikrotik() {
  manualMikrotik.value = !manualMikrotik.value;
  if (manualMikrotik.value) return;
  const contract = selectedContract.value;
  if (!contract?.mikrotik_device_id) return;
  mikrotikDeviceId.value = contract.mikrotik_device_id;
  secretMode.value = contract.pppoe_username ? 'existing' : 'create';
  await onMikrotikDeviceChange();
  if (contract.pppoe_username) selectedSecretName.value = contract.pppoe_username;
  mikrotikProfile.value = contract.mikrotik_profile || contract.plans?.mikrotik_profile || '';
}
const mikrotikRoutersForZone = computed(() => {
  if (!zoneId.value) return mikrotikStore.devices;
  const inZone = mikrotikStore.devices.filter((d) => d.zone_id === zoneId.value);
  return inZone.length ? inZone : mikrotikStore.devices;
});

const secretMode = ref<'create' | 'existing'>('create');
const newSecretName = ref('');
const newSecretPassword = ref('');
const mikrotikProfile = ref('');
const mikrotikProfileNames = ref<string[]>([]);
const loadingMikrotikProfiles = ref(false);
const existingSecrets = ref<PppSecret[]>([]);
const loadingSecrets = ref(false);
const selectedSecretName = ref('');

// Excluye secretos ya vinculados a OTRO contrato del mismo router (mismo
// criterio que ClientServiceDetailView.vue) — requiere el listado completo
// de contratos, cargado en onMounted.
const availableSecrets = computed(() => {
  const linked = new Set(
    contractsStore.contracts
      .filter((c) => c.mikrotik_device_id === mikrotikDeviceId.value && c.id !== selectedContractId.value)
      .map((c) => c.pppoe_username),
  );
  return existingSecrets.value.filter((s) => !linked.has(s.name));
});

async function onMikrotikDeviceChange() {
  mikrotikProfileNames.value = [];
  existingSecrets.value = [];
  selectedSecretName.value = '';
  mikrotikProfile.value = '';
  if (!mikrotikDeviceId.value) return;
  loadingMikrotikProfiles.value = true;
  try {
    const list = await mikrotikStore.fetchPppProfiles(mikrotikDeviceId.value);
    mikrotikProfileNames.value = list.map((p) => p.name);
    // Reaplica el perfil del plan contratado si este router tambien lo tiene
    // configurado (mismo criterio que tcont/traffic: el plan manda).
    const planProfile = selectedContract.value?.plans?.mikrotik_profile;
    if (planProfile && mikrotikProfileNames.value.includes(planProfile)) mikrotikProfile.value = planProfile;
  } catch (e) {
    submitError.value = getErrorMessage(e, 'No se pudo leer los perfiles del router');
  } finally {
    loadingMikrotikProfiles.value = false;
  }
  if (secretMode.value === 'existing') await loadExistingSecrets();
}

async function loadExistingSecrets() {
  if (!mikrotikDeviceId.value) return;
  loadingSecrets.value = true;
  try {
    existingSecrets.value = await mikrotikStore.fetchPppSecrets(mikrotikDeviceId.value);
  } catch (e) {
    submitError.value = getErrorMessage(e, 'No se pudo leer los usuarios PPPoE del router');
  } finally {
    loadingSecrets.value = false;
  }
}

watch(secretMode, (mode) => {
  if (mode === 'existing' && mikrotikDeviceId.value) void loadExistingSecrets();
});

// ---- Envio ----
const submitting = ref(false);
const submitError = ref<string | null>(null);
const submitWarnings = ref<string[]>([]);
// true apenas el paso 1 (OLT) tiene exito — a partir de ahi la ONU YA existe
// en el equipo real, asi que el formulario nunca debe volver a enviarse (evitaria
// crear una segunda ONU duplicada); solo queda la opcion de cerrar el modal.
const ontCreated = ref(false);

function validate(): string | null {
  if (!serial.value.trim()) return 'El serial es obligatorio';
  if (!onuType.value.trim()) return 'El tipo de ONU es obligatorio';
  if (!tcontProfile.value || !trafficProfile.value) return 'Selecciona el perfil de subida y de bajada';
  if (!selectedClientId.value) return 'Selecciona un cliente';
  if (!selectedContractId.value) return 'Selecciona el servicio/contrato del cliente';
  if (!mikrotikDeviceId.value) return 'Selecciona el router MikroTik';
  if (secretMode.value === 'create') {
    if (!newSecretName.value.trim() || !newSecretPassword.value.trim() || !mikrotikProfile.value) {
      return 'Completa usuario, contraseña y perfil PPPoE';
    }
  } else if (!selectedSecretName.value || !mikrotikProfile.value) {
    return 'Elige el secreto PPPoE existente y su perfil';
  }
  return null;
}

async function handleAuthorize() {
  const validationError = validate();
  if (validationError) {
    submitError.value = validationError;
    return;
  }

  submitting.value = true;
  submitError.value = null;
  submitWarnings.value = [];

  // PASO 1 — OLT (duro: si falla, no se ejecuta nada mas).
  let ontRow: OltOnt;
  try {
    ontRow = await oltStore.registerOnt(props.deviceId, {
      slot: slot.value,
      port: port.value,
      serial: serial.value,
      onuType: onuType.value,
      description: description.value,
      vlan: vlan.value,
      tcontProfile: tcontProfile.value,
      trafficProfile: trafficProfile.value,
      clientId: selectedClientId.value,
      onuId: isLocked.value ? undefined : onuId.value === '' ? undefined : onuId.value,
    });
  } catch (e) {
    submitError.value = getErrorMessage(e, 'Error al registrar la ONT en la OLT');
    submitting.value = false;
    return;
  }
  ontCreated.value = true;

  // A partir de aqui la ONT YA existe en la OLT — cada paso siguiente es
  // best-effort (igual que handleContractSubmit en ClientServiceDetailView.vue):
  // nunca revierte el paso 1, solo acumula avisos.

  // PASO 2 — vincular cliente/contrato/zona.
  try {
    await oltStore.updateOntMeta(props.deviceId, ontRow.id, {
      client_id: selectedClientId.value,
      contract_id: selectedContractId.value,
      zone_id: zoneId.value || null,
    });
  } catch (e) {
    submitWarnings.value.push(getErrorMessage(e, 'La ONT se registró en la OLT, pero no se pudo vincular al cliente/contrato'));
  }

  // PASO 3 — Caja NAP (solo si se eligió una).
  if (napId.value) {
    try {
      const nap = napOptions.value.find((n) => n.id === napId.value);
      await fibra.assignContractToNap(napId.value, selectedContractId.value, selectedClientId.value, nap?.capacity ?? NAP_CLIENT_LIMIT);
    } catch (e) {
      submitWarnings.value.push(getErrorMessage(e, 'No se pudo asignar la caja NAP'));
    }
  }

  // PASO 4 — MikroTik: crear o vincular secreto PPPoE.
  let pppoeUsername: string | null = null;
  try {
    if (secretMode.value === 'create') {
      const secret = await mikrotikStore.createPppSecret(mikrotikDeviceId.value, {
        name: newSecretName.value.trim(),
        password: newSecretPassword.value,
        profile: mikrotikProfile.value,
        comment: description.value || undefined,
      });
      pppoeUsername = secret.name;
    } else {
      const secret = existingSecrets.value.find((s) => s.name === selectedSecretName.value);
      if (secret) await mikrotikStore.setPppSecretProfile(mikrotikDeviceId.value, secret['.id'], mikrotikProfile.value);
      pppoeUsername = selectedSecretName.value;
    }
  } catch (e) {
    submitWarnings.value.push(
      getErrorMessage(e, 'La ONT y el cliente quedaron registrados, pero no se pudo crear/activar la credencial PPPoE en MikroTik'),
    );
  }

  // PASO 5 — guardar la referencia MikroTik en el contrato (solo si el paso 4 dio un usuario).
  if (pppoeUsername) {
    try {
      await contractsStore.updateContract(selectedContractId.value, {
        mikrotik_device_id: mikrotikDeviceId.value,
        pppoe_username: pppoeUsername,
        mikrotik_profile: mikrotikProfile.value,
      });
    } catch (e) {
      submitWarnings.value.push(getErrorMessage(e, 'La credencial PPPoE se creó, pero no se pudo guardar en el contrato'));
    }
  }

  submitting.value = false;
  emit('authorized');
  // El modal se queda abierto mostrando el resultado (exito o avisos) — el
  // tecnico lo lee y cierra a mano (ver template, boton "Cerrar"). Los pasos
  // que fallaron se pueden completar despues desde las pantallas ya
  // existentes (ficha del cliente para MikroTik/NAP, tabla de ONTs para
  // reintentar vinculo).
}

onMounted(() => {
  void clientsStore.fetchClients();
  void catalogs.fetchZones();
  void mikrotikStore.fetchDevices();
  void infraStore.fetchElementos();
  void fibra.fetchTodosNapPuertos();
  void contractsStore.fetchContracts();
});
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay">
      <form class="w-full max-w-2xl modal-panel max-h-[90vh] overflow-y-auto" @submit.prevent="handleAuthorize">
        <h2 class="text-lg font-semibold mb-1">Autorizar ONU</h2>
        <p class="text-xs text-slate-500 mb-4">Aprovisiona la OLT, vincula al cliente y activa MikroTik en un solo paso.</p>

        <!-- 1) Identificacion heredada del escaneo -->
        <div class="mb-2 text-sm">
          <div class="text-xs text-slate-500">OLT</div>
          <div class="font-mono">{{ oltName || 'OLT' }}</div>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2 text-sm">
          <div>
            <div class="text-xs text-slate-500">Board</div>
            <div v-if="isLocked" class="font-mono">{{ slot }}</div>
            <input v-else v-model.number="slot" type="number" min="1" class="field-input" />
          </div>
          <div>
            <div class="text-xs text-slate-500">Port</div>
            <div v-if="isLocked" class="font-mono">{{ port }}</div>
            <input v-else v-model.number="port" type="number" min="1" class="field-input" />
          </div>
          <div class="col-span-2">
            <div class="text-xs text-slate-500">Serial (SN)</div>
            <div v-if="isLocked" class="font-mono">{{ serial }} <span class="text-[10px] text-slate-400">(detectado por escaneo)</span></div>
            <input v-else v-model="serial" placeholder="ZTEGC1234567" class="field-input font-mono" />
          </div>
        </div>
        <div class="mb-4">
          <div class="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span>Ocupación del puerto PON</span>
            <span>{{ ponUsed }}/{{ PON_PORT_MAX_ONUS }}</span>
          </div>
          <div class="h-1.5 rounded-full bg-slate-200 overflow-hidden">
            <div class="h-full bg-sky-500" :style="{ width: `${Math.min(100, (ponUsed / PON_PORT_MAX_ONUS) * 100)}%` }"></div>
          </div>
        </div>

        <!-- 3) Cliente -->
        <h3 class="text-sm font-semibold mb-2 pt-3 border-t border-slate-200">Cliente y servicio</h3>
        <div class="mb-3">
          <label class="block text-xs text-slate-600 mb-1">Cliente</label>
          <input v-model="clientFilter" placeholder="Buscar por nombre o documento..." class="field-input mb-2" />
          <select v-model="selectedClientId" required size="5" class="field-input" @change="onClientChange">
            <option v-for="c in filteredClients" :key="c.id" :value="c.id">{{ c.first_name }} {{ c.last_name }} — {{ c.document_number }}</option>
          </select>
        </div>

        <!-- 4) Contrato -->
        <div v-if="selectedClientId" class="mb-3">
          <label class="block text-xs text-slate-600 mb-1">Servicio/línea</label>
          <select v-model="selectedContractId" required class="field-input" :disabled="loadingContracts">
            <option value="" disabled>{{ loadingContracts ? 'Cargando...' : 'Selecciona un servicio' }}</option>
            <option v-for="ct in contracts" :key="ct.id" :value="ct.id">{{ ct.contract_number }} — {{ ct.installation_address || 'Sin dirección' }}</option>
          </select>
          <p v-if="!loadingContracts && !contracts.length" class="text-xs text-amber-700 mt-1">
            Este cliente no tiene un servicio contratado — créalo primero en su ficha ("+ Nuevo servicio").
          </p>
        </div>

        <!-- 5/6) Zona y Caja NAP -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="block text-xs text-slate-600">Zona</label>
              <button type="button" class="text-xs text-sky-700 hover:underline" @click="showNewZone = !showNewZone">
                {{ showNewZone ? 'Cancelar' : '+ Nueva zona' }}
              </button>
            </div>
            <select v-if="!showNewZone" v-model="zoneId" class="field-input">
              <option value="">Sin asignar</option>
              <option v-for="z in catalogs.zones" :key="z.id" :value="z.id">{{ z.name }}</option>
            </select>
            <div v-else class="flex gap-2">
              <input v-model="newZoneName" placeholder="Nombre de la zona" class="field-input flex-1" @keydown.enter.prevent="handleCreateZone" />
              <button type="button" :disabled="savingZone || !newZoneName.trim()" class="btn-primary" @click="handleCreateZone">
                {{ savingZone ? '...' : 'Agregar' }}
              </button>
            </div>
          </div>
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="block text-xs text-slate-600">Caja NAP</label>
              <button v-if="!manualNap" type="button" class="text-xs text-sky-700 hover:underline" @click="toggleManualNap">
                Cambiar
              </button>
            </div>
            <div v-if="!manualNap" class="rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm font-mono">
              {{ napOptionsAll.find((n) => n.id === napId)?.name ?? napId }}
            </div>
            <template v-else>
              <select v-model="napId" class="field-input" :disabled="!zoneId">
                <option value="">Sin asignar</option>
                <option v-for="n in napOptions" :key="n.id" :value="n.id">{{ n.name }} — {{ n.used }}/{{ n.capacity }}{{ n.used >= n.capacity ? ' (LLENA)' : '' }}</option>
              </select>
              <p v-if="!zoneId" class="text-xs text-slate-400 mt-1">Elige primero una zona para ver sus cajas NAP.</p>
              <p v-else-if="!napOptions.length" class="text-xs text-slate-400 mt-1">Esa zona no tiene cajas NAP asignadas.</p>
            </template>
          </div>
        </div>

        <!-- 7) Modo ONU + 8) Red/OLT -->
        <h3 class="text-sm font-semibold mb-2 pt-3 border-t border-slate-200">Configuración en la OLT</h3>
        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="block text-xs text-slate-600 mb-1">Modo ONU</label>
            <select disabled class="field-input opacity-60">
              <option>Bridging</option>
            </select>
            <p class="text-[11px] text-slate-400 mt-1">Routing próximamente</p>
          </div>
          <div v-if="!isLocked">
            <label class="block text-xs text-slate-600 mb-1">ID de ONU (vacío = auto)</label>
            <input v-model.number="onuId" type="number" min="0" placeholder="auto" class="field-input" />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="block text-xs text-slate-600 mb-1">VLAN de servicio</label>
            <input v-model.number="vlan" type="number" class="field-input" />
          </div>
          <div>
            <label class="block text-xs text-slate-600 mb-1">Perfil OMCI / Tipo de ONU</label>
            <input v-model="onuType" required placeholder="ej. ZTE-F660" class="field-input" />
          </div>
        </div>
        <div class="mb-3">
          <label class="block text-xs text-slate-600 mb-1">Descripción</label>
          <input v-model="description" placeholder="Nombre del cliente" class="field-input" />
        </div>
        <div class="mb-4">
          <div class="flex items-center justify-between mb-1">
            <label class="block text-xs text-slate-600">Velocidad OLT (segun el plan del contrato)</label>
            <button
              v-if="selectedContract?.plans?.olt_tcont_profile && selectedContract?.plans?.olt_traffic_profile"
              type="button"
              class="text-xs text-sky-700 hover:underline"
              @click="toggleManualProfiles"
            >
              {{ manualProfiles ? 'Usar el perfil del plan' : 'Usar otro perfil (avanzado)' }}
            </button>
          </div>

          <p v-if="!selectedContract" class="text-xs text-slate-400">
            Selecciona primero el cliente y su servicio — el perfil de la OLT se toma de su plan contratado.
          </p>

          <div v-else-if="!manualProfiles" class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <p class="font-medium">{{ selectedContract.plans?.name }}</p>
            <p class="text-xs text-slate-500 font-mono">{{ tcontProfile }} / {{ trafficProfile }}</p>
          </div>

          <template v-else>
            <p v-if="selectedContract && !selectedContract.plans?.olt_tcont_profile" class="text-xs text-amber-700 mb-2">
              El plan "{{ selectedContract.plans?.name }}" no tiene perfiles OLT configurados (ver Planes) — elige uno manualmente.
            </p>
            <p v-if="profilesError" class="text-xs text-red-600 mb-2">{{ profilesError }}</p>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs text-slate-600 mb-1">Perfil de subida (tcont)</label>
                <select v-model="tcontProfile" required class="field-input" :disabled="profilesLoading">
                  <option value="" disabled>{{ profilesLoading ? 'Cargando...' : 'Selecciona un plan' }}</option>
                  <option v-for="p in profiles.tcontProfiles" :key="p" :value="p">{{ p }}</option>
                </select>
              </div>
              <div>
                <label class="block text-xs text-slate-600 mb-1">Perfil de bajada (traffic)</label>
                <select v-model="trafficProfile" required class="field-input" :disabled="profilesLoading">
                  <option value="" disabled>{{ profilesLoading ? 'Cargando...' : 'Selecciona un plan' }}</option>
                  <option v-for="p in profiles.trafficProfiles" :key="p" :value="p">{{ p }}</option>
                </select>
              </div>
            </div>
          </template>
        </div>

        <!-- 9) MikroTik -->
        <div class="flex items-center justify-between mb-2 pt-3 border-t border-slate-200">
          <h3 class="text-sm font-semibold">Sincronización MikroTik</h3>
          <button v-if="!manualMikrotik" type="button" class="text-xs text-sky-700 hover:underline" @click="toggleManualMikrotik">
            Cambiar
          </button>
        </div>

        <div v-if="!manualMikrotik" class="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <p><span class="text-slate-500">Router:</span> {{ mikrotikStore.devices.find((d) => d.id === mikrotikDeviceId)?.name ?? mikrotikDeviceId }}</p>
          <p><span class="text-slate-500">Usuario PPPoE:</span> <span class="font-mono">{{ selectedSecretName }}</span></p>
          <p><span class="text-slate-500">Perfil:</span> <span class="font-mono">{{ mikrotikProfile || '—' }}</span></p>
        </div>

        <template v-else>
          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Router MikroTik</label>
            <select v-model="mikrotikDeviceId" required class="field-input" @change="onMikrotikDeviceChange">
              <option value="" disabled>Selecciona un router</option>
              <option v-for="d in mikrotikRoutersForZone" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
          </div>
          <div class="flex gap-4 mb-3 text-sm">
            <label class="flex items-center gap-1.5">
              <input v-model="secretMode" type="radio" value="create" /> Crear credencial nueva
            </label>
            <label class="flex items-center gap-1.5">
              <input v-model="secretMode" type="radio" value="existing" /> Vincular usuario PPPoE existente
            </label>
          </div>
          <div v-if="secretMode === 'create'" class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Usuario PPPoE</label>
              <input v-model="newSecretName" class="field-input" placeholder="usuario.pppoe" />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Contraseña</label>
              <input v-model="newSecretPassword" class="field-input" />
            </div>
          </div>
          <div v-else class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Usuario PPPoE existente</label>
            <select v-model="selectedSecretName" class="field-input" :disabled="!mikrotikDeviceId || loadingSecrets">
              <option value="" disabled>{{ loadingSecrets ? 'Cargando...' : 'Selecciona un secreto' }}</option>
              <option v-for="s in availableSecrets" :key="s['.id']" :value="s.name">{{ s.name }}</option>
            </select>
          </div>
          <div class="mb-4">
            <label class="block text-xs text-slate-600 mb-1">Perfil PPPoE (MikroTik)</label>
            <select v-model="mikrotikProfile" class="field-input" :disabled="!mikrotikDeviceId || loadingMikrotikProfiles">
              <option value="" disabled>{{ loadingMikrotikProfiles ? 'Cargando...' : 'Selecciona un perfil' }}</option>
              <option v-for="p in mikrotikProfileNames" :key="p" :value="p">{{ p }}</option>
            </select>
          </div>
        </template>

        <p v-if="submitError" class="text-sm text-red-600 mb-3">{{ submitError }}</p>
        <div v-if="ontCreated && !submitWarnings.length" class="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3">
          <p class="text-sm font-semibold text-emerald-800">
            ONU registrada exitosamente en OLT y sincronizada con MikroTik.
          </p>
        </div>
        <div v-if="submitWarnings.length" class="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p class="text-sm font-semibold text-amber-800 mb-1">La ONU quedó registrada, pero con avisos:</p>
          <ul class="text-xs text-amber-800 list-disc pl-4 space-y-0.5">
            <li v-for="(w, i) in submitWarnings" :key="i">{{ w }}</li>
          </ul>
        </div>

        <div class="flex justify-end gap-2">
          <template v-if="!ontCreated">
            <button type="button" class="btn-ghost" @click="emit('close')">Cancelar</button>
            <button type="submit" :disabled="submitting" class="btn-primary">
              {{ submitting ? 'Autorizando...' : 'Autorizar y Activar' }}
            </button>
          </template>
          <button v-else type="button" class="btn-primary" @click="emit('authorized'); emit('close')">Cerrar</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>
