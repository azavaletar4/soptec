<script setup lang="ts">
import { computed } from 'vue';
import { formatElapsedTime } from '@/lib/elapsedTime';
import type { StaffProfile, Ticket } from '@/types/domain';

// Panel estilo despacho de campo (TOA-like): una tarjeta por tecnico con su
// estado en vivo, derivado de SUS tickets asignados (no de los que esten
// filtrados/buscados en la tabla de abajo).
//
// "En camino" no es un estado real en la tabla tickets (no hay un paso de
// "aceptar" separado de "iniciar") — se aproxima como "tiene un ticket
// asignado que sigue 'abierto'" (ya se lo dieron, todavia no marco en
// progreso). Si tiene un 'en progreso', eso manda sobre cualquier 'abierto'.
const props = defineProps<{ technicians: StaffProfile[]; tickets: Ticket[]; now: number }>();

type TechStatus = 'en_atencion' | 'en_camino' | 'disponible';

interface TechCard {
  id: string;
  name: string;
  status: TechStatus;
  ticket: Ticket | null;
}

const STATUS_META: Record<TechStatus, { dot: string; label: string }> = {
  en_atencion: { dot: 'bg-green-500', label: 'En atención' },
  en_camino: { dot: 'bg-sky-500', label: 'En camino' },
  disponible: { dot: 'bg-slate-300', label: 'Disponible' },
};

const cards = computed<TechCard[]>(() =>
  props.technicians.map((tech) => {
    const name = tech.full_name || tech.email;
    const assigned = props.tickets.filter((t) => t.assigned_to === tech.id);
    const inProgress = assigned.find((t) => t.status === 'in_progress');
    if (inProgress) return { id: tech.id, name, status: 'en_atencion', ticket: inProgress };
    const open = assigned.find((t) => t.status === 'open');
    if (open) return { id: tech.id, name, status: 'en_camino', ticket: open };
    return { id: tech.id, name, status: 'disponible', ticket: null };
  }),
);
</script>

<template>
  <div v-if="technicians.length" class="surface mb-4 p-3">
    <div class="text-sm font-medium text-slate-700 mb-2">👷 Técnicos activos</div>
    <div class="flex gap-2 overflow-x-auto pb-1">
      <div
        v-for="card in cards"
        :key="card.id"
        class="flex min-w-[160px] shrink-0 flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
      >
        <div class="flex items-center gap-1.5 text-xs font-medium text-slate-800 truncate">
          <span class="inline-block h-2 w-2 shrink-0 rounded-full" :class="STATUS_META[card.status].dot"></span>
          <span class="truncate">{{ card.name }}</span>
        </div>
        <div class="text-[11px] text-slate-500">
          <template v-if="card.status === 'en_atencion' && card.ticket">
            <span class="font-mono">{{ card.ticket.ticket_number }}</span> · ⏱️ {{ formatElapsedTime(card.ticket.updated_at, now) }}
          </template>
          <template v-else-if="card.status === 'en_camino' && card.ticket">
            <span class="font-mono">{{ card.ticket.ticket_number }}</span> · en camino
          </template>
          <template v-else>{{ STATUS_META.disponible.label }}</template>
        </div>
      </div>
    </div>
  </div>
</template>
