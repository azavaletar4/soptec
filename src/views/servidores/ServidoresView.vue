<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import VueApexCharts from 'vue3-apexcharts';
import AppLayout from '@/components/layout/AppLayout.vue';
import ConfirmModal from '@/components/ConfirmModal.vue';
import { useProxmoxStore, type VmAction, type VmSummary, type VmType } from '@/stores/proxmox';
import { getErrorMessage } from '@/lib/errors';

const proxmoxStore = useProxmoxStore();
const loadError = ref<string | null>(null);

async function loadSummary() {
  try {
    await proxmoxStore.fetchSummary();
    loadError.value = null;
  } catch (e) {
    loadError.value = getErrorMessage(e, 'No se pudo consultar Proxmox');
  }
}

// El resumen (CPU/RAM/VMs "ahora mismo") se refresca seguido; el historico
// para las graficas es mas pesado de pedir y no hace falta tan al segundo,
// asi que va en su propio intervalo mas espaciado.
let summaryPoll: ReturnType<typeof setInterval> | undefined;
let rrdPoll: ReturnType<typeof setInterval> | undefined;
onMounted(async () => {
  await Promise.all([loadSummary(), proxmoxStore.fetchRrdData()]);
  summaryPoll = setInterval(loadSummary, 15000);
  rrdPoll = setInterval(() => proxmoxStore.fetchRrdData(), 60000);
});
onUnmounted(() => {
  clearInterval(summaryPoll);
  clearInterval(rrdPoll);
});

// ---- Formato ----

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—';
  const gib = bytes / 1024 ** 3;
  if (gib >= 1) return `${gib.toFixed(gib >= 10 ? 1 : 2)} GiB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MiB`;
}

