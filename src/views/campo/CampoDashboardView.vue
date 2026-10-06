<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import CampoLayout from '@/components/campo/CampoLayout.vue';
import AsistenciaPanel from '@/components/asistencia/AsistenciaPanel.vue';
import { useCampoStore, type TrabajoEstadoUi, type TrabajoItem } from '@/stores/campo';
import { useAuthStore } from '@/stores/auth';
import { useTicketsStore } from '@/stores/tickets';
import { useInstallationsStore } from '@/stores/installations';
import { useRoutinesStore } from '@/stores/routines';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import { getErrorMessage } from '@/lib/errors';
import { telLink, waLink } from '@/lib/phone';
import type { Installation, Routine, Ticket } from '@/types/domain';

const router = useRouter();
const campoStore = useCampoStore();
const auth = useAuthStore();
const ticketsStore = useTicketsStore();
const installationsStore = useInstallationsStore();
const routinesStore = useRoutinesStore();
const { confirmDialog } = useConfirm();
const toast = useToast();

// 'disponible' (Fase 98) no es un estado de TrabajoEstadoUi — es una lista
// aparte (tickets 'open' sin tecnico, campoStore.availableTickets), solo
// visible para TECNICO_RED, para poder "tomar" una averia libre.
//
// Fase 107: "pendiente" y "en_proceso" se fusionan en una sola pestaña
// ("Mis Pendientes de Hoy") — misma idea que "Operaciones de Hoy" en
// escritorio, el tecnico no necesita separar "no iniciado" de "en curso"
// para saber que le falta atender. La salida automatica al resolver ya
// pasa sola: ticketEstado()/installationEstado()/routineEstado() (campo.ts)
// mapean resuelto/completado a 'completado', asi que filtered() lo saca
// solo de esta pestaña sin tocar ese codigo.
type TabValue = 'pendiente' | 'completado' | 'disponible';
const PENDIENTE_ESTADOS: TrabajoEstadoUi[] = ['pendiente', 'en_proceso'];
const tabs = computed<{ value: TabValue; label: string }[]>(() => {
  const base: { value: TabValue; label: string }[] = [
    { value: 'pendiente', label: '🙋 Mis Pendientes de Hoy' },
    { value: 'completado', label: '📁 Histórico de Atendidos' },
  ];
  if (auth.role === 'TECNICO_RED') base.push({ value: 'disponible', label: '🙋 Disponibles' });
  return base;
});
const activeTab = ref<TabValue>('pendiente');
const search = ref('');

// Cliente Ausente / re-agendamiento prioritario (Fase 102): un ticket
// reprogramado cuya fecha ya llego se va al Top 1 de "Pendientes", igual
// que en OperacionesHoyView.vue (vista de escritorio).
function isDueReschedule(t: TrabajoItem): boolean {
  if (t.jobType !== 'ticket') return false;
  const ticket = t.raw as Ticket;
  return ticket.status === 'rescheduled' && !!ticket.rescheduled_to && new Date(ticket.rescheduled_to).getTime() <= Date.now();
}

// Fase 118: "Disponibles" junta averias + altas + rutinas sin tecnico — antes
// solo traia averias (Fase 98), las otras 2 quedaban invisibles para todo
// tecnico hasta que despacho las asignara a mano.
const availableJobs = computed<TrabajoItem[]>(() => [
  ...campoStore.availableTickets,
  ...campoStore.availableInstallations,
  ...campoStore.availableRoutines,
]);

const filtered = computed(() => {
  let list: TrabajoItem[];
  if (activeTab.value === 'disponible') list = availableJobs.value;
  else if (activeTab.value === 'pendiente') list = campoStore.trabajos.filter((t) => PENDIENTE_ESTADOS.includes(t.estadoUi));
  else list = campoStore.trabajos.filter((t) => t.estadoUi === 'completado');
  const q = search.value.trim().toLowerCase();
  if (q) list = list.filter((t) => `${t.clienteNombre} ${t.direccion ?? ''}`.toLowerCase().includes(q));
  return [...list].sort((a, b) => Number(isDueReschedule(b)) - Number(isDueReschedule(a)));
});

