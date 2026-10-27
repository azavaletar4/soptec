<script setup lang="ts">
import { filterStalePendingOnus } from '@/lib/provisioningUi';
import { computePonOccupancy } from '@/lib/oltCapacity';
import { buildOfficialPonZoneCatalog, comparePonZone, type PonZoneMatch } from '@/lib/ponZoneMapping';
import {
  buildPonNumberMap,
  evaluateOntZoneDiscrepancies,
  countPonPortIssues,
  ontsInZone,
  type OntZoneDiscrepancy,
  type OntZoneCaseStatus,
  type PonPortIssueCounts,
} from '@/lib/ontZoneDiscrepancy';
import OntZoneDiscrepancyModal from './OntZoneDiscrepancyModal.vue';
import {
  buildOltAlertView,
  buildOltAlertLogEntryView,
  formatRelativeTime,
  formatPeruDateTime,
  type OltAlertView,
  type OltAlertLogEntryView,
} from '@/lib/oltAlertPresentation';
import {
  computeConnectionStatusCounts,
  listDisconnectedLinkedClients,
  listSuspendedLinkedClients,
  filterDisconnectedClients,
  evaluateSyncFreshness,
  suspensionReasonLabel,
} from '@/lib/oltConnectionStatus';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import RetiredOntsPanel from '@/components/olt/RetiredOntsPanel.vue';
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
/** Usado por las tarjetas del resumen: filtra la tabla de ONTs (pestaña "Todas") y hace scroll hasta ella. */
function filterOntsBy(status: OntStatusFilter) {
  statusFilter.value = status;
  activeOntTab.value = 'all';
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
  unknown: 'No confirmado',
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

// ---- Pestañas "Todas" / "Nuevas" / "Por reconectar" / "Deshabilitadas" ----
// Fase 3 comercial OLT: antes "Todas" vivia aparte como una tabla siempre
// visible debajo de estas otras 3 — se consolido en una sola pestaña mas
// para no mostrar el mismo listado (o un subconjunto) en 2 lugares a la vez.
type OntTab = 'all' | 'uncfg' | 'reconnect' | 'disabled' | 'retired';
const activeOntTab = ref<OntTab>('all');
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
const visibleUnconfiguredOnts = computed(() => filterStalePendingOnus(
  unconfiguredOnts.value, oltStore.onts.filter(o => o.olt_device_id === deviceId.value),
  unconfiguredCheckedAt.value, unconfiguredLive.value,
));
const newUnconfiguredOnts = computed(() => visibleUnconfiguredOnts.value.filter((o) => !o.existingClient));
const reconnectOnts = computed(() => visibleUnconfiguredOnts.value.filter((o) => o.existingClient));

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

/**
 * Fase 3 comercial OLT: ocupacion por puerto PON a simple vista (cuantos
 * onu-id libres quedan en cada puerto ya conocido) sin abrir "Registrar
 * ONT" por cada uno — hoy esa ocupacion solo se veia puerto por puerto
 * dentro de ese modal. Puramente derivado de oltStore.onts ya cargado, sin
 * llamadas nuevas al backend/OLT.
 */
const ponOccupancy = computed(() => computePonOccupancy(oltStore.onts.filter((o) => o.olt_device_id === deviceId.value)));

/**
 * Fase 3 comercial OLT — Fase A (PON↔zona, ver src/lib/ponZoneMapping.ts):
 * cada zona ya declara su número de PON en el propio nombre del catálogo
 * ("PON 4 - B6") — esa es la zona OFICIAL de ese PON, independiente de
 * cuál sea la zona predominante observada entre las ONTs ya vinculadas
 * (`dominantZone`, de computePonOccupancy). Solo compara y muestra —
 * nunca reasigna ni escribe nada.
 */
const ponZoneCatalog = computed(() => buildOfficialPonZoneCatalog(catalogsStore.zones));
type PonOccupancyPort = { ponNumber: number; dominantZone: { zoneId: string; zoneName: string } | null };
function ponZoneStatus(p: PonOccupancyPort): PonZoneMatch {
  const observed = p.dominantZone ? { id: p.dominantZone.zoneId, name: p.dominantZone.zoneName } : null;
  return comparePonZone(p.ponNumber, observed, ponZoneCatalog.value);
}
/** Nombre de la zona oficial del catálogo cuando hay mismatch (null en cualquier otro caso) — evita castear tipos en el template. */
function ponZoneMismatchOfficialName(p: PonOccupancyPort): string | null {
  const r = ponZoneStatus(p);
  return r.status === 'mismatch' ? r.officialZone.name : null;
}
/** Cantidad de zonas que reclaman el mismo número de PON en el catálogo (null si no es ambiguo). */
function ponZoneAmbiguousCount(p: PonOccupancyPort): number | null {
  const r = ponZoneStatus(p);
  return r.status === 'ambiguous_catalog' ? r.candidates.length : null;
}

/** Que tarjeta de "Ocupación por puerto PON" tiene el desglose de zonas abierto (una a la vez, "slot/port"). */
const expandedPonKey = ref<string | null>(null);
function toggleZoneBreakdown(key: string) {
  expandedPonKey.value = expandedPonKey.value === key ? null : key;
}

/**
 * Fase 3 comercial OLT — Fase B (ver src/lib/ontZoneDiscrepancy.ts,
 * ESTADO_DESARROLLO.md 13al): baja la comparación de la Fase A del nivel
 * de puerto (dominantZone agregada) al nivel de CADA ONT individual,
 * cruzando con su cliente/contrato real — para no generar falsos
 * positivos cuando un puerto mezcla ONTs de varias zonas (traslados,
 * herencia SmartOLT) y para identificar exactamente qué cliente/contrato
 * está afectado. Solo compara — nunca escribe ni vincula nada.
 */
/** Numero de PON operativo por slot/puerto — compartido entre Fase B (discrepancias) y las alertas operativas (13as), un solo calculo. */
const ponNumberMap = computed(() => buildPonNumberMap(ponOccupancy.value));
const ontZoneDiscrepancies = computed<OntZoneDiscrepancy[]>(() =>
  evaluateOntZoneDiscrepancies(
    oltStore.onts.filter((o) => o.olt_device_id === deviceId.value),
    ponNumberMap.value,
    ponZoneCatalog.value,
  ),
);
function ontsOfPort(p: { slot: number; port: number }): OntZoneDiscrepancy[] {
  return ontZoneDiscrepancies.value.filter((r) => r.slot === p.slot && r.port === p.port);
}

/**
 * Mejora de alertas OLT para uso administrativo (13as,
 * src/lib/oltAlertPresentation.ts): resuelve cada alerta en vivo
 * (oltStore.alerts, SSE) contra la ONT YA cargada en este panel — sin
 * consulta nueva — para mostrar fecha/hora real (horario de Perú) y
 * cliente/contrato solo cuando están verificados.
 */
const alertViews = computed<OltAlertView[]>(() =>
  oltStore.alerts.map((a) => {
    const ont = oltStore.onts.find((o) => o.id === a.ontDbId) ?? null;
    const ponNumber = ont ? ponNumberMap.value.get(`${ont.slot}/${ont.port}`) ?? null : null;
    return buildOltAlertView(a, ont, ponNumber);
  }),
);
function openOntFromAlert(ontDbId: string) {
  const ont = oltStore.onts.find((o) => o.id === ontDbId);
  if (ont) openOntDetail(ont);
}
/** Verificación final (punto 2): tiempo relativo evaluado en el momento del render — se evalua de nuevo cada vez que Vue re-renderiza la fila (no hay un timer propio, no hacia falta para este uso). */
function relativeTime(iso: string): string {
  return formatRelativeTime(iso, Date.now());
}

/**
 * Fase 5 OLT — Centro de monitoreo visual (ver ESTADO_DESARROLLO.md 13aw).
 * Pestañas dentro de la misma tarjeta "Alertas y sincronización": "Estado
 * actual" (nueva) e "Historial de alertas" (Fase 4, sin cambios). Todo lo
 * de abajo es agregación pura sobre `oltStore.onts`/`summary` YA cargados
 * en este panel — ningún endpoint/tabla/servicio nuevo.
 */
const alertsTab = ref<'estado' | 'historial'>('estado');
const connectionCounts = computed(() =>
  computeConnectionStatusCounts(oltStore.onts.filter((o) => o.olt_device_id === deviceId.value)),
);
const disconnectedFilters = ref({ zoneId: '', search: '' });
const filteredDisconnectedClients = computed(() =>
  filterDisconnectedClients(
    listDisconnectedLinkedClients(oltStore.onts.filter((o) => o.olt_device_id === deviceId.value)),
    disconnectedFilters.value,
  ),
);
const syncFreshness = computed(() => evaluateSyncFreshness(summary.value, Date.now(), 60));

/**
 * "Tiempo transcurrido desde la detección" — solo si existe un evento
 * 'offline' verificable en el historial (Fase 4); si no hay ninguno para
 * esa ONT, no se muestra nada (nunca se inventa una hora).
 */
const disconnectDetectedAt = ref<Map<string, string>>(new Map());
async function loadDisconnectDetectionTimes() {
  try {
    const res = await oltStore.fetchAlertLog(deviceId.value, { kind: 'offline', limit: 200 });
    const map = new Map<string, string>();
    for (const item of res.items) {
      if (!item.oltOntId || map.has(item.oltOntId)) continue;
      map.set(item.oltOntId, item.at);
    }
    disconnectDetectedAt.value = map;
  } catch {
    // Solo-lectura/best-effort: si falla, simplemente no se muestra el
    // tiempo transcurrido para esas ONTs — nunca se bloquea el panel.
  }
}

/**
 * 13ax — "Suspendidos" (admin_state='disable'), separados de "Clientes sin
 * conexión" (ver oltConnectionStatus.ts: `admin_state` manda SIEMPRE sobre
 * `status`, nunca doble conteo entre esta lista y la de desconectados).
 */
const suspendedFilters = ref({ zoneId: '', search: '' });
const filteredSuspendedClients = computed(() =>
  filterDisconnectedClients(
    listSuspendedLinkedClients(oltStore.onts.filter((o) => o.olt_device_id === deviceId.value)),
    suspendedFilters.value,
  ),
);

/**
 * Motivo de la suspensión — reusa tal cual `disabledOnts` (ya cargado por
 * `loadDisabled()`/`oltStore.fetchDisabledOnts` para "ONUs deshabilitadas /
 * cortadas" más abajo en este mismo panel, SIN una llamada nueva) para
 * saber si hay evidencia confiable de deuda (`reason` incluye 'billing',
 * cruzado contra `service_contracts.debt_hold_status='suspended'`) — nunca
 * se asume "por deuda" solo por `admin_state='disable'` (ver
 * suspensionReasonLabel, caso real Danner Ávalos Ventura en 13ax).
 */
const suspensionReasonByOntId = computed(() => new Map(disabledOnts.value.map((it) => [it.id, it.reason])));
function suspensionLabel(ontDbId: string): string {
  return suspensionReasonLabel(suspensionReasonByOntId.value.get(ontDbId));
}

/**
 * "Fecha/hora cuando exista" para un suspendido: `last_synced_at` de la
 * propia ONT (ya cargado, Fase B) — se actualiza SOLO cuando el sync
 * detecta un cambio real de status/admin_state para esa fila (ver
 * oltSyncService.ts). No es un evento "se suspendió a las X" verificado
 * (detectStatusAlert nunca registra alerta para una transición a
 * admin-disabled — es una acción administrativa, no una caída), por eso
 * se etiqueta como "último cambio registrado", nunca como "fecha de
 * suspensión" exacta.
 */
function ontLastSyncedAt(ontDbId: string): string | null {
  return oltStore.onts.find((o) => o.id === ontDbId)?.last_synced_at ?? null;
}

/**
 * Fase 4 OLT — historial de desconexiones/reconexiones (13at/13au, ver
 * GET /:id/alert-log). Sección dentro de la misma tarjeta "Alertas y
 * sincronización" (no un módulo aparte) — colapsada por defecto, es
 * información secundaria frente a las alertas en vivo. Filtros simples
 * reutilizando catálogos y datos ya cargados en este panel: zona
 * (catalogsStore.zones, ya cargado), cliente (derivado de las ONTs de
 * ESTE dispositivo, sin un buscador nuevo), tipo de evento, fecha.
 */
const showAlertLog = ref(false);
const alertLogItems = ref<OltAlertLogEntryView[]>([]);
const alertLogTotal = ref(0);
const alertLogLoading = ref(false);
const alertLogError = ref<string | null>(null);
const ALERT_LOG_PAGE_SIZE = 25;
const alertLogOffset = ref(0);
const alertLogFilters = ref({ from: '', to: '', clientId: '', zoneId: '', kind: '' });

/** Clientes de ESTE dispositivo con al menos una ONT vinculada — reusa oltStore.onts ya cargado, sin buscador nuevo. */
const alertLogClientOptions = computed(() => {
  const map = new Map<string, string>();
  for (const o of oltStore.onts) {
    if (o.olt_device_id !== deviceId.value || !o.client_id || !o.clients) continue;
    map.set(o.client_id, `${o.clients.first_name} ${o.clients.last_name}`.trim());
  }
  return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
});

async function loadAlertLog(resetOffset = true) {
  if (resetOffset) alertLogOffset.value = 0;
  alertLogLoading.value = true;
  alertLogError.value = null;
  try {
    const f = alertLogFilters.value;
    const res = await oltStore.fetchAlertLog(deviceId.value, {
      from: f.from ? `${f.from}T00:00:00` : undefined,
      to: f.to ? `${f.to}T23:59:59` : undefined,
      clientId: f.clientId || undefined,
      zoneId: f.zoneId || undefined,
      kind: f.kind || undefined,
      limit: ALERT_LOG_PAGE_SIZE,
      offset: alertLogOffset.value,
    });
    alertLogItems.value = res.items.map(buildOltAlertLogEntryView);
    alertLogTotal.value = res.total;
  } catch (e) {
    alertLogError.value = getErrorMessage(e, 'Error al consultar el historial de alertas');
  } finally {
    alertLogLoading.value = false;
  }
}
function toggleAlertLog() {
  showAlertLog.value = !showAlertLog.value;
  if (showAlertLog.value && !alertLogItems.value.length) void loadAlertLog();
}
function alertLogNextPage() {
  alertLogOffset.value += ALERT_LOG_PAGE_SIZE;
  void loadAlertLog(false);
}
function alertLogPrevPage() {
  alertLogOffset.value = Math.max(0, alertLogOffset.value - ALERT_LOG_PAGE_SIZE);
  void loadAlertLog(false);
}
function openOntFromAlertLog(ontDbId: string | null) {
  if (ontDbId) openOntFromAlert(ontDbId);
}
/**
 * Correción puntual (13aq): contadores SEPARADOS — nunca mezclar
 * "pendiente de vincular" (normal durante la migración SmartOLT) con una
 * discrepancia de zona real, ver `countPonPortIssues`.
 */
function ponPortIssues(p: { slot: number; port: number }): PonPortIssueCounts {
  return countPonPortIssues(ontsOfPort(p));
}

const discrepancyModalPort = ref<{ label: string; rows: OntZoneDiscrepancy[] } | null>(null);
/** `filterStatus` opcional — "consultar el detalle de cada categoría" por separado, sin mezclar. */
function openDiscrepancyModal(
  p: { slot: number; port: number; ponNumber: number },
  filterStatus?: OntZoneCaseStatus | 'ambiguous',
) {
  const all = ontsOfPort(p);
  const rows =
    !filterStatus
      ? all
      : filterStatus === 'ambiguous'
        ? all.filter((r) => r.caseStatus === 'ambiguous_catalog' || r.caseStatus === 'no_official')
        : all.filter((r) => r.caseStatus === filterStatus);
  discrepancyModalPort.value = {
    label: `PON ${String(p.ponNumber).padStart(2, '0')} (Slot ${p.slot} / Puerto ${p.port})`,
    rows,
  };
}
/**
 * Ajuste puntual (13ar): cuántas ONTs de este puerto no tienen ninguna
 * zona propia asignada — exactamente las que `computePonOccupancy` deja
 * fuera de `zoneBreakdown` (ver oltCapacity.ts), por eso el total del
 * puerto podía no coincidir con la suma del desglose. Mismo dato, nunca
 * una resta: `ontsInZone(..., null)` filtra por la MISMA condición
 * (`!ontZone`) que usa `computePonOccupancy` para omitirlas.
 */
function sinZonaCount(p: { slot: number; port: number }): number {
  return ontsInZone(ontsOfPort(p), null).length;
}
/** Abre el detalle ya existente, pero filtrado por la zona PROPIA de la ONT (la misma que cuenta el desglose) — no por caseStatus ni por la zona oficial del PON. */
function openPonZoneDetail(p: { slot: number; port: number; ponNumber: number }, zoneId: string | null, zoneLabel: string) {
  discrepancyModalPort.value = {
    label: `PON ${String(p.ponNumber).padStart(2, '0')} (Slot ${p.slot} / Puerto ${p.port}) — zona: ${zoneLabel}`,
    rows: ontsInZone(ontsOfPort(p), zoneId),
  };
}
function handleViewOntFromDiscrepancy(ontDbId: string) {
  const ont = oltStore.onts.find((o) => o.id === ontDbId);
  discrepancyModalPort.value = null;
  if (ont) openOntDetail(ont);
}

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
    loadDisconnectDetectionTimes(),
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
    }${
      res.conflicts.length
        ? ` ⚠ ${res.conflicts.length} posición(es) ya vinculada(s) a un cliente reportan OTRO serial en la OLT (posible ONT reemplazada/trasladada) — no se modificaron, revisar manualmente: ${res.conflicts
            .map((c) => `${c.position} (antes ${c.previousSerial}, ahora ${c.scannedSerial})`)
            .join('; ')}.`
        : ''
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

      <!-- 1) Resumen general -->
      <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Resumen general</h2>
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

      <!-- 2) Ocupacion por puerto PON: numero operativo + nombre de zona predominante -->
      <div v-if="ponOccupancy.length" class="rounded-xl border border-slate-200 bg-slate-100 p-4 mb-6">
        <h2 class="text-sm font-semibold mb-1">Ocupación por puerto PON</h2>
        <p class="text-xs text-slate-500 mb-3">
          "PON ##" es un número operativo correlativo (no un identificador de la OLT); Slot/Puerto es
          el identificador físico real de la ZTE, sin alterar. La zona es la predominante según las
          ONTs ya vinculadas — no necesariamente "la" zona comercial de ese PON si el puerto mezcla
          más de una (ver desglose).
        </p>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <div v-for="p in ponOccupancy" :key="`${p.slot}/${p.port}`" class="rounded-lg bg-white border border-slate-200 p-3">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-semibold text-slate-700">PON {{ String(p.ponNumber).padStart(2, '0') }}</span>
              <span class="text-[10px] text-slate-400 whitespace-nowrap">Slot {{ p.slot }} · Puerto {{ p.port }}</span>
            </div>
            <div class="text-sm font-semibold mt-1">{{ p.count }}/{{ p.max }} ONTs</div>
            <div class="h-1.5 rounded-full bg-slate-200 overflow-hidden mt-1 mb-2">
              <div class="h-full bg-sky-500" :style="{ width: `${p.pct}%` }"></div>
            </div>
            <button
              v-if="p.dominantZone"
              class="text-xs text-slate-600 hover:underline text-left"
              @click="openPonZoneDetail(p, p.dominantZone.zoneId, p.dominantZone.zoneName)"
            >
              {{ p.dominantZone.zoneName }} <span class="text-slate-400">({{ p.dominantZone.count }})</span>
            </button>
            <div v-else class="text-xs text-amber-700">Sin zona vinculada — pendiente de vincular</div>
            <div v-if="ponZoneMismatchOfficialName(p)" class="text-[10px] text-red-600 mt-0.5">
              ⚠ zona oficial del catálogo: "{{ ponZoneMismatchOfficialName(p) }}" — revisar vínculo
            </div>
            <div v-else-if="ponZoneAmbiguousCount(p)" class="text-[10px] text-red-600 mt-0.5">
              ⚠ el catálogo tiene {{ ponZoneAmbiguousCount(p) }} zonas para PON
              {{ String(p.ponNumber).padStart(2, '0') }} — revisar nombres de zona
            </div>
            <div v-else-if="ponZoneStatus(p).status === 'no_official'" class="text-[10px] text-slate-400 mt-0.5">
              Sin zona "PON {{ p.ponNumber }}" en el catálogo
            </div>
            <button
              v-if="p.otherZonesCount > 0"
              class="text-[10px] text-sky-600 hover:underline mt-1"
              @click="toggleZoneBreakdown(`${p.slot}/${p.port}`)"
            >
              {{ expandedPonKey === `${p.slot}/${p.port}` ? 'Ocultar desglose' : `+${p.otherZonesCount} zona${p.otherZonesCount > 1 ? 's' : ''} más` }}
            </button>
            <ul v-if="expandedPonKey === `${p.slot}/${p.port}`" class="mt-1 text-[10px] text-slate-500 space-y-0.5">
              <!-- El desglose completo incluye la dominante (p.zoneBreakdown[0] === p.dominantZone) — se omite acá para no repetirla, ya es clicable arriba. -->
              <li v-for="z in p.zoneBreakdown.slice(1)" :key="z.zoneId">
                <button class="hover:underline text-left" @click="openPonZoneDetail(p, z.zoneId, z.zoneName)">{{ z.zoneName }} — {{ z.count }}</button>
              </li>
            </ul>
            <!-- Ajuste puntual (13ar): ONTs de este puerto sin ninguna zona
                 propia asignada — quedaban fuera del desglose de arriba
                 (computePonOccupancy solo suma ahí las que SÍ tienen zona),
                 por eso el total del puerto podía no coincidir con la suma
                 visible. Mismo criterio exacto que ese cálculo, no una resta. -->
            <div v-if="sinZonaCount(p) > 0" class="mt-1 text-[10px] text-slate-500">
              <button class="hover:underline text-left" @click="openPonZoneDetail(p, null, 'Sin zona identificada')">
                Sin zona identificada ({{ sinZonaCount(p) }})
              </button>
            </div>
            <!-- Correción puntual (13aq): 3 contadores separados — nunca un
                 solo "N con revisión pendiente" que mezcle ONTs sin vincular
                 todavía (normal durante la migración SmartOLT) con una
                 discrepancia de zona real. Cada uno abre el detalle SOLO de
                 su categoría. -->
            <button
              v-if="ponPortIssues(p).discrepanciaReal > 0"
              class="text-[10px] text-red-600 hover:underline mt-1 block font-medium"
              @click="openDiscrepancyModal(p, 'zone_mismatch')"
            >
              ⚠ {{ ponPortIssues(p).discrepanciaReal }} discrepancia{{ ponPortIssues(p).discrepanciaReal > 1 ? 's' : '' }} de zona →
            </button>
            <button
              v-if="ponPortIssues(p).datosAmbiguos > 0"
              class="text-[10px] text-red-600 hover:underline mt-1 block font-medium"
              @click="openDiscrepancyModal(p, 'ambiguous')"
            >
              ❔ {{ ponPortIssues(p).datosAmbiguos }} dato{{ ponPortIssues(p).datosAmbiguos > 1 ? 's' : '' }} ambiguo{{ ponPortIssues(p).datosAmbiguos > 1 ? 's' : '' }} (catálogo) →
            </button>
            <button
              v-if="ponPortIssues(p).pendienteVinculacion > 0"
              class="text-[10px] text-slate-500 hover:underline mt-1 block"
              @click="openDiscrepancyModal(p, 'unlinked')"
            >
              {{ ponPortIssues(p).pendienteVinculacion }} ONT{{ ponPortIssues(p).pendienteVinculacion > 1 ? 's' : '' }} pendiente{{ ponPortIssues(p).pendienteVinculacion > 1 ? 's' : '' }} de vincular (migración) →
            </button>
            <button
              v-if="!ponPortIssues(p).discrepanciaReal && !ponPortIssues(p).datosAmbiguos && !ponPortIssues(p).pendienteVinculacion"
              class="text-[10px] text-slate-400 hover:underline mt-1 block"
              @click="openDiscrepancyModal(p)"
            >
              Ver detalle de ONTs de este puerto
            </button>
          </div>
        </div>
        <p class="text-xs text-slate-500 mt-3">
          Basado en lo ya sincronizado aquí (olt_onts), no en un escaneo nuevo — puede no reflejar una
          ONT cableada en la OLT real que todavía no se importó/sincronizó. La numeración PON es
          correlativa sobre los puertos ya conocidos: si más adelante aparece la primera ONT de un
          puerto nuevo en un slot anterior, los números posteriores se corren (no es un ID fijo de la
          OLT, ver nota en src/lib/oltCapacity.ts).
        </p>
      </div>

      <!-- 3) Gestion de ONTs: una sola seccion con pestañas (antes la tabla completa vivía
           aparte, duplicando lo que ya mostraban las 3 pestañas de abajo). -->
      <div ref="ontsTableEl" class="surface p-5 mb-6">
        <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Gestión de ONTs</h2>
        <div ref="ontTabsEl" class="flex gap-2 border-b border-slate-200 mb-4 flex-wrap">
          <button
            class="px-4 py-2 text-sm font-medium rounded-t-lg"
            :class="activeOntTab === 'all' ? 'bg-slate-100 text-slate-900 border border-b-0 border-slate-200' : 'text-slate-500 hover:text-slate-700'"
            @click="activeOntTab = 'all'"
          >
            Todas ({{ oltStore.onts.length }})
          </button>
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

        <button type="button" class="btn-secondary mb-3" :aria-pressed="activeOntTab === 'retired'" @click="activeOntTab = 'retired'">Retiradas · historial</button>
        <RetiredOntsPanel v-if="activeOntTab === 'retired'" :device-id="deviceId" />
        <template v-if="activeOntTab === 'all'">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
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
                       OntDetailModal, que tiene "Consultar señal"/"Editar información"/
                       "Habilitar TR-069" o "Administrar TR-069" segun el estado, 2026-10-27)
                       — tenerlos duplicados aca era lo que hacia
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
        <UnconfiguredOntsTab
          v-else-if="activeOntTab === 'uncfg'"
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
      </div>

      <!-- 4) Telemetria: en seccion desplegable (cerrada por defecto, misma data/gauges de siempre) -->
      <details class="surface p-5 mb-6 relative overflow-hidden">
        <summary class="text-sm font-semibold flex items-center gap-2 cursor-pointer list-none">🏁 Telemetría</summary>
        <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-500 via-emerald-500 to-amber-500"></div>

        <div class="flex items-center justify-end mt-4 mb-1">
          <span class="text-xs text-slate-500">
            {{ healthLoading ? 'Consultando...' : '' }}
            <button v-if="!healthLoading" class="text-sky-600 hover:underline" @click="loadHealth">Actualizar</button>
          </span>
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
      </details>

      <!-- 5) Alertas y herramientas de sincronizacion: seccion diferenciada (antes el
           banner de alertas vivia arriba de todo y las herramientas quedaban sueltas
           entre la ocupacion PON y las pestañas de ONTs). -->
      <div class="surface p-5 mb-6">
        <h2 class="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Alertas y sincronización</h2>

        <!-- Fase 5 OLT — Centro de monitoreo visual (13aw): 2 pestañas
             dentro de esta misma tarjeta, "Consultar puerto GPON"/"Importar
             ONTs" (herramientas de sincronización manual, sin tocar) quedan
             FUERA de las pestañas, debajo de ambas, sin cambios. -->
        <div class="flex gap-1 border-b border-slate-200 mb-4">
          <button
            type="button"
            class="px-3 py-1.5 text-sm font-medium border-b-2 -mb-px"
            :class="alertsTab === 'estado' ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-700'"
            @click="alertsTab = 'estado'"
          >
            Estado actual
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-sm font-medium border-b-2 -mb-px"
            :class="alertsTab === 'historial' ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-700'"
            @click="alertsTab = 'historial'"
          >
            Historial de alertas
          </button>
        </div>

        <div v-show="alertsTab === 'estado'">
          <!-- Aviso de frescura de los datos (requisito explícito): nunca se
               interpreta un fallo de sincronización como desconexión de
               clientes — si el último intento no completó el escaneo, o ya
               pasó demasiado tiempo, se avisa aparte, SIN mezclarlo con los
               conteos (que siguen siendo del último escaneo que sí se
               completó). -->
          <div
            v-if="!syncFreshness.scanComplete || syncFreshness.stale || !syncFreshness.checkedAtIso"
            class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 mb-3"
          >
            <span v-if="!syncFreshness.checkedAtIso">⚠ Todavía no hay ninguna sincronización registrada para esta OLT.</span>
            <span v-else-if="!syncFreshness.scanComplete">
              ⚠ La OLT no respondió por completo en el último intento ({{ relativeTime(syncFreshness.checkedAtIso) }}) — esta
              información puede estar desactualizada.
            </span>
            <span v-else-if="syncFreshness.stale">
              ⚠ La última sincronización fue hace más de una hora ({{ relativeTime(syncFreshness.checkedAtIso) }}) — esta
              información podría no reflejar el estado actual.
            </span>
          </div>
          <p class="text-xs text-slate-500 mb-3">
            Última sincronización:
            <strong>{{ syncFreshness.checkedAtIso ? `${relativeTime(syncFreshness.checkedAtIso)} · ${formatPeruDateTime(syncFreshness.checkedAtIso)} (Perú)` : 'No disponible' }}</strong>
          </p>

          <!-- Conteos — solo datos ya cargados (oltStore.onts, Fase B), nunca un vinculo inventado.
               Mutuamente excluyentes (13ax): admin_state='disable' SIEMPRE manda sobre status,
               asi que "Suspendidos" nunca se mezcla con "Clientes sin conexión" ni "conectados". -->
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
            <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <div class="text-xl font-bold text-red-700">{{ connectionCounts.linkedOffline }}</div>
              <div class="text-[11px] text-red-700">Clientes sin conexión</div>
            </div>
            <div class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <div class="text-xl font-bold text-amber-700">{{ connectionCounts.linkedSuspended }}</div>
              <div class="text-[11px] text-amber-700">Suspendidos</div>
            </div>
            <div class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <div class="text-xl font-bold text-emerald-700">{{ connectionCounts.linkedOnline }}</div>
              <div class="text-[11px] text-emerald-700">Clientes conectados</div>
            </div>
            <div class="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2">
              <div class="text-xl font-bold text-slate-600">{{ connectionCounts.unlinked }}</div>
              <div class="text-[11px] text-slate-600">ONTs pendientes de vincular</div>
            </div>
            <div v-if="connectionCounts.linkedUnknown > 0" class="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2">
              <div class="text-xl font-bold text-slate-500">{{ connectionCounts.linkedUnknown }}</div>
              <div class="text-[11px] text-slate-500">Estado desconocido (sin verificar todavía)</div>
            </div>
          </div>

          <!-- Suspendidos administrativamente (admin_state='disable') — separados de "Sin conexión" (13ax).
               Motivo "por deuda/mora" SOLO con evidencia confiable (debt_hold_status, via disabledOnts ya
               cargado) — nunca inferido solo del admin-disabled (ver suspensionReasonLabel). -->
          <div class="rounded-xl border border-slate-200 bg-white p-4 mb-4">
            <h3 class="text-sm font-semibold mb-3">Suspendidos</h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
              <select v-model="suspendedFilters.zoneId" class="field-input text-xs">
                <option value="">Todas las zonas</option>
                <option v-for="z in catalogsStore.zones" :key="z.id" :value="z.id">{{ z.name }}</option>
              </select>
              <input v-model="suspendedFilters.search" type="text" placeholder="Buscar cliente por nombre..." class="field-input text-xs" />
            </div>

            <div v-if="filteredSuspendedClients.length" class="space-y-2">
              <div v-for="s in filteredSuspendedClients" :key="s.ontDbId" class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                <div class="flex items-start justify-between gap-3">
                  <router-link :to="`/clientes/${s.client.id}/servicios/${s.contract.id}`" class="font-medium text-sky-700 hover:underline">
                    👤 {{ s.client.name }}
                  </router-link>
                  <span class="text-[11px] font-semibold text-amber-800 bg-amber-100 rounded px-1.5 py-0.5 whitespace-nowrap">{{ suspensionLabel(s.ontDbId) }}</span>
                </div>
                <p class="mt-1 text-xs text-slate-600">
                  {{ s.contract.contractNumber || 'sin número' }}
                  <span v-if="s.contract.clientCode" class="text-slate-400"> · código {{ s.contract.clientCode }}</span>
                  <span v-if="s.zoneName"> · {{ s.zoneName }}</span>
                </p>
                <p v-if="ontLastSyncedAt(s.ontDbId)" class="mt-1 text-[11px] text-slate-500">
                  Último cambio registrado {{ relativeTime(ontLastSyncedAt(s.ontDbId)!) }} · {{ formatPeruDateTime(ontLastSyncedAt(s.ontDbId)!) }} (Perú)
                </p>
                <p class="mt-1 text-[11px] text-slate-500">
                  Slot {{ s.slot }}/Puerto {{ s.port }}/ONU {{ s.ontId }} · {{ s.serial }}
                  <router-link :to="`/clientes/${s.client.id}`" class="ml-2 text-sky-600 hover:underline">Ver cliente</router-link>
                  <button class="ml-2 text-sky-600 hover:underline" @click="openOntFromAlert(s.ontDbId)">Ver ONT</button>
                </p>
              </div>
            </div>
            <p v-else class="text-xs text-slate-500">
              {{ connectionCounts.linkedSuspended === 0 ? 'Ningún cliente vinculado está suspendido en este momento.' : 'Sin resultados para el filtro aplicado.' }}
            </p>
          </div>

          <!-- Lista de clientes desconectados: nombre, contrato, zona, acceso directo. -->
          <div class="rounded-xl border border-slate-200 bg-white p-4 mb-4">
            <h3 class="text-sm font-semibold mb-3">Clientes sin conexión</h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
              <select v-model="disconnectedFilters.zoneId" class="field-input text-xs">
                <option value="">Todas las zonas</option>
                <option v-for="z in catalogsStore.zones" :key="z.id" :value="z.id">{{ z.name }}</option>
              </select>
              <input v-model="disconnectedFilters.search" type="text" placeholder="Buscar cliente por nombre..." class="field-input text-xs" />
            </div>

            <div v-if="filteredDisconnectedClients.length" class="space-y-2">
              <div v-for="d in filteredDisconnectedClients" :key="d.ontDbId" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm">
                <div class="flex items-start justify-between gap-3">
                  <router-link :to="`/clientes/${d.client.id}/servicios/${d.contract.id}`" class="font-medium text-sky-700 hover:underline">
                    👤 {{ d.client.name }}
                  </router-link>
                  <span class="text-[11px] font-semibold text-red-700 bg-red-100 rounded px-1.5 py-0.5 whitespace-nowrap">Sin conexión</span>
                </div>
                <p class="mt-1 text-xs text-slate-600">
                  {{ d.contract.contractNumber || 'sin número' }}
                  <span v-if="d.contract.clientCode" class="text-slate-400"> · código {{ d.contract.clientCode }}</span>
                  <span v-if="d.zoneName"> · {{ d.zoneName }}</span>
                </p>
                <p v-if="disconnectDetectedAt.get(d.ontDbId)" class="mt-1 text-[11px] text-slate-500">
                  Detectado {{ relativeTime(disconnectDetectedAt.get(d.ontDbId)!) }} · {{ formatPeruDateTime(disconnectDetectedAt.get(d.ontDbId)!) }} (Perú)
                </p>
                <p class="mt-1 text-[11px] text-slate-500">
                  Slot {{ d.slot }}/Puerto {{ d.port }}/ONU {{ d.ontId }} · {{ d.serial }}
                  <button class="ml-2 text-sky-600 hover:underline" @click="openOntFromAlert(d.ontDbId)">Ver ONT</button>
                </p>
              </div>
            </div>
            <p v-else class="text-xs text-slate-500">
              {{ connectionCounts.linkedOffline === 0 ? 'Ningún cliente vinculado está sin conexión en este momento.' : 'Sin resultados para el filtro aplicado.' }}
            </p>
          </div>

          <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Notificaciones en vivo (esta sesión)</h3>

        <!--
          Fase 3 comercial OLT: alertas proactivas (caida/recuperacion online-
          offline, cruce de umbral de senal), exclusivas de este panel y en
          vivo (SSE) — solo lo que llego mientras esta pantalla estuvo
          abierta, se vacia al recargar o reabrir. Ver src/stores/olt.ts
          (OltAlert) y server/src/services/oltAlerts.ts.

          Mejora para uso administrativo (13as, src/lib/oltAlertPresentation.ts):
          cada alerta se resuelve contra la ONT ya cargada en este panel
          (oltStore.onts, sin consulta nueva) para mostrar fecha/hora REAL
          del evento en horario de Peru, y cliente/contrato SOLO si
          client_id+contract_id de esa ONT estan verificados — nunca por
          nombre/descripcion/posicion. La limitacion de fondo (sin historial
          persistente mas alla de esta sesion de navegador) sigue igual,
          documentada en 13as — fuera de alcance de este ajuste.
        -->
        <p class="text-[11px] text-slate-500 mb-2">
          La hora mostrada es de <strong>detección</strong> (cuándo el sistema lo notó, en horario de Perú) — el instante
          exacto de la desconexión real puede haber sido antes, no se conoce con precisión.
        </p>
        <div v-if="alertViews.length" class="mb-4 space-y-2">
          <div
            v-for="a in alertViews"
            :key="a.id"
            class="rounded-lg border px-3 py-2 text-sm"
            :class="a.severity === 'critical' ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex items-center gap-2">
                <span
                  class="inline-block w-2 h-2 rounded-full"
                  :class="a.severity === 'critical' ? 'bg-red-500' : 'bg-emerald-500'"
                ></span>
                <span class="font-semibold" :class="a.severity === 'critical' ? 'text-red-800' : 'text-emerald-800'">{{ a.kindLabel }}</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-slate-500 whitespace-nowrap">{{ relativeTime(a.atIso) }} · {{ a.atFormatted }} (Perú)</span>
                <button class="text-xs opacity-60 hover:opacity-100" @click="oltStore.dismissAlert(a.id)">✕</button>
              </div>
            </div>

            <div class="mt-1 text-slate-800">
              <router-link
                v-if="a.client && a.contract"
                :to="`/clientes/${a.client.id}/servicios/${a.contract.id}`"
                class="font-medium text-sky-700 hover:underline"
              >
                👤 {{ a.client.name }}
              </router-link>
              <span v-else class="text-slate-500">⬜ Pendiente de vincular</span>
              <span v-if="a.contract?.clientCode" class="text-slate-400"> · código {{ a.contract.clientCode }}</span>
              <button
                v-if="!a.client"
                class="ml-2 text-xs text-sky-600 hover:underline"
                @click="openOntFromAlert(a.ontDbId)"
              >
                Ver ONT
              </button>
            </div>

            <!-- Datos tecnicos: informacion secundaria, no el foco principal. -->
            <p class="mt-1 text-[11px] text-slate-500">
              <span v-if="a.zoneName">{{ a.zoneName }} · </span>
              <span v-if="a.ponNumber">PON {{ String(a.ponNumber).padStart(2, '0') }} · </span>
              <span v-if="a.slot != null">Slot {{ a.slot }}/Puerto {{ a.port }}/ONU {{ a.ontId }} · </span>
              <span v-if="a.serial">{{ a.serial }}</span>
            </p>
          </div>
        </div>
        <p v-else class="text-xs text-slate-500 mb-4">Sin alertas activas en esta sesión.</p>
        </div>

        <!-- Fase 4 OLT — Historial de alertas (13at/13au): misma tarjeta,
             sección aparte, colapsada por defecto (información secundaria
             frente a las alertas en vivo). Sin cambios de comportamiento —
             solo ahora vive dentro de la pestaña "Historial de alertas". -->
        <div v-show="alertsTab === 'historial'" class="rounded-xl border border-slate-200 bg-white p-4 mb-4">
          <button class="flex items-center justify-between w-full text-left" @click="toggleAlertLog">
            <h3 class="text-sm font-semibold">Historial de alertas</h3>
            <span class="text-xs text-sky-600">{{ showAlertLog ? 'Ocultar ▲' : 'Ver historial ▼' }}</span>
          </button>

          <div v-if="showAlertLog" class="mt-3">
            <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
              <div>
                <label class="block text-[11px] text-slate-500 mb-1">Desde</label>
                <input v-model="alertLogFilters.from" type="date" class="field-input text-xs" />
              </div>
              <div>
                <label class="block text-[11px] text-slate-500 mb-1">Hasta</label>
                <input v-model="alertLogFilters.to" type="date" class="field-input text-xs" />
              </div>
              <div>
                <label class="block text-[11px] text-slate-500 mb-1">Cliente</label>
                <select v-model="alertLogFilters.clientId" class="field-input text-xs">
                  <option value="">Todos</option>
                  <option v-for="c in alertLogClientOptions" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
              </div>
              <div>
                <label class="block text-[11px] text-slate-500 mb-1">Zona</label>
                <select v-model="alertLogFilters.zoneId" class="field-input text-xs">
                  <option value="">Todas</option>
                  <option v-for="z in catalogsStore.zones" :key="z.id" :value="z.id">{{ z.name }}</option>
                </select>
              </div>
              <div>
                <label class="block text-[11px] text-slate-500 mb-1">Evento</label>
                <select v-model="alertLogFilters.kind" class="field-input text-xs">
                  <option value="">Todos</option>
                  <option value="offline">Internet desconectado</option>
                  <option value="recovered">Internet reconectado</option>
                  <option value="lowSignal">Señal óptica baja</option>
                  <option value="signalRecovered">Señal óptica recuperada</option>
                </select>
              </div>
            </div>
            <button class="btn-secondary text-xs mb-3" :disabled="alertLogLoading" @click="loadAlertLog()">
              {{ alertLogLoading ? 'Consultando...' : 'Filtrar' }}
            </button>
            <p v-if="alertLogError" class="text-xs text-red-600 mb-2">{{ alertLogError }}</p>

            <div v-if="alertLogItems.length" class="space-y-2">
              <div
                v-for="h in alertLogItems"
                :key="h.id"
                class="rounded-lg border px-3 py-2 text-sm"
                :class="h.severity === 'critical' ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'"
              >
                <div class="flex items-start justify-between gap-3">
                  <span class="font-semibold text-xs" :class="h.severity === 'critical' ? 'text-red-800' : 'text-emerald-800'">Evento registrado: {{ h.kindLabel }}</span>
                  <span class="text-xs text-slate-500 whitespace-nowrap">{{ relativeTime(h.at) }} · {{ h.atFormatted }} (Perú)</span>
                </div>
                <div class="mt-1 text-slate-800 text-sm">
                  <router-link
                    v-if="h.client && h.contract"
                    :to="`/clientes/${h.client.id}/servicios/${h.contract.id}`"
                    class="font-medium text-sky-700 hover:underline"
                  >
                    👤 {{ h.client.name }}
                  </router-link>
                  <span v-else class="text-slate-500">⬜ Pendiente de vincular</span>
                  <span v-if="h.contract?.clientCode" class="text-slate-400"> · código {{ h.contract.clientCode }}</span>
                  <button v-if="!h.client && !h.retired" class="ml-2 text-xs text-sky-600 hover:underline" @click="openOntFromAlertLog(h.oltOntId)">
                    Ver ONT
                  </button>
                </div>
                <p class="mt-1 text-[11px] text-slate-500">
                  <span v-if="h.zoneName">{{ h.zoneName }} · </span>
                  <span v-if="h.durationMinutes != null">duración aprox. {{ h.durationMinutes }} min · </span>
                  <span :class="h.retired ? 'font-semibold text-amber-800' : ''">{{ h.currentStatusLabel }} · </span>
                  <span v-if="h.ont?.slot != null">{{ h.retired ? 'Última posición histórica: ' : 'Posición registrada: ' }}Slot {{ h.ont.slot }}/Puerto {{ h.ont.port }}/ONU {{ h.ont.ontId }} · </span>
                  <span v-if="h.ont?.serial">{{ h.ont.serial }}</span>
                  <span v-if="h.retired && h.ont?.retiredAt"> · retiro: {{ relativeTime(h.ont.retiredAt) }}</span>
                </p>
                <p v-if="h.detail" class="mt-1 text-xs text-slate-600">Dato registrado en el evento: {{ h.detail }}
                </p>
              </div>
            </div>
            <p v-else-if="!alertLogLoading" class="text-xs text-slate-500">Sin eventos en el rango consultado.</p>

            <div v-if="alertLogTotal > ALERT_LOG_PAGE_SIZE" class="flex items-center justify-between mt-3 text-xs text-slate-500">
              <button class="btn-secondary text-xs" :disabled="alertLogOffset === 0 || alertLogLoading" @click="alertLogPrevPage">← Anterior</button>
              <span>{{ alertLogOffset + 1 }}–{{ Math.min(alertLogOffset + ALERT_LOG_PAGE_SIZE, alertLogTotal) }} de {{ alertLogTotal }}</span>
              <button
                class="btn-secondary text-xs"
                :disabled="alertLogOffset + ALERT_LOG_PAGE_SIZE >= alertLogTotal || alertLogLoading"
                @click="alertLogNextPage"
              >
                Siguiente →
              </button>
            </div>
          </div>
        </div>

        <div class="rounded-xl border border-slate-200 bg-slate-100 p-4 mb-4">
          <h3 class="text-sm font-semibold mb-3">Consultar puerto GPON</h3>
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

        <div class="rounded-xl border border-amber-800/40 bg-amber-950/20 p-4">
          <h3 class="text-sm font-semibold mb-1">¿Ves menos ONTs de las que tienes, o sin nombre/señal?</h3>
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

    <OntZoneDiscrepancyModal
      v-if="discrepancyModalPort"
      :port-label="discrepancyModalPort.label"
      :rows="discrepancyModalPort.rows"
      @close="discrepancyModalPort = null"
      @view-ont="handleViewOntFromDiscrepancy"
    />
  </AppLayout>
</template>
