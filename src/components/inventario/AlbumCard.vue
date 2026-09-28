<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  icon: string;
  name: string;
  color: string;
  itemCount: number;
  lowStock: number;
  totalValue: number;
}>();

defineEmits<{ click: [] }>();

/** Clases literales (no `bg-${color}-50`) para que Tailwind v4 no las purgue por generarse en runtime. */
const ACCENT: Record<string, string> = {
  sky: 'border-sky-200 bg-sky-50/60 hover:border-sky-300',
  amber: 'border-amber-200 bg-amber-50/60 hover:border-amber-300',
  violet: 'border-violet-200 bg-violet-50/60 hover:border-violet-300',
  emerald: 'border-emerald-200 bg-emerald-50/60 hover:border-emerald-300',
  rose: 'border-rose-200 bg-rose-50/60 hover:border-rose-300',
  slate: 'border-slate-200 bg-white hover:border-slate-300',
};

const accentClass = computed(() => ACCENT[props.color] ?? ACCENT.slate);
</script>

<template>
  <button
    type="button"
    class="group relative flex flex-col gap-3 rounded-2xl border p-5 text-left shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md"
    :class="accentClass"
    @click="$emit('click')"
  >
    <span v-if="lowStock > 0" class="badge absolute right-4 top-4 bg-amber-500/15 text-amber-600">
      ⚠ {{ lowStock }} bajo stock
    </span>

    <span class="text-4xl leading-none">{{ icon }}</span>

    <div>
      <h3 class="text-base font-semibold text-slate-900">{{ name }}</h3>
      <p class="mt-0.5 text-xs text-slate-500">{{ itemCount }} {{ itemCount === 1 ? 'ítem' : 'ítems' }}</p>
    </div>

    <div class="mt-auto pt-2 border-t border-slate-200/70">
      <p class="text-lg font-semibold text-slate-800">S/ {{ totalValue.toFixed(2) }}</p>
      <p class="text-[11px] text-slate-500">Valor en stock</p>
    </div>
  </button>
</template>
