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
    router.push(auth.role === 'TECNICO_RED' ? '/instalaciones' : '/dashboard');
  } catch (e) {
    error.value = getErrorMessage(e, 'Error al iniciar sesion');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
    <div
      class="pointer-events-none absolute -top-40 -left-40 w-96 h-96 rounded-full bg-sky-500/10 blur-3xl"
    ></div>
    <div
      class="pointer-events-none absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-sky-500/10 blur-3xl"
    ></div>

    <form class="w-full max-w-sm modal-panel relative" @submit.prevent="handleSubmit">
      <div class="flex flex-col items-center text-center mb-6">
        <img :src="logoIcon" alt="SmartRayco" class="w-16 h-16 mb-3 drop-shadow-[0_0_20px_rgba(14,165,233,0.35)]" />
        <h1 class="text-xl font-bold">SmartRayco</h1>
        <p class="text-sm text-slate-500 mt-1">Ingresa a tu panel de gestión</p>
      </div>

      <label class="field-label">Usuario</label>
      <input
        v-model="username"
        type="text"
        placeholder="usuario"
        required
        autofocus
        autocapitalize="off"
        autocorrect="off"
        class="field-input mb-3"
      />
      <label class="field-label">Contraseña</label>
      <input v-model="password" type="password" placeholder="••••••••" required class="field-input mb-5" />

      <p v-if="error" class="text-sm text-red-600 mb-3 text-center">{{ error }}</p>

      <button type="submit" :disabled="loading" class="btn-primary w-full">
        {{ loading ? 'Ingresando...' : 'Ingresar' }}
      </button>
    </form>
  </main>
</template>
