<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useOltStore, type OltOnt, type OltHealth, type UnconfiguredOnt, type DisabledOnt } from '@/stores/olt';
import { useTr069Store } from '@/stores/tr069';
import { useCatalogsStore } from '@/stores/catalogs';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/lib/errors';
import OntDetailModal from './OntDetailModal.vue';
import OntZoneEditModal from './OntZoneEditModal.vue';
import UnconfiguredOntsTab from './UnconfiguredOntsTab.vue';
import ReconnectOntsTab from './ReconnectOntsTab.vue';
import DisabledOntsTab from './DisabledOntsTab.vue';
import AuthorizeOnuModal from './AuthorizeOnuModal.vue';

const route = useRoute();
const router = useRouter();
const oltStore = useOltStore();
const tr069Store = useTr069Store();
const catalogsStore = useCatalogsStore();
const auth = useAuthStore();

// Registrar una ONT en la OLT es aprovisionamiento de red — solo
// administracion (mismo criterio que ONT_PROVISION en el backend, olt.ts).
const canAuthorizeOnt = computed(() => ['SUPERADMIN', 'ADMIN'].includes(auth.role ?? ''));

const deviceId = computed(() => route.params.id as string);
const device = computed(() => oltStore.devices.find((d) => d.id === deviceId.value));
const deviceZoneName = computed(
  () => catalogsStore.zones.find((z) => z.id === device.value?.zone_id)?.name ?? null,
);

const detailOntId = ref<string | null>(null);
const detailOnt = computed(() => oltStore.onts.find((o) => o.id === detailOntId.value) ?? null);
function openOntDetail(ont: OltOnt) {
  detailOntId.value = ont.id;
}
function handleOpenTr069FromDetail(ont: OltOnt) {
  detailOntId.value = null;
  openTr069Modal(ont);
}

const zoneEditOntId = ref<string | null>(null);
const zoneEditOnt = computed(() => oltStore.onts.find((o) => o.id === zoneEditOntId.value) ?? null);
function openZoneEdit(ont: OltOnt) {
  zoneEditOntId.value = ont.id;
}
function handleEditZoneFromDetail(ont: OltOnt) {
  detailOntId.value = null;
  openZoneEdit(ont);
}

const slot = ref(1);
const port = ref(1);
const syncing = ref(false);
const syncMessage = ref<string | null>(null);

const showAuthorizeModal = ref(false);
const authorizePrefill = ref<{ serial: string; slot: number; port: number; clientId?: string; contractId?: string } | null>(null);
function openAuthorize(prefill?: { serial: string; slot: number; port: number; clientId?: string; contractId?: string }) {
  // Sin prefill real (boton "+ Registrar ONT"): igual se hereda el slot/port
  // ya elegido en el selector PON de arriba, pero el serial queda vacio para
  // escribirlo a mano (AuthorizeOnuModal solo bloquea Serial/Board/Port
  // cuando el serial viene de una fila realmente escaneada).
  authorizePrefill.value = prefill ?? { serial: '', slot: slot.value, port: port.value };
  showAuthorizeModal.value = true;
}

const ontSearch = ref('');

// Mismo umbral que server/src/routes/olt.ts (LOW_SIGNAL_THRESHOLD_DBM) — se
// usa aqui solo para filtrar la tabla de abajo, el conteo real de la
// tarjeta "Señales bajas" sigue viniendo del backend.
const LOW_SIGNAL_THRESHOLD_DBM = -27;

type OntStatusFilter = 'all' | 'online' | 'offline' | 'lowSignal';
const statusFilter = ref<OntStatusFilter>('all');
const STATUS_FILTER_LABEL: Record<OntStatusFilter, string> = {
  all: 'Todas',
  online: 'Online',
  offline: 'Total offline',
  lowSignal: 'Señales bajas',
};

