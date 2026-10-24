<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import VueApexCharts from 'vue3-apexcharts';
import {
  useMikrotikStore,
  type DhcpLease,
  type IpAddress,
  type MikrotikInterface,
  type MikrotikBalancerConnection,
  type MikrotikBalancerHistoryPoint,
  type MikrotikBalancerLinkAlert,
  type MikrotikSaturationAlert,
  type MikrotikTrafficHistoryPoint,
  type MikrotikTrafficLive,
  type PppActive,
  type PppSecret,
  type ReconcileReport,
  type RouterResource,
  type TrafficHistoryRange,
} from '@/stores/mikrotik';
import { MIKROTIK_DEVICE_ROLE_LABELS, isPppoeAdminRole } from '@/lib/mikrotikDeviceRole';
import { formatBpsAsMbps, splitMbpsForDisplay, toMbps, usageBarClass, usagePercent, usageTextClass, type CapacityUnit } from '@/lib/mikrotikBorderTraffic';
import { formatRouterUptime, summarizeMemoryUsage, summarizeWanConnectionCounts } from '@/lib/mikrotikBalancerHealth';
import { formatWanLinkAlertDuration, wanLinkAlertBadgeClass, wanLinkAlertLabel } from '@/lib/mikrotikBalancerLinkAlerts';
import { formatPeruDateTime, formatRelativeTime } from '@/lib/oltAlertPresentation';
import { useAuthStore } from '@/stores/auth';
import { useAsyncAction } from '@/composables/useAsyncAction';
import { getErrorMessage } from '@/lib/errors';

const route = useRoute();
const router = useRouter();
const mikrotikStore = useMikrotikStore();
const auth = useAuthStore();

const deviceId = computed(() => route.params.id as string);
const device = computed(() => mikrotikStore.devices.find((d) => d.id === deviceId.value));
// Un router de borde (dedicado o balanceador) no corre PPP de clientes —
// se muestra solo lo que de verdad aplica (conexion, interfaces, trafico,
// CPU, memoria), nunca una sección PPPoE/DHCP vacía o que de error.
const isPppoeAdmin = computed(() => isPppoeAdminRole(device.value?.device_role));
// Fase 172: el panel de trafico/saturación es EXCLUSIVO del borde dedicado
// (CCR2004 Fiberlux).
const isBorderDedicated = computed(() => device.value?.device_role === 'borde_dedicado');
// Fase 174: el balanceador tiene su propia sección (descubrimiento de
// conexiones WAN) — ya no cae en la rama generica del administrador.
const isBalancer = computed(() => device.value?.device_role === 'borde_balanceador');
const canConfigureBorder = computed(() => auth.role === 'SUPERADMIN' || auth.role === 'ADMIN');

const loading = ref(true);
const loadError = ref<string | null>(null);
const resource = ref<RouterResource | null>(null);
const secrets = ref<PppSecret[]>([]);
const active = ref<PppActive[]>([]);
const leases = ref<DhcpLease[]>([]);
const ipAddresses = ref<IpAddress[]>([]);
const interfaces = ref<MikrotikInterface[]>([]);

function formatBytes(value?: string): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

const activeByName = computed(() => new Set(active.value.map((a) => a.name)));

const secretSearch = ref('');
const filteredSecrets = computed(() => {
  const q = secretSearch.value.trim().toLowerCase();
  if (!q) return secrets.value;
  return secrets.value.filter((s) => `${s.name} ${s.profile} ${s.comment ?? ''}`.toLowerCase().includes(q));
});

const leaseSearch = ref('');
const filteredLeases = computed(() => {
  const q = leaseSearch.value.trim().toLowerCase();
  if (!q) return leases.value;
  return leases.value.filter((l) => `${l.address} ${l['mac-address']} ${l['host-name'] ?? ''}`.toLowerCase().includes(q));
});
// Cruce ONT <-> IP por MAC de WAN: pendiente hasta validar "wan-info" en la OLT real (ver Fase 4).

async function loadAll() {
  loading.value = true;
  loadError.value = null;
  try {
    const adminOnly = isPppoeAdmin.value;
    const [res, ips, ifaces, sec, act, lea] = await Promise.all([
      mikrotikStore.fetchResource(deviceId.value),
      mikrotikStore.fetchIpAddresses(deviceId.value),
      mikrotikStore.fetchInterfaces(deviceId.value),
      adminOnly ? mikrotikStore.fetchPppSecrets(deviceId.value) : Promise.resolve([]),
      adminOnly ? mikrotikStore.fetchPppActive(deviceId.value) : Promise.resolve([]),
      adminOnly ? mikrotikStore.fetchDhcpLeases(deviceId.value) : Promise.resolve([]),
    ]);
    resource.value = res;
    ipAddresses.value = ips;
    interfaces.value = ifaces;
    secrets.value = sec;
    active.value = act;
    leases.value = lea;
  } catch (e) {
    loadError.value = getErrorMessage(e, 'Error al consultar el router');
  } finally {
    loading.value = false;
  }
}

// ---- Fase 172: trafico/saturación del borde dedicado ----

const live = ref<MikrotikTrafficLive | null>(null);
const historyRange = ref<TrafficHistoryRange>('1h');
const historyPoints = ref<MikrotikTrafficHistoryPoint[]>([]);
const historyLoading = ref(false);
const alerts = ref<MikrotikSaturationAlert[]>([]);
const showTechInfo = ref(false);

const HISTORY_RANGE_LABEL: Record<TrafficHistoryRange, string> = {
  '15m': 'Últimos 15 min',
  '1h': 'Última hora',
  '24h': 'Últimas 24 horas',
  '7d': 'Últimos 7 días',
};

const nowMs = ref(Date.now());

async function loadLive() {
  nowMs.value = Date.now();
  try {
    live.value = await mikrotikStore.fetchTrafficLive(deviceId.value);
  } catch {
    // Silencioso: no tumbar el panel por un fallo puntual del sondeo en vivo.
  }
}

const lastReadLabel = computed(() => {
  if (!live.value?.fetchedAt) return 'Sin lecturas todavía';
  return `${formatPeruDateTime(live.value.fetchedAt)} (${formatRelativeTime(live.value.fetchedAt, nowMs.value)})`;
});

async function loadHistory() {
  historyLoading.value = true;
  try {
    const res = await mikrotikStore.fetchTrafficHistory(deviceId.value, historyRange.value);
    historyPoints.value = res.points;
  } catch {
    // Silencioso: el resto del panel (en vivo, config) sigue funcionando sin el historico.
  } finally {
    historyLoading.value = false;
  }
}

async function loadAlerts() {
  try {
    alerts.value = await mikrotikStore.fetchSaturationAlerts(deviceId.value);
  } catch {
    // Silencioso.
  }
}

