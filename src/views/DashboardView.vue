<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import PppoeProfileCards from '@/components/dashboard/PppoeProfileCards.vue';
import DashboardIcon from '@/components/dashboard/DashboardIcon.vue';
import { useDashboardStore } from '@/stores/dashboard';
import { useOltStore } from '@/stores/olt';

const router = useRouter();
const dashboard = useDashboardStore();
const oltStore = useOltStore();

const REFRESH_SECONDS = 60;
const secondsLeft = ref(REFRESH_SECONDS);
const secondsSinceUpdate = ref(0);
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let tickTimer: ReturnType<typeof setInterval> | undefined;

async function refresh() {
  try {
    await dashboard.fetchSummary();
  } catch {
    // el error ya queda visible via dashboard.error
  }
  secondsLeft.value = REFRESH_SECONDS;
  secondsSinceUpdate.value = 0;
}

onMounted(async () => {
  mounted = true;
  viewport = window.matchMedia('(max-width: 700px)');
  updateViewport();
  viewport.addEventListener('change', updateViewport);
  await refresh();
  if (!mounted) return;
  refreshTimer = setInterval(refresh, REFRESH_SECONDS * 1000);
  tickTimer = setInterval(() => {
    secondsLeft.value = Math.max(0, secondsLeft.value - 1);
    secondsSinceUpdate.value += 1;
  }, 1000);
});

onUnmounted(() => {
  mounted = false;
  viewport?.removeEventListener('change', updateViewport);
  if (refreshTimer) clearInterval(refreshTimer);
  if (tickTimer) clearInterval(tickTimer);
});

const updatedLabel = computed(() => {
  const s = secondsSinceUpdate.value;
  if (s < 5) return 'justo ahora';
  if (s < 60) return `hace ${s}s`;
  return `hace ${Math.floor(s / 60)} min`;
});

function goTo(path: string) {
  router.push(path);
}

/**
 * Las listas reales ("sin autorizar", online/offline, señales bajas) viven
 * en el detalle de cada OLT (/olt/:id), no en /olt (que solo lista las OLTs
 * registradas) — si hay una sola OLT activa (caso normal), saltamos directo
 * a su detalle (con el filtro correspondiente ya aplicado) en vez de dejar
 * al usuario un paso antes de ver el listado.
 */
async function goToOlt(filter?: 'online' | 'offline' | 'lowSignal') {
  if (!oltStore.devices.length) {
    try {
      await oltStore.fetchDevices();
    } catch {
      // si falla, cae al listado /olt de todas formas
    }
  }
  if (oltStore.devices.length === 1) {
    router.push({ path: `/olt/${oltStore.devices[0].id}`, query: filter ? { filter } : undefined });
  } else {
    router.push('/olt');
  }
}
const goToUnconfigured = () => goToOlt();

const oltCheckedAtLabel = computed(() => {
  const iso = dashboard.summary?.oltSummary.checkedAt;
  if (!iso || !Number.isFinite(Date.parse(iso))) return '';
  return new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
});

const recaudoBarClass = computed(() => {
  const rate = dashboard.summary?.billing.collectionRate ?? 0;
  if (rate >= 80) return 'rate-good';
  if (rate >= 50) return 'rate-warning';
  return 'rate-low';
});

const CHART_WIDTH = 600;
const CHART_HEIGHT = 180;
const CHART_PAD = { top: 10, bottom: 24 };

const chartBars = computed(() => {
  const monthly = dashboard.summary?.billing.monthly ?? [];
  const max = Math.max(1, ...monthly.flatMap((m) => [m.billed, m.collected])) * 1.15;
  const plotHeight = CHART_HEIGHT - CHART_PAD.top - CHART_PAD.bottom;
  const groupWidth = CHART_WIDTH / (monthly.length || 1);
  const barWidth = Math.min(22, groupWidth / 2 - 6);
  return monthly.map((m) => {
    const groupX = monthly.indexOf(m) * groupWidth;
    const billedH = (m.billed / max) * plotHeight;
    const collectedH = (m.collected / max) * plotHeight;
    return {
      label: m.month,
      billed: m.billed,
      collected: m.collected,
      billedX: groupX + groupWidth / 2 - barWidth - 2,
      collectedX: groupX + groupWidth / 2 + 2,
      barWidth,
      billedY: CHART_PAD.top + (plotHeight - billedH),
      billedH,
      collectedY: CHART_PAD.top + (plotHeight - collectedH),
      collectedH,
      labelX: groupX + groupWidth / 2,
    };
  });
});

