<script setup lang="ts">
import { useRouter } from 'vue-router';

// Conmutador principal del flujo operativo de tecnicos: une Instalaciones
// (altas nuevas) y Tickets/Averias (soporte post-venta) bajo "Soporte", que
// antes vivian en secciones separadas del sidebar (Operaciones vs Soporte).
defineProps<{ active: 'instalaciones' | 'tickets' }>();

const router = useRouter();
</script>

<template>
  <div class="flex gap-2 mb-6">
    <button
      type="button"
      class="flex-1 min-w-[200px] rounded-xl px-4 py-3 text-left font-semibold transition-colors"
      :class="active === 'instalaciones' ? 'bg-sky-500 text-slate-950' : 'bg-slate-100 text-slate-600 hover:text-slate-900'"
      @click="router.push('/soporte/instalaciones')"
    >
      📦 Instalaciones nuevas
    </button>
    <button
      type="button"
      class="flex-1 min-w-[200px] rounded-xl px-4 py-3 text-left font-semibold transition-colors"
      :class="active === 'tickets' ? 'bg-sky-500 text-slate-950' : 'bg-slate-100 text-slate-600 hover:text-slate-900'"
      @click="router.push('/soporte')"
    >
      🛠️ Tickets y averías
    </button>
  </div>
</template>
