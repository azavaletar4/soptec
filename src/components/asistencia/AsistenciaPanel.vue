<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useAsistenciaStore } from '@/stores/asistencia';
import {
  diaSemanaLima,
  esDiaLaborable,
  ESTADO_BADGE_CLASS,
  fechaLimaISO,
  formatHora,
  formatMinutos,
  horaIngresoEsperadaLabel,
} from '@/lib/asistenciaReglas';
import { getErrorMessage } from '@/lib/errors';

// Widget de marcacion de jornada (Fase 117) — un solo componente compartido
// entre la App de Campo (tecnicos) y el modal de marcacion rapida del Panel
// Web (resto del staff): misma logica de GPS/cronometro en un solo lugar en
// vez de duplicarla en dos pantallas.
const store = useAsistenciaStore();
const loading = ref(false);
const actionError = ref<string | null>(null);
const actionNotice = ref<string | null>(null);

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  timer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
  await Promise.all([store.fetchSettings(), store.fetchFeriados(), store.fetchHoy()]);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});

const dow = computed(() => diaSemanaLima());
const esFeriadoHoy = computed(() => store.feriados.some((f) => f.fecha === fechaLimaISO()));
const laborable = computed(() => esDiaLaborable(dow.value, esFeriadoHoy.value));
const esLunes = computed(() => dow.value === 1);
const horaEsperada = computed(() => (store.settings ? horaIngresoEsperadaLabel(store.settings, dow.value) : '—'));

function getPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

async function withAction(fn: () => Promise<{ fuera_oficina_ingreso?: boolean | null; fuera_oficina_fin_almuerzo?: boolean | null } | void>) {
  loading.value = true;
  actionError.value = null;
  actionNotice.value = null;
  try {
    const result = await fn();
    if (result?.fuera_oficina_ingreso || result?.fuera_oficina_fin_almuerzo) {
      actionNotice.value = '⚠️ Marcado fuera de oficina — quedó registrado igual.';
    }
  } catch (e) {
    actionError.value = getErrorMessage(e, 'No se pudo registrar la marcación');
  } finally {
    loading.value = false;
  }
}

async function handleIngreso() {
  await withAction(async () => {
    const pos = await getPosition();
    return store.markIngreso(pos?.coords.latitude ?? null, pos?.coords.longitude ?? null);
  });
}
async function handleInicioAlmuerzo() {
  await withAction(() => store.markInicioAlmuerzo());
}
async function handleFinAlmuerzo() {
  await withAction(async () => {
    const pos = await getPosition();
    return store.markFinAlmuerzo(pos?.coords.latitude ?? null, pos?.coords.longitude ?? null);
  });
}
async function handleSalida() {
  await withAction(async () => {
    const pos = await getPosition();
    return store.markSalida(pos?.coords.latitude ?? null, pos?.coords.longitude ?? null);
  });
}