// Fase 172 — corrección visual: vue3-apexcharts aplica cada actualizacion
// de `options` con `JSON.parse(JSON.stringify(options))` (ver su propio
// codigo fuente, copyData()) para no disparar los watchers profundos de
// Vue — eso BORRA SIEMPRE cualquier función que viva dentro de `options`
// (el formateador del eje Y, el del tooltip), aunque la carga inicial se
// vea bien (el primer render usa un merge que sí preserva funciones). Cada
// refresco de historico (loadHistory, cada 30s) volvia a pisar esas
// funciones -> el eje Y volvia a mostrar el numero crudo en bps.
//
// Arreglo real: `options` deja de depender de `historyPoints` (queda
// estatico, nunca vuelve a disparar esa ruta con JSON.stringify) — los
// puntos nuevos entran como pares {x,y} dentro de `series` (que SI se
// actualiza seguido, pero ahi nunca hubo funciones que perder). Mismos
// valores, mismas series, mismos colores/rangos — solo cambia COMO llegan
// los timestamps al grafico.
const chartSeries = computed(() => [
  { name: 'Descarga', data: historyPoints.value.map((p) => ({ x: new Date(p.bucket_start).getTime(), y: Math.round(p.avg_rx_bps ?? 0) })) },
  { name: 'Subida', data: historyPoints.value.map((p) => ({ x: new Date(p.bucket_start).getTime(), y: Math.round(p.avg_tx_bps ?? 0) })) },
]);
const chartOptions = {
  chart: { type: 'area' as const, toolbar: { show: false }, foreColor: '#64748b', background: 'transparent', animations: { speed: 300 } },
  colors: ['#0ea5e9', '#8b5cf6'],
  dataLabels: { enabled: false },
  stroke: { curve: 'smooth' as const, width: 2 },
  fill: { type: 'gradient', gradient: { opacityFrom: 0.3, opacityTo: 0.02, stops: [0, 90, 100] } },
  grid: { borderColor: '#e2e8f0', strokeDashArray: 4 },
  xaxis: { type: 'datetime' as const, labels: { datetimeUTC: false } },
  yaxis: { labels: { formatter: (v: number) => formatBpsAsMbps(v) } },
  tooltip: { theme: 'light' as const, x: { format: 'dd MMM HH:mm' }, y: { formatter: (v: number) => formatBpsAsMbps(v) } },
  legend: { show: true, position: 'top' as const, horizontalAlign: 'left' as const },
};

const peakDownloadBps = computed(() => Math.max(0, ...historyPoints.value.map((p) => p.max_rx_bps ?? 0)));
const peakUploadBps = computed(() => Math.max(0, ...historyPoints.value.map((p) => p.max_tx_bps ?? 0)));

const activeAlerts = computed(() => alerts.value.filter((a) => a.status === 'active'));
const recentlyResolvedAlerts = computed(() => alerts.value.filter((a) => a.status === 'resolved').slice(0, 3));
const DIRECTION_LABEL = { download: 'Descarga', upload: 'Subida' } as const;

const linkStatusLabel = computed(() => {
  switch (live.value?.status) {
    case 'ok':
      return live.value.monitoredDisabled ? 'Interfaz deshabilitada' : live.value.monitoredRunning ? 'En línea' : 'Sin conexión';
    case 'offline':
      return 'Sin respuesta del router';
    case 'not_configured':
      return 'Pendiente de configurar';
    case 'warming_up':
      return 'Iniciando monitoreo...';
    default:
      return 'Consultando...';
  }
});
const linkStatusClass = computed(() => {
  if (live.value?.status === 'ok' && live.value.monitoredRunning && !live.value.monitoredDisabled) return 'bg-emerald-500/15 text-emerald-700';
  if (live.value?.status === 'ok') return 'bg-amber-500/15 text-amber-700';
  if (live.value?.status === 'offline') return 'bg-red-500/15 text-red-600';
  return 'bg-slate-500/15 text-slate-600';
});

const downloadPct = computed(() => usagePercent(live.value?.rxBps, device.value?.capacity_download_mbps ?? 0));
const uploadPct = computed(() => usagePercent(live.value?.txBps, device.value?.capacity_upload_mbps ?? 0));

// ---- Configuración (solo ADMIN/SUPERADMIN) — nunca toca el router, solo metadatos en Supabase ----

const configForm = reactive({
  monitored_interface_name: '',
  uplink_interface_name: '',
  download_value: 500,
  download_unit: 'Mbps' as CapacityUnit,
  upload_value: 500,
  upload_unit: 'Mbps' as CapacityUnit,
});
const configSaving = ref(false);
const configError = ref<string | null>(null);
const configSaved = ref(false);

function resetConfigForm() {
  if (!device.value) return;
  const dl = splitMbpsForDisplay(device.value.capacity_download_mbps);
  const ul = splitMbpsForDisplay(device.value.capacity_upload_mbps);
  configForm.monitored_interface_name = device.value.monitored_interface_name ?? '';
  configForm.uplink_interface_name = device.value.uplink_interface_name ?? '';
  configForm.download_value = dl.value;
  configForm.download_unit = dl.unit;
  configForm.upload_value = ul.value;
  configForm.upload_unit = ul.unit;
}

async function handleSaveBorderConfig() {
  if (!device.value) return;
  configSaving.value = true;
  configError.value = null;
  configSaved.value = false;
  try {
    await mikrotikStore.updateDevice(device.value.id, {
      monitored_interface_name: configForm.monitored_interface_name || null,
      uplink_interface_name: configForm.uplink_interface_name || null,
      capacity_download_mbps: toMbps(configForm.download_value, configForm.download_unit),
      capacity_upload_mbps: toMbps(configForm.upload_value, configForm.upload_unit),
    });
    configSaved.value = true;
    await Promise.all([loadLive(), loadHistory(), loadAlerts()]);
  } catch (e) {
    configError.value = getErrorMessage(e, 'Error al guardar la configuración');
  } finally {
    configSaving.value = false;
  }
}

// ---- Fase 174: conexiones WAN descubiertas del balanceador ----

const balancerConnections = ref<MikrotikBalancerConnection[]>([]);
const balancerLoadError = ref<string | null>(null);
// true cuando el ultimo descubrimiento exitoso fue hace demasiado -- el
// panel debe mostrar "estado desconocido" en vez de reusar el ultimo
// running/disabled guardado como si fuera el estado actual (ver
// isBalancerDataStale en el backend).
const balancerIsStale = ref(false);
const balancerLastDiscoveryAt = ref<string | null>(null);

async function loadBalancerConnections() {
  nowMs.value = Date.now();
  try {
    const health = await mikrotikStore.fetchBalancerConnections(deviceId.value);
    balancerConnections.value = health.connections;
    balancerIsStale.value = health.isStale;
    balancerLastDiscoveryAt.value = health.lastDiscoveryAt;
    balancerLoadError.value = null;
  } catch (e) {
    balancerLoadError.value = getErrorMessage(e, 'Error al consultar las conexiones del balanceador');
  }
}

// Requisito 7/10: nunca se fija una cantidad -- se muestra exactamente lo
// que el ultimo descubrimiento encontro, sin inventar ni completar huecos.
const activeBalancerConnections = computed(() => balancerConnections.value.filter((c) => !c.removed_at));
const removedBalancerConnections = computed(() => balancerConnections.value.filter((c) => c.removed_at));
// Requisito 8: deshabilitada nunca es averia -- solo habilitada+caida lo es.
// Si los datos estan obsoletos (balancerIsStale), nunca se afirma
// "conectada"/"sin conexion" con un valor viejo -- se muestra desconocido.
function connectionStatusLabel(c: MikrotikBalancerConnection): string {
  if (c.disabled) return 'Deshabilitada';
  if (balancerIsStale.value) return 'Estado desconocido';
  return c.running ? 'Conectada' : 'Sin conexión';
}
function connectionStatusClass(c: MikrotikBalancerConnection): string {
  if (c.disabled) return 'bg-slate-500/15 text-slate-600';
  if (balancerIsStale.value) return 'bg-amber-500/15 text-amber-600';
  return c.running ? 'bg-green-500/15 text-green-600' : 'bg-red-500/15 text-red-600';
}
const balancerWanCounts = computed(() => summarizeWanConnectionCounts(activeBalancerConnections.value, balancerIsStale.value));
const balancerMemory = computed(() => summarizeMemoryUsage(resource.value?.['free-memory'] != null ? Number(resource.value['free-memory']) : null, resource.value?.['total-memory'] != null ? Number(resource.value['total-memory']) : null));
const balancerUptimeLabel = computed(() => formatRouterUptime(resource.value?.uptime ?? null));
// Requisito 6: una sola fuente de trafico por conexion (ya resuelto en el
// backend, nivel PPPoE-client) -- aqui solo se suma lo que YA viene
// calculado asi, nunca se mezcla con otro nivel.
const balancerTotalRxBps = computed(() => activeBalancerConnections.value.reduce((acc, c) => acc + (c.disabled ? 0 : c.latest_rx_bps ?? 0), 0));
const balancerTotalTxBps = computed(() => activeBalancerConnections.value.reduce((acc, c) => acc + (c.disabled ? 0 : c.latest_tx_bps ?? 0), 0));
const balancerPortsInUse = computed(() => {
  const ports = new Set(activeBalancerConnections.value.filter((c) => !c.disabled && c.physical_interface_name).map((c) => c.physical_interface_name));
  return ports.size;
});

