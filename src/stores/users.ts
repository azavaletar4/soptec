import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiFetch } from '@/lib/api';
import type { StaffRole, UserAccount } from '@/types/domain';

export const useUsersStore = defineStore('users', () => {
  const users = ref<UserAccount[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchUsers() {
    loading.value = true;
    error.value = null;
    try {
      users.value = await apiFetch<UserAccount[]>('/api/users');
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function createUser(payload: { email: string; password: string; full_name: string; role: StaffRole }) {
    const created = await apiFetch<UserAccount>('/api/users', { method: 'POST', body: JSON.stringify(payload) });
    users.value.unshift(created);
    return created;
  }

  async function updateUser(
    id: string,
    payload: Partial<{ full_name: string; role: StaffRole; active: boolean; password: string }>,
  ) {
    const updated = await apiFetch<UserAccount>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    const idx = users.value.findIndex((u) => u.id === id);
    if (idx !== -1) users.value[idx] = updated;
    return updated;
  }

  async function deleteUser(id: string) {
    await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
    users.value = users.value.filter((u) => u.id !== id);
  }

  return { users, loading, error, fetchUsers, createUser, updateUser, deleteUser };
});