const counts = computed(() => {
  const c: Record<TabValue, number> = {
    pendiente: 0,
    completado: 0,
    disponible: availableJobs.value.length,
  };
  for (const t of campoStore.trabajos) {
    if (PENDIENTE_ESTADOS.includes(t.estadoUi)) c.pendiente++;
    else if (t.estadoUi === 'completado') c.completado++;
  }
  return c;
});

function openTrabajo(t: TrabajoItem) {
  router.push(`/campo/${t.jobType}/${t.id}`);
}

// Botón de acción primario de la tarjeta: "Iniciar Orden" solo aplica a un
// trabajo YA asignado al técnico (no a "Disponibles", donde primero hay que
// "Tomar" la orden desde el detalle, Fase 98) y todavía no en curso —
// ticket 'open'/'rescheduled' (Cliente Ausente, Fase 102, ya llegó la fecha)
// o instalación 'pending'/'scheduled'. Dispara la misma transición que el
// botón "Iniciar orden" del escritorio (OperacionesHoyView.vue):
// status='in_progress' — para instalaciones, ese valor no existia en el enum
// hasta la Fase 126 (antes solo pending/scheduled/completed/cancelled), asi
// que una Alta no tenia forma de marcarse "en curso" como un ticket. Para
// tickets, ademas hace que TechnicianStatusBar.vue (barra de "Técnicos
// Activos") lo muestre como "En atención" vía la suscripción Realtime de
// tickets.ts. Rutinas ya traian 'in_progress' en su enum desde la Fase 101
// (mantenimiento/peinado NAP), solo le faltaba el boton.
const startingId = ref<string | null>(null);
function canStart(t: TrabajoItem): boolean {
  if (activeTab.value === 'disponible') return false;
  if (t.jobType === 'ticket') {
    const status = (t.raw as Ticket).status;
    return status === 'open' || status === 'rescheduled';
  }
  if (t.jobType === 'installation') {
    const status = (t.raw as Installation).status;
    return status === 'pending' || status === 'scheduled';
  }
  if (t.jobType === 'routine') {
    const status = (t.raw as Routine).status;
    return status === 'pending' || status === 'scheduled';
  }
  return false;
}
function isInProgress(t: TrabajoItem): boolean {
  if (activeTab.value === 'disponible') return false;
  if (t.jobType === 'ticket') return (t.raw as Ticket).status === 'in_progress';
  if (t.jobType === 'installation') return (t.raw as Installation).status === 'in_progress';
  if (t.jobType === 'routine') return (t.raw as Routine).status === 'in_progress';
  return false;
}

async function startJob(t: TrabajoItem): Promise<boolean> {
  startingId.value = t.id;
  try {
    if (t.jobType === 'ticket') await ticketsStore.updateTicketStatus(t.id, 'in_progress');
    else if (t.jobType === 'installation') await installationsStore.updateStatus(t.id, 'in_progress');
    else if (t.jobType === 'routine') await routinesStore.updateStatus(t.id, 'in_progress');
    return true;
  } catch (e) {
    toast.error(getErrorMessage(e, 'No se pudo iniciar la orden'));
    return false;
  } finally {
    startingId.value = null;
  }
}

async function handleStartClick(t: TrabajoItem) {
  if (await startJob(t)) openTrabajo(t);
}

async function handleCardClick(t: TrabajoItem) {
  if (canStart(t)) {
    const ok = await confirmDialog({
      title: 'Iniciar atención',
      message: '¿Deseas iniciar la atención de esta orden?',
      confirmLabel: 'Sí, iniciar',
      cancelLabel: 'Cancelar',
    });
    if (ok) {
      if (await startJob(t)) openTrabajo(t);
      return;
    }
  }
  openTrabajo(t);
}