// Requisito 4: agrupado por puerto fisico, SIEMPRE descubierto (nunca una
// lista fija) — cualquier puerto nuevo que aparezca entra solo.
interface BalancerPortStat {
  port: string;
  connections: MikrotikBalancerConnection[];
  upCount: number;
  disabledCount: number;
  rxBps: number;
  txBps: number;
}
const balancerPortStats = computed<BalancerPortStat[]>(() => {
  const byPort = new Map<string, BalancerPortStat>();
  for (const c of activeBalancerConnections.value) {
    if (!c.physical_interface_name) continue;
    const entry = byPort.get(c.physical_interface_name) ?? { port: c.physical_interface_name, connections: [], upCount: 0, disabledCount: 0, rxBps: 0, txBps: 0 };
    entry.connections.push(c);
    if (c.disabled) entry.disabledCount++;
    else {
      if (c.running) entry.upCount++;
      entry.rxBps += c.latest_rx_bps ?? 0;
      entry.txBps += c.latest_tx_bps ?? 0;
    }
    byPort.set(c.physical_interface_name, entry);
  }
  return [...byPort.values()].sort((a, b) => a.port.localeCompare(b.port));
});

// ---- Requisitos 1/2/3/5: grafico de historico — total, por puerto o por conexion individual ----

type BalancerChartScope = { type: 'total' } | { type: 'port'; port: string } | { type: 'connection'; connectionId: string };
const balancerScope = ref<BalancerChartScope>({ type: 'total' });
const balancerHistoryRange = ref<TrafficHistoryRange>('1h');
const balancerHistoryPoints = ref<MikrotikBalancerHistoryPoint[]>([]);
const balancerHistoryLoading = ref(false);
const balancerHistoryError = ref<string | null>(null);

const balancerScopeLabel = computed(() => {
  const scope = balancerScope.value;
  if (scope.type === 'port') return `Puerto ${scope.port}`;
  if (scope.type === 'connection') {
    const c = balancerConnections.value.find((x) => x.id === scope.connectionId);
    return c ? `Sesión ${c.pppoe_interface_name}` : 'Sesión seleccionada';
  }
  return 'Todas las conexiones activas';
});

async function loadBalancerHistory() {
  balancerHistoryLoading.value = true;
  balancerHistoryError.value = null;
  try {
    const scopeParams = balancerScope.value.type === 'port'
      ? { port: balancerScope.value.port }
      : balancerScope.value.type === 'connection'
        ? { connectionId: balancerScope.value.connectionId }
        : {};
    const res = await mikrotikStore.fetchBalancerTrafficHistory(deviceId.value, balancerHistoryRange.value, scopeParams);
    balancerHistoryPoints.value = res.points;
  } catch (e) {
    balancerHistoryError.value = getErrorMessage(e, 'Error al consultar el histórico del balanceador');
  } finally {
    balancerHistoryLoading.value = false;
  }
}

function selectBalancerTotalScope() {
  balancerScope.value = { type: 'total' };
  selectedConnectionIdForChart.value = '';
  void loadBalancerHistory();
}
function selectBalancerPortScope(port: string) {
  balancerScope.value = { type: 'port', port };
  selectedConnectionIdForChart.value = '';
  void loadBalancerHistory();
}
const selectedConnectionIdForChart = ref('');
function selectBalancerConnectionScope(connectionId: string) {
  if (!connectionId) return;
  balancerScope.value = { type: 'connection', connectionId };
  void loadBalancerHistory();
}

watch(balancerHistoryRange, loadBalancerHistory);

const balancerChartSeries = computed(() => [
  { name: 'Descarga', data: balancerHistoryPoints.value.map((p) => ({ x: new Date(p.bucket_start).getTime(), y: Math.round(p.avg_rx_bps ?? 0) })) },
  { name: 'Subida', data: balancerHistoryPoints.value.map((p) => ({ x: new Date(p.bucket_start).getTime(), y: Math.round(p.avg_tx_bps ?? 0) })) },
]);
// Mismo patron estatico que el grafico del borde dedicado (Fase 172): ver
// el comentario de esa seccion — `options` nunca depende de los datos,
// para que vue3-apexcharts nunca le borre el formateador del eje Y.
const balancerChartOptions = {
  chart: { type: 'area' as const, toolbar: { show: false }, foreColor: '#64748b', background: 'transparent', animations: { speed: 300 } },
  colors: ['#0ea5e9', '#8b5cf6'],
  dataLabels: { enabled: false },
  stroke: { curve: 'smooth' as const, width: 2 },
  fill: { type: 'gradient', gradient: { opacityFrom: 0.3, opacityTo: 0.02, stops: [0, 90, 100] } },
  grid: { borderColor: '#e2e8f0', strokeDashArray: 4 },
  xaxis: { type: 'datetime' as const, labels: { datetimeUTC: false } },
  yaxis: { labels: { formatter: (v: number) => formatBpsAsMbps(v) } },
  tooltip: { theme: 'light' as const, x: { format: 'dd MMM HH:mm' }, y: { formatter: (v: number) => formatBpsAsMbps(v) } },
  legend: { show: true, position: 'top' as const, horizontalAlign: 'left' as const },
};

// ---- Requisito 8: filtros de la tabla (puerto físico + estado) ----

const tableFilterPort = ref('');
const tableFilterStatus = ref<'' | 'up' | 'down' | 'disabled' | 'unknown'>('');
const filteredBalancerConnections = computed(() =>
  activeBalancerConnections.value.filter((c) => {
    if (tableFilterPort.value && c.physical_interface_name !== tableFilterPort.value) return false;
    if (tableFilterStatus.value) {
      const status = c.disabled ? 'disabled' : balancerIsStale.value ? 'unknown' : c.running ? 'up' : 'down';
      if (status !== tableFilterStatus.value) return false;
    }
    return true;
  }),
);

// ---- Fase 174b: alertas de caida/recuperacion de enlaces WAN ----
// Requiere la migracion de mikrotik_balancer_link_alerts -- si todavia no
// esta aplicada, la ruta responde 500 y se muestra un aviso neutro (nunca
// un error alarmante) sin romper el resto del panel ya funcionando.
const balancerActiveLinkAlerts = ref<MikrotikBalancerLinkAlert[]>([]);
const balancerLinkAlertHistory = ref<MikrotikBalancerLinkAlert[]>([]);
const balancerLinkAlertsAvailable = ref(true);
const showLinkAlertHistory = ref(false);

async function loadBalancerLinkAlerts() {
  try {
    const res = await mikrotikStore.fetchBalancerLinkAlerts(deviceId.value);
    balancerActiveLinkAlerts.value = res.active;
    balancerLinkAlertHistory.value = res.history;
    balancerLinkAlertsAvailable.value = true;
  } catch {
    // Todavia no se aplico la migracion de esta tabla -- se oculta la
    // seccion en vez de mostrar un error (ver aviso de "Entrega" del pedido).
    balancerLinkAlertsAvailable.value = false;
  }
}

let livePoll: ReturnType<typeof setInterval> | undefined;
let historyPoll: ReturnType<typeof setInterval> | undefined;
let balancerPoll: ReturnType<typeof setInterval> | undefined;
let balancerHistoryPoll: ReturnType<typeof setInterval> | undefined;
let balancerLinkAlertsPoll: ReturnType<typeof setInterval> | undefined;

watch(historyRange, loadHistory);

onUnmounted(() => {
  clearInterval(livePoll);
  clearInterval(historyPoll);
  clearInterval(balancerPoll);
  clearInterval(balancerHistoryPoll);
  clearInterval(balancerLinkAlertsPoll);
});

