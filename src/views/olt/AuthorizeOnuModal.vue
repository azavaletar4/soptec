<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import QrScannerModal from '@/components/campo/QrScannerModal.vue';
import { useOltStore, type ProvisionResponse, type ProvisionOutcome } from '@/stores/olt';
import { useClientsStore } from '@/stores/clients';
import { useContractsStore } from '@/stores/contracts';
import { useCatalogsStore } from '@/stores/catalogs';
import { useMikrotikStore } from '@/stores/mikrotik';
import { useInfraElementosStore } from '@/stores/infraElementos';
import { useFoFibraStore } from '@/stores/foFibra';
import { NAP_CLIENT_LIMIT, type ServiceContract } from '@/types/domain';
import { getErrorMessage } from '@/lib/errors';
import { createProvisioningKey, classifyProvisioningResult, validateProvisioningWan } from '@/lib/provisioningUi';

const props = defineProps<{
  deviceId: string;
  oltName?: string;
  prefill?: { serial: string; shelf?: number; slot: number; port: number; clientId?: string; contractId?: string } | null;
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
const shelf = ref(props.prefill?.shelf ?? 1);
const slot = ref(props.prefill?.slot ?? 1);
const port = ref(props.prefill?.port ?? 1);
const serial = ref(props.prefill?.serial ?? '');
const qrOpen = ref(false);

// Limite de hardware GPON tipico en tarjetas ZTE (onu-id 1-128 por puerto
// PON) — puramente informativo, nunca bloquea el registro (la OLT real es la
// que decide si acepta o no el onu-id).
const PON_PORT_MAX_ONUS = 128;
const ponUsed = computed(
  () => oltStore.onts.filter((o) => o.olt_device_id === props.deviceId && o.frame === shelf.value && o.slot === slot.value && o.port === port.value).length,
);

// ---- 2) Red / OLT ----
const onuId = ref<number | ''>('');
// El "tipo de ONU" no es la marca del equipo (ej. "huawei") sino un
// perfil OMCI que YA debe existir configurado en la OLT — si se escribe uno
// que la OLT no reconoce, el comando "onu <id> type <tipo> sn <serial>" se
// ignora en silencio: la ONU nunca queda realmente creada (no sale en "show
// gpon onu state"), pero como runTelnetCommands no valida cada comando, el
// registro se guarda igual como "online" en la base — visto en vivo
// 2026-09-30 con un serial Huawei real registrado como tipo "huawei"
// (inexistente en esta OLT: de 706 ONTs reales, 703 usan "GPT-2741GNAC").
// Por eso se precarga con el tipo mas usado en ESTA OLT en vez de dejarlo en
// blanco — sigue editable para el caso real de un modelo distinto.
function mostCommonOnuType(): string {
  const counts = new Map<string, number>();
  for (const o of oltStore.onts) {
    if (o.olt_device_id !== props.deviceId || !o.onu_type) continue;
    counts.set(o.onu_type, (counts.get(o.onu_type) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [type, count] of counts) {
    if (count > bestCount) {
      best = type;
      bestCount = count;
    }
  }
  return best;
}
const onuType = ref(mostCommonOnuType());
const description = ref('');
// VLAN de servicio habitual de la red Rayco; editable antes de autorizar.
const vlan = ref(120);
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

// ---- 3) Cliente (mismo patron de busqueda que OperacionesHoyView.vue/InstalacionesView.vue) ----
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
// editable para NAP como fallback. PPPoE siempre se toma del contrato.
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
    selectedSecretName.value = contract.pppoe_username;
    mikrotikProfile.value = contract.mikrotik_profile || '';
  } else {
    mikrotikDeviceId.value = '';
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

// ---- 7) Modo ONU ----
// ONUs router/HGU: el backend envia WAN/PPPoE por OMCI si se solicita.
// La aceptacion del comando no confirma una sesion PPPoE ni navegacion.

// ---- 8) MikroTik ----
const mikrotikDeviceId = ref('');
// PPPoE is a read-only contract reference. Authorization never creates a secret.
const mikrotikProfile = ref('');
const selectedSecretName = ref('');
const existingSecretPassword = ref('');
const deferWan = ref(true);
const wanVlanProfile = ref('');
watch([mikrotikDeviceId, selectedSecretName], () => { existingSecretPassword.value = ''; });

// ---- Envio ----
const submitting = ref(false);
const submitError = ref<string | null>(null);
const submitWarnings = ref<string[]>([]);
// Success requires the server to confirm the complete operation, including its ONT row.
const ontCreated = ref(false);

// ---- Aprovisionamiento confiable (Fase 2) ----
// Se genera UNA SOLA VEZ por apertura de este modal (no dentro de
// handleAuthorize) y nunca se regenera mientras siga abierto — asi un
// doble-clic o un reintento manual tras un error transitorio (ej. de red)
// SIEMPRE llega al backend con la misma clave, que la reconoce como la
// MISMA solicitud en vez de repetir el comando de alta en la OLT (ver
// POST /:id/onts/provision en routes/olt.ts). Cerrar y volver a abrir el
// modal (ej. para otra ONU) si arranca una clave nueva.
// Retain the operation's key across closing/reopening and a lost HTTP response.
// Only non-secret identifiers are stored; passwords remain in memory.
const recoveryStorageKey = `smartrayco:provision:${props.deviceId}:${props.prefill?.serial ?? 'manual'}`;
function readRecovery(): { key: string; operationId?: string } | null {
  try { const value = JSON.parse(localStorage.getItem(recoveryStorageKey) ?? 'null'); return typeof value?.key === 'string' ? value : null; } catch { return null; }
}
const recovery = readRecovery();
const idempotencyKey = ref(recovery?.key || createProvisioningKey());
function saveRecovery() {
  try { localStorage.setItem(recoveryStorageKey, JSON.stringify({ key: idempotencyKey.value, operationId: provisionOperationId.value })); } catch { /* Storage can be disabled; the in-memory key is still retained. */ }
}

const provisionOperationId = ref<string | null>(recovery?.operationId ?? null);
const lastOutcome = ref<ProvisionOutcome | null>(null);
// A pending operation or a lost response must be reconciled with its original key.
const recoveryRequired = ref(!!recovery);
const needsReconcile = computed(() => recoveryRequired.value || ['uncertain', 'verify_uncertain'].includes(lastOutcome.value?.kind ?? ''));

function describeOutcome(outcome: ProvisionOutcome): string {
  switch (outcome.kind) {
    case 'rejected':
      return outcome.message ?? 'La OLT rechazo el comando de alta.';
    case 'verify_uncertain':
    case 'uncertain':
      return `${outcome.message ?? 'La OLT no confirmo si el comando se aplico.'} Usa "Verificar antes de reintentar" en vez de volver a enviar el formulario.`;
    case 'verify_mismatch': {
      const campos = (outcome.mismatches ?? []).map((m) => m.field).join(', ');
      return `La OLT quedo con datos distintos a los solicitados (${campos}) — revisa antes de continuar, no se marco como completado.`;
    }
    case 'conflict_elsewhere':
      return `Ese serial ya esta registrado en gpon-onu_${outcome.at?.shelf}/${outcome.at?.slot}/${outcome.at?.port}:${outcome.at?.onuId} — no se toco nada. Si es una reconexion, gestionala desde "Desconfiguradas / Por Reconectar".`;
    case 'conflict_same_position_different_config':
      return 'Ya existe una ONU distinta en esa misma posicion de la OLT, con otra configuracion — no se sobreescribio. Revisa manualmente antes de continuar.';
    case 'capacity_full':
      return 'No quedan onu-id libres en ese puerto PON (capacidad agotada).';
    case 'scan_unreliable':
    case 'invalid':
      return outcome.message ?? 'Datos invalidos.';
    default:
      return 'No se pudo confirmar el registro en la OLT.';
  }
}

function continuationPayload() {
  return {
    zoneId: zoneId.value || null, napId: napId.value || null,
    pppoeReference: { deviceId: mikrotikDeviceId.value, username: selectedSecretName.value, profile: mikrotikProfile.value },
    wan: !deferWan.value && existingSecretPassword.value ? {
      username: selectedSecretName.value, password: existingSecretPassword.value,
      vlanProfile: wanVlanProfile.value.trim() || String(vlan.value),
    } : undefined,
  };
}

function applyProvisionResult(result: ProvisionResponse) {
  provisionOperationId.value = result.operation.id;
  saveRecovery();
  lastOutcome.value = result.outcome;
  const status = classifyProvisioningResult(result);
  submitWarnings.value = status.warnings;
  ontCreated.value = status.complete;
  recoveryRequired.value = !status.complete;
  if (!status.oltOk) submitError.value = describeOutcome(result.outcome);
  else if (!status.complete) submitError.value = 'La OLT esta confirmada, pero la operacion sigue pendiente. Puedes verificar y reintentar las etapas faltantes.';
  else {
    try { localStorage.removeItem(recoveryStorageKey); } catch { /* optional */ }
    emit('authorized');
  }
}

async function handleReconcile() {
  if (submitting.value) return;
  submitting.value = true;
  submitError.value = null;
  try {
    if (!provisionOperationId.value) {
      const saved = await oltStore.fetchProvisioningOperationByKey(props.deviceId, idempotencyKey.value);
      if (!saved) { recoveryRequired.value = false; submitError.value = 'El intento no llego al servidor; puedes enviarlo con la misma clave.'; return; }
      provisionOperationId.value = saved.id;
      saveRecovery();
    }
    applyProvisionResult(await oltStore.reconcileProvisioning(props.deviceId, provisionOperationId.value, continuationPayload()));
  } catch (e) {
    recoveryRequired.value = true;
    submitError.value = getErrorMessage(e, 'Error al verificar la operacion; conserva este intento');
  } finally { submitting.value = false; }
}

function validate(): string | null {
  if (!serial.value.trim()) return 'El serial es obligatorio';
  if (!onuType.value.trim()) return 'El tipo de ONU es obligatorio';
  if (!tcontProfile.value || !trafficProfile.value) return 'Selecciona el perfil de subida y de bajada';
  if (!selectedClientId.value) return 'Selecciona un cliente';
  if (!selectedContractId.value) return 'Selecciona el servicio/contrato del cliente';
  if (!mikrotikDeviceId.value) return 'Selecciona el router MikroTik';
  const contract = selectedContract.value;
  if (!contract?.pppoe_username || !contract.mikrotik_profile ||
      contract.pppoe_username !== selectedSecretName.value ||
      contract.mikrotik_device_id !== mikrotikDeviceId.value || contract.mikrotik_profile !== mikrotikProfile.value) {
    return 'Vincula primero router, usuario y perfil PPPoE al contrato desde la ficha del cliente. Autorizar solo usa esa referencia.';
  }
  return validateProvisioningWan(deferWan.value, existingSecretPassword.value);
}

async function handleAuthorize() {
  if (submitting.value || recoveryRequired.value) return;
  const validationError = validate();
  if (validationError) {
    submitError.value = validationError;
    return;
  }

  submitting.value = true;
  submitError.value = null;
  submitWarnings.value = [];

  // PASO 1 — OLT, idempotente y verificada (Fase 2, ver
  // oltProvisioningService.ts): el backend reescanea la OLT en vivo antes
  // de escribir (serial-existe / id-libre), y relee despues de escribir
  // para confirmar que quedo tal como se pidio. Un resultado que no sea
  // "registered"/"already_registered" NUNCA se trata como exito, y nunca
  // se sigue con los pasos 2-6 sobre una OLT que no esta confirmada.
  let result: Awaited<ReturnType<typeof oltStore.provisionOnt>>;
  saveRecovery();
  try {
    result = await oltStore.provisionOnt(props.deviceId, {
      ...continuationPayload(),
      idempotencyKey: idempotencyKey.value,
      shelf: shelf.value,
      slot: slot.value,
      port: port.value,
      serial: serial.value,
      onuType: onuType.value,
      description: description.value,
      vlan: vlan.value,
      tcontProfile: tcontProfile.value,
      trafficProfile: trafficProfile.value,
      clientId: selectedClientId.value,
      contractId: selectedContractId.value,
      onuId: isLocked.value ? undefined : onuId.value === '' ? undefined : onuId.value,
    });
  } catch (e) {
    recoveryRequired.value = true;
    submitError.value = getErrorMessage(e, 'Se perdio la respuesta. Consulta el estado del mismo intento antes de continuar.');
    submitting.value = false;
    return;
  }

  applyProvisionResult(result);
  submitting.value = false;
}

onMounted(async () => {
  void catalogs.fetchZones();
  void mikrotikStore.fetchDevices();
  void infraStore.fetchElementos();
  void fibra.fetchTodosNapPuertos();
  void contractsStore.fetchContracts();
  await clientsStore.fetchClients();

  // Viene de "Desconfiguradas / Por Reconectar" (ReconnectOntsTab.vue): el
  // cliente (y a veces el contrato exacto) ya se conocen de antes — se
  // preseleccionan para no obligar al tecnico a volver a buscarlos/escribirlos.
  if (props.prefill?.clientId) {
    selectedClientId.value = props.prefill.clientId;
    const client = clientsStore.clients.find((c) => c.id === props.prefill!.clientId);
    if (client) clientFilter.value = client.document_number;
    await onClientChange();
    if (props.prefill.contractId) selectedContractId.value = props.prefill.contractId;
  }
  if (recovery) {
    submitting.value = true;
    try {
      const saved = await oltStore.fetchProvisioningOperationByKey(props.deviceId, idempotencyKey.value);
      if (saved) {
        provisionOperationId.value = saved.id;
        serial.value = saved.serial; shelf.value = saved.frame; slot.value = saved.slot; port.value = saved.port;
        selectedClientId.value = saved.client_id ?? '';
        await onClientChange();
        selectedContractId.value = saved.contract_id ?? '';
        const requested = saved.requested;
        onuType.value = String(requested.onuType ?? ''); vlan.value = Number(requested.vlan);
        tcontProfile.value = String(requested.tcontProfile ?? ''); trafficProfile.value = String(requested.trafficProfile ?? '');
        description.value = String(requested.description ?? ''); zoneId.value = String(requested.zoneId ?? ''); napId.value = String(requested.napId ?? '');
        const w = requested.wan as Record<string, unknown> | undefined;
        deferWan.value = !w;
        wanVlanProfile.value = String(w?.vlanProfile ?? '');
        const p = requested.pppoeReference as Record<string, unknown> | undefined;
        if (p) {
          mikrotikDeviceId.value = String(p.deviceId ?? ''); selectedSecretName.value = String(p.username ?? '');
          mikrotikProfile.value = String(p.profile ?? '');
        }
        saveRecovery();
        submitError.value = 'Se recupero el intento anterior. Verifica su estado; si necesita una clave PPPoE, vuelve a ingresarla.';
      } else {
        // No operation exists: the previous request did not reach creation.
        recoveryRequired.value = false;
      }
    } catch (e) {
      submitError.value = getErrorMessage(e, 'No se pudo recuperar el intento anterior. Cierra y vuelve a abrir para consultar antes de continuar.');
    } finally { submitting.value = false; }
  }

});
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay">
      <form class="w-full max-w-2xl modal-panel max-h-[90vh] overflow-y-auto" @submit.prevent="handleAuthorize">
        <h2 class="text-lg font-semibold mb-1">Autorizar ONU</h2>
        <p class="text-xs text-slate-500 mb-4">Aprovisiona la OLT y vincula la ONU al contrato del cliente.</p>

        <!-- 1) Identificacion heredada del escaneo -->
        <div class="mb-2 text-sm">
          <div class="text-xs text-slate-500">OLT</div>
          <div class="font-mono">{{ oltName || 'OLT' }}</div>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2 text-sm">
          <div>
            <div class="text-xs text-slate-500">Shelf</div>
            <div v-if="isLocked" class="font-mono">{{ shelf }}</div>
            <input v-else v-model.number="shelf" type="number" min="1" class="field-input" />
          </div>
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
            <div v-else class="flex gap-2">
              <input v-model="serial" placeholder="ZTEGC1234567" class="field-input font-mono" />
              <button type="button" class="btn-secondary" :disabled="recoveryRequired" @click="qrOpen = true">QR</button>
            </div>
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
              <option>Routing (router/HGU)</option>
            </select>
            <p class="text-[11px] text-slate-400 mt-1">
              SmartRayco configura WAN/PPPoE cuando ingresas la clave. Si no la tienes, completa el WAN despues desde la ficha de la ONU.
            </p>
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
            <input v-model="onuType" required placeholder="ej. GPT-2741GNAC" class="field-input" />
            <p class="text-[11px] text-slate-400 mt-1">
              Debe ser un tipo YA configurado en esta OLT (no la marca del equipo) — se precarga con el mas usado aqui.
            </p>
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
          <h3 class="text-sm font-semibold">PPPoE del contrato</h3>
        </div>
        <div class="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <p><span class="text-slate-500">Router:</span> {{ mikrotikStore.devices.find((d) => d.id === mikrotikDeviceId)?.name ?? 'Sin vincular' }}</p>
          <p><span class="text-slate-500">Usuario PPPoE:</span> <span class="font-mono">{{ selectedSecretName || 'Sin vincular' }}</span></p>
          <p><span class="text-slate-500">Perfil:</span> <span class="font-mono">{{ mikrotikProfile || 'Sin vincular' }}</span></p>
          <p class="text-xs text-slate-500 mt-2">Referencia del contrato. Autorizar no modifica este usuario, su contraseña, perfil ni estado en MikroTik. Vincúlalo previamente desde la ficha del cliente.</p>
        </div>

        <div class="mb-4 rounded-lg border border-slate-200 p-3">
          <h3 class="text-sm font-semibold mb-2">WAN/PPPoE de la ONU</h3>
          <label class="flex items-center gap-2 text-sm mb-3">
            <input v-model="deferWan" type="checkbox" :disabled="recoveryRequired" />
            Configurar WAN manualmente desde la web de la ONT (modo habitual)
          </label>
          <p v-if="deferWan" class="text-xs text-amber-700">
            SmartRayco no enviará la WAN a la ONT ni pedirá su contraseña PPPoE existente. Configúrala desde la web de la ONT. Desmarca esta opción si deseas enviarla desde la OLT.
          </p>
          <template v-else>
            <div class="mb-3">
              <label class="block text-xs text-slate-600 mb-1">Contraseña PPPoE actual de {{ selectedSecretName || 'este usuario' }}</label>
              <input v-model="existingSecretPassword" type="password" autocomplete="new-password" class="field-input" />
              <p class="text-xs text-slate-500 mt-1">Usa la misma contraseña de MikroTik. Se enviará a la ONU sin cambiar la credencial existente en el router.</p>
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Perfil VLAN de la WAN (ya existente en la OLT)</label>
              <input v-model="wanVlanProfile" class="field-input" :placeholder="String(vlan)" :disabled="recoveryRequired" />
              <p class="text-xs text-slate-500 mt-1">Si lo dejas vacío, se usará {{ vlan }} como nombre del perfil. Si tu OLT usa otro nombre, escríbelo aquí.</p>
            </div>
          </template>
        </div>

        <div v-if="submitError && needsReconcile" class="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p class="text-sm font-semibold text-amber-800 mb-1">Operacion pendiente de verificacion</p>
          <p class="text-xs text-amber-800">{{ submitError }}</p>
        </div>
        <p v-else-if="submitError" class="text-sm text-red-600 mb-3">{{ submitError }}</p>
        <div v-if="ontCreated && !submitWarnings.length" class="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3">
          <p class="text-sm font-semibold text-emerald-800">
            ONU registrada y VERIFICADA en la OLT (serial/posición/VLAN/perfiles confirmados contra el equipo), vinculada al contrato. Configuración WAN/PPPoE enviada; comprueba la conexión PPPoE y la navegación del equipo.
          </p>
        </div>
        <div v-if="submitWarnings.length" class="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p class="text-sm font-semibold text-amber-800 mb-1">La ONU quedó registrada y verificada en la OLT, pero con avisos:</p>
          <ul class="text-xs text-amber-800 list-disc pl-4 space-y-0.5">
            <li v-for="(w, i) in submitWarnings" :key="i">{{ w }}</li>
          </ul>
        </div>

        <div class="flex justify-end gap-2">
          <template v-if="!ontCreated && needsReconcile">
            <button type="button" class="btn-ghost" @click="emit('close')">Cancelar</button>
            <button type="button" :disabled="submitting" class="btn-primary" @click="handleReconcile">
              {{ submitting ? 'Verificando...' : 'Verificar antes de reintentar' }}
            </button>
          </template>
          <template v-else-if="!ontCreated">
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
    <QrScannerModal :open="qrOpen" @close="qrOpen = false" @scan="serial = $event; qrOpen = false" />
</template>