const hasChartData = computed(() => chartBars.value.some((b) => b.billed > 0 || b.collected > 0));

// Solo presentacion; las consultas, importes y frecuencias siguen en sus stores.
const isMobile = ref(false);
const chartExpanded = ref(false);
const allTickets = ref(false);
let viewport: MediaQueryList | undefined;
let mounted = false;
function updateViewport() { isMobile.value = viewport?.matches ?? false; }
const visibleClients = computed(() => isMobile.value ? dashboard.summary?.recentClients.slice(0, 3) ?? [] : dashboard.summary?.recentClients ?? []);
const visibleTickets = computed(() => allTickets.value ? dashboard.summary?.tickets.recent ?? [] : dashboard.summary?.tickets.recent.slice(0, 3) ?? []);
const dateLabel = computed(() => new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', year: 'numeric' }).format(dashboard.lastUpdated ?? new Date()));
const lastSuccessLabel = computed(() => dashboard.lastUpdated ? new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(dashboard.lastUpdated) + ' Perú' : 'Sin actualización exitosa');
const networkLabel = computed(() => {
  if (dashboard.error) return 'Estado sin actualizar';
  const network = dashboard.summary?.network;
  if (!network) return dashboard.loading ? 'Consultando estado' : 'Estado no disponible';
  const total = network.olt.total + network.mikrotik.total;
  const down = network.olt.down + network.mikrotik.down;
  const untested = network.olt.untested + network.mikrotik.untested;
  if (!total) return 'Sin equipos registrados';
  if (untested === total) return 'Sin pruebas registradas';
  if (down || untested) return down + ' caído(s) · ' + untested + ' sin probar';
  return 'Pruebas sin fallos';
});
const networkWarning = computed(() => !!dashboard.error || !!dashboard.summary && (dashboard.summary.network.olt.down + dashboard.summary.network.mikrotik.down + dashboard.summary.network.olt.untested + dashboard.summary.network.mikrotik.untested > 0));
const money = (value: number) => Number(value.toFixed(2)).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = (value: number) => value.toLocaleString('es-PE');
const clientStatus: Record<string, string> = { active: 'Activo', suspended: 'Suspendido', prospect: 'Prospecto', retired: 'Retirado' };
const ticketStatus: Record<string, string> = { open: 'Abierto', in_progress: 'En progreso', resolved: 'Resuelto', closed: 'Cerrado', rescheduled: 'Reprogramado' };
</script>

<template>
  <AppLayout>
    <div class="dashboard-v2" data-testid="dashboard-v2">
      <h1 class="sr-only">Dashboard SmartRayco</h1>
      <header class="dv-overview">
        <span class="dv-date">{{ dateLabel }}</span>
        <span class="dv-updated" :title="lastSuccessLabel" data-testid="summary-updated">{{ dashboard.error ? 'Sin actualizar' : dashboard.lastUpdated ? 'Actualizado ' + updatedLabel : dashboard.loading ? 'Consultando' : 'Sin datos' }}</span>
        <span class="dv-network" :class="{ 'is-warning': networkWarning }" title="Última prueba registrada; no es monitoreo en vivo"><DashboardIcon name="network" /><span>Última prueba: {{ networkLabel }}</span></span>
        <div class="dv-actions">
          <button class="dv-icon-button" :disabled="dashboard.loading" @click="refresh" aria-label="Actualizar Dashboard" :title="'Actualizar · próximo refresco en ' + secondsLeft + 's'"><DashboardIcon name="refresh" /></button>
          <details class="dv-shortcuts"><summary><DashboardIcon name="plus" />Accesos rápidos</summary><nav aria-label="Accesos rápidos"><button @click="goTo('/clientes')">Nuevo cliente</button><button @click="goTo('/olt')">Gestión OLT</button><button @click="goTo('/mikrotik')">MikroTik</button><button @click="goTo('/soporte')">Ver tickets</button><button @click="goTo('/facturacion')">Facturación</button></nav></details>
        </div>
      </header>
      <p v-if="dashboard.error" class="dv-error" role="alert" data-testid="summary-error">{{ dashboard.error }}<span v-if="dashboard.summary">Datos desactualizados · última actualización exitosa: {{ lastSuccessLabel }}</span></p>
      <p v-if="!dashboard.summary && dashboard.loading" class="dv-empty" role="status">Cargando panel...</p>
      <p v-else-if="!dashboard.summary && !dashboard.error" class="dv-empty" role="status">Sin información del panel.</p>
      <div class="dv-operations">
        <section class="dv-panel dv-access" aria-label="Acceso de clientes">
          <PppoeProfileCards />
          <div v-if="dashboard.summary" class="dv-optical" data-testid="ont-summary">
            <div class="dv-section-heading"><h2>ONT</h2><button class="dv-link" @click="goTo('/olt')">OLTs<DashboardIcon name="arrow" /></button></div>
            <p v-if="!oltCheckedAtLabel" class="dv-empty">{{ dashboard.summary.oltSummary.deviceCount ? 'Sin lectura de ONT disponible. OLT(s) activas: ' + dashboard.summary.oltSummary.deviceCount : 'No hay OLTs activas.' }}</p>
            <div v-else>
              <div class="dv-ont-values"><button class="dv-online" @click="goToOlt('online')"><i></i><strong>{{ number(dashboard.summary.oltSummary.online) }}</strong><span>en línea</span></button><button class="dv-offline" @click="goToOlt('offline')"><strong>{{ number(dashboard.summary.oltSummary.offline) }}</strong>desconectadas<DashboardIcon name="chevron" /></button></div>
              <div class="dv-ont-track" aria-hidden="true"><span :style="{ width: (dashboard.summary.oltSummary.online + dashboard.summary.oltSummary.offline ? dashboard.summary.oltSummary.online / (dashboard.summary.oltSummary.online + dashboard.summary.oltSummary.offline) * 100 : 0) + '%' }"></span></div>
              <div class="dv-optical-footer"><span>{{ number(dashboard.summary.oltSummary.online + dashboard.summary.oltSummary.offline) }} autorizadas · {{ dashboard.summary.oltSummary.deviceCount }} OLT(s)</span><div><button class="dv-mini warning" @click="goToOlt('lowSignal')">{{ dashboard.summary.oltSummary.lowSignal }} señal baja</button><button class="dv-mini" @click="goToUnconfigured">{{ dashboard.summary.oltSummary.unconfigured }} sin autorizar</button></div></div>
            </div>
            <p class="dv-reading">{{ oltCheckedAtLabel ? 'Lectura ' + oltCheckedAtLabel + ' Perú' : 'Sin lectura exitosa' }}<span v-if="!dashboard.summary.oltSummary.scanComplete" class="warning"> · Escaneo parcial</span><span v-else> · Escaneo completo</span></p>
          </div>
        </section>
        <section v-if="dashboard.summary" class="dv-panel dv-support" aria-labelledby="support-heading">
          <div class="dv-section-heading"><h2 id="support-heading">Soporte</h2><button class="dv-icon-button" @click="goTo('/soporte')" aria-label="Ver soporte"><DashboardIcon name="arrow" /></button></div>
          <div class="dv-support-counts"><button @click="goTo('/soporte')" aria-label="Tickets abiertos"><strong>{{ dashboard.summary.tickets.open }}</strong><span>abiertos</span></button><button @click="goTo('/soporte')"><strong>{{ dashboard.summary.tickets.inProgress }}</strong><span>en progreso</span></button><button class="dv-urgent" @click="goTo('/soporte')"><strong>{{ dashboard.summary.tickets.urgent }}</strong><span>urgentes</span></button></div>
          <h3 class="dv-list-heading">Tickets recientes</h3><p v-if="!dashboard.summary.tickets.recent.length" class="dv-empty">Sin tickets todavía.</p>
          <ul v-else class="dv-ticket-list"><li v-for="t in visibleTickets" :key="t.id"><button @click="goTo('/soporte/' + t.id)" :title="t.title + ' — ' + (t.clients ? t.clients.first_name + ' ' + t.clients.last_name : '—')"><span class="dv-ticket-copy"><span>{{ t.title }}</span><small>{{ t.clients ? t.clients.first_name + ' ' + t.clients.last_name : '—' }}</small></span><span class="dv-status" :class="{ working: t.status === 'in_progress' }">{{ ticketStatus[t.status] ?? t.status }}</span></button></li></ul>
          <button v-if="dashboard.summary.tickets.recent.length > 3" class="dv-more" @click="allTickets = !allTickets">{{ allTickets ? 'Ver menos' : 'Ver ' + dashboard.summary.tickets.recent.length + ' recientes' }}<DashboardIcon name="arrow" /></button>
        </section>
      </div>
      <template v-if="dashboard.summary">
        <section class="dv-portfolio" aria-label="Clientes y contratos"><h2>Clientes y contratos</h2><button @click="goTo('/clientes')"><strong>{{ number(dashboard.summary.clients.active) }}</strong><span>Clientes activos</span></button><button @click="goTo('/clientes')"><strong>{{ number(dashboard.summary.clients.suspended) }}</strong><span>Suspendidos</span></button><button @click="goTo('/clientes')"><strong>{{ number(dashboard.summary.clients.prospect) }}</strong><span>Prospectos</span></button><button @click="goTo('/clientes')"><strong>{{ number(dashboard.summary.activeContracts) }}</strong><span>Contratos activos</span></button></section>
        <section class="dv-panel dv-billing" aria-labelledby="billing-heading">
          <div class="dv-section-heading"><h2 id="billing-heading">Facturación</h2><span class="dv-source">DEL MES</span><button class="dv-icon-button" @click="goTo('/facturacion')" aria-label="Ver facturación"><DashboardIcon name="arrow" /></button></div>
          <div class="dv-billing-content">
            <div class="dv-collection"><div class="dv-collection-head"><div><p class="dv-small-label">COBRADO DEL MES</p><p class="dv-money"><span>S/</span> {{ money(dashboard.summary.billing.collectedThisMonth) }}</p></div><div class="dv-rate">{{ dashboard.summary.billing.collectionRate.toFixed(0) }}<small>%</small><span>recaudo</span></div></div><div class="dv-collection-track" :aria-label="'Recaudo ' + dashboard.summary.billing.collectionRate.toFixed(0) + '%'" role="img"><span :class="recaudoBarClass" :style="{ width: Math.min(100, dashboard.summary.billing.collectionRate) + '%' }"></span></div><div class="dv-billing-pairs"><div><span>Facturado</span><strong>S/ {{ money(dashboard.summary.billing.billedThisMonth) }}</strong></div><div><span>Cobrado hoy</span><strong>S/ {{ money(dashboard.summary.billing.collectedToday) }}</strong></div><div><span>Sin cobrar del mes</span><strong>S/ {{ money(dashboard.summary.billing.uncollectedThisMonth) }}</strong></div></div><button class="dv-overdue" @click="goTo('/facturacion')"><span :class="{ warning: dashboard.summary.billing.overdueCount }">{{ dashboard.summary.billing.overdueCount ? dashboard.summary.billing.overdueCount + ' facturas vencidas' : 'Sin facturas vencidas' }}</span><span>S/ {{ money(dashboard.summary.billing.pendingTotal) }}<small>pendiente total</small><DashboardIcon name="chevron" /></span></button></div>
            <div class="dv-revenue"><div class="dv-chart-heading"><h3>Últimos 6 meses</h3><button v-if="isMobile" class="dv-link" data-testid="chart-toggle" @click="chartExpanded = !chartExpanded" :aria-expanded="chartExpanded" aria-controls="revenue-chart">{{ chartExpanded ? 'Ocultar gráfico' : 'Ver gráfico' }}<DashboardIcon name="chevron" /></button><div v-else class="dv-chart-legend"><span>Facturado</span><span>Cobrado</span></div></div><div v-show="!isMobile || chartExpanded" id="revenue-chart" data-testid="revenue-chart"><div v-if="isMobile" class="dv-chart-legend"><span>Facturado</span><span>Cobrado</span></div><svg v-if="hasChartData" viewBox="0 0 600 180" role="img" aria-label="Importes facturados y cobrados de los últimos seis meses"><g v-for="b in chartBars" :key="b.label"><rect :x="b.billedX" :y="b.billedY" :width="b.barWidth" :height="b.billedH" rx="3" fill="#b8ceda"><title>Facturado {{ b.label }}: S/ {{ b.billed.toFixed(2) }}</title></rect><rect :x="b.collectedX" :y="b.collectedY" :width="b.barWidth" :height="b.collectedH" rx="3" fill="#087caa"><title>Cobrado {{ b.label }}: S/ {{ b.collected.toFixed(2) }}</title></rect><text :x="b.labelX" y="172" text-anchor="middle" font-size="11" fill="#617585">{{ b.label }}</text></g></svg><p v-else class="dv-empty">Sin datos de facturación en este periodo.</p></div></div>
          </div>
        </section>
        <div class="dv-detail-grid">
          <section aria-labelledby="clients-heading"><div class="dv-section-heading"><h2 id="clients-heading">Clientes recientes</h2><button class="dv-link" @click="goTo('/clientes')">Ver todos<DashboardIcon name="arrow" /></button></div><p v-if="!dashboard.summary.recentClients.length" class="dv-empty">Sin clientes todavía.</p><ul v-else class="dv-client-list"><li v-for="c in visibleClients" :key="c.id" data-testid="recent-client"><button @click="goTo('/clientes/' + c.id)"><span>{{ c.first_name }} {{ c.last_name }}</span><small>{{ clientStatus[c.status] ?? c.status }}</small><DashboardIcon name="chevron" /></button></li></ul></section>
          <section aria-labelledby="equipment-heading"><div class="dv-section-heading"><h2 id="equipment-heading">Equipos</h2><span class="dv-source">ÚLTIMA PRUEBA</span></div><div class="dv-equipment-header"><span>Conexión</span><span>OK</span><span>Caídos</span><span>Sin probar</span></div><button v-for="device in [{ label: 'OLTs', path: '/olt', data: dashboard.summary.network.olt }, { label: 'MikroTik', path: '/mikrotik', data: dashboard.summary.network.mikrotik }]" :key="device.path" class="dv-equipment-row" @click="goTo(device.path)"><span>{{ device.label }} <small>{{ device.data.total }}</small></span><b class="good">{{ device.data.ok }}</b><b :class="{ warning: device.data.down }">{{ device.data.down }}</b><b>{{ device.data.untested }}</b></button><p class="dv-reading">Según prueba registrada; no es monitoreo en vivo.</p></section>
        </div>
        <section class="dv-attention" aria-labelledby="attention-heading" data-testid="attention"><div class="dv-section-heading"><h2 id="attention-heading">Atención</h2><span class="dv-source">SEGÚN ÚLTIMAS LECTURAS</span></div><ul>
          <li v-if="dashboard.summary.tickets.urgent"><span class="dv-severity danger"><DashboardIcon name="warning" />Urgente</span><span>{{ dashboard.summary.tickets.urgent }} tickets urgentes</span><button class="dv-link" @click="goTo('/soporte')">Ver tickets<DashboardIcon name="arrow" /></button></li>
          <li v-for="p in dashboard.summary.network.problems" :key="p.kind + p.host"><span class="dv-severity danger"><DashboardIcon name="network" />Incidencia</span><span class="dv-problem">{{ p.name }}<small>{{ p.kind }} · {{ p.host }}</small></span><button class="dv-link" @click="goTo(p.kind === 'OLT' ? '/olt' : '/mikrotik')">Ver equipo<DashboardIcon name="arrow" /></button></li>
          <li v-if="oltCheckedAtLabel && dashboard.summary.oltSummary.lowSignal"><span class="dv-severity warning"><DashboardIcon name="warning" />Revisar</span><span>{{ dashboard.summary.oltSummary.lowSignal }} ONT con señal baja</span><button class="dv-link" @click="goToOlt('lowSignal')">Ver ONT<DashboardIcon name="arrow" /></button></li>
        </ul><p v-if="!dashboard.summary.tickets.urgent && !dashboard.summary.network.problems.length && (!oltCheckedAtLabel || !dashboard.summary.oltSummary.lowSignal)" class="dv-empty">{{ networkWarning || !oltCheckedAtLabel ? 'Sin incidencias reportadas; información incompleta.' : 'Sin incidencias reportadas en las últimas lecturas.' }}</p></section>
        <footer class="dv-footer"><span>COMUNICACIONES RAYCO</span><span>Próximo refresco {{ secondsLeft }}s · Perú</span></footer>
      </template>
    </div>
  </AppLayout>
</template>
<style scoped src="../components/dashboard/dashboard-v2.css"></style>
