import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/login' },
    { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue') },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@/views/DashboardView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/clientes',
      name: 'clientes',
      component: () => import('@/views/clientes/ClientesView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/clientes/:id',
      name: 'cliente-detalle',
      component: () => import('@/views/clientes/ClientDetailView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/olt',
      name: 'olt',
      component: () => import('@/views/olt/OltDevicesView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/olt/:id',
      name: 'olt-detalle',
      component: () => import('@/views/olt/OltDetailView.vue'),
      meta: { requiresAuth: true },
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
      path: '/facturacion',
      name: 'facturacion',
      component: () => import('@/views/facturacion/FacturacionView.vue'),
      meta: { requiresAuth: true, roles: ['SUPERADMIN', 'ADMIN', 'FACTURACION'] },
    },
    {
      path: '/mikrotik',
      name: 'mikrotik',
      component: () => import('@/views/mikrotik/MikrotikDevicesView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/mikrotik/:id',
      name: 'mikrotik-detalle',
      component: () => import('@/views/mikrotik/MikrotikDetailView.vue'),
      meta: { requiresAuth: true },
    },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (auth.loading) await auth.init();

  if (to.meta.requiresAuth && !auth.user) {
    return { name: 'login' };
  }
  const roles = to.meta.roles as string[] | undefined;
  if (roles && !roles.includes(auth.role ?? '')) {
    return { name: 'dashboard' };
  }
  if (to.name === 'login' && auth.user) {
    return { name: 'dashboard' };
  }
  return true;
});

export default router;
