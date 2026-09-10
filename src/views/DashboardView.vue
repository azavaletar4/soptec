<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useDashboardStore } from '@/stores/dashboard';

const router = useRouter();
const dashboard = useDashboardStore();

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
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Panel SmartRayco</h1>
        <p class="text-slate-400 text-sm mt-1">
          Actualizado {{ updatedLabel }} · próximo refresco en {{ secondsLeft }}s
        </p>
      </div>
      <button
        class="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm flex items-center gap-2 disabled:opacity-60"
        :disabled="dashboard.loading"
        @click="refresh"
      >
        <span :class="{ 'animate-spin': dashboard.loading }">↻</span>
        Refrescar
      </button>
    </div>

    <p v-if="dashboard.error" class="mb-4 text-sm text-red-400">{{ dashboard.error }}</p>

    <template v-if="dashboard.summary">
      <!-- Clientes -->
      <h2 class="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Clientes</h2>
      <div class="grid gap-4 mb-8" style="grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))">
        <button class="text-left rounded-xl border border-slate-800 bg-slate-900 p-5 hover:border-sky-500/50" @click="goTo('/clientes')">
          <div class="text-2xl font-semibold text-green-400">{{ dashboard.summary.clients.active }}</div>
          <div class="text-sm text-slate-400 mt-1">Activos</div>
        </button>
        <button class="text-left rounded-xl border border-slate-800 bg-slate-900 p-5 hover:border-sky-500/50" @click="goTo('/clientes')">
          <div class="text-2xl font-semibold text-red-400">{{ dashboard.summary.clients.suspended }}</div>
          <div class="text-sm text-slate-400 mt-1">Suspendidos</div>
        </button>
        <button class="text-left rounded-xl border border-slate-800 bg-slate-900 p-5 hover:border-sky-500/50" @click="goTo('/clientes')">
          <div class="text-2xl font-semibold text-yellow-400">{{ dashboard.summary.clients.prospect }}</div>
          <div class="text-sm text-slate-400 mt-1">Prospectos</div>
        </button>
        <button class="text-left rounded-xl border border-slate-800 bg-slate-900 p-5 hover:border-sky-500/50" @click="goTo('/contratos/kanban')">
          <div class="text-2xl font-semibold text-sky-400">{{ dashboard.summary.activeContracts }}</div>
          <div class="text-sm text-slate-400 mt-1">Contratos activos</div>
        </button>
      </div>

      <!-- Soporte + Facturacion: placeholders -->
      <div class="grid gap-4 mb-8" style="grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))">
        <div class="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-5">
          <div class="text-sm font-semibold text-slate-400 mb-1">Soporte</div>
          <p class="text-xs text-slate-600">Disponible cuando se construya el módulo de tickets (Fase de Soporte técnico).</p>
        </div>
        <div class="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-5">
          <div class="text-sm font-semibold text-slate-400 mb-1">Facturación del mes</div>
          <p class="text-xs text-slate-600">Disponible cuando se construya el módulo de facturación (Fase de Cobros/SRI).</p>
        </div>
      </div>

      <!-- Red -->
      <h2 class="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Estado de la red</h2>
      <div class="grid gap-4 mb-8" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))">
        <button class="text-left rounded-xl border border-slate-800 bg-slate-900 p-5 hover:border-sky-500/50" @click="goTo('/olt')">
          <div class="text-sm font-semibold mb-2">OLTs</div>
          <div class="flex gap-4 text-sm">
            <span class="text-green-400">{{ dashboard.summary.network.olt.ok }} ok</span>
            <span class="text-red-400">{{ dashboard.summary.network.olt.down }} caídas</span>
            <span class="text-slate-500">{{ dashboard.summary.network.olt.untested }} sin probar</span>
          </div>
        </button>
        <button class="text-left rounded-xl border border-slate-800 bg-slate-900 p-5 hover:border-sky-500/50" @click="goTo('/mikrotik')">
          <div class="text-sm font-semibold mb-2">MikroTiks</div>
          <div class="flex gap-4 text-sm">
            <span class="text-green-400">{{ dashboard.summary.network.mikrotik.ok }} ok</span>
            <span class="text-red-400">{{ dashboard.summary.network.mikrotik.down }} caídos</span>
            <span class="text-slate-500">{{ dashboard.summary.network.mikrotik.untested }} sin probar</span>
          </div>
        </button>
        <div class="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div class="text-sm font-semibold mb-2">Con problemas</div>
          <p v-if="!dashboard.summary.network.problems.length" class="text-sm text-green-400">Todos los equipos responden</p>
          <ul v-else class="text-sm text-red-400 space-y-1">
            <li v-for="p in dashboard.summary.network.problems" :key="p.kind + p.host">{{ p.kind }} — {{ p.name }} ({{ p.host }})</li>
          </ul>
        </div>
      </div>

      <!-- Actividad reciente -->
      <h2 class="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Actividad reciente</h2>
      <div class="grid gap-4 mb-8" style="grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))">
        <div class="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div class="text-sm font-semibold mb-3">Clientes recientes</div>
          <p v-if="!dashboard.summary.recentClients.length" class="text-sm text-slate-500">Sin clientes todavía.</p>
          <ul v-else class="space-y-2">
            <li
              v-for="c in dashboard.summary.recentClients"
              :key="c.id"
              class="flex items-center justify-between text-sm cursor-pointer hover:text-sky-400"
              @click="goTo(`/clientes/${c.id}`)"
            >
              <span>{{ c.first_name }} {{ c.last_name }}</span>
              <span class="text-xs text-slate-500">{{ c.status }}</span>
            </li>
          </ul>
        </div>
        <div class="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-5">
          <div class="text-sm font-semibold text-slate-400 mb-1">Tickets recientes</div>
          <p class="text-xs text-slate-600">Disponible cuando se construya el módulo de Soporte técnico.</p>
        </div>
      </div>

      <!-- Accesos rapidos -->
      <h2 class="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Accesos rápidos</h2>
      <div class="flex flex-wrap gap-3">
        <button class="px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold text-sm" @click="goTo('/clientes')">+ Nuevo cliente</button>
        <button class="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm" @click="goTo('/olt')">Gestión OLT</button>
        <button class="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm" @click="goTo('/mikrotik')">MikroTik</button>
        <button class="px-4 py-2 rounded-lg bg-slate-900 border border-dashed border-slate-800 text-sm text-slate-600 cursor-not-allowed" disabled>
          Ver tickets (próximamente)
        </button>
        <button class="px-4 py-2 rounded-lg bg-slate-900 border border-dashed border-slate-800 text-sm text-slate-600 cursor-not-allowed" disabled>
          Nueva factura (próximamente)
        </button>
      </div>
    </template>

    <p v-else-if="dashboard.loading" class="text-slate-500 text-sm">Cargando panel...</p>
  </AppLayout>
</template>