function formatUptime(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function pct(used: number | null, total: number | null): number {
  if (used == null || total == null || total <= 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

// Verde <60%, amarillo 60-85%, rojo >85% — mismo criterio que fillClass en
// ZonasView.vue, aplicado aca a uso de recursos en vez de cupo de zona.
function barClass(p: number): string {
  if (p >= 85) return 'bg-red-500';
  if (p >= 60) return 'bg-amber-500';
  return 'bg-emerald-500';
}
function barTextClass(p: number): string {
  if (p >= 85) return 'text-red-600';
  if (p >= 60) return 'text-amber-600';
  return 'text-emerald-600';
}

const STATUS_LABEL: Record<string, string> = { running: 'Encendida', stopped: 'Apagada', paused: 'Pausada' };
const STATUS_CLASS: Record<string, string> = {
  running: 'bg-emerald-500/15 text-emerald-600',
  stopped: 'bg-red-500/15 text-red-600',
  paused: 'bg-amber-500/15 text-amber-600',
};

function looksLikeSelf(vm: VmSummary): boolean {
  const n = vm.name.toLowerCase();
  return n.includes('smartrayco') || n.includes('panel');
}

function consoleUrl(vm: VmSummary): string {
  if (!proxmoxStore.summary) return '#';
  const { node, host, port } = proxmoxStore.summary.node;
  const consoleType = vm.type === 'lxc' ? 'lxc' : 'kvm';
  return `https://${host}:${port}/?console=${consoleType}&novnc=1&vmid=${vm.vmid}&vmname=${encodeURIComponent(vm.name)}&node=${node}&resize=off`;
}

// ---- Graficas (datos REALES del historial RRD de Proxmox, no simulados) ----
// Un solo eje por grafica a proposito (nunca doble eje Y): CPU e IO-delay
// comparten unidad (%), asi que van juntas; RAM (%) va aparte porque
// mezclarla con Red (Mbps, otra unidad) en el mismo eje distorsiona la
// lectura — mismo criterio que ya usa AnaliticaView.vue en este panel.
const chartBaseOptions = {
  chart: { toolbar: { show: false }, foreColor: '#64748b', background: 'transparent', animations: { speed: 300 } },
  dataLabels: { enabled: false },
  stroke: { curve: 'smooth' as const, width: 2 },
  grid: { borderColor: '#e2e8f0', strokeDashArray: 4 },
  legend: { show: true, position: 'top' as const, horizontalAlign: 'left' as const },
  tooltip: { x: { format: 'HH:mm' } },
};

const rrdCategories = computed(() => proxmoxStore.rrdData.map((p) => p.time * 1000));

const cpuChartOptions = computed(() => ({
  ...chartBaseOptions,
  chart: { ...chartBaseOptions.chart, type: 'area' as const },
  colors: ['#0ea5e9', '#f59e0b'],
  fill: { type: 'gradient', gradient: { opacityFrom: 0.3, opacityTo: 0.02, stops: [0, 90, 100] } },
  xaxis: { type: 'datetime' as const, categories: rrdCategories.value, labels: { datetimeUTC: false } },
  yaxis: { min: 0, max: 100, labels: { formatter: (v: number) => `${v.toFixed(0)}%` } },
}));
const cpuChartSeries = computed(() => [
  { name: 'CPU', data: proxmoxStore.rrdData.map((p) => p.cpuPercent ?? 0) },
  { name: 'Retardo I/O', data: proxmoxStore.rrdData.map((p) => p.ioDelayPercent ?? 0) },
]);

const ramChartOptions = computed(() => ({
  ...chartBaseOptions,
  chart: { ...chartBaseOptions.chart, type: 'area' as const },
  colors: ['#8b5cf6'],
  fill: { type: 'gradient', gradient: { opacityFrom: 0.35, opacityTo: 0.03, stops: [0, 90, 100] } },
  xaxis: { type: 'datetime' as const, categories: rrdCategories.value, labels: { datetimeUTC: false } },
  yaxis: { min: 0, max: 100, labels: { formatter: (v: number) => `${v.toFixed(0)}%` } },
}));
const ramChartSeries = computed(() => [
  { name: 'RAM usada', data: proxmoxStore.rrdData.map((p) => pct(p.memUsedBytes, p.memTotalBytes)) },
]);

// ---- Acciones de energia ----
const pendingAction = ref<{ vm: VmSummary; action: VmAction } | null>(null);
const running = ref(false);
const actionError = ref<string | null>(null);
const ACTION_LABEL: Record<VmAction, string> = { start: 'Iniciar', shutdown: 'Apagar', reboot: 'Reiniciar' };

function askAction(vm: VmSummary, action: VmAction) {
  actionError.value = null;
  pendingAction.value = { vm, action };
}

async function confirmAction() {
  if (!pendingAction.value) return;
  const { vm, action } = pendingAction.value;
  running.value = true;
  try {
    await proxmoxStore.runAction(vm.type as VmType, vm.vmid, action);
    pendingAction.value = null;
    setTimeout(loadSummary, 2000);
  } catch (e) {
    actionError.value = getErrorMessage(e, 'Error al enviar la acción a Proxmox');
  } finally {
    running.value = false;
  }
}
</script>

<template>
  <AppLayout>
    <div class="mb-6">
      <h1 class="text-2xl font-semibold">Servidores</h1>
      <p class="text-slate-600 text-sm mt-1">Monitoreo del nodo Proxmox VE — panel, DNS, Speedtest, IPTV y demás VMs/contenedores.</p>
    </div>

    <p v-if="loadError" class="mb-4 text-sm text-red-600">{{ loadError }}</p>

    <template v-if="proxmoxStore.summary">
      <!-- Encabezado del nodo -->
      <div class="surface p-4 mb-6 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div class="flex items-center gap-2">
          <span class="relative flex h-2.5 w-2.5">
            <span
              v-if="proxmoxStore.summary.node.online"
              class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
            ></span>
            <span class="relative inline-flex rounded-full h-2.5 w-2.5" :class="proxmoxStore.summary.node.online ? 'bg-emerald-500' : 'bg-red-500'"></span>
          </span>
          <span class="text-lg font-semibold">{{ proxmoxStore.summary.node.node }}</span>
          <span class="badge" :class="proxmoxStore.summary.node.online ? 'bg-emerald-500/15 text-emerald-600' : 'bg-red-500/15 text-red-600'">
            {{ proxmoxStore.summary.node.online ? 'En línea' : 'Sin respuesta' }}
          </span>
        </div>
        <span v-if="proxmoxStore.summary.node.uptimeSeconds" class="badge bg-slate-100 text-slate-600">
          ⏱ {{ formatUptime(proxmoxStore.summary.node.uptimeSeconds) }}
        </span>
        <span v-if="proxmoxStore.summary.node.cpuModel" class="text-xs text-slate-500">
          {{ proxmoxStore.summary.node.cpuThreads }}× {{ proxmoxStore.summary.node.cpuModel }}
        </span>
        <span v-if="proxmoxStore.summary.node.kernelVersion" class="text-xs text-slate-500 font-mono">{{ proxmoxStore.summary.node.kernelVersion }}</span>
        <span v-if="proxmoxStore.summary.node.pveVersion" class="text-xs text-slate-500 font-mono">{{ proxmoxStore.summary.node.pveVersion }}</span>
      </div>

      <!-- KPIs -->
      <div class="grid gap-4 mb-6" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))">
        <div class="surface p-4 rounded-2xl">
          <div class="flex items-center justify-between mb-1">
            <span class="text-slate-500 text-xs">🧠 CPU</span>
            <span class="text-xs text-slate-400">{{ proxmoxStore.summary.node.cpuThreads ?? '—' }} núcleos</span>
          </div>
          <div class="text-2xl font-semibold" :class="barTextClass(proxmoxStore.summary.node.cpuPercent ?? 0)">{{ proxmoxStore.summary.node.cpuPercent ?? '—' }}%</div>
          <div class="w-full bg-slate-100 rounded-full h-1.5 mt-2 mb-2">
            <div class="h-1.5 rounded-full transition-all" :class="barClass(proxmoxStore.summary.node.cpuPercent ?? 0)" :style="{ width: `${proxmoxStore.summary.node.cpuPercent ?? 0}%` }"></div>
          </div>
          <div v-if="proxmoxStore.summary.node.loadAvg" class="text-[11px] text-slate-500">Carga: {{ proxmoxStore.summary.node.loadAvg.join(', ') }}</div>
        </div>

        <div class="surface p-4 rounded-2xl">
          <div class="text-slate-500 text-xs mb-1">💾 Memoria RAM</div>
          <div class="text-2xl font-semibold" :class="barTextClass(pct(proxmoxStore.summary.node.memUsedBytes, proxmoxStore.summary.node.memTotalBytes))">
            {{ pct(proxmoxStore.summary.node.memUsedBytes, proxmoxStore.summary.node.memTotalBytes) }}%
          </div>
          <div class="w-full bg-slate-100 rounded-full h-1.5 mt-2 mb-2">
            <div
              class="h-1.5 rounded-full transition-all"
              :class="barClass(pct(proxmoxStore.summary.node.memUsedBytes, proxmoxStore.summary.node.memTotalBytes))"
              :style="{ width: `${pct(proxmoxStore.summary.node.memUsedBytes, proxmoxStore.summary.node.memTotalBytes)}%` }"
            ></div>
          </div>
          <div class="text-[11px] text-slate-500">{{ formatBytes(proxmoxStore.summary.node.memUsedBytes) }} de {{ formatBytes(proxmoxStore.summary.node.memTotalBytes) }}</div>
        </div>

        <div class="surface p-4 rounded-2xl">
          <div class="text-slate-500 text-xs mb-1">💽 Disco local (/)</div>
          <div class="text-2xl font-semibold" :class="barTextClass(pct(proxmoxStore.summary.node.diskUsedBytes, proxmoxStore.summary.node.diskTotalBytes))">
            {{ pct(proxmoxStore.summary.node.diskUsedBytes, proxmoxStore.summary.node.diskTotalBytes) }}%
          </div>
          <div class="w-full bg-slate-100 rounded-full h-1.5 mt-2 mb-2">
            <div
              class="h-1.5 rounded-full transition-all"
              :class="barClass(pct(proxmoxStore.summary.node.diskUsedBytes, proxmoxStore.summary.node.diskTotalBytes))"
              :style="{ width: `${pct(proxmoxStore.summary.node.diskUsedBytes, proxmoxStore.summary.node.diskTotalBytes)}%` }"
            ></div>
          </div>
          <div class="text-[11px] text-slate-500">{{ formatBytes(proxmoxStore.summary.node.diskUsedBytes) }} de {{ formatBytes(proxmoxStore.summary.node.diskTotalBytes) }}</div>
        </div>

        <div class="surface p-4 rounded-2xl">
          <div class="text-slate-500 text-xs mb-1">⚡ E/S y SWAP</div>
          <div class="flex items-baseline gap-3">
            <div>
              <div class="text-lg font-semibold">{{ proxmoxStore.summary.node.ioDelayPercent ?? '—' }}%</div>
              <div class="text-[11px] text-slate-500">Retardo I/O</div>
            </div>
            <div>
              <div class="text-lg font-semibold" :class="barTextClass(pct(proxmoxStore.summary.node.swapUsedBytes, proxmoxStore.summary.node.swapTotalBytes))">
                {{ pct(proxmoxStore.summary.node.swapUsedBytes, proxmoxStore.summary.node.swapTotalBytes) }}%
              </div>
              <div class="text-[11px] text-slate-500">SWAP</div>
            </div>
          </div>
          <div class="w-full bg-slate-100 rounded-full h-1.5 mt-2 mb-2">
            <div
              class="h-1.5 rounded-full transition-all"
              :class="barClass(pct(proxmoxStore.summary.node.swapUsedBytes, proxmoxStore.summary.node.swapTotalBytes))"
              :style="{ width: `${pct(proxmoxStore.summary.node.swapUsedBytes, proxmoxStore.summary.node.swapTotalBytes)}%` }"
            ></div>
          </div>
          <div class="text-[11px] text-slate-500">{{ formatBytes(proxmoxStore.summary.node.swapUsedBytes) }} de {{ formatBytes(proxmoxStore.summary.node.swapTotalBytes) }}</div>
        </div>
      </div>

      <!-- Graficas (historial real de la ultima hora) -->
      <div v-if="rrdCategories.length" class="grid gap-4 mb-8" style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr))">
        <div class="surface p-4 rounded-2xl">
          <h3 class="text-sm font-semibold mb-2">CPU y retardo I/O — última hora</h3>
          <VueApexCharts type="area" height="220" :options="cpuChartOptions" :series="cpuChartSeries" />
        </div>
        <div class="surface p-4 rounded-2xl">
          <h3 class="text-sm font-semibold mb-2">Memoria RAM — última hora</h3>
          <VueApexCharts type="area" height="220" :options="ramChartOptions" :series="ramChartSeries" />
        </div>
      </div>

      <!-- Tarjetas de VMs/LXC -->
      <h2 class="text-lg font-semibold mb-3">Máquinas virtuales y contenedores</h2>
      <p v-if="!proxmoxStore.summary.node.online" class="text-sm text-slate-500 mb-4">
        El nodo no responde — no se puede traer el listado de VMs por ahora.
      </p>
      <p v-else-if="!proxmoxStore.summary.vms.length" class="text-sm text-slate-500 mb-4">Sin VMs ni contenedores en este nodo.</p>
      <div class="grid gap-4" style="grid-template-columns: repeat(auto-fit, minmax(260px, 1fr))">
        <div v-for="vm in proxmoxStore.summary.vms" :key="`${vm.type}-${vm.vmid}`" class="surface p-4 rounded-2xl">
          <div class="flex items-start justify-between gap-2 mb-2">
            <div>
              <div class="font-semibold">{{ vm.name }}</div>
              <div class="text-xs text-slate-500 font-mono">{{ vm.type === 'lxc' ? 'LXC' : 'VM' }} #{{ vm.vmid }}</div>
            </div>
            <span class="badge" :class="STATUS_CLASS[vm.status]">{{ STATUS_LABEL[vm.status] ?? vm.status }}</span>
          </div>

          <div class="space-y-2 text-xs mb-3">
            <div>
              <div class="flex justify-between text-slate-500 mb-0.5"><span>CPU</span><span>{{ vm.cpuPercent ?? '—' }}%</span></div>
              <div class="w-full bg-slate-100 rounded-full h-1.5">
                <div class="h-1.5 rounded-full" :class="barClass(vm.cpuPercent ?? 0)" :style="{ width: `${vm.cpuPercent ?? 0}%` }"></div>
              </div>
            </div>
            <div>
              <div class="flex justify-between text-slate-500 mb-0.5">
                <span>{{ vm.memSource === 'balloon' ? 'RAM en uso (real)' : 'RAM asignada' }}</span>
                <span>{{ formatBytes(vm.memUsedBytes) }} / {{ formatBytes(vm.memTotalBytes) }}</span>
              </div>
              <div class="w-full bg-slate-100 rounded-full h-1.5">
                <!-- Sin el driver de balloon reportando, este numero es solo lo
                     que el hypervisor tiene RESERVADO, no necesariamente lo que
                     la VM usa de verdad — por eso va en azul/violeta neutro en
                     vez de la escala verde/amarillo/rojo (que implicaria "esto
                     esta a punto de quedarse sin memoria", cosa que no se puede
                     afirmar sin el dato real). -->
                <div
                  class="h-1.5 rounded-full"
                  :class="vm.memSource === 'balloon' ? barClass(pct(vm.memUsedBytes, vm.memTotalBytes)) : 'bg-violet-400'"
                  :style="{ width: `${pct(vm.memUsedBytes, vm.memTotalBytes)}%` }"
                ></div>
              </div>
              <p v-if="vm.memSource === 'hypervisor'" class="text-[10px] text-slate-400 mt-0.5">
                Guest Agent/Balloon no detectado — mostrando RAM asignada por Proxmox, no el uso real dentro de la VM.
              </p>
            </div>
            <div class="flex justify-between text-slate-500">
              <span>Red (acumulado)</span><span>↓{{ formatBytes(vm.netInBytes) }} / ↑{{ formatBytes(vm.netOutBytes) }}</span>
            </div>
            <div class="flex justify-between text-slate-500"><span>Encendida hace</span><span>{{ formatUptime(vm.uptimeSeconds) }}</span></div>
          </div>

          <p v-if="looksLikeSelf(vm)" class="text-[11px] text-amber-600 mb-2">
            ⚠ Por el nombre, esta podría ser la VM del propio panel — si la apagas, perderías acceso a SmartRayco hasta encenderla de nuevo desde Proxmox directamente.
          </p>

          <div class="flex flex-wrap gap-2">
            <button class="btn-secondary text-xs" :disabled="vm.status === 'running'" @click="askAction(vm, 'start')">Iniciar</button>
            <button class="btn-secondary text-xs" :disabled="vm.status !== 'running'" @click="askAction(vm, 'reboot')">Reiniciar</button>
            <button class="btn-secondary text-xs text-red-600" :disabled="vm.status !== 'running'" @click="askAction(vm, 'shutdown')">Apagar</button>
            <a :href="consoleUrl(vm)" target="_blank" rel="noopener" class="btn-ghost text-xs ml-auto">Abrir consola ↗</a>
          </div>
        </div>
      </div>
    </template>
    <p v-else-if="!loadError" class="text-slate-500 text-sm">Consultando Proxmox...</p>

    <ConfirmModal
      :open="!!pendingAction"
      :title="pendingAction ? `${ACTION_LABEL[pendingAction.action]} ${pendingAction.vm.name}` : ''"
      :message="pendingAction ? `¿${ACTION_LABEL[pendingAction.action]} ${pendingAction.vm.type === 'lxc' ? 'el contenedor' : 'la VM'} ${pendingAction.vm.name} (#${pendingAction.vm.vmid})?` + (pendingAction.action !== 'start' && looksLikeSelf(pendingAction.vm) ? ' Podría ser la VM del propio panel.' : '')
        : ''"
      :danger="pendingAction?.action === 'shutdown'"
      :confirm-label="pendingAction ? ACTION_LABEL[pendingAction.action] : 'Confirmar'"
      :loading="running"
      @confirm="confirmAction"
      @cancel="pendingAction = null"
    />
    <p v-if="actionError" class="fixed bottom-4 right-4 z-[70] bg-red-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg">{{ actionError }}</p>
  </AppLayout>
</template>
