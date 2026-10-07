<script setup lang="ts">
// Fase 132 — campana de alertas preventivas (30 min antes de la hora
// programada) para admin/soporte. Flotante (fixed top-right) en vez de
// integrada al sidebar: AppLayout no tiene una barra superior propia en
// desktop, y esto evita reacomodar ese layout por una sola campanita.
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useScheduleAlertsStore } from '@/stores/scheduleAlerts';
import { PRIORITY_CLASS, PRIORITY_LABEL } from '@/lib/ticketPriority';

const auth = useAuthStore();
const canSee = computed(() => ['SUPERADMIN', 'ADMIN', 'SOPORTE'].includes(auth.role ?? ''));

const store = useScheduleAlertsStore();
const open = ref(false);

onMounted(() => {
  if (canSee.value) store.subscribe();
});
onUnmounted(() => {
  if (canSee.value) store.unsubscribe();
});

function toggle() {
  open.value = !open.value;
  if (open.value) store.markAllRead();
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <div v-if="canSee" class="fixed top-4 right-4 z-[85] print:hidden flex flex-col items-end gap-2">
    <!-- Toast puntual de cada alerta nueva — arriba a la derecha, pegado a
         la campana (el resto de la app usa ToastHost abajo a la derecha,
         sin cambios). Se autodescarta solo, o con el boton ✕. -->
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

    <div class="relative">
      <button
        type="button"
        class="relative h-10 w-10 rounded-full bg-white shadow-md border border-slate-200 flex items-center justify-center text-lg hover:bg-slate-50"
        aria-label="Alertas de agenda"
        @click="toggle"
      >
        🔔
        <span
          v-if="store.unreadCount"
          class="absolute -top-1 -right-1 h-5 min-w-[20px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center"
        >
          {{ store.unreadCount > 9 ? '9+' : store.unreadCount }}
        </span>
      </button>

      <div v-if="open" class="absolute right-0 top-full mt-2 w-80 max-h-[70vh] overflow-y-auto rounded-xl bg-white shadow-xl border border-slate-200 p-2">
        <p class="text-xs font-semibold text-slate-700 px-2 py-1.5">Próximas atenciones (30 min)</p>
        <p v-if="!store.alerts.length" class="text-xs text-slate-400 px-2 py-3">Sin alertas todavía.</p>
        <div
          v-for="a in store.alerts"
          :key="a.key"
          class="rounded-lg px-2.5 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-medium text-slate-800 truncate">{{ a.technicianName }} → {{ a.label }}</span>
            <span class="badge text-[10px] shrink-0" :class="PRIORITY_CLASS[a.priority]">{{ PRIORITY_LABEL[a.priority] }}</span>
          </div>
          <p class="text-[11px] text-slate-400 mt-0.5">{{ timeLabel(a.scheduledStartAt) }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
