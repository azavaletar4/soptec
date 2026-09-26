<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import logoIcon from '@/assets/logo-icon.png';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const BILLING_ROLES = ['SUPERADMIN', 'ADMIN', 'FACTURACION'];
const SUPERADMIN_ROLES = ['SUPERADMIN'];
const ADMIN_ROLES = ['SUPERADMIN', 'ADMIN'];
// Modulos administrativos que TECNICO_RED no necesita ver (mismo criterio
// que NOT_TECNICO en el router) — solo le quedan Instalaciones, los dos
// Mapas (Red y Clientes) y Soporte.
const HIDDEN_FROM_TECNICO = ['dashboard', 'clientes', 'zonas', 'planes', 'olt', 'mikrotik', 'tr069', 'inventario', 'reportes', 'cortes', 'flota', 'analitica'];

const ROLE_LABEL: Record<string, string> = {
  SUPERADMIN: 'Super admin',
  ADMIN: 'Administrador',
  TECNICO_RED: 'Técnico de red',
  SOPORTE: 'Soporte',
  FACTURACION: 'Facturación',
  CLIENTE: 'Cliente',
};

// Iconos minimalistas (24x24, stroke) por modulo/grupo — sin depender de una
// libreria externa (mismo criterio que el resto del panel: sin Lucide ni
// libs de charts, todo SVG a mano).
const ICONS: Record<string, string> = {
  dashboard: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z',
  clientes: 'M17 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 5 18.5V20M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM21 20v-1.5a3 3 0 0 0-2.4-2.94M16.5 4.06a3 3 0 0 1 0 5.88',
  soporte: 'M12 15a3 3 0 0 0 3-3M12 15a3 3 0 0 1-3-3m3 3v4m-8-7a8 8 0 1 1 16 0v3a2 2 0 0 1-2 2h-1v-5a1 1 0 0 1 1-1h2M4 11h2a1 1 0 0 1 1 1v5H5a2 2 0 0 1-2-2v-3Z',
  planes: 'M4 6h16M4 6l2 14h12l2-14M9 10v6m6-6v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
  zonas: 'M12 3 3 7.5 12 12l9-4.5L12 3ZM3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5',
  olt: 'M4 5.5h16M4 5.5v3h16v-3M4 12.5h16M4 12.5v3h16v-3M4 19.5h16M8 7v0M8 14v0',
  mikrotik: 'M2 9.5a15 15 0 0 1 20 0M5.5 13a10 10 0 0 1 13 0M9 16.5a5 5 0 0 1 6 0M12 20v0',
  analitica: 'M4 19V10m6 9V5m6 14v-8m4 8H2M4 10l4-4 4 3 4-5',
  facturacion: 'M7 4h10a1 1 0 0 1 1 1v15l-3-2-2 2-2-2-2 2-3-2V5a1 1 0 0 1 1-1Zm2 5h6M9 12h6M9 15h3',
  cortes: 'M12 2v6M12 2 8 6m4-4 4 4M5.6 8.6a8 8 0 1 0 12.8 0',
  instalaciones: 'M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21ZM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  'mapa-red': 'M4 17 9 7l5 7 3-4 3 6M4 20h16M9 7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM17 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  'mapa-clientes': 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14M15 6v14',
  inventario: 'M3 7l9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10',
  flota: 'M4 16V9l2-4h8l3 4h2l1 3v4h-2a2 2 0 1 1-4 0H10a2 2 0 1 1-4 0H4Zm3 0a1 1 0 1 0 2 0M15 16a1 1 0 1 0 2 0M4 12h16M8 9V5',
  tr069: 'M12 20v-6m0 0a4 4 0 0 0 4-4V7a4 4 0 0 0-8 0v3a4 4 0 0 0 4 4Zm-7 2h14M5 8H3m18 0h-2M5 4 3 2m16 2 2-2',
  reportes: 'M4 19V10m6 9V5m6 14v-8m-13 8h16',
  usuarios: 'M17 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 5 18.5V20M9.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM21 8v6M18 11h6',
};

// Iconos de las categorias desplegables.
const GROUP_ICONS: Record<string, string> = {
  'planta-interna': 'M4 4h16v6H4V4Zm0 10h16v6H4v-6ZM7.5 7h.01M7.5 17h.01M11 7h5M11 17h5', // rack de equipos
  comercial: 'M6 7V5a4 4 0 1 1 8 0v2M4.5 7h11l1 13h-13l1-13ZM9 11a3 3 0 0 0 6 0', // bolsa de ventas
  operaciones: 'M12 2 3 7l9 5 9-5-9-5ZM3 12l9 5 9-5M3 17l9 5 9-5', // capas/operacion
  configuracion: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8-3.5a7.9 7.9 0 0 0-.15-1.5l2.1-1.6-2-3.4-2.5 1a8 8 0 0 0-2.6-1.5L16.3 3h-4.6l-.5 2.5a8 8 0 0 0-2.6 1.5l-2.5-1-2 3.4 2.1 1.6A7.9 7.9 0 0 0 6 12c0 .5.05 1 .15 1.5l-2.1 1.6 2 3.4 2.5-1a8 8 0 0 0 2.6 1.5l.5 2.5h4.6l.5-2.5a8 8 0 0 0 2.6-1.5l2.5 1 2-3.4-2.1-1.6c.1-.5.15-1 .15-1.5Z',
};
const CHEVRON = 'M6 9l6 6 6-6';

