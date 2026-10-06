<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useBreadcrumbExtra } from '@/composables/useBreadcrumb';
import { homePath } from '@/lib/navigation';

// Fase 114: migas de pan genericas, montadas una sola vez en AppLayout.vue
// (no en cada vista) — la base de cada ruta sale de route.meta.breadcrumb
// (ver router/index.ts), y una vista de detalle puede sumar UN ultimo nivel
// dinamico via useBreadcrumbExtra (ej. el numero de ticket).
interface Crumb {
  label: string;
  to?: string;
}

const route = useRoute();
const auth = useAuthStore();
const { extraLabel } = useBreadcrumbExtra();

const trail = computed<Crumb[]>(() => {
  const base = (route.meta.breadcrumb as Crumb[] | undefined) ?? [];
  const crumbs: Crumb[] = [{ label: 'Inicio', to: homePath(auth.role) }, ...base];
  if (extraLabel.value) crumbs.push({ label: extraLabel.value });
  return crumbs;
});
</script>

<template>
  <nav v-if="trail.length > 1" aria-label="Migas de pan" class="flex items-center flex-wrap gap-1.5 text-xs mb-4">
    <template v-for="(crumb, i) in trail" :key="i">
      <router-link v-if="crumb.to && i < trail.length - 1" :to="crumb.to" class="text-slate-500 hover:text-sky-600 hover:underline">
        {{ crumb.label }}
      </router-link>
      <span v-else :class="i === trail.length - 1 ? 'text-slate-700 font-medium' : 'text-slate-500'">{{ crumb.label }}</span>
      <span v-if="i < trail.length - 1" class="text-slate-300">›</span>
    </template>
  </nav>
</template>
