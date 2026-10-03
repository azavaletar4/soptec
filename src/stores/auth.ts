import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const session = ref<Session | null>(null);
  const role = ref<string | null>(null);
  // Fase 80: true cuando un SUPERADMIN reseteo esta cuenta a la clave por
  // defecto — el router redirige a /cambiar-password hasta que se resuelva.
  const mustChangePassword = ref(false);
  const loading = ref(true);
  let initialized = false;

  // Control total (eliminar productos/unidades, revertir Kardex, etc.) —
  // ver Fase 58. Getter centralizado para no repetir `role === 'SUPERADMIN'`
  // suelto en cada vista que necesite esta misma puerta.
  const isSuperAdmin = computed(() => role.value === 'SUPERADMIN');

  async function loadRole(userId: string) {
    const { data } = await supabase.from('profiles').select('role, must_change_password').eq('id', userId).single();
    role.value = data?.role ?? null;
    mustChangePassword.value = data?.must_change_password ?? false;
  }

  async function init() {
    if (initialized) return;
    initialized = true;

    const { data } = await supabase.auth.getSession();
    session.value = data.session;
    user.value = data.session?.user ?? null;
    if (user.value) await loadRole(user.value.id);
    loading.value = false;

    // onAuthStateChange cubre tambien TOKEN_REFRESHED (el refresco automatico
    // de supabase-js, que mantiene la sesion activa sin que el usuario vuelva
    // a loguearse) ademas de SIGNED_IN/OUT — session/user siempre quedan al dia.
    supabase.auth.onAuthStateChange((_event, newSession) => {
      session.value = newSession;
      user.value = newSession?.user ?? null;
      if (user.value) loadRole(user.value.id);
      else role.value = null;
    });
  }

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // Se resuelve el rol aqui mismo (no solo via onAuthStateChange, que es
    // async y podria no haber terminado cuando signIn() retorna) para que
    // quien llama pueda decidir a donde redirigir sin una carrera.
    if (data.user) {
      user.value = data.user;
      session.value = data.session;
      await loadRole(data.user.id);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  // Cambio de contraseña por el propio usuario (voluntario, o para resolver
  // un mustChangePassword forzado) — pasa por el backend porque RLS no deja
  // que un usuario normal escriba su propia fila de profiles (solo
  // SUPERADMIN/ADMIN), y esta accion necesita limpiar must_change_password.
  async function changePassword(currentPassword: string, newPassword: string) {
    await apiFetch('/api/users/me/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
    mustChangePassword.value = false;
  }

  return {
    user,
    session,
    role,
    mustChangePassword,
    loading,
    isSuperAdmin,
    init,
    signIn,
    signOut,
    changePassword,
  };
});
