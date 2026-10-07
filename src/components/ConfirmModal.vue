<script setup lang="ts">
// Reemplazo del confirm()/alert() nativo del navegador para acciones
// destructivas — se ve fuera de lugar al lado del resto del diseño de la
// app y no distingue visualmente una accion reversible ("Cancelar") de una
// irreversible ("Eliminar definitivamente"). Uso:
//   <ConfirmModal :open="!!pending" :title="..." :message="..." :danger="true"
//     :loading="deleting" @confirm="doDelete" @cancel="pending = null" />
//
// Accesible como dialog modal: role="dialog"/aria-modal, foco inicial en el
// boton "seguro" (Cancelar si danger, si no Confirmar), Escape cierra
// (salvo mientras loading), Tab queda atrapado dentro del panel, y el foco
// vuelve a quien abrio el modal al cerrarse.
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    message: string;
    /** true = accion irreversible (Eliminar definitivamente): boton rojo + texto de advertencia. */
    danger?: boolean;
    /** true = caja ambar con ⚠️ alrededor del mensaje — advertencia no destructiva (ej. choque de horario) que de todos modos se puede confirmar. */
    warning?: boolean;
    confirmLabel?: string;
    cancelLabel?: string;
    loading?: boolean;
  }>(),
  { danger: false, warning: false, confirmLabel: 'Confirmar', cancelLabel: 'Cancelar', loading: false },
);

const emit = defineEmits<{ confirm: []; cancel: [] }>();

const titleId = useId();
const panelRef = ref<HTMLElement | null>(null);
const cancelBtnRef = ref<HTMLButtonElement | null>(null);
const confirmBtnRef = ref<HTMLButtonElement | null>(null);

let previouslyFocused: HTMLElement | null = null;

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(): HTMLElement[] {
  if (!panelRef.value) return [];
  return Array.from(panelRef.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (props.loading) return; // no dejar cerrar a mitad de una accion en curso
    e.preventDefault();
    emit('cancel');
    return;
  }

  if (e.key === 'Tab') {
    const focusable = getFocusable();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

function lockOpen() {
  previouslyFocused = document.activeElement as HTMLElement | null;
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', handleKeydown);
}

function unlockClose() {
  document.body.style.overflow = '';
  document.removeEventListener('keydown', handleKeydown);
  previouslyFocused?.focus();
  previouslyFocused = null;
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      lockOpen();
      await nextTick();
      (props.danger ? cancelBtnRef.value : confirmBtnRef.value)?.focus();
    } else {
      unlockClose();
    }
  },
  { immediate: true },
);

// Por si el componente se desmonta con open=true (padre lo saca del arbol
// sin pasar por false primero) — no dejar el scroll bloqueado ni el
// listener de teclado colgado.
onBeforeUnmount(() => {
  if (props.open) unlockClose();
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" role="dialog" aria-modal="true" :aria-labelledby="titleId">
      <div ref="panelRef" class="w-full max-w-sm modal-panel max-h-[90vh] overflow-y-auto">
        <h2 :id="titleId" class="text-lg font-semibold mb-1">{{ title }}</h2>
        <p v-if="!warning" class="text-sm text-slate-600 mb-1">{{ message }}</p>
        <p v-if="danger" class="text-xs text-red-600 font-medium mb-3">Esta acción no se puede deshacer.</p>
        <p v-if="warning" class="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-1">
          ⚠️ {{ message }}
        </p>
        <div class="flex justify-end gap-2 mt-4">
          <button ref="cancelBtnRef" type="button" class="btn-ghost" :disabled="loading" @click="$emit('cancel')">
            {{ cancelLabel }}
          </button>
          <button
            ref="confirmBtnRef"
            type="button"
            :class="danger ? 'btn-destructive' : 'btn-primary'"
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