// ---- Fase 173: reconciliacion PPPoE — EXCLUSIVA del router administrador, UN router a la vez ----

const reconcileReport = ref<ReconcileReport | null>(null);
const showReconcileDetail = ref(false);

async function loadReconcileReport() {
  try {
    reconcileReport.value = await mikrotikStore.fetchReconcileReport(deviceId.value);
  } catch {
    // silencioso: es solo informativo, no bloquea el resto de la pantalla
  }
}

const { loading: reconcileLoading, error: reconcileError, run: runReconcile } = useAsyncAction(
  () => mikrotikStore.runReconcileNow(deviceId.value),
  'Error al reconciliar',
);
async function handleReconcileNow() {
  const report = await runReconcile();
  if (report) reconcileReport.value = report;
}

function formatReconcileDate(iso: string) {
  return new Date(iso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
}

onMounted(async () => {
  if (!mikrotikStore.devices.length) await mikrotikStore.fetchDevices();
  await loadAll();
  if (isPppoeAdmin.value) await loadReconcileReport();
  if (isBorderDedicated.value) {
    resetConfigForm();
    await Promise.all([loadLive(), loadHistory(), loadAlerts()]);
    // Un solo sondeo en vivo por pestaña contra la CACHE del backend (nunca
    // contra el router directo) -- varios admins con el panel abierto no
    // multiplican las consultas reales al CCR2004.
    livePoll = setInterval(loadLive, 5000);
    historyPoll = setInterval(() => {
      void loadHistory();
      void loadAlerts();
    }, 30000);
  }
  if (isBalancer.value) {
    await Promise.all([loadBalancerConnections(), loadBalancerHistory(), loadBalancerLinkAlerts()]);
    // Cada 60s -- mismo ritmo que el scheduler de descubrimiento del
    // backend (mikrotikBalancerDiscoveryScheduler.ts); pedir mas seguido
    // no traeria datos mas nuevos.
    balancerPoll = setInterval(loadBalancerConnections, 60000);
    balancerHistoryPoll = setInterval(loadBalancerHistory, 60000);
    balancerLinkAlertsPoll = setInterval(loadBalancerLinkAlerts, 60000);
  }
});

async function handleToggleSecret(secret: PppSecret) {
  const willDisable = secret.disabled !== 'true';
  const ok = confirm(`¿${willDisable ? 'Deshabilitar' : 'Habilitar'} el usuario PPPoE "${secret.name}"?`);
  if (!ok) return;
  try {
    await mikrotikStore.togglePppSecret(deviceId.value, secret['.id'], willDisable);
    await loadAll();
  } catch (e) {
    alert(getErrorMessage(e, 'Error al actualizar en el router'));
  }
}
</script>

<template>
  <AppLayout>
    <button class="text-sm text-slate-600 hover:text-slate-900 mb-4" @click="router.push('/mikrotik')">
      ← Volver a MikroTik
    </button>

    <div v-if="!device" class="text-slate-500">Router no encontrado.</div>
    <template v-else>
      <div class="flex items-center gap-2 mb-1">
        <h1 class="text-2xl font-semibold">{{ device.name }}</h1>
        <span
          class="badge"
          :class="isPppoeAdmin ? 'bg-sky-500/15 text-sky-700' : 'bg-amber-500/15 text-amber-700'"
        >
          {{ MIKROTIK_DEVICE_ROLE_LABELS[device.device_role] }}
        </span>
      </div>
      <p class="text-slate-600 text-sm mb-6">{{ device.host }}:{{ device.port }}</p>

      <p v-if="loadError" class="mb-4 text-sm text-red-600">{{ loadError }}</p>
      <p v-else-if="loading" class="text-slate-500 text-sm mb-6">Consultando el router...</p>

      <template v-else-if="isPppoeAdmin">
        <div class="grid gap-4 mb-8" style="grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))">
          <div class="surface p-4">
            <div class="text-slate-500 text-xs mb-1">RouterOS</div>
            <div class="text-lg font-semibold">{{ resource?.version ?? '—' }}</div>
          </div>
          <div class="surface p-4">
            <div class="text-slate-500 text-xs mb-1">CPU</div>
            <div class="text-lg font-semibold">{{ resource?.['cpu-load'] ?? '—' }}%</div>
          </div>
          <div class="surface p-4">
            <div class="text-slate-500 text-xs mb-1">Memoria libre</div>
            <div class="text-lg font-semibold">{{ resource?.['free-memory'] ?? '—' }}</div>
          </div>
          <div class="surface p-4">
            <div class="text-slate-500 text-xs mb-1">Uptime</div>
            <div class="text-lg font-semibold">{{ resource?.uptime ?? '—' }}</div>
          </div>
        </div>

        <h2 class="text-lg font-semibold mb-3">Interfaces ({{ interfaces.length }})</h2>
        <div class="table-shell mb-8">
          <table class="w-full text-sm min-w-[560px]">
            <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
              <tr>
                <th class="text-left px-4 py-3">Nombre</th>
                <th class="text-left px-4 py-3">Tipo</th>
                <th class="text-left px-4 py-3">Estado</th>
                <th class="text-left px-4 py-3">Descarga (RX)</th>
                <th class="text-left px-4 py-3">Subida (TX)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!interfaces.length">
                <td colspan="5" class="px-4 py-6 text-center text-slate-500">Sin interfaces.</td>
              </tr>
              <tr v-for="i in interfaces" :key="i['.id']" class="border-t border-slate-200">
                <td class="px-4 py-3 font-medium">{{ i.name }}</td>
                <td class="px-4 py-3 text-slate-600">{{ i.type }}</td>
                <td class="px-4 py-3">
                  <span
                    class="badge"
                    :class="i.running === 'true' ? 'bg-green-500/15 text-green-600' : 'bg-slate-500/15 text-slate-600'"
                  >
                    {{ i.disabled === 'true' ? 'Deshabilitada' : (i.running === 'true' ? 'Conectada' : 'Sin conexion') }}
                  </span>
                </td>
                <td class="px-4 py-3 font-mono text-xs">{{ formatBytes(i['rx-byte']) }}</td>
                <td class="px-4 py-3 font-mono text-xs">{{ formatBytes(i['tx-byte']) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <template v-if="isPppoeAdmin">
        <!-- Fase 173: reconciliación PPPoE — exclusiva de ESTE router administrador -->
        <div class="surface p-4 mb-8">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">Reconciliación PPPoE de este router</h2>
              <p class="text-xs text-slate-500 mt-0.5">
                Compara los usuarios PPPoE de <strong>{{ device.name }}</strong> contra los contratos vinculados a él
                (detecta cambios hechos directo en Winbox/WebFig). El perfil PPPoE se actualiza solo; el resto solo se reporta.
              </p>
            </div>
            <button class="btn-secondary text-xs" :disabled="reconcileLoading" @click="handleReconcileNow">
              {{ reconcileLoading ? 'Reconciliando...' : 'Reconciliar ahora' }}
            </button>
          </div>

          <p v-if="reconcileError" class="text-xs text-red-600 mt-3">{{ reconcileError }}</p>

          <div v-if="reconcileReport" class="mt-3 text-xs text-slate-600">
            <p>
              Última corrida: {{ formatReconcileDate(reconcileReport.ranAt) }} — {{ reconcileReport.contractsChecked }}
              contrato(s) evaluados, {{ reconcileReport.profilesUpdated }} perfil(es) actualizados,
              <button
                v-if="reconcileReport.mismatches.length"
                class="text-amber-600 hover:underline"
                @click="showReconcileDetail = !showReconcileDetail"
              >
                {{ reconcileReport.mismatches.length }} diferencia(s)
              </button>
              <span v-else class="text-green-600">sin diferencias</span>.
              <span v-if="reconcileReport.error" class="text-red-600"> Error de conexión: {{ reconcileReport.error }}</span>
            </p>
            <div v-if="showReconcileDetail && reconcileReport.mismatches.length" class="mt-2 rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-60 overflow-y-auto">
              <div v-for="(m, i) in reconcileReport.mismatches" :key="i" class="px-3 py-2">
                <span class="font-mono text-slate-500">{{ m.contractNumber }}</span> ({{ m.pppoeUsername }}) — {{ m.detail }}
              </div>
            </div>
          </div>
          <p v-else class="mt-3 text-xs text-slate-400">Todavía no corrió ninguna reconciliación en esta sesión del servidor.</p>
        </div>

        <h2 class="text-lg font-semibold mb-3">Usuarios PPPoE ({{ secrets.length }})</h2>
        <input
          v-model="secretSearch"
          placeholder="Buscar por usuario, perfil o comentario..."
          class="field-input mb-3"
        />
        <div class="table-shell mb-8">
          <table class="w-full text-sm min-w-[640px]">
            <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
              <tr>
                <th class="text-left px-4 py-3">Usuario</th>
                <th class="text-left px-4 py-3">Perfil</th>
                <th class="text-left px-4 py-3">Conectado</th>
                <th class="text-left px-4 py-3">Estado</th>
                <th class="text-right px-4 py-3">Accion</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!filteredSecrets.length">
                <td colspan="5" class="px-4 py-6 text-center text-slate-500">
                  {{ secretSearch ? 'Sin resultados para esa busqueda.' : 'Sin usuarios PPPoE.' }}
                </td>
              </tr>
              <tr v-for="s in filteredSecrets" :key="s['.id']" class="border-t border-slate-200">
                <td class="px-4 py-3 font-mono text-xs">{{ s.name }}</td>
                <td class="px-4 py-3 text-slate-600">{{ s.profile }}</td>
                <td class="px-4 py-3">
                  <span
                    class="badge"
                    :class="activeByName.has(s.name) ? 'bg-green-500/15 text-green-600' : 'bg-slate-500/15 text-slate-600'"
                  >
                    {{ activeByName.has(s.name) ? 'Si' : 'No' }}
                  </span>
                </td>
                <td class="px-4 py-3">
                  <span
                    class="badge"
                    :class="s.disabled === 'true' ? 'bg-red-500/15 text-red-600' : 'bg-green-500/15 text-green-600'"
                  >
                    {{ s.disabled === 'true' ? 'Deshabilitado' : 'Habilitado' }}
                  </span>
                </td>
                <td class="px-4 py-3 text-right">
                  <button class="text-sky-700 hover:underline text-xs" @click="handleToggleSecret(s)">
                    {{ s.disabled === 'true' ? 'Habilitar' : 'Deshabilitar' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2 class="text-lg font-semibold mb-3">Leases DHCP ({{ leases.length }})</h2>
        <input
          v-model="leaseSearch"
          placeholder="Buscar por IP, MAC o hostname..."
          class="field-input mb-3"
        />
        <div class="table-shell mb-8">
          <table class="w-full text-sm min-w-[560px]">
            <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
              <tr>
                <th class="text-left px-4 py-3">IP</th>
                <th class="text-left px-4 py-3">MAC</th>
                <th class="text-left px-4 py-3">Hostname</th>
                <th class="text-left px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!filteredLeases.length">
                <td colspan="4" class="px-4 py-6 text-center text-slate-500">
                  {{ leaseSearch ? 'Sin resultados para esa busqueda.' : 'Sin leases DHCP.' }}
                </td>
              </tr>
              <tr v-for="l in filteredLeases" :key="l['.id']" class="border-t border-slate-200">
                <td class="px-4 py-3 font-mono text-xs">{{ l.address }}</td>
                <td class="px-4 py-3 font-mono text-xs text-slate-600">{{ l['mac-address'] }}</td>
                <td class="px-4 py-3 text-slate-600">{{ l['host-name'] || '—' }}</td>
                <td class="px-4 py-3 text-slate-600">{{ l.status }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        </template>

        <h2 class="text-lg font-semibold mb-3">Direcciones IP del router ({{ ipAddresses.length }})</h2>
        <div class="table-shell">
          <table class="w-full text-sm min-w-[480px]">
            <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
              <tr>
                <th class="text-left px-4 py-3">IP / Red</th>
                <th class="text-left px-4 py-3">Interfaz</th>
                <th class="text-left px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!ipAddresses.length">
                <td colspan="3" class="px-4 py-6 text-center text-slate-500">Sin direcciones IP configuradas.</td>
              </tr>
              <tr v-for="ip in ipAddresses" :key="ip['.id']" class="border-t border-slate-200">
                <td class="px-4 py-3 font-mono text-xs">{{ ip.address }}</td>
                <td class="px-4 py-3 text-slate-600">{{ ip.interface }}</td>
                <td class="px-4 py-3">
                  <span class="badge" :class="ip.disabled === 'true' ? 'bg-slate-500/15 text-slate-600' : 'bg-green-500/15 text-green-600'">
                    {{ ip.disabled === 'true' ? 'Deshabilitada' : 'Activa' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="text-xs text-slate-500 mt-3">
          Nota: el cruce automatico ONT ↔ IP (por MAC de WAN) llega cuando se valide el comando de
          "wan-info" contra la OLT real (ver Fase 4). Por ahora, la MAC se puede buscar aqui manualmente.
        </p>
      </template>

      <!-- Fase 174: conexiones WAN descubiertas — EXCLUSIVO del balanceador -->
      <template v-else-if="isBalancer">
        <div v-if="balancerIsStale && activeBalancerConnections.length" class="surface p-4 mb-6 border-l-4 border-amber-500 bg-amber-500/5 text-sm text-amber-700">
          Sin datos recientes del router — la última lectura exitosa fue
          {{ balancerLastDiscoveryAt ? `${formatPeruDateTime(balancerLastDiscoveryAt)} (${formatRelativeTime(balancerLastDiscoveryAt, nowMs)})` : 'hace demasiado' }}.
          El estado de las conexiones se muestra como "desconocido" hasta la próxima lectura exitosa — nunca se asume que están caídas.
        </div>

        <div class="grid gap-4 mb-6" style="grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))">
          <div class="surface p-4">
            <div class="text-slate-500 text-xs mb-1">RouterOS</div>
            <div class="text-lg font-semibold">{{ resource?.version ?? '—' }}</div>
          </div>
          <div class="surface p-4">
            <div class="text-slate-500 text-xs mb-1">CPU</div>
            <div class="text-lg font-semibold">{{ resource?.['cpu-load'] ?? '—' }}%</div>
          </div>
          <div class="surface p-4">
            <div class="text-slate-500 text-xs mb-1">RAM usada</div>
            <div class="text-lg font-semibold">{{ balancerMemory.usedLabel }} <span class="text-xs text-slate-500">de {{ balancerMemory.totalLabel }}</span></div>
            <div class="text-[11px] text-slate-500">{{ balancerMemory.usedPercent != null ? `${balancerMemory.usedPercent}% usado — ${balancerMemory.freeLabel} libre` : '—' }}</div>
          </div>
          <div class="surface p-4">
            <div class="text-slate-500 text-xs mb-1">Uptime</div>
            <div class="text-lg font-semibold">{{ balancerUptimeLabel }}</div>
          </div>
          <div class="surface p-4">
            <div class="text-slate-500 text-xs mb-1">Puertos SFP en uso</div>
            <div class="text-lg font-semibold">{{ balancerPortsInUse }}</div>
          </div>
          <div class="surface p-4">
            <div class="text-slate-500 text-xs mb-1">Conexiones WAN</div>
            <div class="text-sm font-semibold text-green-600">{{ balancerWanCounts.up }} conectada(s)</div>
            <div class="text-sm font-semibold text-red-600">{{ balancerWanCounts.down }} sin conexión</div>
            <div class="text-[11px] text-slate-500">{{ balancerWanCounts.disabled }} deshabilitada(s) · {{ balancerWanCounts.unknown }} desconocida(s)</div>
          </div>
          <div class="surface p-4">
            <div class="text-slate-500 text-xs mb-1">Consumo total (conexiones activas)</div>
            <div class="text-sm font-semibold">↓{{ formatBpsAsMbps(balancerTotalRxBps) }}</div>
            <div class="text-sm font-semibold">↑{{ formatBpsAsMbps(balancerTotalTxBps) }}</div>
          </div>
        </div>
        <p class="text-xs text-slate-500 mb-4">
          Descubierto automáticamente desde el router (interfaces físicas SFP, MACVLAN y sesiones PPPoE-WAN) —
          nunca se fija una cantidad de puertos ni de conexiones. El consumo total usa una sola fuente de tráfico
          por conexión (la sesión PPPoE) — nunca se suma junto con su puerto físico ni su MACVLAN.
        </p>

        <p v-if="balancerLoadError" class="mb-4 text-sm text-red-600">{{ balancerLoadError }}</p>

        <!-- Fase 174b: alertas de caida/recuperacion de enlaces WAN -- encima del grafico principal, inmediatamente debajo de los indicadores -->
        <div v-if="balancerLinkAlertsAvailable" class="mb-8">
          <h3 class="text-sm font-semibold mb-3">Alertas de enlaces</h3>
          <div v-if="!balancerActiveLinkAlerts.length" class="surface p-4 rounded-2xl text-sm text-slate-500">
            Sin alertas activas — todos los enlaces WAN con datos recientes están como se espera.
          </div>
          <ul v-else class="space-y-2 mb-3">
            <li v-for="a in balancerActiveLinkAlerts" :key="a.id" class="surface p-4 rounded-2xl border-l-4 border-red-500 bg-red-500/5">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span class="badge" :class="wanLinkAlertBadgeClass(a.status)">{{ wanLinkAlertLabel(a.link_kind, a.status) }}</span>
                  <span class="ml-2 font-mono text-sm">{{ a.link_name }}</span>
                  <span v-if="a.link_kind === 'pppoe_connection' && a.physical_interface_name" class="ml-1 text-xs text-slate-500">({{ a.physical_interface_name }})</span>
                </div>
                <div class="text-xs text-slate-500 text-right">
                  Desde {{ formatPeruDateTime(a.started_at) }} ({{ formatRelativeTime(a.started_at, nowMs) }}) —
                  lleva {{ formatWanLinkAlertDuration(a.started_at, null, nowMs) }}
                </div>
              </div>
            </li>
          </ul>

          <button class="text-xs text-sky-600 hover:underline" @click="showLinkAlertHistory = !showLinkAlertHistory">
            {{ showLinkAlertHistory ? 'Ocultar' : 'Ver' }} historial de alertas ({{ balancerLinkAlertHistory.length }})
          </button>
          <div v-if="showLinkAlertHistory" class="table-shell mt-3">
            <table class="w-full text-sm min-w-[640px]">
              <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
                <tr>
                  <th class="text-left px-4 py-3">Enlace</th>
                  <th class="text-left px-4 py-3">Puerto</th>
                  <th class="text-left px-4 py-3">Evento</th>
                  <th class="text-left px-4 py-3">Detectado</th>
                  <th class="text-left px-4 py-3">Recuperado</th>
                  <th class="text-left px-4 py-3">Duración</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!balancerLinkAlertHistory.length">
                  <td colspan="6" class="px-4 py-6 text-center text-slate-500">Todavía sin historial de alertas resueltas.</td>
                </tr>
                <tr v-for="a in balancerLinkAlertHistory" :key="a.id" class="border-t border-slate-200">
                  <td class="px-4 py-3 font-mono text-xs">{{ a.link_name }}</td>
                  <td class="px-4 py-3 font-mono text-xs text-slate-600">{{ a.physical_interface_name ?? '—' }}</td>
                  <td class="px-4 py-3">{{ wanLinkAlertLabel(a.link_kind, 'resolved') }}</td>
                  <td class="px-4 py-3 text-slate-600">{{ formatPeruDateTime(a.started_at) }}</td>
                  <td class="px-4 py-3 text-slate-600">{{ a.resolved_at ? formatPeruDateTime(a.resolved_at) : '—' }}</td>
                  <td class="px-4 py-3 text-slate-600">{{ formatWanLinkAlertDuration(a.started_at, a.resolved_at, nowMs) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Gráfico principal: suma de las conexiones activas segun el alcance elegido (total / un puerto / una sesión) -->
        <div class="surface p-4 rounded-2xl mb-8">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-1">
            <h3 class="text-sm font-semibold">Tráfico — {{ balancerScopeLabel }}</h3>
            <div class="flex gap-1">
              <button
                v-for="r in (['15m', '1h', '24h', '7d'] as const)"
                :key="r"
                class="text-xs px-2.5 py-1 rounded-full"
                :class="balancerHistoryRange === r ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
                @click="balancerHistoryRange = r"
              >
                {{ HISTORY_RANGE_LABEL[r] }}
              </button>
            </div>
          </div>
          <button v-if="balancerScope.type !== 'total'" class="text-xs text-sky-600 hover:underline mb-3" @click="selectBalancerTotalScope">
            ← Volver al total de todas las conexiones activas
          </button>
          <p v-if="balancerHistoryLoading && !balancerHistoryPoints.length" class="text-sm text-slate-500">Cargando historial...</p>
          <p v-else-if="balancerHistoryError" class="text-sm text-red-600">{{ balancerHistoryError }}</p>
          <p v-else-if="!balancerHistoryPoints.length" class="text-sm text-slate-500">
            Recopilando historial — todavía no hay muestras suficientes para este alcance y rango.
          </p>
          <VueApexCharts v-else type="area" height="280" :options="balancerChartOptions" :series="balancerChartSeries" />
        </div>

        <!-- Estadisticas por puerto SFP: agrupado dinamicamente, sin cantidad fija de puertos -->
        <h3 class="text-sm font-semibold mb-3">Consumo por puerto SFP</h3>
        <div class="grid gap-4 mb-8" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))">
          <p v-if="!balancerPortStats.length" class="text-sm text-slate-500">Todavía sin puertos con conexiones activas detectadas.</p>
          <div
            v-for="p in balancerPortStats"
            :key="p.port"
            class="surface p-4 rounded-2xl cursor-pointer transition-colors"
            :class="balancerScope.type === 'port' && balancerScope.port === p.port ? 'ring-2 ring-sky-500' : ''"
            @click="selectBalancerPortScope(p.port)"
          >
            <div class="text-slate-500 text-xs mb-1 font-mono">{{ p.port }}</div>
            <div class="text-sm font-semibold">↓{{ formatBpsAsMbps(p.rxBps) }}</div>
            <div class="text-sm font-semibold">↑{{ formatBpsAsMbps(p.txBps) }}</div>
            <div class="text-[11px] text-slate-500 mt-1">
              {{ p.connections.length }} conexión(es) — {{ p.upCount }} activa(s), {{ p.disabledCount }} deshabilitada(s)
            </div>
          </div>
        </div>

        <!-- Selector de sesion PPPoE-WAN individual -->
        <div class="surface p-4 rounded-2xl mb-8">
          <label class="text-sm font-semibold block mb-2">Ver el gráfico de una sesión PPPoE-WAN específica</label>
          <select
            v-model="selectedConnectionIdForChart"
            class="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full max-w-md"
            @change="selectBalancerConnectionScope(selectedConnectionIdForChart)"
          >
            <option value="">Seleccionar sesión...</option>
            <option v-for="c in activeBalancerConnections" :key="c.id" :value="c.id">
              {{ c.pppoe_interface_name }}{{ c.physical_interface_name ? ` — ${c.physical_interface_name}` : '' }}
            </option>
          </select>
        </div>

        <p v-if="balancerLoadError" class="mb-4 text-sm text-red-600">{{ balancerLoadError }}</p>

        <h2 class="text-lg font-semibold mb-3">Conexiones WAN activas ({{ filteredBalancerConnections.length }} de {{ activeBalancerConnections.length }})</h2>
        <div class="flex flex-wrap items-center gap-3 mb-3">
          <select v-model="tableFilterPort" class="border border-slate-300 rounded-lg px-3 py-1.5 text-sm">
            <option value="">Todos los puertos</option>
            <option v-for="p in balancerPortStats" :key="p.port" :value="p.port">{{ p.port }}</option>
          </select>
          <select v-model="tableFilterStatus" class="border border-slate-300 rounded-lg px-3 py-1.5 text-sm">
            <option value="">Todos los estados</option>
            <option value="up">Activa</option>
            <option value="down">Caída</option>
            <option value="disabled">Deshabilitada</option>
            <option value="unknown">Estado desconocido</option>
          </select>
        </div>
        <div class="table-shell mb-8">
          <table class="w-full text-sm min-w-[720px]">
            <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
              <tr>
                <th class="text-left px-4 py-3">Puerto físico</th>
                <th class="text-left px-4 py-3">MACVLAN</th>
                <th class="text-left px-4 py-3">Sesión PPPoE</th>
                <th class="text-left px-4 py-3">Usuario</th>
                <th class="text-left px-4 py-3">Estado</th>
                <th class="text-left px-4 py-3">Descarga</th>
                <th class="text-left px-4 py-3">Subida</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!filteredBalancerConnections.length">
                <td colspan="7" class="px-4 py-6 text-center text-slate-500">
                  {{ balancerLoadError ? 'No se pudo consultar.' : activeBalancerConnections.length ? 'Ninguna conexión coincide con el filtro.' : 'Todavía sin datos — esperando el primer descubrimiento automático.' }}
                </td>
              </tr>
              <tr v-for="c in filteredBalancerConnections" :key="c.id" class="border-t border-slate-200">
                <td class="px-4 py-3 font-mono text-xs">{{ c.physical_interface_name ?? 'Pendiente de vincular' }}</td>
                <td class="px-4 py-3 font-mono text-xs text-slate-600">{{ c.macvlan_interface_name ?? '—' }}</td>
                <td class="px-4 py-3 font-mono text-xs">{{ c.pppoe_interface_name }}</td>
                <td class="px-4 py-3 text-slate-600">{{ c.pppoe_user ?? '—' }}</td>
                <td class="px-4 py-3">
                  <span class="badge" :class="connectionStatusClass(c)">{{ connectionStatusLabel(c) }}</span>
                </td>
                <td class="px-4 py-3 font-mono text-xs">{{ c.disabled ? '—' : formatBpsAsMbps(c.latest_rx_bps) }}</td>
                <td class="px-4 py-3 font-mono text-xs">{{ c.disabled ? '—' : formatBpsAsMbps(c.latest_tx_bps) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Requisito 7: el historico de conexiones retiradas/renombradas se conserva, nunca se borra. -->
        <details v-if="removedBalancerConnections.length" class="surface rounded-2xl">
          <summary class="cursor-pointer select-none p-4 text-sm font-semibold">
            Conexiones retiradas ({{ removedBalancerConnections.length }}) — conservadas solo como historial
          </summary>
          <div class="table-shell p-4 pt-0">
            <table class="w-full text-sm min-w-[560px]">
              <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
                <tr>
                  <th class="text-left px-4 py-3">Sesión PPPoE</th>
                  <th class="text-left px-4 py-3">Puerto físico</th>
                  <th class="text-left px-4 py-3">Visto por última vez</th>
                  <th class="text-left px-4 py-3">Retirada</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in removedBalancerConnections" :key="c.id" class="border-t border-slate-200">
                  <td class="px-4 py-3 font-mono text-xs">{{ c.pppoe_interface_name }}</td>
                  <td class="px-4 py-3 font-mono text-xs text-slate-600">{{ c.physical_interface_name ?? '—' }}</td>
                  <td class="px-4 py-3 text-slate-600">{{ formatPeruDateTime(c.last_seen_at) }}</td>
                  <td class="px-4 py-3 text-slate-600">{{ formatPeruDateTime(c.removed_at!) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </template>

      <!-- Fase 172: panel de trafico/saturación — EXCLUSIVO del borde dedicado -->
      <template v-else>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mb-6 text-sm">
          <span class="badge" :class="linkStatusClass">{{ linkStatusLabel }}</span>
          <span class="text-slate-500">RouterOS {{ live?.version ?? resource?.version ?? '—' }}</span>
          <span class="text-slate-500">Última lectura exitosa: {{ lastReadLabel }}</span>
        </div>

        <!-- Alertas de saturación -->
        <div v-if="activeAlerts.length" class="surface p-4 mb-6 border-l-4 border-red-500 bg-red-500/5">
          <h3 class="text-sm font-semibold text-red-700 mb-2">⚠ Enlace saturado</h3>
          <ul class="space-y-1 text-sm text-red-700">
            <li v-for="a in activeAlerts" :key="a.id">
              {{ DIRECTION_LABEL[a.direction] }} sobre el 85% desde {{ formatPeruDateTime(a.started_at) }} ({{ formatRelativeTime(a.started_at, nowMs) }}) —
              pico {{ formatBpsAsMbps(a.peak_bps) }} de un límite de {{ formatBpsAsMbps(a.threshold_bps) }}.
            </li>
          </ul>
        </div>
        <div v-else-if="recentlyResolvedAlerts.length" class="surface p-4 mb-6 border-l-4 border-emerald-500 bg-emerald-500/5 text-sm text-emerald-700">
          Recuperado — {{ DIRECTION_LABEL[recentlyResolvedAlerts[0].direction] }} volvió a estar por debajo del 85% el
          {{ formatPeruDateTime(recentlyResolvedAlerts[0].resolved_at!) }}.
        </div>

        <!-- Indicadores principales -->
        <div class="grid gap-4 mb-6" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))">
          <div class="surface p-4 rounded-2xl">
            <div class="text-slate-500 text-xs mb-1">↓ Descarga actual</div>
            <div class="text-2xl font-semibold" :class="usageTextClass(downloadPct)">{{ formatBpsAsMbps(live?.rxBps) }}</div>
            <div class="w-full bg-slate-100 rounded-full h-1.5 mt-2 mb-1">
              <div class="h-1.5 rounded-full transition-all" :class="usageBarClass(downloadPct)" :style="{ width: `${Math.min(100, downloadPct)}%` }"></div>
            </div>
            <div class="text-[11px] text-slate-500">{{ downloadPct }}% de {{ device.capacity_download_mbps }} Mbps contratados</div>
          </div>
          <div class="surface p-4 rounded-2xl">
            <div class="text-slate-500 text-xs mb-1">↑ Subida actual</div>
            <div class="text-2xl font-semibold" :class="usageTextClass(uploadPct)">{{ formatBpsAsMbps(live?.txBps) }}</div>
            <div class="w-full bg-slate-100 rounded-full h-1.5 mt-2 mb-1">
              <div class="h-1.5 rounded-full transition-all" :class="usageBarClass(uploadPct)" :style="{ width: `${Math.min(100, uploadPct)}%` }"></div>
            </div>
            <div class="text-[11px] text-slate-500">{{ uploadPct }}% de {{ device.capacity_upload_mbps }} Mbps contratados</div>
          </div>
          <div class="surface p-4 rounded-2xl">
            <div class="text-slate-500 text-xs mb-1">Pico — {{ HISTORY_RANGE_LABEL[historyRange] }}</div>
            <div class="text-lg font-semibold">↓{{ formatBpsAsMbps(peakDownloadBps) }}</div>
            <div class="text-lg font-semibold">↑{{ formatBpsAsMbps(peakUploadBps) }}</div>
          </div>
          <div class="surface p-4 rounded-2xl">
            <div class="text-slate-500 text-xs mb-1">CPU / Memoria / Uptime</div>
            <div class="text-lg font-semibold">{{ live?.cpuLoadPercent ?? resource?.['cpu-load'] ?? '—' }}%</div>
            <div class="text-[11px] text-slate-500">{{ live?.uptime ?? resource?.uptime ?? '—' }}</div>
          </div>
        </div>

        <!-- Gráfico principal -->
        <div class="surface p-4 rounded-2xl mb-8">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 class="text-sm font-semibold">Tráfico de "{{ device.monitored_interface_name ?? 'interfaz sin configurar' }}" (entrada del proveedor)</h3>
            <div class="flex gap-1">
              <button
                v-for="r in (['15m', '1h', '24h', '7d'] as const)"
                :key="r"
                class="text-xs px-2.5 py-1 rounded-full"
                :class="historyRange === r ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
                @click="historyRange = r"
              >
                {{ HISTORY_RANGE_LABEL[r] }}
              </button>
            </div>
          </div>
          <p v-if="!device.monitored_interface_name" class="text-sm text-slate-500">
            Todavía no se eligió qué interfaz monitorear — configúralo abajo para empezar a ver datos.
          </p>
          <p v-else-if="historyLoading && !historyPoints.length" class="text-sm text-slate-500">Cargando historial...</p>
          <p v-else-if="!historyPoints.length" class="text-sm text-slate-500">
            Sin datos todavía para este rango — el monitoreo recién empieza a acumular historial desde ahora.
          </p>
          <VueApexCharts v-else type="area" height="280" :options="chartOptions" :series="chartSeries" />
        </div>

        <!-- Configuración (ADMIN/SUPERADMIN) -->
        <div class="surface p-4 rounded-2xl mb-8">
          <h3 class="text-sm font-semibold mb-3">Configuración de monitoreo</h3>
          <p class="text-xs text-slate-500 mb-4">
            Solo para estadísticas y alertas de este panel — nunca cambia la configuración real del router (VLANs, rutas, velocidades ni queues).
          </p>
          <template v-if="canConfigureBorder">
            <div class="grid gap-3 mb-4" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))">
              <div>
                <label class="block text-xs text-slate-600 mb-1">Interfaz de entrada (proveedor)</label>
                <select v-model="configForm.monitored_interface_name" class="field-input">
                  <option value="">Sin elegir</option>
                  <option v-for="i in interfaces" :key="i['.id']" :value="i.name">{{ i.name }}</option>
                </select>
              </div>
              <div>
                <label class="block text-xs text-slate-600 mb-1">Interfaz de salida (hacia administrador) — solo etiqueta</label>
                <select v-model="configForm.uplink_interface_name" class="field-input">
                  <option value="">Sin elegir</option>
                  <option v-for="i in interfaces" :key="i['.id']" :value="i.name">{{ i.name }}</option>
                </select>
              </div>
              <div>
                <label class="block text-xs text-slate-600 mb-1">Capacidad de descarga contratada</label>
                <div class="flex gap-2">
                  <input v-model.number="configForm.download_value" type="number" min="1" step="1" class="field-input" />
                  <select v-model="configForm.download_unit" class="field-input w-28">
                    <option value="Mbps">Mbps</option>
                    <option value="Gbps">Gbps</option>
                  </select>
                </div>
              </div>
              <div>
                <label class="block text-xs text-slate-600 mb-1">Capacidad de subida contratada</label>
                <div class="flex gap-2">
                  <input v-model.number="configForm.upload_value" type="number" min="1" step="1" class="field-input" />
                  <select v-model="configForm.upload_unit" class="field-input w-28">
                    <option value="Mbps">Mbps</option>
                    <option value="Gbps">Gbps</option>
                  </select>
                </div>
              </div>
            </div>
            <p v-if="configError" class="text-sm text-red-600 mb-3">{{ configError }}</p>
            <p v-if="configSaved" class="text-sm text-emerald-600 mb-3">Configuración guardada.</p>
            <button class="btn-primary text-sm" :disabled="configSaving" @click="handleSaveBorderConfig">
              {{ configSaving ? 'Guardando...' : 'Guardar configuración' }}
            </button>
          </template>
          <p v-else class="text-sm text-slate-500">
            Capacidad contratada: ↓{{ device.capacity_download_mbps }} Mbps / ↑{{ device.capacity_upload_mbps }} Mbps.
            Solo un administrador puede modificar esta configuración.
          </p>
        </div>

        <!-- Información técnica (colapsable) -->
        <details class="surface rounded-2xl" :open="showTechInfo" @toggle="showTechInfo = ($event.target as HTMLDetailsElement).open">
          <summary class="cursor-pointer select-none p-4 text-sm font-semibold">Información técnica</summary>
          <div class="p-4 pt-0">
            <h4 class="text-sm font-semibold mb-3">Interfaces ({{ interfaces.length }})</h4>
            <div class="table-shell mb-6">
              <table class="w-full text-sm min-w-[620px]">
                <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
                  <tr>
                    <th class="text-left px-4 py-3">Nombre</th>
                    <th class="text-left px-4 py-3">Rol</th>
                    <th class="text-left px-4 py-3">Estado</th>
                    <th class="text-left px-4 py-3">Descarga (RX)</th>
                    <th class="text-left px-4 py-3">Subida (TX)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="!interfaces.length">
                    <td colspan="5" class="px-4 py-6 text-center text-slate-500">Sin interfaces.</td>
                  </tr>
                  <tr v-for="i in interfaces" :key="i['.id']" class="border-t border-slate-200">
                    <td class="px-4 py-3 font-medium">{{ i.name }}</td>
                    <td class="px-4 py-3">
                      <span v-if="i.name === device.monitored_interface_name" class="badge bg-sky-500/15 text-sky-700">Entrada del proveedor</span>
                      <span v-else-if="i.name === device.uplink_interface_name" class="badge bg-violet-500/15 text-violet-700">Salida hacia administrador</span>
                      <span v-else class="text-slate-400">—</span>
                    </td>
                    <td class="px-4 py-3">
                      <span class="badge" :class="i.running === 'true' ? 'bg-green-500/15 text-green-600' : 'bg-slate-500/15 text-slate-600'">
                        {{ i.disabled === 'true' ? 'Deshabilitada' : (i.running === 'true' ? 'Conectada' : 'Sin conexion') }}
                      </span>
                    </td>
                    <td class="px-4 py-3 font-mono text-xs">{{ formatBytes(i['rx-byte']) }}</td>
                    <td class="px-4 py-3 font-mono text-xs">{{ formatBytes(i['tx-byte']) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h4 class="text-sm font-semibold mb-3">Direcciones IP del router ({{ ipAddresses.length }})</h4>
            <div class="table-shell">
              <table class="w-full text-sm min-w-[480px]">
                <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
                  <tr>
                    <th class="text-left px-4 py-3">IP / Red</th>
                    <th class="text-left px-4 py-3">Interfaz</th>
                    <th class="text-left px-4 py-3">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="!ipAddresses.length">
                    <td colspan="3" class="px-4 py-6 text-center text-slate-500">Sin direcciones IP configuradas.</td>
                  </tr>
                  <tr v-for="ip in ipAddresses" :key="ip['.id']" class="border-t border-slate-200">
                    <td class="px-4 py-3 font-mono text-xs">{{ ip.address }}</td>
                    <td class="px-4 py-3 text-slate-600">{{ ip.interface }}</td>
                    <td class="px-4 py-3">
                      <span class="badge" :class="ip.disabled === 'true' ? 'bg-slate-500/15 text-slate-600' : 'bg-green-500/15 text-green-600'">
                        {{ ip.disabled === 'true' ? 'Deshabilitada' : 'Activa' }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </details>

        <p class="text-xs text-slate-500 mt-4">
          El servicio REST de este router usa HTTP sin cifrar (puerto 80) — recomendado restringir su acceso solo al
          servidor del panel y planificar HTTPS como mejora independiente (ver sección de seguridad, Fase 172).
        </p>
      </template>
    </template>
  </AppLayout>
</template>
