<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
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
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
});

const recaudoBarClass = computed(() => {
  const rate = dashboard.summary?.billing.collectionRate ?? 0;
  if (rate >= 80) return 'bg-green-500/80';
  if (rate >= 50) return 'bg-amber-500/80';
  return 'bg-red-500/80';
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
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-8">
      <div>
        <h1 class="text-2xl font-bold">Panel SmartRayco</h1>
        <p class="text-slate-500 text-sm mt-1">
          Actualizado {{ updatedLabel }} · próximo refresco en {{ secondsLeft }}s
        </p>
      </div>
      <button class="btn-secondary" :disabled="dashboard.loading" @click="refresh">
        <span :class="{ 'animate-spin': dashboard.loading }">↻</span>
        Refrescar
      </button>
    </div>

    <p v-if="dashboard.error" class="mb-4 text-sm text-red-600">{{ dashboard.error }}</p>

    <template v-if="dashboard.summary">
      <!-- Estado de la red: encabezado del dashboard -->
      <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Estado de la red — OLTs</h2>
      <div class="grid gap-4 mb-1" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))">
        <button class="kpi-tile bg-sky-600/80" @click="goToUnconfigured">
          <div>
            <div class="text-3xl font-bold text-white">{{ dashboard.summary.oltSummary.unconfigured }}</div>
            <div class="text-sm text-white/85 mt-1">Sin autorizar</div>
          </div>
          <span class="text-2xl">✨</span>
        </button>
        <button class="kpi-tile bg-green-600/80" @click="goToOlt('online')">
          <div>
            <div class="text-3xl font-bold text-white">{{ dashboard.summary.oltSummary.online }}</div>
            <div class="text-sm text-white/85 mt-1">En línea</div>
          </div>
          <span class="text-2xl">🖧</span>
        </button>
        <button class="kpi-tile bg-slate-600/80" @click="goToOlt('offline')">
          <div>
            <div class="text-3xl font-bold text-white">{{ dashboard.summary.oltSummary.offline }}</div>
            <div class="text-sm text-white/85 mt-1">Desconectado</div>
          </div>
          <span class="text-2xl">✕</span>
        </button>
        <button class="kpi-tile bg-orange-600/80" @click="goToOlt('lowSignal')">
          <div>
            <div class="text-3xl font-bold text-white">{{ dashboard.summary.oltSummary.lowSignal }}</div>
            <div class="text-sm text-white/85 mt-1">Señales bajas</div>
          </div>
          <span class="text-2xl">⚠</span>
        </button>
      </div>
      <p class="text-xs text-slate-500 text-right mb-8">
        Total autorizado: {{ dashboard.summary.oltSummary.online + dashboard.summary.oltSummary.offline }}
        · {{ dashboard.summary.oltSummary.deviceCount }} OLT(s)
        · Información válida a las {{ oltCheckedAtLabel }}
        <span v-if="!dashboard.summary.oltSummary.scanComplete" class="text-amber-600/80">(escaneo parcial)</span>
      </p>

      <div class="grid gap-4 mb-8" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))">
        <button class="text-left surface-hover p-5" @click="goTo('/olt')">
          <div class="text-sm font-semibold mb-3">OLTs (conexión)</div>
          <div class="flex gap-2 flex-wrap text-sm">
            <span class="badge bg-green-500/15 text-green-600">{{ dashboard.summary.network.olt.ok }} ok</span>
            <span class="badge bg-red-500/15 text-red-600">{{ dashboard.summary.network.olt.down }} caídas</span>
            <span class="badge bg-slate-500/15 text-slate-600">{{ dashboard.summary.network.olt.untested }} sin probar</span>
          </div>
        </button>
        <button class="text-left surface-hover p-5" @click="goTo('/mikrotik')">
          <div class="text-sm font-semibold mb-3">MikroTiks</div>
          <div class="flex gap-2 flex-wrap text-sm">
            <span class="badge bg-green-500/15 text-green-600">{{ dashboard.summary.network.mikrotik.ok }} ok</span>
            <span class="badge bg-red-500/15 text-red-600">{{ dashboard.summary.network.mikrotik.down }} caídos</span>
            <span class="badge bg-slate-500/15 text-slate-600">{{ dashboard.summary.network.mikrotik.untested }} sin probar</span>
          </div>
        </button>
        <div class="surface p-5">
          <div class="text-sm font-semibold mb-2">Con problemas</div>
          <p v-if="!dashboard.summary.network.problems.length" class="text-sm text-green-600">Todos los equipos responden</p>
          <ul v-else class="text-sm text-red-600 space-y-1">
            <li v-for="p in dashboard.summary.network.problems" :key="p.kind + p.host">{{ p.kind }} — {{ p.name }} ({{ p.host }})</li>
          </ul>
        </div>
      </div>

      <!-- Clientes -->
      <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Clientes</h2>
      <div class="grid gap-4 mb-8" style="grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))">
        <button class="kpi-tile bg-green-600/80" @click="goTo('/clientes')">
          <div>
            <div class="text-3xl font-bold text-white">{{ dashboard.summary.clients.active }}</div>
            <div class="text-sm text-white/85 mt-1">Activos</div>
          </div>
          <span class="text-2xl">✓</span>
        </button>
        <button class="kpi-tile bg-red-600/80" @click="goTo('/clientes')">
          <div>
            <div class="text-3xl font-bold text-white">{{ dashboard.summary.clients.suspended }}</div>
            <div class="text-sm text-white/85 mt-1">Suspendidos</div>
          </div>
          <span class="text-2xl">⏸</span>
        </button>
        <button class="kpi-tile bg-amber-600/80" @click="goTo('/clientes')">
          <div>
            <div class="text-3xl font-bold text-white">{{ dashboard.summary.clients.prospect }}</div>
            <div class="text-sm text-white/85 mt-1">Prospectos</div>
          </div>
          <span class="text-2xl">★</span>
        </button>
        <button class="kpi-tile bg-sky-600/80" @click="goTo('/clientes')">
          <div>
            <div class="text-3xl font-bold text-white">{{ dashboard.summary.activeContracts }}</div>
            <div class="text-sm text-white/85 mt-1">Contratos activos</div>
          </div>
          <span class="text-2xl">📄</span>
        </button>
      </div>

      <!-- Soporte -->
      <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Soporte</h2>
      <div class="grid gap-4 mb-8" style="grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))">
        <button class="kpi-tile bg-amber-600/80" @click="goTo('/soporte')">
          <div>
            <div class="text-3xl font-bold text-white">{{ dashboard.summary.tickets.open }}</div>
            <div class="text-sm text-white/85 mt-1">Tickets abiertos</div>
          </div>
          <span class="text-2xl">🎫</span>
        </button>
        <button class="kpi-tile bg-sky-600/80" @click="goTo('/soporte')">
          <div>
            <div class="text-3xl font-bold text-white">{{ dashboard.summary.tickets.inProgress }}</div>
            <div class="text-sm text-white/85 mt-1">En progreso</div>
          </div>
          <span class="text-2xl">🔧</span>
        </button>
        <button class="kpi-tile bg-red-600/80" @click="goTo('/soporte')">
          <div>
            <div class="text-3xl font-bold text-white">{{ dashboard.summary.tickets.urgent }}</div>
            <div class="text-sm text-white/85 mt-1">Urgentes</div>
          </div>
          <span class="text-2xl">🚨</span>
        </button>
      </div>

      <!-- Facturacion del mes -->
      <div class="surface p-5 mb-8">
        <div class="flex items-center justify-between mb-4">
          <div class="text-sm font-semibold">Facturación del mes</div>
          <button class="text-xs text-sky-600 hover:text-sky-700 font-medium" @click="goTo('/facturacion')">Ver todo →</button>
        </div>
        <div class="grid gap-4 mb-4" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr))">
          <div>
            <div class="text-xl font-semibold">S/ {{ dashboard.summary.billing.billedThisMonth.toFixed(2) }}</div>
            <div class="text-xs text-slate-500 mt-1">Facturado</div>
          </div>
          <div>
            <div class="text-xl font-semibold text-green-600">S/ {{ dashboard.summary.billing.collectedThisMonth.toFixed(2) }}</div>
            <div class="text-xs text-slate-500 mt-1">Cobrado del mes</div>
          </div>
          <div>
            <div class="text-xl font-semibold text-sky-600">S/ {{ dashboard.summary.billing.collectedToday.toFixed(2) }}</div>
            <div class="text-xs text-slate-500 mt-1">Cobrado hoy</div>
          </div>
          <div>
            <div class="text-xl font-semibold text-amber-600">S/ {{ dashboard.summary.billing.uncollectedThisMonth.toFixed(2) }}</div>
            <div class="text-xs text-slate-500 mt-1">Sin cobrar del mes</div>
          </div>
        </div>
        <div class="mb-3">
          <div class="flex justify-between text-xs text-slate-500 mb-1">
            <span>Recaudo del mes</span>
            <span>{{ dashboard.summary.billing.collectionRate.toFixed(0) }}%</span>
          </div>
          <div class="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              class="h-full rounded-full"
              :class="recaudoBarClass"
              :style="{ width: Math.min(100, dashboard.summary.billing.collectionRate) + '%' }"
            ></div>
          </div>
        </div>
        <p v-if="dashboard.summary.billing.overdueCount" class="text-xs text-red-600">
          ⚠ {{ dashboard.summary.billing.overdueCount }} factura(s) vencida(s) sin cobrar (S/ {{ dashboard.summary.billing.pendingTotal.toFixed(2) }} pendiente en total).
        </p>
        <p v-else class="text-xs text-green-600">Sin facturas vencidas.</p>
      </div>

      <!-- Ingresos 6 meses -->
      <div class="surface p-5 mb-8">
        <div class="flex items-center justify-between mb-3">
          <div class="text-sm font-semibold">Ingresos últimos 6 meses</div>
          <div class="flex items-center gap-3 text-xs text-slate-600">
            <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:#3987e5"></span>Facturado</span>
            <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:#d95926"></span>Cobrado</span>
          </div>
        </div>
        <svg v-if="hasChartData" viewBox="0 0 600 180" class="w-full h-40">
          <g v-for="b in chartBars" :key="b.label">
            <rect :x="b.billedX" :y="b.billedY" :width="b.barWidth" :height="b.billedH" rx="3" fill="#3987e5">
              <title>Facturado {{ b.label }}: S/ {{ b.billed.toFixed(2) }}</title>
            </rect>
            <rect :x="b.collectedX" :y="b.collectedY" :width="b.barWidth" :height="b.collectedH" rx="3" fill="#d95926">
              <title>Cobrado {{ b.label }}: S/ {{ b.collected.toFixed(2) }}</title>
            </rect>
            <text :x="b.labelX" y="172" text-anchor="middle" font-size="10" fill="#898781">{{ b.label }}</text>
          </g>
        </svg>
        <p v-else class="text-sm text-slate-500">Sin datos de facturación en este periodo.</p>
      </div>

      <!-- Actividad reciente -->
      <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Actividad reciente</h2>
      <div class="grid gap-4 mb-8" style="grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))">
        <div class="surface p-5">
          <div class="text-sm font-semibold mb-3">Clientes recientes</div>
          <p v-if="!dashboard.summary.recentClients.length" class="text-sm text-slate-500">Sin clientes todavía.</p>
          <ul v-else class="space-y-2">
            <li
              v-for="c in dashboard.summary.recentClients"
              :key="c.id"
              class="flex items-center justify-between text-sm cursor-pointer hover:text-sky-600 transition-colors"
              @click="goTo(`/clientes/${c.id}`)"
            >
              <span>{{ c.first_name }} {{ c.last_name }}</span>
              <span class="text-xs text-slate-500">{{ c.status }}</span>
            </li>
          </ul>
        </div>
        <div class="surface p-5">
          <div class="text-sm font-semibold mb-3">Tickets abiertos recientes</div>
          <p v-if="!dashboard.summary.tickets.recent.length" class="text-sm text-slate-500">Sin tickets todavía.</p>
          <ul v-else class="space-y-2">
            <li
              v-for="t in dashboard.summary.tickets.recent"
              :key="t.id"
              class="flex items-center justify-between text-sm cursor-pointer hover:text-sky-600 transition-colors"
              @click="goTo(`/soporte/${t.id}`)"
            >
              <span>{{ t.title }} — {{ t.clients ? `${t.clients.first_name} ${t.clients.last_name}` : '—' }}</span>
              <span class="text-xs text-slate-500">{{ t.status }}</span>
            </li>
          </ul>
        </div>
      </div>

      <!-- Accesos rapidos -->
      <h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Accesos rápidos</h2>
      <div class="flex flex-wrap gap-3">
        <button class="btn-primary" @click="goTo('/clientes')">+ Nuevo cliente</button>
        <button class="btn-secondary" @click="goTo('/olt')">Gestión OLT</button>
        <button class="btn-secondary" @click="goTo('/mikrotik')">MikroTik</button>
        <button class="btn-secondary" @click="goTo('/soporte')">Ver tickets</button>
        <button class="btn-secondary" @click="goTo('/facturacion')">Facturación</button>
      </div>
    </template>

    <p v-else-if="dashboard.loading" class="text-slate-500 text-sm">Cargando panel...</p>
  </AppLayout>
</template>
