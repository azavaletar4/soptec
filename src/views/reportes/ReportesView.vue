<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useReportsStore, type ClientReport, type FinancialReport, type TicketReport } from '@/stores/reports';
import { getErrorMessage } from '@/lib/errors';
import type { TicketCategory, TicketPriority, TicketStatus } from '@/types/domain';

const reportsStore = useReportsStore();

const loading = ref(true);
const error = ref<string | null>(null);
const clientReport = ref<ClientReport | null>(null);
const financialReport = ref<FinancialReport | null>(null);
const ticketReport = ref<TicketReport | null>(null);

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
function startOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfYear() {
  const d = new Date();
  return new Date(d.getFullYear(), 0, 1);
}

const dateFrom = ref(isoDate(startOfMonth()));
const dateTo = ref(isoDate(new Date()));

const STATUS_LABEL: Record<TicketStatus, string> = { open: 'Abierto', in_progress: 'En progreso', resolved: 'Resuelto', closed: 'Cerrado' };
const STATUS_CLASS: Record<TicketStatus, string> = {
  open: 'bg-yellow-500/15 text-yellow-600',
  in_progress: 'bg-sky-500/15 text-sky-600',
  resolved: 'bg-green-500/15 text-green-600',
  closed: 'bg-slate-500/15 text-slate-600',
};
const CATEGORY_LABEL: Record<TicketCategory, string> = {
  no_service: 'Sin servicio',
  slow_speed: 'Lentitud',
  billing: 'Facturación',
  installation: 'Instalación',
  equipment: 'Equipo',
  reconnection_relocation: 'Reconexión / Traslado',
  other: 'Otro',
};
const PRIORITY_LABEL: Record<TicketPriority, string> = { low: 'Baja', medium: 'Media', high: 'Alta', urgent: 'Urgente' };
const PRIORITY_COLOR: Record<TicketPriority, string> = { low: '#64748b', medium: '#0ea5e9', high: '#f97316', urgent: '#ef4444' };
const CATEGORY_COLOR: Record<TicketCategory, string> = {
  no_service: '#ef4444',
  slow_speed: '#f97316',
  billing: '#8b5cf6',
  installation: '#0ea5e9',
  equipment: '#22c55e',
  reconnection_relocation: '#a855f7',
  other: '#64748b',
};

async function loadReports() {
  loading.value = true;
  error.value = null;
  const fromIso = `${dateFrom.value}T00:00:00`;
  const toIso = `${dateTo.value}T23:59:59`;
  try {
    const [clients, financial, tickets] = await Promise.all([
      reportsStore.fetchClientReport(fromIso, toIso),
      reportsStore.fetchFinancialReport(dateFrom.value, dateTo.value),
      reportsStore.fetchTicketReport(fromIso, toIso),
    ]);
    clientReport.value = clients;
    financialReport.value = financial;
    ticketReport.value = tickets;
  } catch (e) {
    error.value = getErrorMessage(e, 'Error al cargar los reportes');
  } finally {
    loading.value = false;
  }
}

function setPreset(preset: 'month' | '30d' | 'year') {
  const now = new Date();
  if (preset === 'month') dateFrom.value = isoDate(startOfMonth());
  else if (preset === '30d') dateFrom.value = isoDate(new Date(now.getTime() - 30 * 86_400_000));
  else dateFrom.value = isoDate(startOfYear());
  dateTo.value = isoDate(now);
  loadReports();
}

