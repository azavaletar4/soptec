import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

// TECNICO_RED es de campo: no necesita ver el panorama administrativo
// completo (dashboard general, clientes, red/OLT, MikroTik, TR-069,
// inventario, reportes) — solo lo que toca en el dia a dia (instalaciones,
// mapa, soporte de sus propios tickets). El resto del staff no cambia.
const NOT_TECNICO = ['SUPERADMIN', 'ADMIN', 'SOPORTE', 'FACTURACION'];

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/login' },
    { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue') },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@/views/DashboardView.vue'),
      meta: { requiresAuth: true, roles: NOT_TECNICO },
    },
    {
      path: '/clientes',
      name: 'clientes',
      component: () => import('@/views/clientes/ClientesView.vue'),
      meta: { requiresAuth: true, roles: NOT_TECNICO },
    },
    {
      path: '/clientes/:id',
      name: 'cliente-detalle',
      component: () => import('@/views/clientes/ClientDetailView.vue'),
      meta: { requiresAuth: true, roles: NOT_TECNICO },
    },
    {
      // Ficha independiente de UN servicio/contrato puntual (Fase 37): ver
      // comentario en ClientDetailView.vue sobre por que un cliente con 2+
      // servicios no los muestra mezclados en una sola pantalla.
      path: '/clientes/:id/servicios/:contractId',
      name: 'cliente-servicio-detalle',
      component: () => import('@/views/clientes/ClientServiceDetailView.vue'),
      meta: { requiresAuth: true, roles: NOT_TECNICO },
    },
    {
      path: '/olt',
      name: 'olt',
      component: () => import('@/views/olt/OltDevicesView.vue'),
      meta: { requiresAuth: true, roles: NOT_TECNICO },
    },
    {
      path: '/olt/:id',
      name: 'olt-detalle',
      component: () => import('@/views/olt/OltDetailView.vue'),
      meta: { requiresAuth: true, roles: NOT_TECNICO },
    },
    {
      path: '/soporte',
      name: 'soporte',
      component: () => import('@/views/soporte/TicketsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/soporte/ranking',
      name: 'soporte-ranking',
      component: () => import('@/views/soporte/RankingTecnicosView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/soporte/:id',
      name: 'soporte-detalle',
      component: () => import('@/views/soporte/TicketDetailView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/instalaciones',
      name: 'instalaciones',
      component: () => import('@/views/instalaciones/InstalacionesView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/campo',
      name: 'campo',
      component: () => import('@/views/campo/CampoDashboardView.vue'),
      meta: { requiresAuth: true, roles: ['SUPERADMIN', 'ADMIN', 'TECNICO_RED'] },
    },
    {
      path: '/campo/:tipo/:id',
      name: 'campo-detalle',
      component: () => import('@/views/campo/CampoTrabajoDetailView.vue'),
      meta: { requiresAuth: true, roles: ['SUPERADMIN', 'ADMIN', 'TECNICO_RED'] },
    },
    { path: '/mapa', redirect: '/mapa/red' },
    {
      path: '/mapa/red',
      name: 'mapa-red',
      component: () => import('@/views/mapa/RedMapView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/mapa/clientes',
      name: 'mapa-clientes',
      component: () => import('@/views/mapa/ClientesMapView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/mapa/importar',
      name: 'mapa-importar',
      component: () => import('@/views/mapa/ImportMapView.vue'),
      meta: { requiresAuth: true, roles: ['SUPERADMIN', 'ADMIN', 'TECNICO_RED'] },
    },
    {
      path: '/inventario',
      name: 'inventario',
      component: () => import('@/views/inventario/InventarioView.vue'),
      meta: { requiresAuth: true, roles: NOT_TECNICO },
    },
    {
      path: '/inventario/devoluciones',
      name: 'inventario-devoluciones',
      component: () => import('@/views/inventario/DevolucionesView.vue'),
      meta: { requiresAuth: true, roles: NOT_TECNICO },
    },
    {
      path: '/inventario/:id',
      name: 'inventario-detalle',
      component: () => import('@/views/inventario/InventarioProductoView.vue'),
      meta: { requiresAuth: true, roles: NOT_TECNICO },
    },
    {
      path: '/tr069',
      name: 'tr069',
      component: () => import('@/views/tr069/Tr069View.vue'),
      meta: { requiresAuth: true, roles: NOT_TECNICO },
    },
    {
      path: '/reportes',
      name: 'reportes',
      component: () => import('@/views/reportes/ReportesView.vue'),
      meta: { requiresAuth: true, roles: NOT_TECNICO },
    },
    {
      path: '/facturacion',
      name: 'facturacion',
      component: () => import('@/views/facturacion/FacturacionView.vue'),
      meta: { requiresAuth: true, roles: ['SUPERADMIN', 'ADMIN', 'FACTURACION'] },
    },
    {
      path: '/cortes',
      name: 'cortes',
      component: () => import('@/views/facturacion/CortesView.vue'),
      meta: { requiresAuth: true, roles: ['SUPERADMIN', 'ADMIN', 'FACTURACION'] },
    },
    {
      path: '/usuarios',
      name: 'usuarios',
      component: () => import('@/views/usuarios/UsuariosView.vue'),
      meta: { requiresAuth: true, roles: ['SUPERADMIN'] },
    },
    {
      path: '/zonas',
      name: 'zonas',
      component: () => import('@/views/zonas/ZonasView.vue'),
      meta: { requiresAuth: true, roles: NOT_TECNICO },
    },
    {
      path: '/planes',
      name: 'planes',
      component: () => import('@/views/planes/PlanesView.vue'),
      meta: { requiresAuth: true, roles: NOT_TECNICO },
    },
    {
      path: '/flota',
      name: 'flota',
      component: () => import('@/views/flota/FlotaView.vue'),
      meta: { requiresAuth: true, roles: NOT_TECNICO },
    },
    {
      path: '/mikrotik',
      name: 'mikrotik',
      component: () => import('@/views/mikrotik/MikrotikDevicesView.vue'),
      meta: { requiresAuth: true, roles: NOT_TECNICO },
    },
    {
      path: '/analitica',
      name: 'analitica',
      component: () => import('@/views/analitica/AnaliticaView.vue'),
      // Vision global de consumo de TODA la red — solo administracion,
      // igual que /usuarios (ver server/src/routes/analytics.ts).
      meta: { requiresAuth: true, roles: ['SUPERADMIN', 'ADMIN'] },
    },
    {
      path: '/mikrotik/:id',
      name: 'mikrotik-detalle',
      component: () => import('@/views/mikrotik/MikrotikDetailView.vue'),
      meta: { requiresAuth: true, roles: NOT_TECNICO },
    },
  ],
});

// TECNICO_RED no tiene "dashboard" (ver NOT_TECNICO arriba) — su pantalla
// de aterrizaje tras login, o cuando intenta entrar a algo que no le toca,
// es Instalaciones en vez de Dashboard.
function homeFor(role: string | null) {
  return role === 'TECNICO_RED' ? { name: 'campo' } : { name: 'dashboard' };
}

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (auth.loading) await auth.init();

  if (to.meta.requiresAuth && !auth.user) {
    return { name: 'login' };
  }
  const roles = to.meta.roles as string[] | undefined;
  if (roles && !roles.includes(auth.role ?? '')) {
    return homeFor(auth.role);
  }
  if (to.name === 'login' && auth.user) {
    return homeFor(auth.role);
  }
  return true;
});

export default router;
