<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import DateRangeFilter, { type DateRange } from '@/components/soporte/DateRangeFilter.vue';
import { useTicketsStore } from '@/stores/tickets';
import { useInstallationsStore } from '@/stores/installations';
import { useRoutinesStore } from '@/stores/routines';
import { useUnifiedJobs, type UnifiedJob } from '@/composables/useUnifiedJobs';
import type { JobType, Ticket } from '@/types/domain';

// Fase 107: todo lo resuelto/cerrado/completado vive aca aparte — asi
// "Operaciones de Hoy" solo tiene que mostrar lo que de verdad hace falta
// atender hoy, sin que el historico la vaya llenando con el tiempo.

const router = useRouter();
const ticketsStore = useTicketsStore();
const installationsStore = useInstallationsStore();
const routinesStore = useRoutinesStore();
const { finishedJobs } = useUnifiedJobs();

const TYPE_META: Record<JobType, { label: string; badge: string }> = {
  ticket: { label: '🔴 Avería', badge: 'bg-red-500/15 text-red-700' },
  installation: { label: '🟢 Alta', badge: 'bg-green-500/15 text-green-700' },
  routine: { label: '🟡 Rutina', badge: 'bg-amber-500/15 text-amber-700' },
};
const TYPE_TABS: { value: JobType | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'ticket', label: '🔴 Averías' },
  { value: 'installation', label: '🟢 Altas' },
  { value: 'routine', label: '🟡 Rutinas' },
];

const typeFilter = ref<JobType | 'all'>('all');
const searchQuery = ref('');
const dateRange = ref<DateRange | null>(null);

const filteredJobs = computed(() => {
  let list = finishedJobs.value;
  if (typeFilter.value !== 'all') list = list.filter((j) => j.jobType === typeFilter.value);
  if (dateRange.value) {
    const { start, end } = dateRange.value;
    list = list.filter((j) => {
      const relevant = j.finishedAt ? new Date(j.finishedAt) : new Date(`${j.fallbackDate}T12:00:00`);
      const time = relevant.getTime();
      return time >= start.getTime() && time <= end.getTime();
    });
  }
  const q = searchQuery.value.trim().toLowerCase();
  if (q) list = list.filter((j) => `${j.label} ${j.number ?? ''}`.toLowerCase().includes(q));
  return [...list].sort((a, b) => {
    const aTime = a.finishedAt ? new Date(a.finishedAt).getTime() : new Date(a.createdAt).getTime();
    const bTime = b.finishedAt ? new Date(b.finishedAt).getTime() : new Date(b.createdAt).getTime();
    return bTime - aTime;
  });
});

onMounted(() => {
  Promise.all([ticketsStore.fetchTickets(), installationsStore.fetchInstallations(), routinesStore.fetchRoutines()]);
});

function goToJob(job: UnifiedJob) {
  if (job.jobType === 'ticket') router.push(`/soporte/${job.id}`);
  else if (job.jobType === 'installation') router.push(`/soporte/instalaciones?q=${encodeURIComponent(job.label)}`);
  else router.push(`/soporte/rutinas?q=${encodeURIComponent(job.label)}`);
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <h1 class="text-2xl font-semibold">📁 Histórico de Atendidos</h1>
        <p class="text-slate-600 text-sm mt-1">{{ filteredJobs.length }} órdenes resueltas / cerradas / completadas</p>
      </div>
      <button class="btn-ghost" @click="router.push('/soporte')">← Volver a Operaciones de Hoy</button>
    </div>

    <div class="surface flex flex-col gap-3 p-3 mb-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input v-model="searchQuery" placeholder="Buscar por cliente, título o número..." class="field-input sm:max-w-xs" />
        <div class="flex flex-wrap gap-2">
          <button
            v-for="tab in TYPE_TABS"
            :key="tab.value"
            class="px-3 py-1.5 rounded-lg text-xs font-medium"
            :class="typeFilter === tab.value ? 'bg-sky-500 text-slate-950' : 'bg-slate-100 text-slate-600 hover:text-slate-900'"
            @click="typeFilter = tab.value"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>
      <DateRangeFilter @change="dateRange = $event" />
    </div>

    <p v-if="!filteredJobs.length" class="text-center text-slate-500 py-6">No hay órdenes atendidas en este filtro.</p>

    <template v-else>
      <div class="flex flex-col gap-3 sm:hidden">
        <div v-for="job in filteredJobs" :key="`${job.jobType}-${job.id}`" class="surface p-3 cursor-pointer" @click="goToJob(job)">
          <div class="flex items-start justify-between gap-2 mb-1.5">
            <span class="font-mono text-xs text-slate-500">{{ job.number ?? '—' }}</span>
            <span class="badge text-[10px]" :class="TYPE_META[job.jobType].badge">{{ TYPE_META[job.jobType].label }}</span>
          </div>
          <div class="text-slate-900 font-medium mb-1">{{ job.label }}</div>
          <div class="text-xs text-slate-500">
            {{ job.status }} · atendido {{ formatDate(job.finishedAt) }} · {{ job.assignedName ?? 'Sin asignar' }}
          </div>
        </div>
      </div>

      <div class="table-shell hidden sm:block">
        <table class="w-full text-sm min-w-[700px]">
          <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
            <tr>
              <th class="text-left px-4 py-3">Orden</th>
              <th class="text-left px-4 py-3">Cliente</th>
              <th class="text-left px-4 py-3">Tipo</th>
              <th class="text-left px-4 py-3">Estado</th>
              <th class="text-left px-4 py-3">Asignado</th>
              <th class="text-left px-4 py-3">Atendido</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="job in filteredJobs"
              :key="`${job.jobType}-${job.id}`"
              class="border-t border-slate-200 hover:bg-slate-50 cursor-pointer"
              @click="goToJob(job)"
            >
              <td class="px-4 py-3">
                <div class="font-mono text-xs text-slate-500">{{ job.number ?? '—' }}</div>
                <div class="text-slate-900">{{ job.jobType === 'ticket' ? (job.raw as Ticket).title : job.label }}</div>
              </td>
              <td class="px-4 py-3 text-slate-600">{{ job.label }}</td>
              <td class="px-4 py-3"><span class="badge" :class="TYPE_META[job.jobType].badge">{{ TYPE_META[job.jobType].label }}</span></td>
              <td class="px-4 py-3"><span class="badge bg-slate-500/15 text-slate-600">{{ job.status }}</span></td>
              <td class="px-4 py-3 text-slate-600">{{ job.assignedName ?? 'Sin asignar' }}</td>
              <td class="px-4 py-3 text-slate-500 text-xs">{{ formatDate(job.finishedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </AppLayout>
</template>
