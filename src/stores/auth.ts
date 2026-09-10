import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const session = ref<Session | null>(null);
  const loading = ref(true);
  let initialized = false;

  async function init() {
    if (initialized) return;
    initialized = true;

    const { data } = await supabase.auth.getSession();
    session.value = data.session;
    user.value = data.session?.user ?? null;
    loading.value = false;

    supabase.auth.onAuthStateChange((_event, newSession) => {
      session.value = newSession;
      user.value = newSession?.user ?? null;
    });
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return { user, session, loading, init, signIn, signOut };
});