function formatFecha(value: string | null) {
  if (!value) return '—';
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
}

onMounted(() => {
  campoStore.fetchAll();
});
</script>

<template>
  <CampoLayout title="Mis trabajos">
    <AsistenciaPanel class="mb-3" />
    <input v-model="search" placeholder="Buscar cliente o dirección..." class="field-input mb-3" />

    <div class="grid gap-2 mb-3" :class="tabs.length > 2 ? 'grid-cols-3' : 'grid-cols-2'">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        class="rounded-xl py-2.5 text-xs font-semibold text-center transition-colors"
        :class="activeTab === tab.value ? 'bg-sky-500 text-slate-950' : 'bg-white border border-slate-200 text-slate-600'"
        @click="activeTab = tab.value"
      >
        {{ tab.label }}
        <span class="block text-[15px] font-bold mt-0.5">{{ counts[tab.value] }}</span>
      </button>
    </div>

    <p v-if="campoStore.loading" class="text-center text-sm text-slate-500 py-8">Cargando...</p>
    <p v-else-if="!filtered.length" class="text-center text-sm text-slate-500 py-8">No hay trabajos en este filtro.</p>

    <ul class="space-y-2.5">
      <li
        v-for="t in filtered"
        :key="`${t.jobType}-${t.id}`"
        class="surface p-3.5 active:scale-[0.99] transition-transform"
        :class="isDueReschedule(t) ? 'ring-2 ring-red-500' : ''"
        @click="handleCardClick(t)"
      >
        <p v-if="isDueReschedule(t)" class="text-[11px] font-bold text-red-600 mb-1.5">🔴 REPROGRAMADO - ATENDER PRIMERO</p>
        <div class="flex items-start justify-between gap-2 mb-1.5">
          <div class="flex items-center gap-1.5">
            <span
              class="badge text-[10px]"
              :class="{
                'bg-green-500/15 text-green-700': t.jobType === 'installation',
                'bg-red-500/15 text-red-700': t.jobType === 'ticket',
                'bg-amber-500/15 text-amber-700': t.jobType === 'routine',
              }"
            >
              {{ t.jobType === 'installation' ? '🟢 Alta' : t.jobType === 'routine' ? '🟡 Rutina' : '🔴 Avería' }}
            </span>
            <span v-if="activeTab === 'disponible'" class="badge text-[10px] bg-amber-500/15 text-amber-700">🙋 Libre</span>
          </div>
          <span class="text-[11px] text-slate-500">{{ formatFecha(t.fecha) }}</span>
        </div>
        <p class="font-semibold text-sm text-slate-900">{{ t.clienteNombre }}</p>
        <p v-if="t.direccion" class="text-xs text-slate-500 mt-0.5">{{ t.direccion }}</p>

        <div v-if="canStart(t) || isInProgress(t)" class="mt-3" @click.stop>
          <button
            v-if="canStart(t)"
            class="w-full py-2.5 rounded-lg bg-sky-500 text-slate-950 text-xs font-bold"
            :disabled="startingId === t.id"
            @click="handleStartClick(t)"
          >
            {{ startingId === t.id ? 'Iniciando...' : '🚀 Iniciar Orden' }}
          </button>
          <button
            v-else
            class="w-full py-2.5 rounded-lg bg-amber-500/15 text-amber-700 text-xs font-bold"
            @click="openTrabajo(t)"
          >
            🛠️ En Atención · Abrir Formulario
          </button>
        </div>

        <div class="flex items-center gap-2 mt-3" @click.stop>
          <a
            v-if="t.telefono"
            :href="telLink(t.telefono)"
            class="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium"
          >
            📞 Llamar
          </a>
          <a
            v-if="t.telefono"
            :href="waLink(t.telefono)"
            target="_blank"
            rel="noopener"
            class="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-green-500/15 text-green-700 text-xs font-medium"
          >
            💬 WhatsApp
          </a>
        </div>
      </li>
    </ul>
  </CampoLayout>
</template>