function money(n: number) {
  return `$${n.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function maxOf(record: Record<string, number>) {
  return Math.max(1, ...Object.values(record));
}

onMounted(loadReports);
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <h1 class="text-2xl font-semibold">Reportes y estadísticas</h1>
      <div class="flex flex-wrap items-end gap-2">
        <div>
          <label class="block text-xs text-slate-600 mb-1">Desde</label>
          <input v-model="dateFrom" type="date" class="field-input py-1.5 text-xs" />
        </div>
        <div>
          <label class="block text-xs text-slate-600 mb-1">Hasta</label>
          <input v-model="dateTo" type="date" class="field-input py-1.5 text-xs" />
        </div>
        <button class="btn-secondary text-xs" :disabled="loading" @click="loadReports">
          {{ loading ? 'Cargando...' : 'Aplicar' }}
        </button>
        <button class="btn-ghost text-xs" @click="setPreset('month')">Este mes</button>
        <button class="btn-ghost text-xs" @click="setPreset('30d')">Últimos 30 días</button>
        <button class="btn-ghost text-xs" @click="setPreset('year')">Este año</button>
      </div>
    </div>

    <p v-if="error" class="mb-4 text-sm text-red-600">{{ error }}</p>
    <p v-if="loading && !clientReport" class="text-slate-500 text-sm">Cargando reportes...</p>

    <template v-if="!loading || clientReport">
      <!-- ---- Clientes ---- -->
      <h2 class="text-lg font-semibold mb-3">Clientes</h2>
      <div class="grid gap-4 mb-3" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))">
        <div class="kpi-tile" style="background: #16a34a">
          <div>
            <div class="text-2xl font-bold text-white">{{ clientReport?.totalsByStatus.active ?? 0 }}</div>
            <div class="text-xs text-white/90 mt-1">Activos</div>
          </div>
        </div>
        <div class="kpi-tile" style="background: #ef4444">
          <div>
            <div class="text-2xl font-bold text-white">{{ clientReport?.totalsByStatus.suspended ?? 0 }}</div>
            <div class="text-xs text-white/90 mt-1">Suspendidos</div>
          </div>
        </div>
        <div class="kpi-tile" style="background: #f59e0b">
          <div>
            <div class="text-2xl font-bold text-white">{{ clientReport?.totalsByStatus.prospect ?? 0 }}</div>
            <div class="text-xs text-white/90 mt-1">Prospectos</div>
          </div>
        </div>
        <div class="kpi-tile" style="background: #64748b">
          <div>
            <div class="text-2xl font-bold text-white">{{ clientReport?.totalsByStatus.retired ?? 0 }}</div>
            <div class="text-xs text-white/90 mt-1">Retirados</div>
          </div>
        </div>
        <div class="kpi-tile" style="background: #2563eb">
          <div>
            <div class="text-2xl font-bold text-white">{{ clientReport?.newInPeriod ?? 0 }}</div>
            <div class="text-xs text-white/90 mt-1">Altas en el periodo</div>
          </div>
        </div>
      </div>

      <div v-if="clientReport?.byZone.length" class="rounded-xl border border-slate-200 bg-slate-100 p-4 mb-8">
        <div class="text-xs text-slate-500 mb-3">Clientes activos por zona</div>
        <div class="space-y-2">
          <div v-for="z in clientReport.byZone" :key="z.zoneName" class="flex items-center gap-3 text-xs">
            <span class="w-28 truncate text-slate-600">{{ z.zoneName }}</span>
            <div class="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden">
              <div
                class="h-full bg-sky-500"
                :style="{ width: `${(z.count / Math.max(1, clientReport.byZone[0].count)) * 100}%` }"
              ></div>
            </div>
            <span class="w-8 text-right">{{ z.count }}</span>
          </div>
        </div>
      </div>
      <div v-else class="mb-8"></div>

      <!-- ---- Financiero ---- -->
      <h2 class="text-lg font-semibold mb-3">Financiero</h2>
      <p class="text-xs text-slate-500 mb-3">Facturas con periodo de facturación dentro del rango seleccionado.</p>
      <div class="grid gap-4 mb-8" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))">
        <div class="kpi-tile" style="background: #2563eb">
          <div>
            <div class="text-2xl font-bold text-white">{{ money(financialReport?.invoiced ?? 0) }}</div>
            <div class="text-xs text-white/90 mt-1">Facturado ({{ financialReport?.invoiceCount ?? 0 }} facturas)</div>
          </div>
        </div>
        <div class="kpi-tile" style="background: #16a34a">
          <div>
            <div class="text-2xl font-bold text-white">{{ money(financialReport?.collected ?? 0) }}</div>
            <div class="text-xs text-white/90 mt-1">Cobrado</div>
          </div>
        </div>
        <div class="kpi-tile" style="background: #f59e0b">
          <div>
            <div class="text-2xl font-bold text-white">{{ money(financialReport?.pending ?? 0) }}</div>
            <div class="text-xs text-white/90 mt-1">Pendiente de cobro</div>
          </div>
        </div>
        <div class="kpi-tile" style="background: #ef4444">
          <div>
            <div class="text-2xl font-bold text-white">{{ money(financialReport?.overdue ?? 0) }}</div>
            <div class="text-xs text-white/90 mt-1">Vencido</div>
          </div>
        </div>
      </div>

      <!-- ---- Soporte ---- -->
      <h2 class="text-lg font-semibold mb-3">Soporte técnico</h2>
      <div class="grid gap-4 mb-4" style="grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))">
        <div v-for="(label, status) in STATUS_LABEL" :key="status" class="rounded-xl border border-slate-200 bg-slate-100 p-4">
          <div class="text-2xl font-bold">{{ ticketReport?.byStatus[status] ?? 0 }}</div>
          <span class="badge mt-1" :class="STATUS_CLASS[status]">{{ label }}</span>
        </div>
        <div class="rounded-xl border border-slate-200 bg-slate-100 p-4">
          <div class="text-2xl font-bold">
            {{ ticketReport?.avgResolutionHours != null ? ticketReport.avgResolutionHours.toFixed(1) + 'h' : '—' }}
          </div>
          <div class="text-xs text-slate-500 mt-1">Tiempo prom. de resolución</div>
        </div>
      </div>

      <div class="grid gap-4 mb-8" style="grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))">
        <div class="rounded-xl border border-slate-200 bg-slate-100 p-4">
          <div class="text-xs text-slate-500 mb-3">Por categoría</div>
          <div class="space-y-2">
            <div v-for="(label, cat) in CATEGORY_LABEL" :key="cat" class="flex items-center gap-3 text-xs">
              <span class="w-24 truncate text-slate-600">{{ label }}</span>
              <div class="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden">
                <div
                  class="h-full"
                  :style="{
                    width: `${((ticketReport?.byCategory[cat] ?? 0) / maxOf(ticketReport?.byCategory ?? {})) * 100}%`,
                    background: CATEGORY_COLOR[cat],
                  }"
                ></div>
              </div>
              <span class="w-6 text-right">{{ ticketReport?.byCategory[cat] ?? 0 }}</span>
            </div>
          </div>
        </div>

        <div class="rounded-xl border border-slate-200 bg-slate-100 p-4">
          <div class="text-xs text-slate-500 mb-3">Por prioridad</div>
          <div class="space-y-2">
            <div v-for="(label, pr) in PRIORITY_LABEL" :key="pr" class="flex items-center gap-3 text-xs">
              <span class="w-16 truncate text-slate-600">{{ label }}</span>
              <div class="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden">
                <div
                  class="h-full"
                  :style="{
                    width: `${((ticketReport?.byPriority[pr] ?? 0) / maxOf(ticketReport?.byPriority ?? {})) * 100}%`,
                    background: PRIORITY_COLOR[pr],
                  }"
                ></div>
              </div>
              <span class="w-6 text-right">{{ ticketReport?.byPriority[pr] ?? 0 }}</span>
            </div>
          </div>
        </div>
      </div>

      <h3 class="text-sm font-semibold mb-3">Ranking de técnicos (por puntos en el periodo)</h3>
      <div class="table-shell mb-6">
        <table class="w-full text-sm">
          <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
            <tr>
              <th class="text-left px-4 py-2">#</th>
              <th class="text-left px-4 py-2">Técnico</th>
              <th class="text-right px-4 py-2">Tickets</th>
              <th class="text-right px-4 py-2">Puntos</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!ticketReport?.technicianRanking.length">
              <td colspan="4" class="px-4 py-6 text-center text-slate-500">Sin tickets asignados en este periodo.</td>
            </tr>
            <tr v-for="(t, i) in ticketReport?.technicianRanking" :key="t.staffId" class="border-t border-slate-200">
              <td class="px-4 py-2 text-slate-500">{{ i + 1 }}</td>
              <td class="px-4 py-2">{{ t.name }}</td>
              <td class="px-4 py-2 text-right text-slate-600">{{ t.ticketCount }}</td>
              <td class="px-4 py-2 text-right font-semibold">{{ t.points }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </AppLayout>
</template>
