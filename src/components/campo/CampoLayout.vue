<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useCampoStore } from '@/stores/campo';
import ToastHost from '@/components/ToastHost.vue';
import ConfirmHost from '@/components/ConfirmHost.vue';
import logoIcon from '@/assets/logo-icon.png';
import { homePath } from '@/lib/navigation';
import { isNativeApp } from '@/lib/nativeApp';
import { useConfirm } from '@/composables/useConfirm';

withDefaults(defineProps<{ title: string; showBack?: boolean }>(), { showBack: false });

const auth = useAuthStore();
const router = useRouter();
const campoStore = useCampoStore();
const online = ref(navigator.onLine);
const accountMenu = ref<HTMLDetailsElement | null>(null);
const accountOpen = ref(false);
const { confirmDialog } = useConfirm();
function closeAccount(focus = false) {
  if (accountMenu.value) {
    accountMenu.value.open = false;
    if (focus) accountMenu.value.querySelector('summary')?.focus();
  }
  accountOpen.value = false;
}
function outsideAccount(event: PointerEvent) {
  if (event.target instanceof Node && !accountMenu.value?.contains(event.target)) closeAccount();
}
watch(() => router.currentRoute.value.fullPath, () => closeAccount());
async function handleRefresh() {
  const ok = await confirmDialog({ title: 'Actualizar vista', message: 'Se recargará la página actual. Los cambios sin guardar en un formulario se perderán.', warning: true, confirmLabel: 'Actualizar' });
  if (ok) window.location.reload();
}

// Preserve the existing role-specific home destination.
const homeTo = computed(() => homePath(auth.role));

async function handleOnline() {
  online.value = true;
  if (campoStore.queuedCount > 0) await campoStore.syncQueued();
}
function handleOffline() {
  online.value = false;
}

async function handleLogout() {
  closeAccount();
  await auth.signOut();
  router.push('/login');
}

onMounted(() => {
  document.addEventListener('pointerdown', outsideAccount);
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  campoStore.refreshQueuedCount();
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outsideAccount);
  window.removeEventListener('online', handleOnline);
  window.removeEventListener('offline', handleOffline);
});
</script>

<template>
  <div class="min-h-screen bg-slate-50 flex flex-col">
    <header class="sticky top-0 z-30 bg-white border-b border-slate-200 px-2 py-2 flex flex-wrap items-center gap-1">
      <button v-if="showBack" class="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-slate-700 focus-visible:outline-2 focus-visible:outline-sky-600" aria-label="Volver" @click="router.back()">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <img v-else :src="logoIcon" alt="SmartRayco" class="w-7 h-7 shrink-0 mx-1" />
      <h1 class="flex-1 min-w-0 text-sm font-semibold leading-snug break-words">{{ title }}</h1>
      <router-link :to="homeTo" class="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-slate-600 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-sky-600" aria-label="Inicio" title="Inicio">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </router-link>
      <button v-if="isNativeApp" class="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-slate-600 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-sky-600" aria-label="Recargar" title="Recargar" @click="handleRefresh">
        <svg class="block w-5 h-5 shrink-0" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 4v5h5M20 20v-5h-5M4.6 9a8 8 0 0 1 14.03-3.36M19.4 15a8 8 0 0 1-14.03 3.36" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <details ref="accountMenu" class="relative shrink-0" @toggle="accountOpen = accountMenu?.open ?? false" @keydown.esc.stop.prevent="closeAccount(true)">
        <summary class="list-none min-h-11 min-w-11 px-2 flex items-center justify-center gap-1 rounded-lg text-slate-700 bg-slate-100 cursor-pointer text-xs font-medium focus-visible:outline-2 focus-visible:outline-sky-600 [&::-webkit-details-marker]:hidden" aria-controls="campo-account-actions" :aria-expanded="accountOpen">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="3" /><path d="M5 21v-3a7 7 0 0 1 14 0v3" stroke-linecap="round" /></svg>
          Cuenta
        </summary>
        <div id="campo-account-actions" class="absolute right-0 top-full mt-2 w-60 max-w-[calc(100vw-1rem)] rounded-xl bg-white border border-slate-200 shadow-lg p-1">
          <router-link v-if="auth.role !== 'TECNICO_RED' || (router.currentRoute.value.name !== 'campo' && router.currentRoute.value.name !== 'campo-mi-custodia')" :to="auth.role === 'TECNICO_RED' ? '/campo/mi-custodia' : '/campo/custodia'" class="flex items-center min-h-11 px-3 text-sm rounded-lg hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-sky-600">Mis equipos y materiales</router-link>
          <router-link to="/cambiar-password" class="flex items-center min-h-11 px-3 text-sm rounded-lg hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-sky-600">Cambiar contraseña</router-link>
          <button class="w-full min-h-11 text-left px-3 text-sm text-red-700 rounded-lg hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-red-600" @click="handleLogout">Cerrar sesión</button>
        </div>
      </details>
      <div v-if="!online || campoStore.queuedCount > 0" class="basis-full px-1 text-xs text-amber-700" role="status">
        <span v-if="!online" title="Sin conexión: los cierres se guardan localmente">Sin señal</span>
        <span v-else>{{ campoStore.syncing ? 'Sincronizando…' : campoStore.queuedCount + ' por sincronizar' }}</span>
      </div>
    </header>

    <!-- pb-32 (no pb-8): deja espacio de sobra para que el boton principal
         ("Completar instalación"/"Resolver avería"...) nunca quede tapado
         por los FAB nativos de Inicio/Actualizar del APK (siempre flotan
         sobre el WebView, el padding de la pagina no los mueve — solo
         garantiza que el scroll maximo deje el contenido por encima de
         donde ellos se dibujan). -->
    <main class="flex-1 p-3 pb-32 max-w-lg w-full mx-auto">
      <slot />
    </main>

    <ToastHost />
    <ConfirmHost />
  </div>
</template>
