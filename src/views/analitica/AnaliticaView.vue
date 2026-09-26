<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import VueApexCharts from 'vue3-apexcharts';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useAnalyticsStore } from '@/stores/analytics';

const analytics = useAnalyticsStore();

const REFRESH_SECONDS = 60;
const secondsLeft = ref(REFRESH_SECONDS);
const secondsSinceUpdate = ref(0);
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let tickTimer: ReturnType<typeof setInterval> | undefined;

async function refresh() {
  try {
    await analytics.fetchAll();
  } catch {
    // el error ya queda visible via analytics.error
  }
  secondsLeft.value = REFRESH_SECONDS;
  secondsSinceUpdate.value = 0;
}

onMounted(async () => {
  await refresh();
  refreshTimer = setInterval(refresh, REFRESH_SECONDS * 1000);
  tickTimer = setInterval(() => {
    secondsLeft.value = Math.max(0, secondsLeft.value - 1);
    secondsSinceUpdate.value += 1;
  }, 1000);
});
onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
  if (tickTimer) clearInterval(tickTimer);
});

const updatedLabel = computed(() => {
  const s = secondsSinceUpdate.value;
  if (s < 5) return 'justo ahora';
  if (s < 60) return `hace ${s}s`;
  return `hace ${Math.floor(s / 60)} min`;
});

// ---- Formato ----

