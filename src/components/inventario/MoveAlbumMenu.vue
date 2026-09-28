<script setup lang="ts">
import { ref } from 'vue';
import type { InventoryCategory, InventoryUnitStatus } from '@/types/domain';

/**
 * Modal de cambio rápido de álbum, controlado por el padre (no tiene botón
 * disparador propio: se abre con v-if desde donde haga falta "Mover").
 * - mode="product": cambia inventory_products.category_id (un UPDATE, no toca unidades ni clientes).
 * - mode="unit": registra un inventory_unit_events con el nuevo status (Fase 11c) — nunca toca category_id,
 *   así el álbum virtual "Equipos por Recoger / Averiados" nunca se confunde con una categoría real.
 */
const props = defineProps<{
  mode: 'product' | 'unit';
  categories?: InventoryCategory[];
  currentCategoryId?: string | null;
  currentStatus?: InventoryUnitStatus;
}>();

const emit = defineEmits<{
  close: [];
  moveCategory: [categoryId: string];
  moveStatus: [status: InventoryUnitStatus, reason: string];
}>();

const reason = ref('');

const STATUS_OPTIONS: { value: InventoryUnitStatus; label: string }[] = [
  { value: 'in_stock', label: 'Disponible en bodega' },
  { value: 'damaged', label: 'Averiado' },
  { value: 'in_repair', label: 'En reparación' },
  { value: 'retired', label: 'Retirado (baja definitiva)' },
];

function pickCategory(categoryId: string) {
  emit('moveCategory', categoryId);
}

function pickStatus(status: InventoryUnitStatus) {
  emit('moveStatus', status, reason.value);
  reason.value = '';
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="w-full max-w-sm modal-panel">
        <h3 class="text-sm font-semibold mb-3">
          {{ mode === 'product' ? 'Mover producto a...' : 'Cambiar estado del equipo' }}
        </h3>

        <div v-if="mode === 'product'" class="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
          <button
            v-for="c in props.categories"
            :key="c.id"
            type="button"
            class="text-left px-3 py-2 rounded-lg text-sm hover:bg-slate-100 flex items-center gap-2"
            :class="c.id === currentCategoryId ? 'bg-sky-500/10 text-sky-700 font-medium' : 'text-slate-700'"
            :disabled="c.id === currentCategoryId"
            @click="pickCategory(c.id)"
          >
            <span>{{ c.icon }}</span>
            <span>{{ c.name }}</span>
            <span v-if="c.id === currentCategoryId" class="ml-auto text-xs text-sky-700">Actual</span>
          </button>
        </div>

        <div v-else class="flex flex-col gap-3">
          <div>
            <label class="field-label">Motivo (opcional)</label>
            <input v-model="reason" class="field-input" placeholder="ej. Cliente dio de baja el servicio" />
          </div>
          <div class="flex flex-col gap-1.5">
            <button
              v-for="s in STATUS_OPTIONS"
              :key="s.value"
              type="button"
              class="text-left px-3 py-2 rounded-lg text-sm hover:bg-slate-100"
              :class="s.value === currentStatus ? 'bg-sky-500/10 text-sky-700 font-medium' : 'text-slate-700'"
              :disabled="s.value === currentStatus"
              @click="pickStatus(s.value)"
            >
              {{ s.label }}
              <span v-if="s.value === currentStatus" class="ml-2 text-xs text-sky-700">Actual</span>
            </button>
          </div>
        </div>

        <div class="flex justify-end mt-4">
          <button type="button" class="btn-ghost text-xs" @click="emit('close')">Cancelar</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
