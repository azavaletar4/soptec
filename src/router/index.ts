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
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (auth.loading) await auth.init();

  if (to.meta.requiresAuth && !auth.user) {
    return { name: 'login' };
  }
  if (to.name === 'login' && auth.user) {
    return { name: 'dashboard' };
  }
  return true;
});

export default router;
