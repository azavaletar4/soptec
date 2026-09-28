<script setup lang="ts">
import { computed } from 'vue';
import type { InventoryProduct } from '@/types/domain';

const props = defineProps<{
  product: InventoryProduct;
  /** Conteo de unidades in_stock — solo aplica/se muestra si product.is_serialized. */
  unitsInStock?: number;
}>();

defineEmits<{ open: []; move: [] }>();

const stockLabel = computed(() => (props.product.is_serialized ? props.unitsInStock ?? 0 : props.product.current_stock));

const isLowStock = computed(
  () => !props.product.is_serialized && props.product.current_stock <= props.product.min_stock,
);
</script>

<template>
  <div class="surface-hover p-4 flex flex-col gap-2 cursor-pointer" @click="$emit('open')">
    <div class="flex items-start justify-between gap-2">
      <h4 class="text-sm font-semibold text-slate-900 leading-snug">{{ product.name }}</h4>
      <span
        class="badge shrink-0"
        :class="isLowStock ? 'bg-amber-500/15 text-amber-700' : 'bg-green-500/15 text-green-600'"
      >
        {{ stockLabel }}
      </span>
    </div>

    <div class="flex flex-wrap gap-1.5">
      <span v-if="product.is_serialized" class="badge bg-sky-500/15 text-sky-700">Por serie/MAC</span>
      <span v-else class="badge bg-slate-100 text-slate-500">Por cantidad</span>
      <span v-if="!product.is_active" class="badge bg-red-500/15 text-red-600">Inactivo</span>
    </div>

    <p class="text-sm font-semibold text-slate-700 mt-1">S/ {{ Number(product.price).toFixed(2) }}</p>

    <div class="mt-auto pt-2 flex justify-end" @click.stop>
      <button type="button" class="text-xs text-sky-700 hover:text-sky-700" @click="$emit('move')">
        🔀 Mover
      </button>
    </div>
  </div>
</template>
