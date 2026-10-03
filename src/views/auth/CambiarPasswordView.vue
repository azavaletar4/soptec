<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useAsyncAction } from '@/composables/useAsyncAction';
import { useToast } from '@/composables/useToast';
import logoIcon from '@/assets/logo-icon.png';

const router = useRouter();
const auth = useAuthStore();
const toast = useToast();

// Si entro aqui porque un SUPERADMIN le reseteo la clave (Fase 80), el
// router ya lo trajo a la fuerza y no hay forma de salir sin completar el
// formulario (ver guard en router/index.ts) — por eso el unico escape que se
// ofrece es cerrar sesion.
const forced = auth.mustChangePassword;

const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');

const { loading: saving, error: formError, run: submit } = useAsyncAction(async () => {
  if (newPassword.value.length < 8) throw new Error('La nueva contraseña debe tener al menos 8 caracteres');
  if (newPassword.value !== confirmPassword.value) throw new Error('Las contraseñas nuevas no coinciden');
  await auth.changePassword(currentPassword.value, newPassword.value);
}, 'Error al cambiar la contraseña');

async function handleSubmit() {
  await submit();
  if (formError.value) return;
  toast.success('Contraseña actualizada');
  // Deja que el guard del router decida a donde ir segun el rol (mismo
  // destino que tras el login) en vez de duplicar esa logica aqui.
  router.push('/');
}

async function handleLogout() {
  await auth.signOut();
  router.push('/login');
}
</script>

<template>
  <main class="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
    <div class="pointer-events-none absolute -top-40 -left-40 w-96 h-96 rounded-full bg-sky-500/10 blur-3xl"></div>
    <div class="pointer-events-none absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-sky-500/10 blur-3xl"></div>

    <form class="w-full max-w-sm modal-panel relative" @submit.prevent="handleSubmit">
      <div class="flex flex-col items-center text-center mb-6">
        <img :src="logoIcon" alt="SmartRayco" class="w-14 h-14 mb-3" />
        <h1 class="text-xl font-bold">{{ forced ? 'Debes cambiar tu contraseña' : 'Cambiar contraseña' }}</h1>
        <p class="text-sm text-slate-500 mt-1">
          {{
            forced
              ? 'Un administrador restableció tu contraseña. Elige una nueva antes de continuar.'
              : 'Ingresa tu contraseña actual y la nueva.'
          }}
        </p>
      </div>

      <label class="field-label">Contraseña actual</label>
      <input v-model="currentPassword" type="password" placeholder="••••••••" required class="field-input mb-3" />

      <label class="field-label">Nueva contraseña</label>
      <input v-model="newPassword" type="password" placeholder="Mínimo 8 caracteres" required class="field-input mb-3" />

      <label class="field-label">Confirmar nueva contraseña</label>
      <input v-model="confirmPassword" type="password" placeholder="Repite la nueva contraseña" required class="field-input mb-5" />

      <p v-if="formError" class="text-sm text-red-600 mb-3 text-center">{{ formError }}</p>

      <button type="submit" :disabled="saving" class="btn-primary w-full mb-3">
        {{ saving ? 'Guardando...' : 'Guardar nueva contraseña' }}
      </button>

      <button type="button" class="text-xs text-slate-500 hover:text-slate-700 w-full text-center" @click="handleLogout">
        Cerrar sesión
      </button>
    </form>
  </main>
</template>