interface ModuloItem {
  key: string;
  label: string;
  to: string;
  requiresBilling?: boolean;
  requiresSuperadmin?: boolean;
  requiresAdmin?: boolean;
}

// Modulos de uso frecuente para cualquier rol con acceso al panel — se
// muestran sueltos, sin acordeon, para no obligar a un clic extra.
const STANDALONE: ModuloItem[] = [
  { key: 'dashboard', label: 'Dashboard', to: '/dashboard' },
  { key: 'clientes', label: 'Clientes', to: '/clientes' },
  { key: 'soporte', label: 'Soporte', to: '/soporte' },
];

interface ModuloGrupo {
  key: string;
  label: string;
  items: ModuloItem[];
}

// El resto se agrupa por afinidad para que el sidebar no se vea amontonado
// (18 items sueltos antes). "Planta Interna" agrupa toda la infraestructura
// tecnica de red/monitoreo, tal como se pidio.
const GRUPOS: ModuloGrupo[] = [
  {
    key: 'planta-interna',
    label: 'Planta Interna',
    items: [
      { key: 'olt', label: 'Red & OLTs', to: '/olt' },
      { key: 'mikrotik', label: 'MikroTik', to: '/mikrotik' },
      { key: 'analitica', label: 'Analítica de Tráfico', to: '/analitica', requiresAdmin: true },
      { key: 'tr069', label: 'TR-069', to: '/tr069' },
    ],
  },
  {
    key: 'comercial',
    label: 'Comercial',
    items: [
      { key: 'planes', label: 'Planes', to: '/planes' },
      { key: 'facturacion', label: 'Facturación', to: '/facturacion', requiresBilling: true },
      { key: 'cortes', label: 'Cortes por deuda', to: '/cortes', requiresBilling: true },
    ],
  },
  {
    key: 'operaciones',
    label: 'Operaciones',
    items: [
      { key: 'zonas', label: 'Zonas', to: '/zonas' },
      { key: 'instalaciones', label: 'Instalaciones', to: '/instalaciones' },
      { key: 'mapa-red', label: 'Mapa de Red', to: '/mapa/red' },
      { key: 'mapa-clientes', label: 'Mapa de Clientes', to: '/mapa/clientes' },
      { key: 'flota', label: 'Flota vehicular', to: '/flota' },
    ],
  },
  {
    key: 'configuracion',
    label: 'Configuración',
    items: [
      { key: 'inventario', label: 'Inventario', to: '/inventario' },
      { key: 'reportes', label: 'Reportes', to: '/reportes' },
      { key: 'usuarios', label: 'Usuarios', to: '/usuarios', requiresSuperadmin: true },
    ],
  },
];

function isVisible(mod: ModuloItem) {
  return (
    (!mod.requiresBilling || BILLING_ROLES.includes(auth.role ?? '')) &&
    (!mod.requiresSuperadmin || SUPERADMIN_ROLES.includes(auth.role ?? '')) &&
    (!mod.requiresAdmin || ADMIN_ROLES.includes(auth.role ?? '')) &&
    !(auth.role === 'TECNICO_RED' && HIDDEN_FROM_TECNICO.includes(mod.key))
  );
}

const visibleStandalone = computed(() => STANDALONE.filter(isVisible));
// Un grupo entero se oculta si a ese rol no le queda ningun item visible
// adentro (ej. TECNICO_RED nunca ve "Planta Interna").
const visibleGrupos = computed(() =>
  GRUPOS.map((g) => ({ ...g, items: g.items.filter(isVisible) })).filter((g) => g.items.length > 0),
);

function isActive(to: string) {
  return route.path === to || route.path.startsWith(`${to}/`);
}
function groupHasActiveItem(grupo: ModuloGrupo) {
  return grupo.items.some((item) => isActive(item.to));
}

// Que grupos estan expandidos "a mano" (independiente de donde este
// parado el usuario). Se recuerda en localStorage porque AppLayout se
// vuelve a montar en cada navegacion (cada vista lo envuelve en su propio
// <template>), asi que un ref normal perderia el estado al cambiar de
// pagina.
const OPEN_GROUPS_STORAGE_KEY = 'smartrayco:sidebar-open-groups';
function loadStoredOpenGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(OPEN_GROUPS_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}
const manuallyOpenGroups = ref<Set<string>>(loadStoredOpenGroups());

function persistOpenGroups() {
  try {
    localStorage.setItem(OPEN_GROUPS_STORAGE_KEY, JSON.stringify([...manuallyOpenGroups.value]));
  } catch {
    // localStorage puede fallar (modo privado, cuota) — no es critico, el
    // acordeon solo pierde el estado recordado entre sesiones.
  }
}

