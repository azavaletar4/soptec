<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useTicketsStore } from '@/stores/tickets';
import { useInstallationsStore } from '@/stores/installations';
import { useRoutinesStore } from '@/stores/routines';
import { useCatalogsStore } from '@/stores/catalogs';
import { useAuthStore } from '@/stores/auth';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import { getErrorMessage } from '@/lib/errors';
import { formatElapsedTime } from '@/lib/elapsedTime';
import { TURNOS, todayStr } from '@/lib/turnos';
import type { JobType, StaffProfile } from '@/types/domain';

// Fase 101-B: tablero de despacho tipo "Cronograma de Campo" (TOA-like) —
// cruza los 3 tipos de orden (averias/altas/rutinas) por tecnico y hora,
// con agendamiento de hora exacta (scheduled_start_at/scheduled_end_at,
// agregados ya en la migracion de Fase A). Vista ALTERNATIVA a las tablas
// de Averias/Altas/Rutinas (selector de vista, punto 4 del pedido), no un
// 4to tipo de orden — por eso vive aparte de "Operaciones de Hoy" (Fase 107).

const router = useRouter();
const ticketsStore = useTicketsStore();
const installationsStore = useInstallationsStore();
const routinesStore = useRoutinesStore();
const catalogsStore = useCatalogsStore();
const auth = useAuthStore();
const { confirmDialog } = useConfirm();
const toast = useToast();

// Click & Create (Fase 104): crear tickets es exclusivo de SUPERADMIN/ADMIN
// (RLS tickets_insert_admin) — ocultar/deshabilitar el click para el resto
// evita una navegacion que de todos modos no abriria el modal en /soporte.
const canCreateTickets = computed(() => auth.role === 'SUPERADMIN' || auth.role === 'ADMIN');

const HOUR_START = 8;
const HOUR_END = 18;
const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
const DAY_MINUTES = (HOUR_END - HOUR_START) * 60;

const TYPE_META: Record<JobType, { label: string; dot: string; bg: string; border: string }> = {
  ticket: { label: 'Avería', dot: 'bg-red-500', bg: 'bg-red-500/15', border: 'border-red-400' },
  installation: { label: 'Alta', dot: 'bg-green-500', bg: 'bg-green-500/15', border: 'border-green-400' },
  routine: { label: 'Rutina', dot: 'bg-amber-500', bg: 'bg-amber-500/15', border: 'border-amber-400' },
};

interface BoardItem {
  id: string;
  jobType: JobType;
  label: string;
  status: string;
  inProgress: boolean;
  assignedTo: string | null;
  updatedAt: string;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  fallbackDate: string;
}

const items = computed<BoardItem[]>(() => {
  const tickets = ticketsStore.tickets.map<BoardItem>((t) => ({
    id: t.id,
    jobType: 'ticket',
    label: t.clients ? `${t.clients.first_name} ${t.clients.last_name}` : t.title,
    status: t.status,
    inProgress: t.status === 'in_progress',
    assignedTo: t.assigned_to,
    updatedAt: t.updated_at,
    scheduledStartAt: t.scheduled_start_at,
    scheduledEndAt: t.scheduled_end_at,
    fallbackDate: t.created_at.slice(0, 10),
  }));
  const installations = installationsStore.installations
    .filter((i) => i.status !== 'cancelled')
    .map<BoardItem>((i) => ({
      id: i.id,
      jobType: 'installation',
      label: i.clients ? `${i.clients.first_name} ${i.clients.last_name}` : 'Instalación',
      status: i.status,
      inProgress: false,
      assignedTo: i.assigned_to,
      updatedAt: i.updated_at,
      scheduledStartAt: i.scheduled_start_at,
      scheduledEndAt: i.scheduled_end_at,
      fallbackDate: (i.scheduled_date ?? i.created_at).slice(0, 10),
    }));
  const routines = routinesStore.routines
    .filter((r) => r.status !== 'cancelled')
    .map<BoardItem>((r) => ({
      id: r.id,
      jobType: 'routine',
      label: r.title,
      status: r.status,
      inProgress: r.status === 'in_progress',
      assignedTo: r.assigned_to,
      updatedAt: r.updated_at,
      scheduledStartAt: r.scheduled_start_at,
      scheduledEndAt: r.scheduled_end_at,
      fallbackDate: (r.scheduled_date ?? r.created_at).slice(0, 10),
    }));
  return [...tickets, ...installations, ...routines];
});

