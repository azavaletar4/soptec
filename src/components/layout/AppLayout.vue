<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import logoIcon from '@/assets/logo-icon.png';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const BILLING_ROLES = ['SUPERADMIN', 'ADMIN', 'FACTURACION'];

const ROLE_LABEL: Record<string, string> = {
  SUPERADMIN: 'Super admin',
  ADMIN: 'Administrador',
  TECNICO_RED: 'Técnico de red',
  SOPORTE: 'Soporte',
  FACTURACION: 'Facturación',
  CLIENTE: 'Cliente',
};

// Iconos minimalistas (24x24, stroke) por modulo — sin depender de una libreria externa.
const ICONS: Record<string, string> = {
  dashboard: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z',
  clientes: 'M17 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 5 18.5V20M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM21 20v-1.5a3 3 0 0 0-2.4-2.94M16.5 4.06a3 3 0 0 1 0 5.88',
  olt: 'M4 5.5h16M4 5.5v3h16v-3M4 12.5h16M4 12.5v3h16v-3M4 19.5h16M8 7v0M8 14v0',
  mikrotik: 'M2 9.5a15 15 0 0 1 20 0M5.5 13a10 10 0 0 1 13 0M9 16.5a5 5 0 0 1 6 0M12 20v0',
  soporte: 'M12 15a3 3 0 0 0 3-3M12 15a3 3 0 0 1-3-3m3 3v4m-8-7a8 8 0 1 1 16 0v3a2 2 0 0 1-2 2h-1v-5a1 1 0 0 1 1-1h2M4 11h2a1 1 0 0 1 1 1v5H5a2 2 0 0 1-2-2v-3Z',
  facturacion: 'M7 4h10a1 1 0 0 1 1 1v15l-3-2-2 2-2-2-2 2-3-2V5a1 1 0 0 1 1-1Zm2 5h6M9 12h6M9 15h3',
  instalaciones: 'M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21ZM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  mapa: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14M15 6v14',
  inventario: 'M3 7l9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10',
  tr069: 'M12 20v-6m0 0a4 4 0 0 0 4-4V7a4 4 0 0 0-8 0v3a4 4 0 0 0 4 4Zm-7 2h14M5 8H3m18 0h-2M5 4 3 2m16 2 2-2',
};

const MODULOS = [
  { key: 'dashboard', label: 'Dashboard', to: '/dashboard', disabled: false },
  { key: 'clientes', label: 'Clientes', to: '/clientes', disabled: false },
  { key: 'instalaciones', label: 'Instalaciones', to: '/instalaciones', disabled: false },
  { key: 'mapa', label: 'Mapa', to: '/mapa', disabled: false },
  { key: 'olt', label: 'Red & OLTs', to: '/olt', disabled: false },
  { key: 'mikrotik', label: 'MikroTik', to: '/mikrotik', disabled: false },
  { key: 'tr069', label: 'TR-069', to: '/tr069', disabled: false },
  { key: 'inventario', label: 'Inventario', to: '/inventario', disabled: false },
  { key: 'soporte', label: 'Soporte', to: '/soporte', disabled: false },
  { key: 'facturacion', label: 'Facturación', to: '/facturacion', disabled: false, requiresBilling: true },
];

const visibleModulos = computed(() =>
  MODULOS.filter((mod) => !mod.requiresBilling || BILLING_ROLES.includes(auth.role ?? '')),
);

function isActive(to: string) {
  return route.path === to || route.path.startsWith(`${to}/`);
}

const roleLabel = computed(() => (auth.role ? (ROLE_LABEL[auth.role] ?? auth.role) : ''));
const initials = computed(() => (auth.user?.email ?? '?').slice(0, 2).toUpperCase());

const sidebarOpen = ref(false);

watch(
  () => route.fullPath,
  () => {
    sidebarOpen.value = false;
  },
);

async function handleLogout() {
  await auth.signOut();
  router.push('/login');
}
</script>

<template>
  <div class="min-h-screen md:flex">
    <div class="sticky top-0 z-30 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 backdrop-blur px-4 py-3 md:hidden">
      <div class="flex items-center gap-2.5">
        <img :src="logoIcon" alt="" class="w-7 h-7 shrink-0" />
        <div class="text-base font-semibold">SmartRayco</div>
      </div>
      <button
        class="p-2 rounded-lg text-slate-200 hover:bg-slate-800 active:scale-95 transition-transform"
        aria-label="Abrir menu"
        @click="sidebarOpen = true"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 6h16M4 12h16M4 18h16" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm md:hidden transition-opacity"
      @click="sidebarOpen = false"
    ></div>

    <aside
      class="fixed inset-y-0 left-0 z-50 w-72 shrink-0 border-r border-slate-800 bg-slate-900 p-5 flex flex-col transition-transform duration-200 ease-out md:static md:z-auto md:w-64 md:translate-x-0"
      :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <div class="flex items-center justify-between mb-8">
        <div class="flex items-center gap-2.5">
          <img :src="logoIcon" alt="" class="w-9 h-9 shrink-0" />
          <div>
            <div class="text-base font-semibold leading-tight">SmartRayco</div>
            <div class="text-[11px] text-slate-500 leading-tight">Panel de gestión</div>
          </div>
        </div>
        <button class="p-1 text-slate-400 hover:text-slate-100 md:hidden" aria-label="Cerrar menu" @click="sidebarOpen = false">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <nav class="flex-1 space-y-0.5">
        <router-link
          v-for="mod in visibleModulos"
          :key="mod.key"
          :to="mod.disabled ? '' : mod.to"
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 relative"
          :class="
            mod.disabled
              ? 'text-slate-600 cursor-not-allowed'
              : isActive(mod.to)
                ? 'bg-sky-500/10 text-sky-400'
                : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
          "
        >
          <span
            v-if="isActive(mod.to)"
            class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-sky-400"
          ></span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="shrink-0">
            <path :d="ICONS[mod.key]" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          {{ mod.label }}
        </router-link>
      </nav>

      <div class="mt-4 pt-4 border-t border-slate-800 flex items-center gap-3">
        <div class="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-semibold text-slate-300 shrink-0">
          {{ initials }}
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-xs text-slate-300 truncate">{{ auth.user?.email }}</div>
          <div class="text-[11px] text-slate-500">{{ roleLabel }}</div>
        </div>
        <button
          class="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          aria-label="Cerrar sesion"
          title="Cerrar sesion"
          @click="handleLogout"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 17l5-5-5-5M21 12H9" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>
    </aside>

    <main class="flex-1 p-4 md:p-8 min-w-0">
      <slot />
    </main>
  </div>
</template>
