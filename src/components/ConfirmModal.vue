<script setup lang="ts">
// Reemplazo del confirm()/alert() nativo del navegador para acciones
// destructivas — se ve fuera de lugar al lado del resto del diseño de la
// app y no distingue visualmente una accion reversible ("Cancelar") de una
// irreversible ("Eliminar definitivamente"). Uso:
//   <ConfirmModal :open="!!pending" :title="..." :message="..." :danger="true"
//     :loading="deleting" @confirm="doDelete" @cancel="pending = null" />
withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    message: string;
    /** true = accion irreversible (Eliminar definitivamente): boton rojo + texto de advertencia. */
    danger?: boolean;
    confirmLabel?: string;
    cancelLabel?: string;
    loading?: boolean;
  }>(),
  { danger: false, confirmLabel: 'Confirmar', cancelLabel: 'Cancelar', loading: false },
);

defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay">
      <div class="w-full max-w-sm modal-panel">
        <h2 class="text-lg font-semibold mb-1">{{ title }}</h2>
        <p class="text-sm text-slate-600 mb-1">{{ message }}</p>
        <p v-if="danger" class="text-xs text-red-600 font-medium mb-3">Esta acción no se puede deshacer.</p>
        <div class="flex justify-end gap-2 mt-4">
          <button type="button" class="btn-ghost" :disabled="loading" @click="$emit('cancel')">
            {{ cancelLabel }}
          </button>
          <button
            type="button"
            class="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            :class="danger ? 'bg-red-600 hover:bg-red-700' : 'bg-sky-600 hover:bg-sky-700'"
            :disabled="loading"
            @click="$emit('confirm')"
          >
            {{ loading ? 'Procesando...' : confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