// ---- Fecha seleccionada (un solo dia — el tablero es un cronograma diario, no un rango) ----
const selectedDate = ref(todayStr());

function shiftDate(days: number) {
  const d = new Date(`${selectedDate.value}T12:00:00`);
  d.setDate(d.getDate() + days);
  selectedDate.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function belongsToSelectedDate(item: BoardItem): boolean {
  if (item.scheduledStartAt) return item.scheduledStartAt.slice(0, 10) === selectedDate.value;
  return item.fallbackDate === selectedDate.value;
}

// Fase 106: 'resuelto'/'cerrado' (o 'completed' en altas/rutinas) es un
// estado final — una vez ahi, la orden no tiene nada mas que agendar.
function isFinalStatus(item: BoardItem): boolean {
  if (item.jobType === 'ticket') return item.status === 'resolved' || item.status === 'closed';
  return item.status === 'completed';
}

const dayItems = computed(() => items.value.filter(belongsToSelectedDate));
const scheduledItems = computed(() => dayItems.value.filter((i) => i.scheduledStartAt && i.scheduledEndAt));
// "Sin horario asignado" es para trabajo que TODAVIA no tiene su fila en la
// matriz (que es por tecnico): sin hora, o con hora pero sin tecnico (se
// puede crear un ticket con turno reservado y el tecnico "Sin asignar" para
// despues, ver OperacionesHoyView handleSubmit) — en ambos casos no cae en
// ninguna fila y se perderia de vista si no quedara listado aca. Una orden
// ya resuelta/cerrada sin haber tenido hora no tiene sentido seguir
// pidiendo que se agende, asi que se excluye (Fase 106).
const unscheduledItems = computed(() =>
  dayItems.value.filter((i) => !(i.scheduledStartAt && i.scheduledEndAt && i.assignedTo) && !isFinalStatus(i)),
);

const technicians = computed(() => catalogsStore.staff.filter((s) => s.role === 'TECNICO_RED'));

// Fase 131 — antes todos los bloques de un tecnico se pintaban con la misma
// position:absolute top/bottom, asi que si dos se cruzaban en hora quedaban
// literalmente encima uno del otro (texto ilegible). Reparte los bloques en
// "carriles" (mismo algoritmo que un calendario tipo Google/Outlook):
// mientras no se cruce con el ultimo del carril, entra ahi; si no, abre un
// carril nuevo. El layout horizontal (hora) sigue siendo blockStyle() tal
// cual — esto solo decide en que carril (fila vertical dentro de la celda
// del tecnico) va cada bloque.
interface TechLayout {
  laneItems: BoardItem[][];
  conflictCount: number;
}

function computeTechLayout(techId: string): TechLayout {
  const list = itemsForTechnician(techId)
    .map((item) => ({
      item,
      startMs: new Date(item.scheduledStartAt!).getTime(),
      endMs: new Date(item.scheduledEndAt!).getTime(),
    }))
    .sort((a, b) => a.startMs - b.startMs);

  const laneEndMs: number[] = [];
  const laneItems: BoardItem[][] = [];
  for (const entry of list) {
    let laneIdx = laneEndMs.findIndex((end) => end <= entry.startMs);
    if (laneIdx === -1) {
      laneIdx = laneEndMs.length;
      laneEndMs.push(entry.endMs);
      laneItems.push([]);
    } else {
      laneEndMs[laneIdx] = entry.endMs;
    }
    laneItems[laneIdx].push(entry.item);
  }

  let conflictCount = 0;
  for (let a = 0; a < list.length; a++) {
    const hasOverlap = list.some((b, bi) => bi !== a && list[a].startMs < b.endMs && b.startMs < list[a].endMs);
    if (hasOverlap) conflictCount++;
  }

  return { laneItems: laneItems.length ? laneItems : [[]], conflictCount };
}

const techLayouts = computed(() => {
  const map = new Map<string, TechLayout>();
  for (const tech of technicians.value) map.set(tech.id, computeTechLayout(tech.id));
  return map;
});

// Switch "Ocultar Resueltos" (Fase 106) — deja visible solo la carga de
// trabajo pendiente del dia en la matriz; "Sin horario asignado" ya excluye
// finalizados siempre, sin importar este switch.
const hideResolved = ref(false);

function itemsForTechnician(techId: string) {
  return scheduledItems.value.filter((i) => i.assignedTo === techId && (!hideResolved.value || !isFinalStatus(i)));
}

// Posicion/ancho del bloque dentro de la franja 08:00-18:00, en %.
function blockStyle(item: BoardItem) {
  const start = new Date(item.scheduledStartAt!);
  const end = new Date(item.scheduledEndAt!);
  const startMin = Math.max(0, (start.getHours() - HOUR_START) * 60 + start.getMinutes());
  const endMin = Math.min(DAY_MINUTES, (end.getHours() - HOUR_START) * 60 + end.getMinutes());
  const left = (startMin / DAY_MINUTES) * 100;
  const width = Math.max(2, ((endMin - startMin) / DAY_MINUTES) * 100);
  return { left: `${left}%`, width: `${width}%` };
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
}

// Click & Create (Fase 104): click en una casilla VACIA del tablero (no en
// un bloque existente, esos ya tienen su propio @click) abre "Nuevo
// ticket" en /soporte con fecha/turno/tecnico pre-cargados segun donde se
// hizo click en la fila de ese tecnico.
function handleCellClick(e: MouseEvent, tech: StaffProfile) {
  if (!canCreateTickets.value) return;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  const hour = HOUR_START + frac * (HOUR_END - HOUR_START);
  const turno = TURNOS.find((t) => hour >= Number(t.start.split(':')[0]) && hour < Number(t.end.split(':')[0])) ?? TURNOS[0];
  router.push({
    path: '/soporte',
    query: { schedule_date: selectedDate.value, schedule_turno: turno.value, tech_id: tech.id },
  });
}

// Reloj compartido para el cronometro "en progreso" (mismo patron que OperacionesHoyView.vue).
const now = ref(Date.now());
let clockTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  clockTimer = setInterval(() => (now.value = Date.now()), 1000);
});
onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer);
});

