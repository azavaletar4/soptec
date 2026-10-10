<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { supabase } from '@/lib/supabase';
import { getErrorMessage } from '@/lib/errors';
import logoIcon from '@/assets/logo-icon.png';

const router = useRouter();
const auth = useAuthStore();

const username = ref('');
const password = ref('');
const error = ref<string | null>(null);
const loading = ref(false);
const showPassword = ref(false);

async function handleSubmit() {
  loading.value = true;
  error.value = null;
  try {
    const { data: email, error: lookupErr } = await supabase.rpc('get_email_by_username', {
      p_username: username.value.trim(),
    });
    if (lookupErr || !email) {
      error.value = 'Usuario o contraseña incorrectos';
      return;
    }
    await auth.signIn(email, password.value);
    router.push(auth.role === 'TECNICO_RED' ? '/soporte' : '/dashboard');
  } catch (e) {
    error.value = getErrorMessage(e, 'Error al iniciar sesion');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main
    class="min-h-screen flex items-center justify-center px-4 py-10 relative overflow-hidden bg-gradient-to-br from-sky-50 via-white to-sky-100"
  >
    <div class="pointer-events-none absolute -top-32 -left-32 w-[28rem] h-[28rem] rounded-full bg-sky-400/20 blur-3xl"></div>
    <div class="pointer-events-none absolute -bottom-32 -right-24 w-[28rem] h-[28rem] rounded-full bg-sky-300/25 blur-3xl"></div>
    <div class="pointer-events-none absolute top-1/3 right-1/4 w-72 h-72 rounded-full bg-blue-200/30 blur-3xl"></div>

    <form
      class="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-8 shadow-2xl shadow-sky-900/10 relative"
      @submit.prevent="handleSubmit"
    >
      <div class="flex flex-col items-center text-center mb-6">
        <img :src="logoIcon" alt="" class="w-36 h-36 drop-shadow-[0_8px_24px_rgba(14,165,233,0.35)]" />
        <h1 class="text-3xl font-extrabold tracking-tight -mt-2">
          <span class="text-slate-900">Smart</span><span class="text-sky-500">Rayco</span>
        </h1>
        <p class="text-base text-slate-500 mt-1">Ingresa a tu panel de gestión</p>
      </div>

      <label class="field-label">Usuario</label>
      <div class="relative mb-4">
        <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path
              d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <input
          v-model="username"
          type="text"
          placeholder="usuario"
          required
          autofocus
          autocapitalize="off"
          autocorrect="off"
          class="field-input pl-10"
        />
      </div>

      <label class="field-label">Contraseña</label>
      <div class="relative mb-5">
        <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="5" y="11" width="14" height="9" rx="2" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <input
          v-model="password"
          :type="showPassword ? 'text' : 'password'"
          placeholder="••••••••"
          required
          class="field-input pl-10 pr-10"
        />
        <button
          type="button"
          class="absolute inset-y-0 right-3 flex items-center text-slate-400 hover:text-slate-600"
          :aria-label="showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'"
          @click="showPassword = !showPassword"
        >
          <svg v-if="showPassword" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path
              d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <circle cx="12" cy="12" r="3" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path
              d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M9.88 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a13.2 13.2 0 0 1-3.17 4.1M6.6 6.6C4.2 8.1 2 12 2 12a13.3 13.3 0 0 0 5.17 5.1"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>

      <p v-if="error" class="text-sm text-red-600 mb-3 text-center">{{ error }}</p>

      <button
        type="submit"
        :disabled="loading"
        class="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-semibold text-white
          bg-gradient-to-r from-blue-600 to-sky-400 shadow-lg shadow-sky-500/30
          transition-all duration-150 hover:brightness-105 active:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {{ loading ? 'Ingresando...' : 'Ingresar' }}
        <svg v-if="!loading" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </form>
  </main>
</template>
