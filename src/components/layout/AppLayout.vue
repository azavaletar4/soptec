<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();

const MODULOS = [
  { label: 'Dashboard', to: '/dashboard', disabled: false },
  { label: 'Clientes', to: '/clientes', disabled: false },
  { label: 'Contratos', to: '/contratos/kanban', disabled: false },
  { label: 'Red & OLTs', to: '#', disabled: true },
  { label: 'MikroTik', to: '#', disabled: true },
  { label: 'Facturacion', to: '#', disabled: true },
  { label: 'Soporte', to: '#', disabled: true },
];

async function handleLogout() {
  await auth.signOut();
  router.push('/login');
}
</script>

<template>
  <div class="min-h-screen flex">
    <aside class="w-60 shrink-0 border-r border-slate-800 bg-slate-900 p-4 flex flex-col">
      <div class="text-lg font-semibold mb-6">SmartRayco</div>
      <nav class="flex-1 space-y-1">
        <router-link
          v-for="mod in MODULOS"
          :key="mod.label"
          :to="mod.disabled ? '' : mod.to"
          class="block px-3 py-2 rounded-lg text-sm"
          :class="mod.disabled ? 'text-slate-600 cursor-not-allowed' : 'text-slate-200 hover:bg-slate-800'"
        >
          {{ mod.label }}
        </router-link>
      </nav>
      <button class="text-sm text-slate-400 hover:text-slate-200 text-left" @click="handleLogout">
        Cerrar sesion
      </button>
    </aside>
    <main class="flex-1 p-8">
      <slot />
    </main>
  </div>
</template>