// Abierto si el usuario lo desplego a mano, O si contiene la pagina activa
// (para no dejar al usuario "perdido" con una pagina abierta cuyo grupo
// aparece colapsado). Por eso mismo, un grupo con la pagina activa adentro
// no se puede colapsar desde aqui — es la misma logica que usan la mayoria
// de paneles admin.
function isGroupOpen(grupo: ModuloGrupo) {
  return manuallyOpenGroups.value.has(grupo.key) || groupHasActiveItem(grupo);
}

function toggleGroup(key: string) {
  if (manuallyOpenGroups.value.has(key)) manuallyOpenGroups.value.delete(key);
  else manuallyOpenGroups.value.add(key);
  persistOpenGroups();
}

const roleLabel = computed(() => (auth.role ? (ROLE_LABEL[auth.role] ?? auth.role) : ''));
const initials = computed(() => (auth.user?.email ?? '?').slice(0, 2).toUpperCase());

const sidebarOpen = ref(false);

// Cierra el drawer movil al navegar (clic en cualquier router-link dentro
// del nav) — delegado en el <nav> en vez de un watcher sobre la ruta,
// porque AppLayout se vuelve a montar fresco en cada navegacion (cada
// vista lo envuelve en su propio <template>) y un watcher no alcanza a
// ver el cambio antes de que la instancia vieja se destruya.
function closeSidebarOnLinkClick(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('a')) sidebarOpen.value = false;
}

async function handleLogout() {
  await auth.signOut();
  router.push('/login');
}
</script>

<template>
  <div class="min-h-screen md:flex">
    <div class="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/95 backdrop-blur px-4 py-3 md:hidden">
      <div class="flex items-center gap-2.5">
        <img :src="logoIcon" alt="" class="w-7 h-7 shrink-0" />
        <div class="text-base font-semibold">SmartRayco</div>
      </div>
      <button
        class="p-2 rounded-lg text-slate-800 hover:bg-slate-100 active:scale-95 transition-transform"
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
      class="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm md:hidden transition-opacity"
      @click="sidebarOpen = false"
    ></div>

    <aside
      class="fixed inset-y-0 left-0 z-50 w-72 shrink-0 border-r border-slate-200 bg-slate-100 p-5 flex flex-col overflow-y-auto transition-transform duration-200 ease-out md:sticky md:top-0 md:h-screen md:z-auto md:w-64 md:translate-x-0"
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
        <button class="p-1 text-slate-600 hover:text-slate-900 md:hidden" aria-label="Cerrar menu" @click="sidebarOpen = false">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <nav class="flex-1 space-y-0.5" @click="closeSidebarOnLinkClick">
        <router-link
          v-for="mod in visibleStandalone"
          :key="mod.key"
          :to="mod.to"
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 relative"
          :class="isActive(mod.to) ? 'bg-sky-500/10 text-sky-600' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'"
        >
          <span v-if="isActive(mod.to)" class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-sky-400"></span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="shrink-0">
            <path :d="ICONS[mod.key]" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          {{ mod.label }}
        </router-link>

        <div v-if="visibleStandalone.length && visibleGrupos.length" class="my-3 border-t border-slate-200"></div>

        <div v-for="grupo in visibleGrupos" :key="grupo.key">
          <button
            type="button"
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150"
            :class="groupHasActiveItem(grupo) ? 'text-slate-900' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'"
            :aria-expanded="isGroupOpen(grupo)"
            @click="toggleGroup(grupo.key)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="shrink-0">
              <path :d="GROUP_ICONS[grupo.key]" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span class="flex-1 text-left">{{ grupo.label }}</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="shrink-0 transition-transform duration-200"
              :class="{ 'rotate-180': isGroupOpen(grupo) }"
            >
              <path :d="CHEVRON" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>

          <div class="grid transition-[grid-template-rows] duration-200 ease-out" :style="{ gridTemplateRows: isGroupOpen(grupo) ? '1fr' : '0fr' }">
            <div class="overflow-hidden">
              <router-link
                v-for="item in grupo.items"
                :key="item.key"
                :to="item.to"
                class="flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-sm transition-colors duration-150 relative"
                :class="isActive(item.to) ? 'bg-sky-500/10 text-sky-600 font-medium' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'"
              >
                <span v-if="isActive(item.to)" class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-sky-400"></span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="shrink-0">
                  <path :d="ICONS[item.key]" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                {{ item.label }}
              </router-link>
            </div>
          </div>
        </div>
      </nav>

      <div class="mt-4 pt-4 border-t border-slate-200 flex items-center gap-3">
        <div class="w-9 h-9 rounded-full bg-slate-100 border border-slate-300 flex items-center justify-center text-xs font-semibold text-slate-700 shrink-0">
          {{ initials }}
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-xs text-slate-700 truncate">{{ auth.user?.email }}</div>
          <div class="text-[11px] text-slate-500">{{ roleLabel }}</div>
        </div>
        <button
          class="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-500/10 transition-colors"
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
