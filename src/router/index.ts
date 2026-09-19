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
      path: '/mapa',
      name: 'mapa',
      component: () => import('@/views/mapa/MapaView.vue'),
      meta: { requiresAuth: true },
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
      path: '/usuarios',
      name: 'usuarios',
      component: () => import('@/views/usuarios/UsuariosView.vue'),
      meta: { requiresAuth: true, roles: ['SUPERADMIN'] },
    },
    {
      path: '/mikrotik',
      name: 'mikrotik',
      component: () => import('@/views/mikrotik/MikrotikDevicesView.vue'),
      meta: { requiresAuth: true, roles: NOT_TECNICO },
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
  return role === 'TECNICO_RED' ? { name: 'instalaciones' } : { name: 'dashboard' };
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
