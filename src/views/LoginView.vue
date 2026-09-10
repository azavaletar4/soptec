<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/lib/errors';

const router = useRouter();
const auth = useAuthStore();

const email = ref('');
const password = ref('');
const error = ref<string | null>(null);
const loading = ref(false);

async function handleSubmit() {
  loading.value = true;
  error.value = null;
  try {
    await auth.signIn(email.value, password.value);
    router.push('/dashboard');
  } catch (e) {
    error.value = getErrorMessage(e, 'Error al iniciar sesion');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="min-h-screen flex items-center justify-center px-4">
    <form
      class="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900 p-8"
      @submit.prevent="handleSubmit"
    >
      <h1 class="text-xl font-semibold mb-1">SmartRayco</h1>
      <p class="text-sm text-slate-400 mb-6">Ingresa a tu panel de gestion</p>

      <input
        v-model="email"
        type="email"
        placeholder="correo@empresa.com"
        required
        class="w-full mb-3 px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-slate-100 outline-none focus:border-sky-500"
      />
      <input
        v-model="password"
        type="password"
        placeholder="Contrasena"
        required
        class="w-full mb-4 px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-slate-100 outline-none focus:border-sky-500"
      />

      <p v-if="error" class="text-sm text-red-400 mb-3">{{ error }}</p>

      <button
        type="submit"
        :disabled="loading"
        class="w-full py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold disabled:opacity-60"
      >
        {{ loading ? 'Ingresando...' : 'Ingresar' }}
      </button>
    </form>
  </main>
</template>
