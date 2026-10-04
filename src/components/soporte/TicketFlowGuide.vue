<script setup lang="ts">
import { ref } from 'vue';

// Banner explicativo del flujo de estados de un ticket/averia, para que
// tecnicos y administrativos nuevos entiendan que significa cada badge sin
// tener que preguntar. Se puede ocultar y la preferencia se recuerda en
// localStorage (por navegador) para no restarle espacio permanente a la
// tabla a quien ya se lo aprendio.
const STORAGE_KEY = 'smartrayco:ticket-flow-guide-hidden';

function loadHidden(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

const hidden = ref(loadHidden());

function toggle() {
  hidden.value = !hidden.value;
  try {
    localStorage.setItem(STORAGE_KEY, hidden.value ? '1' : '0');
  } catch {
    // localStorage puede fallar (modo privado, cuota) — no es critico, solo
    // no se recuerda la preferencia entre sesiones.
  }
}

const STEPS = [
  { icon: '🟡', label: 'Abierto', desc: 'Entra la avería / Pendiente asignación', dot: 'bg-yellow-400' },
  { icon: '🔵', label: 'En progreso', desc: 'Técnico atendiendo en campo', dot: 'bg-sky-500' },
  { icon: '🟢', label: 'Resuelto', desc: 'Servicio reparado / Funcionando', dot: 'bg-green-500' },
  { icon: '⚪', label: 'Cerrado', desc: 'Validado por admin y archivado', dot: 'bg-slate-400' },
] as const;
</script>

<template>
  <div class="surface mb-4">
    <button
      type="button"
      class="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left"
      @click="toggle"
    >
      <span class="text-sm font-medium text-slate-700">📘 Guía de flujo de averías</span>
      <span class="text-xs font-medium text-sky-600 hover:text-sky-700">
        {{ hidden ? 'Mostrar guía' : 'Ocultar guía' }}
      </span>
    </button>

    <div v-if="!hidden" class="border-t border-slate-200 px-4 py-4">
      <!-- Desktop/tablet: stepper horizontal conectado por flechas -->
      <div class="hidden items-stretch gap-2 sm:flex">
        <template v-for="(step, i) in STEPS" :key="step.label">
          <div class="flex flex-1 flex-col items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-3 text-center">
            <span class="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              <span class="inline-block h-2.5 w-2.5 rounded-full" :class="step.dot"></span>
              {{ step.icon }} {{ step.label }}
            </span>
            <span class="text-xs leading-snug text-slate-500">{{ step.desc }}</span>
          </div>
          <div v-if="i < STEPS.length - 1" class="flex items-center text-slate-300">
            <span class="text-lg">→</span>
          </div>
        </template>
      </div>

      <!-- Mobile: tarjetas compactas en columna -->
      <div class="flex flex-col gap-2 sm:hidden">
        <div
          v-for="step in STEPS"
          :key="step.label"
          class="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2"
        >
          <span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full" :class="step.dot"></span>
          <div>
            <div class="text-sm font-semibold text-slate-800">{{ step.icon }} {{ step.label }}</div>
            <div class="text-xs leading-snug text-slate-500">{{ step.desc }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
