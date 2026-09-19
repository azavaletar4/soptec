import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const session = ref<Session | null>(null);
  const role = ref<string | null>(null);
  const loading = ref(true);
  let initialized = false;

  async function loadRole(userId: string) {
    const { data } = await supabase.from('profiles').select('role').eq('id', userId).single();
    role.value = data?.role ?? null;
  }

  async function init() {
    if (initialized) return;
    initialized = true;

    const { data } = await supabase.auth.getSession();
    session.value = data.session;
    user.value = data.session?.user ?? null;
    if (user.value) await loadRole(user.value.id);
    loading.value = false;

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

  return { user, session, role, loading, init, signIn, signOut };
});
