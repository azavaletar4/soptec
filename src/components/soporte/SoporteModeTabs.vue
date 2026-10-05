<script setup lang="ts">
import { useRouter } from 'vue-router';

// Conmutador principal del flujo operativo de tecnicos: une Tickets/Averias
// (soporte post-venta), Instalaciones (altas nuevas) y Rutinas (mantenimiento
// preventivo, Fase 101) bajo "Soporte", que antes vivian en secciones
// separadas del sidebar (Operaciones vs Soporte). Estilo "segmented control"
// compacto, no bloques grandes estirados.
defineProps<{ active: 'instalaciones' | 'tickets' | 'rutinas' }>();

const router = useRouter();
</script>

<template>
  <div class="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
    <button
      type="button"
      class="rounded-lg px-3 py-2 text-sm font-medium transition-colors"
      :class="active === 'tickets' ? 'bg-sky-500 text-slate-950 shadow-sm' : 'text-slate-600 hover:text-slate-900'"
      @click="router.push('/soporte')"
    >
      🛠️ Tickets y averías
    </button>
    <button
      type="button"
      class="rounded-lg px-3 py-2 text-sm font-medium transition-colors"
      :class="active === 'instalaciones' ? 'bg-sky-500 text-slate-950 shadow-sm' : 'text-slate-600 hover:text-slate-900'"
      @click="router.push('/soporte/instalaciones')"
    >
      📦 Instalaciones nuevas
    </button>
    <button
      type="button"
      class="rounded-lg px-3 py-2 text-sm font-medium transition-colors"
      :class="active === 'rutinas' ? 'bg-sky-500 text-slate-950 shadow-sm' : 'text-slate-600 hover:text-slate-900'"
      @click="router.push('/soporte/rutinas')"
    >
      🔄 Rutinas
    </button>
  </div>
</template>