onMounted(async () => {
  await Promise.all([
    ticketsStore.fetchTickets(),
    installationsStore.fetchInstallations(),
    routinesStore.fetchRoutines(),
    catalogsStore.fetchStaff(),
  ]);
});

function goToDetail(item: BoardItem) {
  if (item.jobType === 'ticket') router.push(`/soporte/${item.id}`);
}

// ---- Agendar hora exacta (el nucleo de la Fase B) ----
// Una sola clave compuesta (jobType:id) en vez de solo id — el tablero
// mezcla 3 tablas distintas y un UUID podria coincidir entre ellas.
function itemKey(item: BoardItem) {
  return `${item.jobType}:${item.id}`;
}
const schedulingKey = ref<string | null>(null);
const schedulingItem = computed(() => dayItems.value.find((i) => itemKey(i) === schedulingKey.value) ?? null);
const scheduleStart = ref('09:00');
const scheduleEnd = ref('10:00');
const scheduleError = ref<string | null>(null);
const saving = ref(false);

function openSchedule(item: BoardItem) {
  schedulingKey.value = itemKey(item);
  scheduleStart.value = item.scheduledStartAt ? timeLabel(item.scheduledStartAt) : '09:00';
  scheduleEnd.value = item.scheduledEndAt ? timeLabel(item.scheduledEndAt) : '10:00';
  scheduleError.value = null;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

async function confirmSchedule(item: BoardItem) {
  if (!item.assignedTo) {
    scheduleError.value = 'Este trabajo todavía no tiene técnico asignado — asígnalo primero desde su pestaña.';
    return;
  }
  if (!scheduleStart.value || !scheduleEnd.value) {
    scheduleError.value = 'Completa la hora de inicio y fin.';
    return;
  }
  const startIso = `${selectedDate.value}T${scheduleStart.value}:00`;
  const endIso = `${selectedDate.value}T${scheduleEnd.value}:00`;
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (endMs <= startMs) {
    scheduleError.value = 'La hora de fin debe ser después de la hora de inicio.';
    return;
  }

  // Choque de horario: mismo tecnico, mismo dia, otro trabajo ya agendado que se cruza.
  const clash = scheduledItems.value.find(
    (i) =>
      itemKey(i) !== itemKey(item) &&
      i.assignedTo === item.assignedTo &&
      overlaps(startMs, endMs, new Date(i.scheduledStartAt!).getTime(), new Date(i.scheduledEndAt!).getTime()),
  );
  if (clash) {
    const ok = await confirmDialog({
      title: 'Choque de horario',
      message: `Este técnico ya tiene "${clash.label}" (${TYPE_META[clash.jobType].label}) agendado en un horario que se cruza. ¿Agendar de todas formas?`,
      confirmLabel: 'Agendar igual',
      cancelLabel: 'Cancelar',
    });
    if (!ok) return;
  }

  saving.value = true;
  scheduleError.value = null;
  try {
    const payload = { scheduled_start_at: startIso, scheduled_end_at: endIso };
    if (item.jobType === 'ticket') await ticketsStore.updateTicket(item.id, payload);
    else if (item.jobType === 'installation') await installationsStore.updateInstallation(item.id, payload);
    else await routinesStore.updateRoutine(item.id, payload);
    toast.success('Horario agendado');
    schedulingKey.value = null;
  } catch (e) {
    scheduleError.value = getErrorMessage(e, 'Error al agendar el horario');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <h1 class="text-2xl font-semibold">Cronograma de Campo</h1>
        <p class="text-slate-600 text-sm mt-1">Despacho por técnico y hora — Averías, Altas y Rutinas</p>
      </div>
      <button class="btn-ghost" @click="router.push('/soporte')">📋 Vista tabla</button>
    </div>

    <div class="surface flex flex-wrap items-center gap-3 p-3 mb-4">
      <div class="flex items-center gap-2">
        <button class="btn-secondary text-xs px-2.5 py-1.5" @click="shiftDate(-1)">← Anterior</button>
        <input v-model="selectedDate" type="date" class="field-input text-sm py-1.5" />
        <button class="btn-secondary text-xs px-2.5 py-1.5" @click="selectedDate = todayStr()">Hoy</button>
        <button class="btn-secondary text-xs px-2.5 py-1.5" @click="shiftDate(1)">Siguiente →</button>
      </div>
      <label class="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
        <input v-model="hideResolved" type="checkbox" class="rounded border-slate-300" />
        Ocultar Resueltos
      </label>
      <div class="flex items-center gap-3 text-xs text-slate-600 ml-auto">
        <span v-for="(meta, type) in TYPE_META" :key="type" class="inline-flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-full" :class="meta.dot"></span>{{ meta.label }}
        </span>
      </div>
    </div>

    <!-- Tablero: filas = tecnicos, columnas = horas 08:00-18:00 -->
    <div class="surface p-3 mb-4 overflow-x-auto">
      <div class="min-w-[820px]">
        <div class="flex border-b border-slate-200 pb-1.5 mb-1.5">
          <div class="w-36 shrink-0"></div>
          <div class="flex-1 grid" :style="{ gridTemplateColumns: `repeat(${HOURS.length - 1}, 1fr)` }">
            <div v-for="h in HOURS.slice(0, -1)" :key="h" class="text-[11px] text-slate-400 text-center">
              {{ String(h).padStart(2, '0') }}:00
            </div>
          </div>
        </div>

        <p v-if="!technicians.length" class="text-center text-sm text-slate-500 py-6">No hay técnicos registrados.</p>

        <div v-for="tech in technicians" :key="tech.id" class="flex items-stretch py-1.5 border-b border-slate-100 last:border-0">
          <div class="w-36 shrink-0 flex flex-col justify-center pr-2">
            <span class="text-xs font-medium text-slate-700 truncate">{{ tech.full_name || tech.email }}</span>
            <span v-if="techLayouts.get(tech.id)?.conflictCount" class="text-[10px] font-semibold text-red-600 mt-0.5">
              ⚠️ {{ techLayouts.get(tech.id)?.conflictCount }}
              {{ techLayouts.get(tech.id)?.conflictCount === 1 ? 'evento' : 'eventos' }} a la misma hora
            </span>
          </div>
          <div
            class="relative flex-1 bg-slate-50 rounded-md"
            :class="[
              canCreateTickets ? 'cursor-pointer hover:bg-sky-50' : '',
              techLayouts.get(tech.id)?.conflictCount ? 'border-l-[3px] border-red-500' : '',
            ]"
            :title="canCreateTickets ? 'Click para crear un ticket en este horario' : undefined"
            @click="handleCellClick($event, tech)"
          >
            <!-- lineas guia por hora -->
            <div class="absolute inset-0 grid pointer-events-none" :style="{ gridTemplateColumns: `repeat(${HOURS.length - 1}, 1fr)` }">
              <div v-for="h in HOURS.slice(0, -1)" :key="h" class="border-l border-slate-200 first:border-l-0"></div>
            </div>
            <!-- carriles: cada carril es una franja horizontal propia, asi dos
                 bloques que se cruzan en hora caen en carriles distintos en
                 vez de superponerse. Mas de 3 carriles: la celda crece hasta
                 un tope y de ahi scrollea en vez de aplastar la fila de los
                 demas tecnicos. -->
            <div
              class="relative flex flex-col gap-0.5 py-0.5"
              :class="(techLayouts.get(tech.id)?.laneItems.length ?? 1) > 3 ? 'max-h-[150px] overflow-y-auto' : ''"
            >
              <div v-for="(lane, laneIdx) in techLayouts.get(tech.id)?.laneItems ?? [[]]" :key="laneIdx" class="relative h-9 shrink-0">
                <div
                  v-for="item in lane"
                  :key="itemKey(item)"
                  class="absolute top-0.5 bottom-0.5 rounded-md border px-1.5 py-0.5 text-[10px] font-medium truncate cursor-pointer transition-transform hover:z-10 hover:scale-[1.03]"
                  :class="[TYPE_META[item.jobType].bg, TYPE_META[item.jobType].border]"
                  :style="blockStyle(item)"
                  :title="`${TYPE_META[item.jobType].label}: ${item.label} (${timeLabel(item.scheduledStartAt!)}–${timeLabel(item.scheduledEndAt!)})`"
                  @click.stop="item.jobType === 'ticket' ? goToDetail(item) : openSchedule(item)"
                >
                  {{ item.label }}
                  <template v-if="item.inProgress"> · ⏱️ {{ formatElapsedTime(item.updatedAt, now) }}</template>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Panel de agendamiento — compartido entre un click en el tablero
         (reagendar algo ya agendado) y el boton "Agendar" de la lista de
         abajo (todavia sin horario). -->
    <div v-if="schedulingItem" class="surface p-3.5 mb-4 border-2 border-sky-300">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-sm font-semibold">
          🕐 Agendar — <span class="font-normal">{{ schedulingItem.label }}</span>
          <span class="badge text-[10px] ml-1" :class="TYPE_META[schedulingItem.jobType].bg">{{ TYPE_META[schedulingItem.jobType].label }}</span>
        </h2>
        <button type="button" class="text-xs text-slate-400 hover:text-slate-600" @click="schedulingKey = null">✕</button>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <input v-model="scheduleStart" type="time" class="field-input text-sm py-1.5 w-28" />
        <span class="text-slate-400 text-xs">a</span>
        <input v-model="scheduleEnd" type="time" class="field-input text-sm py-1.5 w-28" />
        <button type="button" class="btn-primary text-xs px-3 py-1.5" :disabled="saving" @click="confirmSchedule(schedulingItem)">
          {{ saving ? 'Guardando...' : 'Confirmar' }}
        </button>
        <button type="button" class="btn-ghost text-xs px-2 py-1.5" @click="schedulingKey = null">Cancelar</button>
      </div>
      <p v-if="scheduleError" class="text-xs text-red-600 mt-2">{{ scheduleError }}</p>
    </div>

    <!-- Sin horario asignado -->
    <div class="surface p-3.5">
      <h2 class="text-sm font-semibold mb-2">Sin horario asignado ({{ unscheduledItems.length }})</h2>
      <p v-if="!unscheduledItems.length" class="text-xs text-slate-400">Todo lo de este día ya tiene horario.</p>
      <ul v-else class="space-y-2">
        <li v-for="item in unscheduledItems" :key="itemKey(item)" class="rounded-lg border border-slate-200 p-2.5">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <span class="h-2 w-2 rounded-full shrink-0" :class="TYPE_META[item.jobType].dot"></span>
              <span class="text-sm text-slate-800 truncate">{{ item.label }}</span>
              <span class="text-xs text-slate-400 shrink-0">
                {{ technicians.find((t) => t.id === item.assignedTo)?.full_name || (item.assignedTo ? 'Técnico' : 'Sin asignar') }}
              </span>
            </div>
            <button type="button" class="btn-secondary text-xs px-2.5 py-1.5 shrink-0" @click="openSchedule(item)">
              🕐 Agendar
            </button>
          </div>
        </li>
      </ul>
    </div>
  </AppLayout>
</template>
