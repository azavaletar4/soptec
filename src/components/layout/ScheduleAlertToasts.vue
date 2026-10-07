<script setup lang="ts">
// Fase 134 — separado de ScheduleAlertBell.vue: el toast de "faltan 30 min"
// necesita quedar SIEMPRE flotante arriba a la derecha, sin importar si la
// campana se renderiza inline (header movil) o flotante (desktop) — con la
// campana duplicada por variante (ver ScheduleAlertBell.vue), si el toast
// viviera adentro de cada variante se habria mostrado 2 veces (una oculta
// por CSS, pero igual montada) en vez de una sola vez consistente.
import { useAuthStore } from '@/stores/auth';
import { useScheduleAlertsStore } from '@/stores/scheduleAlerts';
import { PRIORITY_CLASS, PRIORITY_LABEL } from '@/lib/ticketPriority';
import { computed } from 'vue';

const auth = useAuthStore();
const canSee = computed(() => ['SUPERADMIN', 'ADMIN', 'SOPORTE'].includes(auth.role ?? ''));
const store = useScheduleAlertsStore();
</script>

<template>
  <!-- top-16 en movil para quedar debajo de la barra superior (logo +
       campana + menu, ~56px) en vez de tapar ninguno de los 3; en desktop
       (sin esa barra) vuelve a top-4. -->
  <div v-if="canSee" class="fixed top-16 md:top-4 right-4 z-[85] print:hidden flex flex-col items-end gap-2">
    <div
      v-for="t in store.toasts"
      :key="t.key"
      class="w-80 rounded-lg bg-white shadow-lg border border-sky-200 px-3.5 py-3 text-sm flex items-start gap-2"
    >
      <span>🔔</span>
      <div class="flex-1">
        <p class="text-slate-800">
          <span class="font-medium">Próxima atención (30 min):</span> {{ t.technicianName }} → {{ t.label }}
        </p>
        <span class="badge text-[10px] mt-1 inline-block" :class="PRIORITY_CLASS[t.priority]">{{ PRIORITY_LABEL[t.priority] }}</span>
      </div>
      <button type="button" class="text-slate-400 hover:text-slate-600 leading-none" aria-label="Cerrar" @click="store.dismissToast(t.key)">✕</button>
    </div>
  </div>
</template>
