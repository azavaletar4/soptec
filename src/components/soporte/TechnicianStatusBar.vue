<script setup lang="ts">
import { computed } from 'vue';
import { formatElapsedTime } from '@/lib/elapsedTime';
import { waLink, telLink } from '@/lib/phone';
import type { StaffProfile, Ticket } from '@/types/domain';

// Panel estilo despacho de campo (TOA-like): una tarjeta por tecnico con su
// estado en vivo, derivado de SUS tickets asignados (no de los que esten
// filtrados/buscados en la tabla de abajo).
//
// "En camino" no es un estado real en la tabla tickets (no hay un paso de
// "aceptar" separado de "iniciar") — se aproxima como "tiene un ticket
// asignado que sigue 'abierto'" (ya se lo dieron, todavia no marco en
// progreso). Si tiene un 'en progreso', eso manda sobre cualquier 'abierto'.
const props = withDefaults(
  defineProps<{
    technicians: StaffProfile[];
    tickets: Ticket[];
    now: number;
    selectedTechId?: string | null;
    /** Minutos desde que entro "en progreso" a partir de los cuales se alerta demora (Fase 111). */
    slaThresholdMinutes?: number;
  }>(),
  { selectedTechId: null, slaThresholdMinutes: 60 },
);

const emit = defineEmits<{
  /** Click simple: filtra la tabla de abajo. ticketId viene null si el tecnico esta "disponible". */
  select: [techId: string, ticketId: string | null];
  /** Doble click sobre un tecnico con orden activa: ir directo al detalle. */
  openTicket: [ticketId: string];
}>();

type TechStatus = 'en_atencion' | 'en_camino' | 'disponible';

interface TechCard {
  id: string;
  name: string;
  phone: string | null;
  status: TechStatus;
  ticket: Ticket | null;
  elapsedMinutes: number | null;
  resolvedToday: number;
}

const STATUS_META: Record<TechStatus, { dot: string; label: string }> = {
  en_atencion: { dot: 'bg-green-500', label: 'En atención' },
  en_camino: { dot: 'bg-sky-500', label: 'En camino' },
  disponible: { dot: 'bg-slate-300', label: 'Disponible' },
};

function isToday(iso: string | null, nowMs: number): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date(nowMs);
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

const cards = computed<TechCard[]>(() =>
  props.technicians.map((tech) => {
    const name = tech.full_name || tech.email;
    const assigned = props.tickets.filter((t) => t.assigned_to === tech.id);
    const resolvedToday = assigned.filter(
      (t) => (t.status === 'resolved' || t.status === 'closed') && isToday(t.resolved_at ?? t.closed_at, props.now),
    ).length;
    const inProgress = assigned.find((t) => t.status === 'in_progress');
    if (inProgress) {
      const elapsedMinutes = Math.max(0, props.now - new Date(inProgress.updated_at).getTime()) / 60000;
      return { id: tech.id, name, phone: tech.phone, status: 'en_atencion', ticket: inProgress, elapsedMinutes, resolvedToday };
    }
    const open = assigned.find((t) => t.status === 'open');
    if (open) return { id: tech.id, name, phone: tech.phone, status: 'en_camino', ticket: open, elapsedMinutes: null, resolvedToday };
    return { id: tech.id, name, phone: tech.phone, status: 'disponible', ticket: null, elapsedMinutes: null, resolvedToday };
  }),
);

function timerClass(card: TechCard): string {
  if (card.elapsedMinutes == null) return 'text-slate-500';
  if (card.elapsedMinutes > props.slaThresholdMinutes * 2) return 'text-red-600 font-semibold';
  if (card.elapsedMinutes > props.slaThresholdMinutes) return 'text-orange-600 font-semibold';
  return 'text-slate-500';
}

function handleClick(card: TechCard) {
  emit('select', card.id, card.ticket?.id ?? null);
}

function handleDblClick(card: TechCard) {
  if (card.ticket) emit('openTicket', card.ticket.id);
}
</script>

<template>
  <div v-if="technicians.length" class="surface mb-4 p-3">
    <div class="text-sm font-medium text-slate-700 mb-2">👷 Técnicos activos</div>
    <div class="flex gap-2 overflow-x-auto pb-1">
      <button
        v-for="card in cards"
        :key="card.id"
        type="button"
        class="flex min-w-[170px] shrink-0 flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors"
        :class="
          card.id === selectedTechId
            ? 'border-sky-400 bg-sky-50 ring-1 ring-sky-300'
            : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
        "
        :title="card.ticket ? 'Clic: filtrar · Doble clic: abrir el ticket' : 'Clic: ver sus órdenes de hoy'"
        @click="handleClick(card)"
        @dblclick="handleDblClick(card)"
      >
        <div class="flex items-center justify-between gap-1.5">
          <div class="flex items-center gap-1.5 text-xs font-medium text-slate-800 truncate">
            <span class="inline-block h-2 w-2 shrink-0 rounded-full" :class="STATUS_META[card.status].dot"></span>
            <span class="truncate">{{ card.name }}</span>
          </div>
          <div v-if="card.phone" class="flex items-center gap-1 shrink-0" @click.stop @dblclick.stop>
            <a :href="waLink(card.phone)" target="_blank" rel="noopener" title="WhatsApp" class="text-green-600 hover:text-green-700">
              💬
            </a>
            <a :href="telLink(card.phone)" title="Llamar" class="text-sky-600 hover:text-sky-700">📞</a>
          </div>
        </div>
        <div class="text-[11px] text-slate-500">
          <template v-if="card.status === 'en_atencion' && card.ticket">
            <span class="font-mono">{{ card.ticket.ticket_number }}</span> ·
            <span :class="timerClass(card)">⏱️ {{ formatElapsedTime(card.ticket.updated_at, now) }}</span>
            <span v-if="card.elapsedMinutes! > slaThresholdMinutes" class="ml-0.5" title="Demora sobre el umbral configurado">⚠️</span>
          </template>
          <template v-else-if="card.status === 'en_camino' && card.ticket">
            <span class="font-mono">{{ card.ticket.ticket_number }}</span> · en camino
          </template>
          <template v-else>{{ STATUS_META.disponible.label }}</template>
        </div>
        <div v-if="card.resolvedToday" class="badge text-[10px] self-start bg-green-500/15 text-green-700">
          ✓ {{ card.resolvedToday }} hoy
        </div>
      </button>
    </div>
  </div>
</template>