function formatBytes(bytes: number): string {
  if (!bytes) return '0 GB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function formatBps(bps: number): string {
  if (!bps) return '0 Mbps';
  const mbps = bps / 1_000_000;
  if (mbps < 1000) return `${mbps.toFixed(mbps < 10 ? 2 : 1)} Mbps`;
  return `${(mbps / 1000).toFixed(2)} Gbps`;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const MONTH_LABEL = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// ---- Gráfica: evolución mensual (área, descarga/subida en GB) ----

const monthlyChartOptions = computed(() => ({
  chart: { type: 'area' as const, toolbar: { show: false }, foreColor: '#64748b', background: 'transparent' },
  colors: ['#0ea5e9', '#8b5cf6'],
  dataLabels: { enabled: false },
  stroke: { curve: 'smooth' as const, width: 2 },
  fill: { type: 'gradient', gradient: { opacityFrom: 0.3, opacityTo: 0.02, stops: [0, 90, 100] } },
  grid: { borderColor: '#e2e8f0', strokeDashArray: 4 },
  xaxis: {
    categories: analytics.monthly.map((m) => {
      const d = new Date(m.month_start);
      return `${MONTH_LABEL[d.getMonth()]} ${d.getFullYear()}`;
    }),
    axisBorder: { show: false },
    axisTicks: { show: false },
  },
  yaxis: { labels: { formatter: (v: number) => formatBytes(v) } },
  tooltip: { theme: 'light' as const, y: { formatter: (v: number) => formatBytes(v) } },
  legend: { labels: { colors: '#475569' } },
}));
const monthlyChartSeries = computed(() => [
  { name: 'Descarga', data: analytics.monthly.map((m) => m.download_bytes) },
  { name: 'Subida', data: analytics.monthly.map((m) => m.upload_bytes) },
]);

// ---- Gráfica: top clientes (barras horizontales) ----

const topClientsOptions = computed(() => ({
  chart: { type: 'bar' as const, toolbar: { show: false }, foreColor: '#64748b', background: 'transparent' },
  colors: ['#0ea5e9'],
  plotOptions: { bar: { horizontal: true, borderRadius: 4, distributed: false } },
  dataLabels: {
    enabled: true,
    formatter: (v: number) => formatBytes(v),
    style: { colors: ['#334155'] },
    offsetX: 8,
  },
  grid: { borderColor: '#e2e8f0', strokeDashArray: 4 },
  xaxis: {
    categories: analytics.topClients.map((c) => c.client_name),
    labels: { formatter: (v: string) => formatBytes(Number(v)) },
  },
  tooltip: { theme: 'light' as const, x: { show: true }, y: { formatter: (v: number) => formatBytes(v) } },
}));
const topClientsSeries = computed(() => [{ name: 'Consumo total', data: analytics.topClients.map((c) => c.total_bytes) }]);
const topClientsChartHeight = computed(() => Math.max(220, analytics.topClients.length * 42));

// ---- Gauge: saturación de los clientes más comprometidos ----

const bottleneckGaugeClients = computed(() => analytics.bottlenecks.slice(0, 3));
const bottleneckGaugeOptions = computed(() => ({
  chart: { type: 'radialBar' as const, foreColor: '#64748b', background: 'transparent' },
  colors: ['#ef4444', '#f97316', '#eab308'],
  plotOptions: {
    radialBar: {
      dataLabels: {
        name: { fontSize: '11px', color: '#64748b' },
        value: { fontSize: '15px', color: '#334155', formatter: (v: number) => `${v.toFixed(0)}%` },
      },
    },
  },
  labels: bottleneckGaugeClients.value.map((c) => c.client_name),
  stroke: { lineCap: 'round' as const },
}));
const bottleneckGaugeSeries = computed(() => bottleneckGaugeClients.value.map((c) => Math.min(100, Math.round(c.usage_pct))));

function severityClass(pct: number) {
  if (pct >= 95) return 'text-red-600';
  if (pct >= 90) return 'text-orange-600';
  return 'text-amber-600';
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-bold">Analítica y Monitoreo de Tráfico</h1>
        <p class="text-slate-500 text-sm mt-1">
          Consumo de clientes y rendimiento del servicio · actualizado {{ updatedLabel }} · próximo refresco en {{ secondsLeft }}s
        </p>
      </div>
      <button class="btn-secondary" :disabled="analytics.loading" @click="refresh">
        <span :class="{ 'animate-spin': analytics.loading }">↻</span>
        Refrescar
      </button>
    </div>

    <p v-if="analytics.error" class="mb-4 text-sm text-red-600">{{ analytics.error }}</p>

    <template v-if="analytics.kpis">
      <!-- KPIs -->
      <div class="grid gap-4 mb-8" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))">
        <div class="kpi-tile bg-sky-600/80">
          <div>
            <div class="text-2xl font-bold text-white">{{ formatBytes(analytics.kpis.monthTotalBytes) }}</div>
            <div class="text-sm text-white/85 mt-1">Consumo del mes</div>
            <div class="text-xs text-white/70 mt-1">
              ↓ {{ formatBytes(analytics.kpis.monthDownloadBytes) }} · ↑ {{ formatBytes(analytics.kpis.monthUploadBytes) }}
            </div>
          </div>
        </div>
        <div class="kpi-tile bg-violet-600/80">
          <div>
            <div class="text-2xl font-bold text-white">{{ formatBps(analytics.kpis.peakTotalBps) }}</div>
            <div class="text-sm text-white/85 mt-1">Pico máximo registrado</div>
            <div class="text-xs text-white/70 mt-1">{{ formatDate(analytics.kpis.peakAt) }}</div>
          </div>
        </div>
        <div class="kpi-tile bg-orange-600/80">
          <div>
            <div class="text-2xl font-bold text-white">{{ analytics.kpis.bottleneckCount }}</div>
            <div class="text-sm text-white/85 mt-1">Riesgo de cuello de botella</div>
            <div class="text-xs text-white/70 mt-1">clientes ≥ 85% de su plan contratado</div>
          </div>
        </div>
        <div class="kpi-tile bg-red-600/80">
          <div>
            <div class="text-2xl font-bold text-white">{{ analytics.kpis.anomalyCount }}</div>
            <div class="text-sm text-white/85 mt-1">Consumo anómalo (24h)</div>
            <div class="text-xs text-white/70 mt-1">picos ≥ 2× su propio promedio</div>
          </div>
        </div>
      </div>

      <!-- Evolución mensual + Top clientes -->
      <div class="grid gap-5 mb-8" style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr)">
        <div class="surface p-5">
          <h2 class="text-sm font-semibold text-slate-700 mb-4">Evolución del consumo mensual</h2>
          <VueApexCharts type="area" height="300" :options="monthlyChartOptions" :series="monthlyChartSeries" />
        </div>
        <div class="surface p-5">
          <h2 class="text-sm font-semibold text-slate-700 mb-1">Saturación — top ofensores</h2>
          <p class="text-xs text-slate-500 mb-2">% del plan contratado en uso ahora mismo</p>
          <VueApexCharts
            v-if="bottleneckGaugeClients.length"
            type="radialBar"
            height="260"
            :options="bottleneckGaugeOptions"
            :series="bottleneckGaugeSeries"
          />
          <p v-else class="text-sm text-slate-500 py-16 text-center">Sin clientes saturados ahora mismo.</p>
        </div>
      </div>

      <!-- Top clientes (barras) -->
      <div class="surface p-5 mb-8">
        <h2 class="text-sm font-semibold text-slate-700 mb-4">Top clientes por consumo (este mes)</h2>
        <VueApexCharts
          v-if="analytics.topClients.length"
          type="bar"
          :height="topClientsChartHeight"
          :options="topClientsOptions"
          :series="topClientsSeries"
        />
        <p v-else class="text-sm text-slate-500 py-8 text-center">Todavía no hay muestras de consumo este mes.</p>
      </div>

      <!-- Cuellos de botella + Anomalías -->
      <div class="grid gap-5" style="grid-template-columns: repeat(auto-fit, minmax(380px, 1fr))">
        <div class="table-shell">
          <h2 class="text-sm font-semibold text-slate-700 p-5 pb-3">Cuellos de botella (≥ 85% de su plan)</h2>
          <table>
            <thead>
              <tr>
                <th class="text-left px-5 py-2">Cliente</th>
                <th class="text-right px-5 py-2">Uso</th>
                <th class="text-right px-5 py-2">% plan</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="b in analytics.bottlenecks" :key="b.contract_id">
                <td class="px-5 py-2.5">
                  <div class="text-slate-900">{{ b.client_name }}</div>
                  <div class="text-xs text-slate-500">{{ b.contract_number ?? '—' }}</div>
                </td>
                <td class="px-5 py-2.5 text-right text-slate-600">↓{{ formatBps(b.download_bps) }} ↑{{ formatBps(b.upload_bps) }}</td>
                <td class="px-5 py-2.5 text-right font-semibold" :class="severityClass(b.usage_pct)">{{ b.usage_pct.toFixed(0) }}%</td>
              </tr>
              <tr v-if="!analytics.bottlenecks.length">
                <td colspan="3" class="px-5 py-6 text-center text-slate-500">Sin cuellos de botella detectados.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="table-shell">
          <h2 class="text-sm font-semibold text-slate-700 p-5 pb-3">Consumos elevados — últimas 24h</h2>
          <table>
            <thead>
              <tr>
                <th class="text-left px-5 py-2">Cliente</th>
                <th class="text-right px-5 py-2">Actual vs. habitual</th>
                <th class="text-right px-5 py-2">Veces</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in analytics.anomalies" :key="a.contract_id">
                <td class="px-5 py-2.5">
                  <div class="text-slate-900">{{ a.client_name }}</div>
                  <div class="text-xs text-slate-500">{{ a.contract_number ?? '—' }} · {{ formatDate(a.last_seen) }}</div>
                </td>
                <td class="px-5 py-2.5 text-right text-slate-600">{{ formatBps(a.current_bps) }} vs {{ formatBps(a.baseline_bps) }}</td>
                <td class="px-5 py-2.5 text-right font-semibold text-red-600">{{ a.ratio.toFixed(1) }}×</td>
              </tr>
              <tr v-if="!analytics.anomalies.length">
                <td colspan="3" class="px-5 py-6 text-center text-slate-500">Sin picos de consumo atípicos.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <div v-else-if="analytics.loading" class="text-center text-slate-500 py-24">Cargando analítica…</div>
  </AppLayout>
</template>