const ontsTableEl = ref<HTMLElement | null>(null);
/** Usado por las tarjetas del resumen: filtra la tabla de ONTs y hace scroll hasta ella. */
function filterOntsBy(status: OntStatusFilter) {
  statusFilter.value = status;
  ontsTableEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const filteredOnts = computed(() => {
  const q = ontSearch.value.trim().toLowerCase();
  return oltStore.onts.filter((o) => {
    if (statusFilter.value === 'online' && o.status !== 'online') return false;
    if (statusFilter.value === 'offline' && o.status !== 'offline') return false;
    if (statusFilter.value === 'lowSignal' && !(o.rx_power != null && o.rx_power < LOW_SIGNAL_THRESHOLD_DBM)) return false;
    if (!q) return true;
    // o.description es el nombre que la tabla muestra como "Cliente" cuando
    // la ONT no esta vinculada a un cliente de la app (la inmensa mayoria,
    // vienen de "import-existing" con el nombre puesto directo en la OLT) —
    // sin esto, buscar por ese mismo nombre que se ve en pantalla no encontraba nada.
    return `${o.serial} ${o.clients?.first_name ?? ''} ${o.clients?.last_name ?? ''} ${o.description ?? ''} ${o.frame}/${o.slot}/${o.port}:${o.ont_id}`
      .toLowerCase()
      .includes(q);
  });
});

const STATUS_CLASS: Record<string, string> = {
  online: 'bg-green-500/15 text-green-600',
  offline: 'bg-red-500/15 text-red-600',
  unknown: 'bg-slate-500/15 text-slate-600',
};
const STATUS_LABEL: Record<string, string> = {
  online: 'En línea',
  offline: 'Sin conexión',
  unknown: 'Desconocido',
};

interface OltSummary {
  unconfigured: number;
  online: number;
  offline: number;
  disabled: number;
  lowSignal: number;
  scanComplete: boolean;
  checkedAt: string;
}

const summary = ref<OltSummary | null>(null);
const summaryLoading = ref(true);
const summaryError = ref<string | null>(null);

const checkedAtLabel = computed(() => {
  if (!summary.value) return '';
  const d = new Date(summary.value.checkedAt);
  return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
});

async function loadSummary() {
  summaryLoading.value = true;
  summaryError.value = null;
  try {
    summary.value = await oltStore.fetchSummary(deviceId.value);
  } catch (e) {
    summaryError.value = getErrorMessage(e, 'Error al consultar el resumen de la OLT');
  } finally {
    summaryLoading.value = false;
  }
}

// ---- Telemetria: uptime, temperatura, CPU/RAM por tarjeta ----
const health = ref<OltHealth | null>(null);
const healthLoading = ref(true);
const healthError = ref<string | null>(null);

async function loadHealth() {
  healthLoading.value = true;
  healthError.value = null;
  try {
    health.value = await oltStore.fetchHealth(deviceId.value);
  } catch (e) {
    healthError.value = getErrorMessage(e, 'Error al consultar la telemetría de la OLT');
  } finally {
    healthLoading.value = false;
  }
}

const unconfiguredOnts = ref<UnconfiguredOnt[]>([]);
const unconfiguredLoading = ref(false);
const unconfiguredError = ref<string | null>(null);
const unconfiguredCheckedAt = ref<string | null>(null);
const unconfiguredLive = ref(false);

async function loadUnconfigured(opts: { live?: boolean } = {}) {
  unconfiguredLoading.value = true;
  unconfiguredError.value = null;
  try {
    const res = await oltStore.fetchUnconfiguredOnts(deviceId.value, opts);
    unconfiguredOnts.value = res.items;
    unconfiguredCheckedAt.value = res.checkedAt;
    unconfiguredLive.value = res.live;
  } catch (e) {
    unconfiguredError.value = getErrorMessage(e, 'Error al consultar ONUs sin autorizar');
  } finally {
    unconfiguredLoading.value = false;
  }
}

// ---- Pestañas "Nuevas" / "Por reconectar" / "Deshabilitadas" (estilo SmartOLT) ----
type OntTab = 'uncfg' | 'reconnect' | 'disabled';
const activeOntTab = ref<OntTab>('uncfg');
const ontTabsEl = ref<HTMLElement | null>(null);
function goToDisabledTab() {
  activeOntTab.value = 'disabled';
  ontTabsEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// "Sin configurar" mezcla dos cosas muy distintas: una ONU 100% nueva (nadie
// la conoce todavia) y una ONU de un cliente YA existente que se desconfiguro
// en la OLT (corte de deuda con el equipo anterior, reemplazo de ONT,
// registro perdido) — separarlas evita que un tecnico tenga que adivinar
// cual es cual, y deja reconectar sin volver a escribir los datos del
// cliente.
const newUnconfiguredOnts = computed(() => unconfiguredOnts.value.filter((o) => !o.existingClient));
const reconnectOnts = computed(() => unconfiguredOnts.value.filter((o) => o.existingClient));

const disabledOnts = ref<DisabledOnt[]>([]);
const disabledLoading = ref(false);
const disabledError = ref<string | null>(null);
const disabledCheckedAt = ref<string | null>(null);

async function loadDisabled() {
  disabledLoading.value = true;
  disabledError.value = null;
  try {
    const res = await oltStore.fetchDisabledOnts(deviceId.value);
    disabledOnts.value = res.items;
    disabledCheckedAt.value = res.checkedAt;
  } catch (e) {
    disabledError.value = getErrorMessage(e, 'Error al consultar ONUs deshabilitadas');
  } finally {
    disabledLoading.value = false;
  }
}

const enablingDisabledId = ref<string | null>(null);
async function handleEnableService(ont: DisabledOnt) {
  const ok = confirm(`¿Habilitar el servicio de la ONT ${ont.serial}?`);
  if (!ok) return;
  enablingDisabledId.value = ont.id;
  try {
    await oltStore.toggleOnt(deviceId.value, ont.id, true);
    await Promise.all([loadDisabled(), oltStore.fetchOnts(deviceId.value), loadSummary()]);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al habilitar el servicio de la ONT'));
  } finally {
    enablingDisabledId.value = null;
  }
}

// ---- Selector de puerto PON con opcion "TODOS" ----
interface PonPortOption {
  slot: number;
  port: number;
  count: number;
}
const knownPorts = computed<PonPortOption[]>(() => {
  const map = new Map<string, PonPortOption>();
  for (const o of oltStore.onts) {
    const key = `${o.slot}/${o.port}`;
    const entry = map.get(key) ?? { slot: o.slot, port: o.port, count: 0 };
    entry.count += 1;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => a.slot - b.slot || a.port - b.port);
});
// 'all' = escanear todos los puertos conocidos (reusa "Actualizar ahora");
// 'manual' = puerto recien cableado, aun sin ninguna ONT en olt_onts;
// cualquier otro valor es "slot/port" de un puerto ya conocido.
const portSelection = ref<'all' | 'manual' | string>('all');

function handlePortSync() {
  if (portSelection.value !== 'manual' && portSelection.value !== 'all') {
    const [s, p] = portSelection.value.split('/').map(Number);
    slot.value = s;
    port.value = p;
  }
  return handleSync();
}

// "Actualizar ahora": ya no hace Telnet en vivo desde el navegador (Fase
// 40) — encola un sync completo en el backend (202 inmediato) y espera a
// que llegue por SSE (connectOltEvents) para refrescar summary/health/onts
// desde la cache ya actualizada. syncStatusPoll es solo un respaldo por si
// el SSE se desconecta.
const fullSyncing = ref(false);
const fullSyncMessage = ref<string | null>(null);
let syncStatusPoll: ReturnType<typeof setInterval> | undefined;

async function handleTriggerFullSync() {
  fullSyncing.value = true;
  fullSyncMessage.value = null;
  try {
    const res = await oltStore.triggerFullSync(deviceId.value);
    fullSyncMessage.value =
      res.status === 'already_running' ? 'Ya hay una sincronización en curso.' : 'Sincronización en curso en segundo plano...';

    clearInterval(syncStatusPoll);
    syncStatusPoll = setInterval(async () => {
      try {
        const status = await oltStore.fetchSyncStatus(deviceId.value);
        if (!status.running) {
          clearInterval(syncStatusPoll);
          fullSyncing.value = false;
          fullSyncMessage.value = null;
          await Promise.all([loadSummary(), loadHealth(), oltStore.fetchOnts(deviceId.value), loadUnconfigured(), loadDisabled()]);
        }
      } catch {
        // se reintenta en el proximo tick; si el SSE sigue vivo, tambien se
        // entera por ahi sin depender de este sondeo.
      }
    }, 5000);
  } catch (e) {
    fullSyncing.value = false;
    fullSyncMessage.value = getErrorMessage(e, 'Error al iniciar la sincronización');
  }
}

onMounted(async () => {
  // Llegando desde el Dashboard (ej. tarjeta "Total offline") con
  // ?filter=offline|online|lowSignal — aplica el filtro de una vez.
  const queryFilter = route.query.filter;
  if (queryFilter === 'online' || queryFilter === 'offline' || queryFilter === 'lowSignal') {
    statusFilter.value = queryFilter;
  }

  if (!oltStore.devices.length) await oltStore.fetchDevices();
  // Los 4 son lecturas de cache (Fase 40) — ya no hacen Telnet en vivo, por
  // eso si pueden ir en paralelo sin riesgo de chocar contra la OLT.
  await Promise.all([
    oltStore.fetchOnts(deviceId.value),
    loadSummary(),
    loadHealth(),
    catalogsStore.fetchZones(),
    loadUnconfigured(),
    loadDisabled(),
  ]);

  // Tiempo real: cuando el sync en background (o una accion manual desde
  // otra pestana) cambia una ONT, se refleja sola en la tabla; cuando
  // cambia el resumen/salud cacheados, se vuelven a pedir (son baratos).
  void oltStore.connectOltEvents(deviceId.value, () => {
    void loadSummary();
    void loadHealth();
  });
});

onUnmounted(() => {
  oltStore.disconnectOltEvents();
  clearInterval(syncStatusPoll);
});

async function handleSync() {
  syncing.value = true;
  syncMessage.value = null;
  try {
    const res = await oltStore.syncOnts(deviceId.value, slot.value, port.value);
    syncMessage.value = `La OLT reporta ${res.foundInOlt} ONT(s) en el puerto ${slot.value}/${port.value}. Se actualizo el estado de ${res.synced} ya registradas aqui.${
      res.notInDb.length ? ` ${res.notInDb.length} mas existen en la OLT pero no en SmartRayco (IDs: ${res.notInDb.join(', ')}) — registralas manualmente si son tuyas.` : ''
    }`;
    await oltStore.fetchOnts(deviceId.value);
  } catch (e) {
    syncMessage.value = getErrorMessage(e, 'Error al sincronizar con la OLT');
  } finally {
    syncing.value = false;
  }
}

const importing = ref(false);
const importMessage = ref<string | null>(null);
async function handleImportExisting() {
  const ok = confirm(
    'Esto escanea TODA la OLT (solo lectura, no cambia nada) y trae/actualiza serial, tipo, nombre, plan, VLAN y señal de todas las ONTs. Con cientos de ONTs puede tardar varios minutos. ¿Continuar?',
  );
  if (!ok) return;
  importing.value = true;
  importMessage.value = null;
  try {
    const res = await oltStore.importExistingOnts(deviceId.value);
    importMessage.value = `Escaneadas ${res.scanned} ONTs en ${res.ports} puertos PON. Importadas/actualizadas: ${res.imported}.${
      res.failedPorts.length ? ` Fallaron ${res.failedPorts.length} puertos: ${res.failedPorts.join(', ')}.` : ''
    }`;
    await oltStore.fetchOnts(deviceId.value);
  } catch (e) {
    importMessage.value = getErrorMessage(e, 'Error al importar las ONTs existentes');
  } finally {
    importing.value = false;
  }
}

async function handleAuthorized() {
  // "live: true" fuerza un escaneo en vivo en vez de leer la cache del sync
  // periodico (cada 20 min) — si no, la ONU recien autorizada sigue
  // apareciendo en "Sin autorizar" hasta el proximo sync automatico, aunque
  // el registro en la OLT ya haya salido exitoso.
  await Promise.all([oltStore.fetchOnts(deviceId.value), loadUnconfigured({ live: true }), loadDisabled(), loadSummary()]);
}

const togglingId = ref<string | null>(null);
const deletingId = ref<string | null>(null);

// El backend ya serializa cualquier comando Telnet contra la misma OLT
// (withOltLock), asi que nunca se van a chocar dos acciones entre si — pero
// antes de esto no habia NINGUN indicador de "en curso" en Activar/
// Desactivar/Eliminar, asi que un tecnico podia hacer doble clic sin
// enterarse de que la primera peticion seguia en el aire. oltWriteBusy
// tambien desactiva Sincronizar/Importar/Registrar mientras otra escritura
// esta en curso, para que la fila de botones sea clara sobre que se puede
// tocar en cada momento.
const oltWriteBusy = computed(
  () => syncing.value || importing.value || !!togglingId.value || !!deletingId.value || tr069Saving.value,
);

async function handleToggle(ont: OltOnt) {
  // OJO: se decide por admin_state (lo que este boton realmente cambia en la
  // OLT), no por status (online/offline/unknown, que solo refleja el ultimo
  // sync) — una ONU recien registrada queda admin_state='enable' pero
  // status='unknown' hasta el proximo sync, y con status el boton mostraba
  // "Activar" para una ONU que ya estaba habilitada.
  const activate = ont.admin_state !== 'enable';
  const ok = confirm(`¿${activate ? 'Activar' : 'Desactivar'} la ONT ${ont.serial}?`);
  if (!ok) return;
  togglingId.value = ont.id;
  try {
    await oltStore.toggleOnt(deviceId.value, ont.id, activate);
    await oltStore.fetchOnts(deviceId.value);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al cambiar el estado de la ONT'));
  } finally {
    togglingId.value = null;
  }
}

async function handleDelete(ont: OltOnt) {
  const ok = confirm(`¿Eliminar la ONT ${ont.serial}? Esto tambien la borra de la OLT (comando "no onu").`);
  if (!ok) return;
  deletingId.value = ont.id;
  try {
    await oltStore.deleteOnt(deviceId.value, ont.id);
    await oltStore.fetchOnts(deviceId.value);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al eliminar la ONT'));
  } finally {
    deletingId.value = null;
  }
}

// ---- TR-069: asignar/quitar el ACS (GenieACS) de una ONT ----
const tr069Modal = ref<OltOnt | null>(null);
const tr069AcsUrl = ref('');
const tr069Veip = ref(1);
const tr069Saving = ref(false);
const tr069Error = ref<string | null>(null);

async function openTr069Modal(ont: OltOnt) {
  tr069Modal.value = ont;
  tr069Error.value = null;
  tr069Veip.value = 1;
  if (ont.tr069_acs_url) {
    tr069AcsUrl.value = ont.tr069_acs_url;
    return;
  }
  try {
    const profile = await tr069Store.fetchAcsProfile(deviceId.value);
    tr069AcsUrl.value = profile?.acs_url ?? '';
  } catch {
    tr069AcsUrl.value = '';
  }
}

async function handleTr069Assign() {
  if (!tr069Modal.value || !tr069AcsUrl.value) return;
  tr069Saving.value = true;
  tr069Error.value = null;
  try {
    await oltStore.assignTr069(deviceId.value, tr069Modal.value.id, tr069AcsUrl.value, tr069Veip.value);
    tr069Modal.value = null;
  } catch (e) {
    tr069Error.value = getErrorMessage(e, 'Error al asignar el ACS en la OLT');
  } finally {
    tr069Saving.value = false;
  }
}

async function handleTr069Remove() {
  if (!tr069Modal.value) return;
  tr069Saving.value = true;
  tr069Error.value = null;
  try {
    await oltStore.removeTr069(deviceId.value, tr069Modal.value.id, tr069Veip.value);
    tr069Modal.value = null;
  } catch (e) {
    tr069Error.value = getErrorMessage(e, 'Error al desactivar TR-069 en la OLT');
  } finally {
    tr069Saving.value = false;
  }
}

// ---- Perfil ACS (GenieACS) por defecto de esta OLT ----
const showAcsProfileModal = ref(false);
const acsProfileId = ref<string | null>(null);
const acsProfileForm = ref({
  acs_url: '',
  acs_username: '',
  acs_password: '',
  inform_interval: 300,
});
const acsProfileLoading = ref(false);
const acsProfileSaving = ref(false);
const acsProfileError = ref<string | null>(null);
const acsProfileSaved = ref(false);

async function openAcsProfileModal() {
  showAcsProfileModal.value = true;
  acsProfileError.value = null;
  acsProfileSaved.value = false;
  acsProfileLoading.value = true;
  try {
    const profile = await tr069Store.fetchAcsProfile(deviceId.value);
    acsProfileId.value = profile?.id ?? null;
    acsProfileForm.value = {
      acs_url: profile?.acs_url ?? '',
      acs_username: profile?.acs_username ?? '',
      acs_password: profile?.acs_password ?? '',
      inform_interval: profile?.inform_interval ?? 300,
    };
  } catch (e) {
    acsProfileError.value = getErrorMessage(e, 'Error al cargar el perfil ACS');
  } finally {
    acsProfileLoading.value = false;
  }
}

async function handleSaveAcsProfile() {
  if (!acsProfileForm.value.acs_url) return;
  acsProfileSaving.value = true;
  acsProfileError.value = null;
  acsProfileSaved.value = false;
  try {
    const saved = await tr069Store.saveAcsProfile(deviceId.value, acsProfileForm.value, acsProfileId.value ?? undefined);
    acsProfileId.value = saved.id;
    acsProfileSaved.value = true;
  } catch (e) {
    acsProfileError.value = getErrorMessage(e, 'Error al guardar el perfil ACS');
  } finally {
    acsProfileSaving.value = false;
  }
}

// ---- Detalle por tarjeta (barras) ----
const HEALTH_CHART_WIDTH = 320;
const HEALTH_PLOT_HEIGHT = 74;

interface HealthBar {
  slot: number;
  value: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  labelX: number;
}

function healthBarColor(value: number, warn: number, danger: number): string {
  if (value >= danger) return '#ef4444';
  if (value >= warn) return '#f59e0b';
  return '#22c55e';
}

function buildHealthBars(items: { slot: number; value: number }[], max: number, warn: number, danger: number): HealthBar[] {
  const n = items.length || 1;
  const groupWidth = HEALTH_CHART_WIDTH / n;
  const barWidth = Math.min(28, groupWidth - 8);
  return items.map((it, i) => {
    const h = Math.max(2, Math.min(HEALTH_PLOT_HEIGHT, (it.value / max) * HEALTH_PLOT_HEIGHT));
    return {
      slot: it.slot,
      value: it.value,
      x: i * groupWidth + (groupWidth - barWidth) / 2,
      y: HEALTH_PLOT_HEIGHT - h,
      width: barWidth,
      height: h,
      color: healthBarColor(it.value, warn, danger),
      labelX: i * groupWidth + groupWidth / 2,
    };
  });
}

// ---- Cluster de velocímetros estilo panel deportivo (temp/CPU/RAM) ----
const GAUGE_VIEWBOX = '0 0 220 160';
const GAUGE_CX = 110;
const GAUGE_CY = 108;
const GAUGE_R = 66;
const GAUGE_START = -120;
const GAUGE_END = 120;

function gaugePoint(angleDeg: number, r = GAUGE_R) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: GAUGE_CX + r * Math.cos(rad), y: GAUGE_CY + r * Math.sin(rad) };
}

