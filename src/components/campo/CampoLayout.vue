<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useCampoStore } from '@/stores/campo';
import logoIcon from '@/assets/logo-icon.png';

withDefaults(defineProps<{ title: string; showBack?: boolean }>(), { showBack: false });

const auth = useAuthStore();
const router = useRouter();
const campoStore = useCampoStore();
const online = ref(navigator.onLine);

async function handleOnline() {
  online.value = true;
  if (campoStore.queuedCount > 0) await campoStore.syncQueued();
}
function handleOffline() {
  online.value = false;
}

async function handleLogout() {
  await auth.signOut();
  router.push('/login');
}

onMounted(() => {
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  campoStore.refreshQueuedCount();
});
onBeforeUnmount(() => {
  window.removeEventListener('online', handleOnline);
  window.removeEventListener('offline', handleOffline);
});
</script>

<template>
  <div class="min-h-screen bg-slate-50 flex flex-col">
    <header class="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">
      <button
        v-if="showBack"
        class="p-2 -ml-2 rounded-lg text-slate-700 hover:bg-slate-100 active:scale-95 transition-transform"
        aria-label="Volver"
        @click="router.back()"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <img v-else :src="logoIcon" alt="" class="w-7 h-7 shrink-0" />
      <h1 class="flex-1 text-base font-semibold truncate">{{ title }}</h1>

      <span
        v-if="!online"
        class="badge bg-amber-500/15 text-amber-700 text-[10px]"
        title="Sin conexión: los cierres se guardan localmente"
      >
        Sin señal
      </span>
      <span
        v-else-if="campoStore.queuedCount > 0"
        class="badge bg-sky-500/15 text-sky-700 text-[10px]"
        :title="campoStore.syncing ? 'Sincronizando...' : 'Pendiente por sincronizar'"
      >
        {{ campoStore.syncing ? 'Sincronizando…' : `${campoStore.queuedCount} por sincronizar` }}
      </span>

      <button
        class="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-500/10 transition-colors"
        aria-label="Cerrar sesión"
        @click="handleLogout"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 17l5-5-5-5M21 12H9" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </header>

    <main class="flex-1 p-3 pb-8 max-w-lg w-full mx-auto">
      <slot />
    </main>
  </div>
</template>
