<script setup lang="ts">
// Fase 132/134 — campana de alertas preventivas (30 min antes de la hora
// programada) para admin/soporte.
//
// AppLayout no tiene una barra superior propia en desktop (sidebar + main a
// pantalla completa), asi que ahi sigue flotando fixed top-right como antes
// (variant="floating"). En movil SI hay una barra superior (logo + menu
// hamburguesa) y la campana flotante le quedaba literalmente encima del
// botón ☰, bloqueando el menu (bug reportado) — variant="inline" la
// renderiza como un boton mas DENTRO de esa barra, sin position
// fixed/absolute propia, para que AppLayout la ubique con flex/gap como a
// cualquier otro icono del header. El toast ("faltan 30 min") vive aparte en
// ScheduleAlertToasts.vue — con las 2 variantes montadas en simultaneo
// (una oculta por CSS segun el ancho de pantalla, ver AppLayout.vue) un
// toast adentro de cada una se habria duplicado.
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useScheduleAlertsStore } from '@/stores/scheduleAlerts';
import { PRIORITY_CLASS, PRIORITY_LABEL } from '@/lib/ticketPriority';

const props = withDefaults(defineProps<{ variant?: 'floating' | 'inline' }>(), { variant: 'floating' });

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
  <div v-if="canSee" class="relative" :class="props.variant === 'floating' ? 'fixed top-4 right-4 z-[85] print:hidden' : ''">
    <button
      type="button"
      class="relative flex items-center justify-center hover:bg-slate-50"
      :class="
        props.variant === 'floating'
          ? 'h-10 w-10 rounded-full bg-white shadow-md border border-slate-200 text-lg'
          : 'h-9 w-9 rounded-lg text-lg text-slate-800'
      "
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

    <div v-if="open" class="absolute right-0 top-full mt-2 w-80 max-h-[70vh] overflow-y-auto rounded-xl bg-white shadow-xl border border-slate-200 p-2 z-[85]">
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
</template>