function gaugeArc(startAngle: number, endAngle: number, r = GAUGE_R): string {
  const start = gaugePoint(endAngle, r);
  const end = gaugePoint(startAngle, r);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

const GAUGE_TRACK_PATH = gaugeArc(GAUGE_START, GAUGE_END);
const GAUGE_BEZEL_PATH = gaugeArc(GAUGE_START, GAUGE_END, GAUGE_R + 26);

function gaugeAngleFor(value: number, max: number): number {
  const t = Math.max(0, Math.min(1, value / max));
  return GAUGE_START + t * (GAUGE_END - GAUGE_START);
}

interface GaugeSpec {
  key: string;
  label: string;
  unit: string;
  value: number;
  max: number;
  warn: number;
  danger: number;
}

function average(nums: number[]): number {
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
}

interface GaugeTick {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  major: boolean;
  labelX: number;
  labelY: number;
  labelText: string;
}

const GAUGE_TICK_STEPS = 8;

function buildTicks(max: number): GaugeTick[] {
  const ticks: GaugeTick[] = [];
  for (let i = 0; i <= GAUGE_TICK_STEPS; i++) {
    const frac = i / GAUGE_TICK_STEPS;
    const angle = GAUGE_START + frac * (GAUGE_END - GAUGE_START);
    const major = i % 2 === 0;
    const inner = gaugePoint(angle, GAUGE_R + 9);
    const outer = gaugePoint(angle, GAUGE_R + (major ? 20 : 15));
    const labelPos = gaugePoint(angle, GAUGE_R + 34);
    ticks.push({
      x1: inner.x,
      y1: inner.y,
      x2: outer.x,
      y2: outer.y,
      major,
      labelX: labelPos.x,
      labelY: labelPos.y,
      labelText: major ? String(Math.round(frac * max)) : '',
    });
  }
  return ticks;
}

/** Aguja tipo rombo (mas ancha en la base, afilada en la punta) con contrapeso. */
function needlePolygon(angleDeg: number): string {
  const tip = gaugePoint(angleDeg, GAUGE_R - 18);
  const baseLeft = gaugePoint(angleDeg - 3.5, 9);
  const baseRight = gaugePoint(angleDeg + 3.5, 9);
  const tail = gaugePoint(angleDeg + 180, 16);
  return [tip, baseRight, tail, baseLeft].map((p) => `${p.x},${p.y}`).join(' ');
}

function statusLabel(value: number, warn: number, danger: number) {
  if (value >= danger) return { text: 'CRÍTICO', classes: 'bg-red-500/15 text-red-600' };
  if (value >= warn) return { text: 'ALERTA', classes: 'bg-amber-500/15 text-amber-700' };
  return { text: 'NORMAL', classes: 'bg-emerald-500/15 text-emerald-700' };
}

function buildGauge(g: GaugeSpec) {
  const warnAngle = gaugeAngleFor(g.warn, g.max);
  const dangerAngle = gaugeAngleFor(g.danger, g.max);
  const valueAngle = gaugeAngleFor(g.value, g.max);
  const color = g.value >= g.danger ? '#ef4444' : g.value >= g.warn ? '#f59e0b' : '#22c55e';
  return {
    ...g,
    zoneGreen: gaugeArc(GAUGE_START, warnAngle),
    zoneAmber: gaugeArc(warnAngle, dangerAngle),
    zoneRed: gaugeArc(dangerAngle, GAUGE_END),
    progressPath: g.value > 0 ? gaugeArc(GAUGE_START, valueAngle, GAUGE_R - 18) : '',
    needlePoints: needlePolygon(valueAngle),
    ticks: buildTicks(g.max),
    status: statusLabel(g.value, g.warn, g.danger),
    color,
    display: Math.round(g.value),
    glow: `drop-shadow(0 0 7px ${color}88)`,
  };
}

const gauges = computed(() => {
  const h = health.value;
  const maxTemp = h?.temperature.length ? Math.max(...h.temperature.map((t) => t.tempC)) : 0;
  const avgCpu = average((h?.load ?? []).map((l) => l.cpuPercent));
  const avgRam = average((h?.load ?? []).map((l) => l.memPercent));
  const specs: GaugeSpec[] = [
    { key: 'temp', label: 'Temperatura', unit: '°C', value: maxTemp, max: 80, warn: 50, danger: 65 },
    { key: 'cpu', label: 'CPU', unit: '%', value: avgCpu, max: 100, warn: 70, danger: 85 },
    { key: 'ram', label: 'RAM', unit: '%', value: avgRam, max: 100, warn: 70, danger: 85 },
  ];
  return specs.map(buildGauge);
});
</script>

<template>
  <AppLayout>
    <button class="text-sm text-slate-600 hover:text-slate-900 mb-4" @click="router.push('/olt')">← Volver a OLTs</button>

    <div v-if="!device" class="text-slate-500">OLT no encontrada.</div>
    <template v-else>
      <div class="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1 class="text-2xl font-semibold mb-1">{{ device.name }}</h1>
          <p class="text-slate-600 text-sm">{{ device.host }}:{{ device.telnet_port }} · {{ device.brand.toUpperCase() }}</p>
        </div>
        <div class="flex items-center gap-2">
          <span v-if="fullSyncMessage" class="text-xs text-slate-500">{{ fullSyncMessage }}</span>
          <button class="btn-ghost text-xs" :disabled="fullSyncing" @click="handleTriggerFullSync">
            {{ fullSyncing ? 'Sincronizando...' : '↻ Actualizar ahora' }}
          </button>
          <button class="btn-ghost text-xs" @click="openAcsProfileModal">ACS (GenieACS) por defecto</button>
        </div>
      </div>

      <!-- Resumen estilo SmartOLT -->
      <div class="grid gap-4 mb-2" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))">
        <div class="rounded-xl p-5 flex items-start justify-between" style="background:#2f6fed">
          <div>
            <div class="text-3xl font-bold text-white">{{ summaryLoading ? '—' : summary?.unconfigured ?? 0 }}</div>
            <div class="text-sm text-white/90 mt-1">Sin autorizar</div>
          </div>
          <span class="text-2xl">✨</span>
        </div>
        <button
          class="rounded-xl p-5 flex items-start justify-between text-left"
          style="background:#16a34a"
          @click="filterOntsBy('online')"
        >
          <div>
            <div class="text-3xl font-bold text-white">{{ summaryLoading ? '—' : summary?.online ?? 0 }}</div>
            <div class="text-sm text-white/90 mt-1">Online</div>
          </div>
          <span class="text-2xl">🖧</span>
        </button>
        <button
          class="rounded-xl p-5 flex items-start justify-between text-left"
          style="background:#475569"
          @click="filterOntsBy('offline')"
        >
          <div>
            <div class="text-3xl font-bold text-white">{{ summaryLoading ? '—' : summary?.offline ?? 0 }}</div>
            <div class="text-sm text-white/90 mt-1">Total offline</div>
          </div>
          <span class="text-2xl">✕</span>
        </button>
        <button
          class="rounded-xl p-5 flex items-start justify-between text-left"
          style="background:#ea580c"
          @click="filterOntsBy('lowSignal')"
        >
          <div>
            <div class="text-3xl font-bold text-white">{{ summaryLoading ? '—' : summary?.lowSignal ?? 0 }}</div>
            <div class="text-sm text-white/90 mt-1">Señales bajas</div>
          </div>
          <span class="text-2xl">⚠</span>
        </button>
        <button
          class="rounded-xl p-5 flex items-start justify-between text-left"
          style="background:#b91c1c"
          @click="goToDisabledTab"
        >
          <div>
            <div class="text-3xl font-bold text-white">{{ summaryLoading ? '—' : summary?.disabled ?? 0 }}</div>
            <div class="text-sm text-white/90 mt-1">Deshabilitadas</div>
          </div>
          <span class="text-2xl">⏻</span>
        </button>
      </div>
      <p class="text-xs text-slate-500 text-right mb-1">
        {{ summaryLoading ? 'Consultando...' : `Informacion valida a las ${checkedAtLabel}` }}
        <button class="ml-2 text-sky-600 hover:underline" @click="loadSummary">Actualizar</button>
      </p>
      <p v-if="summaryError" class="text-xs text-red-600 mb-4">{{ summaryError }}</p>
      <p v-if="summary && !summary.scanComplete" class="text-xs text-amber-700/80 mb-4">
        ⚠ El escaneo completo de la OLT falló esta vez; "Online/Offline" se muestran con el último
        dato local disponible.
      </p>
      <p class="text-xs text-slate-500 mb-6">
        Estos datos vienen de la última sincronización en segundo plano con la OLT (automática cada
        rato, o al presionar "Actualizar ahora"), no de una consulta en vivo — por eso la pantalla
        carga al instante. Los cambios de estado se reflejan solos en la tabla en tiempo real.
      </p>

      <!-- Telemetria: cluster de velocimetros estilo deportivo -->
      <div class="surface p-5 mb-6 relative overflow-hidden">
        <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-500 via-emerald-500 to-amber-500"></div>

        <div class="flex items-center justify-between mb-5">
          <div class="text-sm font-semibold flex items-center gap-2">🏁 Telemetría</div>
          <div class="text-xs text-slate-500">
            {{ healthLoading ? 'Consultando...' : '' }}
            <button v-if="!healthLoading" class="text-sky-600 hover:underline" @click="loadHealth">Actualizar</button>
          </div>
        </div>

        <p v-if="healthError" class="text-xs text-red-600 mb-4">{{ healthError }}</p>

        <p
          v-else-if="!healthLoading && !health?.uptime && !health?.temperature.length && !health?.load.length"
          class="text-sm text-slate-500"
        >
          No se pudo consultar la salud de este equipo (revisa la conexión Telnet).
        </p>

        <template v-else-if="health">
          <!-- Cluster: temperatura / CPU / RAM / actividad -->
          <div class="grid gap-4 mb-6" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))">
            <div v-for="g in gauges" :key="g.key" class="flex flex-col items-center">
              <svg :viewBox="GAUGE_VIEWBOX" class="w-full" :style="{ filter: g.glow }">
                <!-- bisel decorativo -->
                <path :d="GAUGE_BEZEL_PATH" fill="none" stroke="#1e293b" stroke-width="1" opacity="0.8" />
                <!-- marcas de escala -->
                <g>
                  <line
                    v-for="(t, i) in g.ticks"
                    :key="'tick' + i"
                    :x1="t.x1"
                    :y1="t.y1"
                    :x2="t.x2"
                    :y2="t.y2"
                    stroke="#475569"
                    :stroke-width="t.major ? 1.5 : 1"
                  />
                  <text
                    v-for="(t, i) in g.ticks"
                    :key="'ticklabel' + i"
                    :x="t.labelX"
                    :y="t.labelY"
                    text-anchor="middle"
                    dominant-baseline="middle"
                    font-size="8"
                    fill="#64748b"
                  >{{ t.labelText }}</text>
                </g>
                <!-- pista base + zonas de color (verde/ambar/rojo) -->
                <path :d="GAUGE_TRACK_PATH" fill="none" stroke="#1e293b" stroke-width="14" stroke-linecap="round" />
                <path :d="g.zoneGreen" fill="none" stroke="#22c55e" stroke-width="14" stroke-linecap="round" opacity="0.9" />
                <path :d="g.zoneAmber" fill="none" stroke="#f59e0b" stroke-width="14" opacity="0.9" />
                <path :d="g.zoneRed" fill="none" stroke="#ef4444" stroke-width="14" stroke-linecap="round" opacity="0.9" />
                <!-- anillo de progreso (lectura exacta) -->
                <path v-if="g.progressPath" :d="g.progressPath" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" opacity="0.85" />
                <!-- aguja -->
                <polygon :points="g.needlePoints" :fill="g.color" stroke="#0f172a" stroke-width="0.5" />
                <circle :cx="GAUGE_CX" :cy="GAUGE_CY" r="8" fill="#0f172a" stroke="#475569" stroke-width="1" />
                <circle :cx="GAUGE_CX" :cy="GAUGE_CY" r="3" fill="white" />
                <text
                  :x="GAUGE_CX"
                  :y="GAUGE_CY + 40"
                  text-anchor="middle"
                  font-size="24"
                  font-weight="900"
                  font-style="italic"
                  :fill="g.color"
                >{{ g.display }}<tspan font-size="12">{{ g.unit }}</tspan></text>
              </svg>
              <div class="text-xs text-slate-500 uppercase tracking-wider -mt-1">{{ g.label }}</div>
              <span class="mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider" :class="g.status.classes">{{ g.status.text }}</span>
            </div>

            <!-- Actividad / uptime: estilo odometro de carreras -->
            <div class="flex flex-col items-center justify-center">
              <div class="text-4xl font-black italic tracking-tight text-sky-600">
                {{ health.uptime ? Math.round(health.uptime.totalHours) : '—' }}<span class="text-base align-top">h</span>
              </div>
              <div class="text-xs text-slate-500 mt-1">{{ health.uptime ? health.uptime.raw : 'sin datos' }}</div>
              <div class="flex gap-0.5 mt-3">
                <span
                  v-for="n in 16"
                  :key="n"
                  class="w-1.5 h-3 rounded-sm"
                  :class="health.uptime ? 'bg-emerald-500' : 'bg-slate-100'"
                ></span>
              </div>
              <div class="text-[10px] text-slate-500 uppercase tracking-wider mt-2">Actividad</div>
            </div>
          </div>

          <!-- Detalle por tarjeta -->
          <div class="grid gap-6 pt-4 border-t border-slate-200" style="grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))">
            <div>
              <div class="text-xs text-slate-500 mb-2">Temperatura por tarjeta (°C)</div>
              <svg v-if="health.temperature.length" viewBox="0 0 320 90" class="w-full h-24">
                <g
                  v-for="b in buildHealthBars(health.temperature.map((t) => ({ slot: t.slot, value: t.tempC })), 80, 50, 65)"
                  :key="'temp' + b.slot"
                >
                  <rect :x="b.x" y="0" :width="b.width" :height="HEALTH_PLOT_HEIGHT" rx="5" class="fill-slate-800" />
                  <rect :x="b.x" :y="b.y" :width="b.width" :height="b.height" rx="5" :fill="b.color">
                    <title>Slot {{ b.slot }}: {{ b.value }}°C</title>
                  </rect>
                  <text :x="b.labelX" y="88" text-anchor="middle" font-size="9" fill="#898781">{{ b.slot }}</text>
                </g>
              </svg>
              <p v-else class="text-xs text-slate-500">Sin datos.</p>
            </div>

            <div>
              <div class="text-xs text-slate-500 mb-2">CPU por tarjeta (%, prom. 5 min)</div>
              <svg v-if="health.load.length" viewBox="0 0 320 90" class="w-full h-24">
                <g
                  v-for="b in buildHealthBars(health.load.map((l) => ({ slot: l.slot, value: l.cpuPercent })), 100, 70, 85)"
                  :key="'cpu' + b.slot"
                >
                  <rect :x="b.x" y="0" :width="b.width" :height="HEALTH_PLOT_HEIGHT" rx="5" class="fill-slate-800" />
                  <rect :x="b.x" :y="b.y" :width="b.width" :height="b.height" rx="5" :fill="b.color">
                    <title>Slot {{ b.slot }}: {{ b.value }}%</title>
                  </rect>
                  <text :x="b.labelX" y="88" text-anchor="middle" font-size="9" fill="#898781">{{ b.slot }}</text>
                </g>
              </svg>
              <p v-else class="text-xs text-slate-500">Sin datos.</p>
            </div>

            <div>
              <div class="text-xs text-slate-500 mb-2">RAM por tarjeta (%)</div>
              <svg v-if="health.load.length" viewBox="0 0 320 90" class="w-full h-24">
                <g
                  v-for="b in buildHealthBars(health.load.map((l) => ({ slot: l.slot, value: l.memPercent })), 100, 70, 85)"
                  :key="'ram' + b.slot"
                >
                  <rect :x="b.x" y="0" :width="b.width" :height="HEALTH_PLOT_HEIGHT" rx="5" class="fill-slate-800" />
                  <rect :x="b.x" :y="b.y" :width="b.width" :height="b.height" rx="5" :fill="b.color">
                    <title>Slot {{ b.slot }}: {{ b.value }}%</title>
                  </rect>
                  <text :x="b.labelX" y="88" text-anchor="middle" font-size="9" fill="#898781">{{ b.slot }}</text>
                </g>
              </svg>
              <p v-else class="text-xs text-slate-500">Sin datos.</p>
            </div>
          </div>
        </template>

        <p v-else class="text-sm text-slate-500">Consultando telemetría...</p>
      </div>

      <div class="rounded-xl border border-slate-200 bg-slate-100 p-4 mb-6">
        <h2 class="text-sm font-semibold mb-3">Consultar puerto GPON</h2>
        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label class="block text-xs text-slate-600 mb-1">Puerto PON</label>
            <select v-model="portSelection" class="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm">
              <option value="all">TODOS los puertos</option>
              <option v-for="p in knownPorts" :key="`${p.slot}/${p.port}`" :value="`${p.slot}/${p.port}`">
                Slot {{ p.slot }} · Puerto {{ p.port }} ({{ p.count }})
              </option>
              <option value="manual">Otro puerto...</option>
            </select>
          </div>
          <template v-if="portSelection === 'manual'">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Slot</label>
              <input v-model.number="slot" type="number" min="1" class="w-24 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm" />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Puerto</label>
              <input v-model.number="port" type="number" min="1" class="w-24 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm" />
            </div>
          </template>
          <button v-if="portSelection === 'all'" :disabled="oltWriteBusy || fullSyncing" class="btn-secondary" @click="handleTriggerFullSync">
            {{ fullSyncing ? 'Escaneando...' : 'Escanear todos los puertos' }}
          </button>
          <button v-else :disabled="oltWriteBusy" class="btn-secondary" @click="handlePortSync">
            {{ syncing ? 'Sincronizando...' : 'Sincronizar este puerto' }}
          </button>
          <button v-if="canAuthorizeOnt" :disabled="oltWriteBusy" class="btn-primary" @click="openAuthorize()">
            + Registrar ONT
          </button>
        </div>
        <p v-if="portSelection === 'all' && fullSyncMessage" class="text-xs text-slate-600 mt-3">{{ fullSyncMessage }}</p>
        <p v-if="syncMessage" class="text-xs text-slate-600 mt-3">{{ syncMessage }}</p>
        <p class="text-xs text-slate-500 mt-3">
          Registrar / activar / desactivar / eliminar ya validados contra tu OLT real (ver reporte de la Fase 4).
          Solo la lectura de señal óptica sigue sin probar. "TODOS" escanea en segundo plano (no bloquea la
          pantalla) — el listado de puertos se arma con los que ya tienen alguna ONT registrada aquí; un puerto
          recién cableado sin ninguna todavía usa "Otro puerto...".
        </p>
      </div>

      <div ref="ontTabsEl" class="flex gap-2 border-b border-slate-200 mb-4">
        <button
          class="px-4 py-2 text-sm font-medium rounded-t-lg"
          :class="activeOntTab === 'uncfg' ? 'bg-slate-100 text-slate-900 border border-b-0 border-slate-200' : 'text-slate-500 hover:text-slate-700'"
          @click="activeOntTab = 'uncfg'"
        >
          Nuevas por Autorizar ({{ newUnconfiguredOnts.length }})
        </button>
        <button
          class="px-4 py-2 text-sm font-medium rounded-t-lg"
          :class="activeOntTab === 'reconnect' ? 'bg-slate-100 text-slate-900 border border-b-0 border-slate-200' : 'text-slate-500 hover:text-slate-700'"
          @click="activeOntTab = 'reconnect'"
        >
          Desconfiguradas / Por Reconectar ({{ reconnectOnts.length }})
        </button>
        <button
          class="px-4 py-2 text-sm font-medium rounded-t-lg"
          :class="activeOntTab === 'disabled' ? 'bg-slate-100 text-slate-900 border border-b-0 border-slate-200' : 'text-slate-500 hover:text-slate-700'"
          @click="activeOntTab = 'disabled'"
        >
          Deshabilitadas / Cortadas ({{ disabledOnts.length }})
        </button>
      </div>

      <UnconfiguredOntsTab
        v-if="activeOntTab === 'uncfg'"
        :onts="newUnconfiguredOnts"
        :loading="unconfiguredLoading"
        :error="unconfiguredError"
        :checked-at="unconfiguredCheckedAt"
        :live="unconfiguredLive"
        @refresh="loadUnconfigured()"
        @refresh-live="loadUnconfigured({ live: true })"
        @authorize="openAuthorize($event)"
      />
      <ReconnectOntsTab
        v-else-if="activeOntTab === 'reconnect'"
        :onts="reconnectOnts"
        :loading="unconfiguredLoading"
        :error="unconfiguredError"
        :checked-at="unconfiguredCheckedAt"
        :live="unconfiguredLive"
        @refresh="loadUnconfigured()"
        @refresh-live="loadUnconfigured({ live: true })"
        @reauthorize="openAuthorize($event)"
      />
      <DisabledOntsTab
        v-else
        :items="disabledOnts"
        :loading="disabledLoading"
        :error="disabledError"
        :checked-at="disabledCheckedAt"
        :enabling-id="enablingDisabledId"
        @refresh="loadDisabled"
        @enable-service="handleEnableService"
      />

      <div class="rounded-xl border border-amber-800/40 bg-amber-950/20 p-4 mb-6">
        <h2 class="text-sm font-semibold mb-1">¿Ves menos ONTs de las que tienes, o sin nombre/señal?</h2>
        <p class="text-xs text-slate-600 mb-3">
          Si esta OLT ya tenia ONTs configuradas desde antes de usar SmartRayco (ej. desde SmartOLT), no
          apareceran aqui hasta importarlas. Trae serial, tipo, nombre (de la OLT), plan, VLAN y señal
          Rx/Tx de todas. Esto solo lee la OLT (sin cambiar nada) y puede tardar varios minutos con
          cientos de ONTs — se puede repetir cuando quieras para refrescar todo.
        </p>
        <button :disabled="oltWriteBusy" class="btn-secondary" @click="handleImportExisting">
          {{ importing ? 'Importando...' : 'Importar / actualizar ONTs desde la OLT' }}
        </button>
        <p v-if="importMessage" class="text-xs text-slate-600 mt-3">{{ importMessage }}</p>
      </div>

      <div ref="ontsTableEl" class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="text-lg font-semibold">ONTs registradas</h2>
        <div v-if="statusFilter !== 'all'" class="flex items-center gap-2 text-xs">
          <span class="badge bg-sky-500/15 text-sky-700">Filtro: {{ STATUS_FILTER_LABEL[statusFilter] }} ({{ filteredOnts.length }})</span>
          <button class="text-slate-600 hover:text-slate-900" @click="statusFilter = 'all'">Quitar filtro</button>
        </div>
      </div>
      <input
        v-model="ontSearch"
        placeholder="Buscar por serial, cliente o shelf/slot/port..."
        class="field-input mb-3"
      />
      <!-- max-h + overflow-y-auto: con cientos de ONTs la tabla podia ser mucho
           mas alta que la pantalla, y la barra de scroll HORIZONTAL de
           table-shell (que vive al pie de ese contenedor) quedaba miles de
           pixeles mas abajo, practicamente inalcanzable. Con la altura
           limitada, las dos barras de scroll quedan siempre a la vista aca
           mismo. El encabezado queda fijo arriba mientras se baja. -->
      <div class="table-shell max-h-[70dvh] overflow-y-auto">
        <!-- En celular se ocultan las columnas secundarias (quedan Serial/Cliente/
             Estado/Señal/TR-069/Acciones) — antes las 11 columnas forzaban scroll
             horizontal incluso para ver "Acciones". El detalle completo sigue
             disponible al tocar la fila (openOntDetail). -->
        <table class="w-full text-sm min-w-[480px] md:min-w-[760px]">
          <thead class="bg-slate-100 text-slate-600 text-xs uppercase sticky top-0 z-10">
            <tr>
              <!-- Antes decia "Shelf/Slot/Port/ID": ese titulo largo obligaba a la
                   columna a ser mas ancha que el dato real ("1/2/1:1", corto) —
                   un titulo corto + whitespace-nowrap deja que la columna se
                   achique al tamaño del dato en vez del titulo. -->
              <th class="text-left px-2 py-3 hidden md:table-cell whitespace-nowrap shadow-[0_1px_0_0_var(--color-slate-200)]" title="Shelf/Slot/Port:ID de la ONU">Posición</th>
              <th class="text-left px-3 py-3 shadow-[0_1px_0_0_var(--color-slate-200)]">Serial</th>
              <th class="text-left px-3 py-3 shadow-[0_1px_0_0_var(--color-slate-200)]">Cliente</th>
              <th class="text-left px-3 py-3 hidden md:table-cell shadow-[0_1px_0_0_var(--color-slate-200)]">Zona</th>
              <th class="text-left px-3 py-3 shadow-[0_1px_0_0_var(--color-slate-200)]">Estado</th>
              <th class="text-left px-3 py-3 whitespace-nowrap shadow-[0_1px_0_0_var(--color-slate-200)]">Rx/Tx (dBm)</th>
              <th class="text-left px-3 py-3 hidden md:table-cell shadow-[0_1px_0_0_var(--color-slate-200)]">VLAN</th>
              <th class="text-left px-3 py-3 hidden md:table-cell shadow-[0_1px_0_0_var(--color-slate-200)]">Tipo</th>
              <th class="text-left px-3 py-3 hidden md:table-cell shadow-[0_1px_0_0_var(--color-slate-200)]">Alta</th>
              <th class="text-left px-3 py-3 shadow-[0_1px_0_0_var(--color-slate-200)]">TR-069</th>
              <th class="text-right px-3 py-3 shadow-[0_1px_0_0_var(--color-slate-200)]">Acciones</th>
              <!-- Columna solo-icono: en tactil no hay ":hover" que sugiera que la
                   fila es clickeable (abre el detalle), asi que el ">" cumple ese
                   rol visualmente en vez de depender del cursor. -->
              <th class="w-8 px-2 py-3 shadow-[0_1px_0_0_var(--color-slate-200)]"><span class="sr-only">Abrir detalle</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!filteredOnts.length">
              <td colspan="12" class="px-4 py-6 text-center text-slate-500">
                {{ ontSearch || statusFilter !== 'all' ? 'Sin resultados para ese filtro/busqueda.' : 'Sin ONTs. Sincroniza un puerto o registra una nueva.' }}
              </td>
            </tr>
            <tr
              v-for="ont in filteredOnts"
              :key="ont.id"
              class="border-t border-slate-200 cursor-pointer hover:bg-slate-50"
              @click="openOntDetail(ont)"
            >
              <td class="px-2 py-3 font-mono text-xs hidden md:table-cell whitespace-nowrap">{{ ont.frame }}/{{ ont.slot }}/{{ ont.port }}:{{ ont.ont_id }}</td>
              <td class="px-3 py-3 font-mono text-xs">{{ ont.serial }}</td>
              <td class="px-3 py-3 text-slate-600">
                <template v-if="ont.clients">{{ ont.clients.first_name }} {{ ont.clients.last_name }}</template>
                <template v-else-if="ont.description">
                  {{ ont.description }}
                  <span class="block text-[10px] text-slate-400">de la OLT, sin vincular</span>
                </template>
                <template v-else>—</template>
              </td>
              <td class="px-3 py-3 text-slate-600 text-xs hidden md:table-cell">
                <span v-if="ont.zones">{{ ont.zones.name }}</span>
                <span v-else-if="ont.splitter">{{ ont.splitter }}<span v-if="ont.splitter_port"> / {{ ont.splitter_port }}</span></span>
                <span v-else class="text-slate-400">—</span>
              </td>
              <td class="px-3 py-3">
                <span class="badge" :class="STATUS_CLASS[ont.status]">{{ STATUS_LABEL[ont.status] ?? ont.status }}</span>
              </td>
              <td class="px-3 py-3 text-slate-600 text-xs whitespace-nowrap">{{ ont.rx_power ?? '—' }} / {{ ont.tx_power ?? '—' }}</td>
              <td class="px-3 py-3 text-slate-600 text-xs hidden md:table-cell">{{ ont.vlan ?? '—' }}</td>
              <td class="px-3 py-3 text-slate-600 text-xs hidden md:table-cell">{{ ont.onu_type ?? '—' }}</td>
              <td class="px-3 py-3 text-slate-500 text-xs hidden md:table-cell whitespace-nowrap">{{ new Date(ont.created_at).toLocaleDateString('es-PE') }}</td>
              <td class="px-3 py-3">
                <span v-if="ont.tr069_enabled" class="badge bg-emerald-500/15 text-emerald-700">Activo</span>
                <span v-else class="text-slate-500 text-xs">—</span>
              </td>
              <!-- "Señal"/"Zona"/"TR-069" se sacaron de la fila: son EXACTAMENTE lo
                   mismo que ya ofrece el detalle (clic en la fila abre
                   OntDetailModal, que tiene "Consultar señal"/"Editar zona"/
                   "Gestionar TR-069") — tenerlos duplicados aca era lo que hacia
                   esta columna tan ancha que la fila se desbordaba hacia la
                   derecha sin forma practica de llegar a "Eliminar" en una tabla
                   de cientos de filas (la barra de scroll horizontal queda al
                   final de TODA la tabla). Solo quedan las 2 acciones que el
                   modal de detalle no cubre. -->
              <td class="px-3 py-3 text-right space-x-2 whitespace-nowrap text-xs" @click.stop>
                <button
                  class="text-slate-600 hover:text-slate-900 disabled:opacity-40"
                  :disabled="oltWriteBusy && togglingId !== ont.id"
                  @click="handleToggle(ont)"
                >
                  {{ togglingId === ont.id ? 'Aplicando...' : ont.admin_state === 'enable' ? 'Desactivar' : 'Activar' }}
                </button>
                <button
                  class="text-red-500/80 hover:text-red-600 disabled:opacity-40"
                  :disabled="oltWriteBusy && deletingId !== ont.id"
                  @click="handleDelete(ont)"
                >
                  {{ deletingId === ont.id ? 'Eliminando...' : 'Eliminar' }}
                </button>
              </td>
              <td class="px-2 py-3 text-slate-300 text-center" aria-hidden="true">›</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <Teleport to="body">
      <div v-if="tr069Modal" class="modal-overlay">
        <form class="w-full max-w-md modal-panel" @submit.prevent="handleTr069Assign">
          <h2 class="text-lg font-semibold mb-1">TR-069 — {{ tr069Modal.serial }}</h2>
          <p class="text-xs text-slate-500 mb-4">
            Asigna el servidor ACS (GenieACS) a esta ONT via OMCI. Requiere una ONT con VEIP (ej. ZTE-F660).
          </p>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">URL del ACS</label>
            <input v-model="tr069AcsUrl" placeholder="http://192.168.100.136:7547" required class="field-input" />
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-600 mb-1">VEIP</label>
            <input v-model.number="tr069Veip" type="number" min="1" class="field-input" />
          </div>

          <p v-if="tr069Error" class="text-sm text-red-600 mb-3">{{ tr069Error }}</p>

          <div class="flex justify-between gap-2">
            <button
              v-if="tr069Modal.tr069_enabled"
              type="button"
              class="text-red-600 hover:underline text-xs"
              :disabled="tr069Saving"
              @click="handleTr069Remove"
            >
              Desactivar TR-069
            </button>
            <div class="flex gap-2 ml-auto">
              <button type="button" class="btn-ghost" @click="tr069Modal = null">Cancelar</button>
              <button type="submit" :disabled="tr069Saving || !tr069AcsUrl" class="btn-primary">
                {{ tr069Saving ? 'Guardando...' : 'Asignar' }}
              </button>
            </div>
          </div>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showAcsProfileModal" class="modal-overlay">
        <form class="w-full max-w-md modal-panel" @submit.prevent="handleSaveAcsProfile">
          <h2 class="text-lg font-semibold mb-1">ACS (GenieACS) por defecto</h2>
          <p class="text-xs text-slate-500 mb-4">
            Se usa para prellenar la URL del ACS al asignar TR-069 a cualquier ONT de esta OLT.
          </p>

          <p v-if="acsProfileLoading" class="text-xs text-slate-500 mb-3">Cargando...</p>
          <template v-else>
            <div class="mb-3">
              <label class="block text-xs text-slate-600 mb-1">URL del ACS</label>
              <input v-model="acsProfileForm.acs_url" required placeholder="http://192.168.100.136:7547" class="field-input" />
            </div>
            <div class="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label class="block text-xs text-slate-600 mb-1">Usuario (opcional)</label>
                <input v-model="acsProfileForm.acs_username" class="field-input" />
              </div>
              <div>
                <label class="block text-xs text-slate-600 mb-1">Contraseña (opcional)</label>
                <input v-model="acsProfileForm.acs_password" type="password" class="field-input" />
              </div>
            </div>
            <div class="mb-4">
              <label class="block text-xs text-slate-600 mb-1">Intervalo de Inform (segundos)</label>
              <input v-model.number="acsProfileForm.inform_interval" type="number" min="30" class="field-input" />
            </div>
          </template>

          <p v-if="acsProfileError" class="text-sm text-red-600 mb-3">{{ acsProfileError }}</p>
          <p v-if="acsProfileSaved" class="text-sm text-emerald-600 mb-3">Guardado.</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showAcsProfileModal = false">Cerrar</button>
            <button type="submit" :disabled="acsProfileSaving || acsProfileLoading || !acsProfileForm.acs_url" class="btn-primary">
              {{ acsProfileSaving ? 'Guardando...' : 'Guardar' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>

    <AuthorizeOnuModal
      v-if="showAuthorizeModal"
      :device-id="deviceId"
      :olt-name="device?.name ?? ''"
      :prefill="authorizePrefill"
      @close="showAuthorizeModal = false"
      @authorized="handleAuthorized"
    />

    <OntDetailModal
      v-if="detailOnt && device"
      :ont="detailOnt"
      :device="device"
      :zone-name="detailOnt.zones?.name ?? deviceZoneName"
      @close="detailOntId = null"
      @open-tr069="handleOpenTr069FromDetail"
      @edit-zone="handleEditZoneFromDetail"
    />

    <OntZoneEditModal
      v-if="zoneEditOnt"
      :ont="zoneEditOnt"
      :device-id="deviceId"
      @close="zoneEditOntId = null"
      @saved="zoneEditOntId = null"
    />
  </AppLayout>
</template>