// Cronometro inverso de 2:00:00 (o lo que diga company_settings.almuerzo_min)
// desde que se inicio el almuerzo — negativo = excedido, se muestra en rojo.
const almuerzoRestanteMs = computed(() => {
  const h = store.hoy;
  if (!h?.inicio_almuerzo || h.fin_almuerzo || !store.settings) return null;
  const limite = new Date(h.inicio_almuerzo).getTime() + store.settings.almuerzo_min * 60000;
  return limite - now.value;
});
function formatCountdown(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  const abs = Math.round(Math.abs(ms) / 1000);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
</script>

<template>
  <div class="surface p-3.5">
    <div class="flex items-center justify-between mb-2">
      <h2 class="text-sm font-semibold">🕐 Marcación de Jornada</h2>
      <span v-if="store.hoy" class="badge text-[10px]" :class="ESTADO_BADGE_CLASS[store.hoy.estado]">{{ store.hoy.estado }}</span>
    </div>

    <p v-if="!laborable" class="text-xs text-slate-500">
      {{ esFeriadoHoy ? '📅 Hoy es feriado — no hay marcación de jornada.' : '📅 Hoy domingo — no hay marcación de jornada.' }}
    </p>

    <template v-else>
      <p v-if="esLunes" class="text-xs font-medium text-sky-700 bg-sky-500/10 rounded-lg px-2.5 py-1.5 mb-3">
        📌 Hoy Lunes: Reunión Semanal — Ingreso {{ horaEsperada }}
      </p>
      <p v-else class="text-xs font-medium text-slate-600 bg-slate-100 rounded-lg px-2.5 py-1.5 mb-3">
        ⏰ Ingreso {{ horaEsperada }}
      </p>

      <!-- Sin marcar ingreso -->
      <div v-if="!store.hoy">
        <button type="button" class="btn-primary w-full text-sm" :disabled="loading" @click="handleIngreso">
          {{ loading ? 'Marcando...' : '🟢 Marcar Ingreso' }}
        </button>
      </div>

      <!-- Ingreso marcado, falta almuerzo -->
      <div v-else-if="store.hoy.hora_ingreso && !store.hoy.inicio_almuerzo && !store.hoy.hora_salida" class="space-y-2.5">
        <p class="text-xs text-slate-500">
          Ingreso: <span class="font-medium text-slate-800">{{ formatHora(store.hoy.hora_ingreso) }}</span>
          <span v-if="store.hoy.minutos_tardanza > 0" class="text-amber-600"> · {{ store.hoy.minutos_tardanza }} min de tardanza</span>
        </p>
        <button type="button" class="btn-primary w-full text-sm" :disabled="loading" @click="handleInicioAlmuerzo">
          {{ loading ? 'Marcando...' : '🍲 Iniciar Almuerzo (2h)' }}
        </button>
      </div>

      <!-- En almuerzo -->
      <div v-else-if="store.hoy.inicio_almuerzo && !store.hoy.fin_almuerzo" class="space-y-2.5">
        <div class="text-center py-2">
          <p class="text-[11px] text-slate-500 mb-1">Tiempo de almuerzo</p>
          <p class="text-2xl font-mono font-semibold" :class="(almuerzoRestanteMs ?? 0) < 0 ? 'text-red-600' : 'text-slate-800'">
            {{ formatCountdown(almuerzoRestanteMs ?? 0) }}
          </p>
          <p v-if="(almuerzoRestanteMs ?? 0) < 0" class="text-[11px] text-red-600 mt-1">⚠️ Tiempo de refrigerio excedido</p>
        </div>
        <button type="button" class="btn-primary w-full text-sm" :disabled="loading" @click="handleFinAlmuerzo">
          {{ loading ? 'Marcando...' : '🛠️ Fin Almuerzo' }}
        </button>
      </div>

      <!-- Almuerzo terminado, falta salida -->
      <div v-else-if="store.hoy.fin_almuerzo && !store.hoy.hora_salida" class="space-y-2.5">
        <p class="text-xs text-slate-500">
          Almuerzo: {{ formatMinutos(store.hoy.duracion_almuerzo_min) }}
          <span v-if="store.hoy.exceso_almuerzo_min" class="text-amber-600"> · {{ store.hoy.exceso_almuerzo_min }} min de exceso</span>
        </p>
        <button type="button" class="btn-destructive w-full text-sm" :disabled="loading" @click="handleSalida">
          {{ loading ? 'Marcando...' : '🔴 Marcar Salida' }}
        </button>
      </div>

      <!-- Jornada finalizada -->
      <div v-else-if="store.hoy.hora_salida" class="text-xs text-slate-500">
        ✅ Jornada finalizada — {{ formatHora(store.hoy.hora_ingreso) }} a {{ formatHora(store.hoy.hora_salida) }}
      </div>
    </template>

    <p v-if="actionNotice" class="text-xs text-amber-600 mt-2.5">{{ actionNotice }}</p>
    <p v-if="actionError" class="text-xs text-red-600 mt-2.5">{{ actionError }}</p>
  </div>
</template>
