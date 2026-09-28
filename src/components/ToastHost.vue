<script setup lang="ts">
// Montado UNA VEZ en AppLayout.vue y CampoLayout.vue — ver useToast.ts para
// el estado compartido. No recibe props: lee directo del composable.
import { useToast } from '@/composables/useToast';

const { toasts, dismiss } = useToast();

const ICON: Record<string, string> = { error: '⚠', success: '✓', info: 'ℹ' };
const CLASS: Record<string, string> = {
  error: 'bg-red-600 text-white',
  success: 'bg-emerald-600 text-white',
  info: 'bg-slate-800 text-white',
};
</script>

<template>
  <Teleport to="body">
    <!-- Mobile-first: centrado y ancho completo por defecto; desde sm:
         apilado abajo a la derecha con ancho automatico. El padding-bottom
         combina el margen normal con env(safe-area-inset-bottom) para no
         quedar tapado por la barra/home-indicator de un celular con notch. -->
    <div
      class="fixed inset-x-0 z-[80] flex flex-col gap-2 px-4 pointer-events-none items-center sm:inset-x-auto sm:right-4 sm:items-end sm:px-0"
      style="bottom: 0; padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));"
    >
      <div
        v-for="t in toasts"
        :key="t.id"
        :role="t.type === 'error' ? 'alert' : 'status'"
        class="pointer-events-auto w-full sm:w-auto sm:max-w-sm rounded-lg px-4 py-3 text-sm shadow-lg flex items-start gap-2"
        :class="CLASS[t.type]"
      >
        <span aria-hidden="true">{{ ICON[t.type] }}</span>
        <span class="flex-1">{{ t.message }}</span>
        <button type="button" class="opacity-70 hover:opacity-100 leading-none" aria-label="Cerrar aviso" @click="dismiss(t.id)">✕</button>
      </div>
    </div>
  </Teleport>
</template>
