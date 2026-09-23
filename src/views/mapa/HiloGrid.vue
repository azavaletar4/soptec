<script setup lang="ts">
import { computed } from 'vue';
import { tubosDeCable, HILO_ESTADO_COLOR } from '@/lib/fiberColors';
import type { FoHiloEstadoTipo } from '@/types/domain';

const props = defineProps<{
  hilosTotal: number;
  /** hilo_index (1-based) -> estado. Ausente = 'libre'. */
  estados?: Record<number, FoHiloEstadoTipo>;
  /** hilo_index seleccionado actualmente (resaltado con anillo). */
  selected?: number | null;
  /** hilos a resaltar (p. ej. resultado de trazabilidad). */
  highlighted?: Set<number>;
  /** deshabilita el click (solo lectura). */
  readonly?: boolean;
}>();

const emit = defineEmits<{ select: [hiloIndex: number] }>();

const tubos = computed(() => tubosDeCable(props.hilosTotal));

function estadoDe(hiloIndex: number): FoHiloEstadoTipo {
  return props.estados?.[hiloIndex] ?? 'libre';
}
</script>

<template>
  <div class="space-y-3">
    <div v-for="tubo in tubos" :key="tubo.tuboNumero" class="flex items-start gap-2">
      <div class="flex items-center gap-1.5 w-28 shrink-0 pt-1">
        <span class="w-3 h-3 rounded-full border border-slate-900/40" :style="{ background: tubo.hilos[0].tuboColor.hex }"></span>
        <span class="text-xs text-slate-600">Tubo {{ tubo.tuboNumero }} · {{ tubo.hilos[0].tuboColor.name }}</span>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="h in tubo.hilos"
          :key="h.hiloIndex"
          type="button"
          class="relative w-7 h-7 rounded-full border-2 flex items-center justify-center text-[9px] font-semibold transition-transform"
          :class="[
            readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110',
            selected === h.hiloIndex ? 'ring-2 ring-offset-1 ring-sky-400' : '',
            highlighted?.has(h.hiloIndex) ? 'ring-2 ring-offset-1 ring-emerald-400 animate-pulse' : '',
          ]"
          :style="{ background: h.hiloColor.hex, borderColor: HILO_ESTADO_COLOR[estadoDe(h.hiloIndex)] }"
          :title="`Hilo ${h.hiloIndex} · ${h.hiloColor.name} · ${estadoDe(h.hiloIndex)}`"
          @click="!readonly && emit('select', h.hiloIndex)"
        >
          <span :style="{ color: ['Blanco', 'Amarillo', 'Aqua'].includes(h.hiloColor.name) ? '#0f172a' : 'white' }">{{ h.hiloIndex }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
