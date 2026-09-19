<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useUsersStore } from '@/stores/users';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/lib/errors';
import type { StaffRole, UserAccount } from '@/types/domain';

const usersStore = useUsersStore();
const auth = useAuthStore();

const ROLE_LABEL: Record<StaffRole, string> = {
  SUPERADMIN: 'Super admin',
  ADMIN: 'Administrador',
  TECNICO_RED: 'Técnico de red',
  SOPORTE: 'Soporte',
  FACTURACION: 'Facturación',
};
const ROLES: StaffRole[] = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'];

const searchQuery = ref('');
const filteredUsers = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return usersStore.users;
  return usersStore.users.filter((u) => `${u.full_name ?? ''} ${u.email} ${ROLE_LABEL[u.role]}`.toLowerCase().includes(q));
});

onMounted(() => {
  usersStore.fetchUsers();
});

const showModal = ref(false);
const editing = ref<UserAccount | null>(null);
const saving = ref(false);
const formError = ref<string | null>(null);

const emptyForm = () => ({ full_name: '', email: '', password: '', role: 'TECNICO_RED' as StaffRole });
const form = ref(emptyForm());

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
  form.value.password = out;
}

function openCreate() {
  editing.value = null;
  form.value = emptyForm();
  formError.value = null;
  showModal.value = true;
}

function openEdit(u: UserAccount) {
  editing.value = u;
  form.value = { full_name: u.full_name ?? '', email: u.email, password: '', role: u.role };
  formError.value = null;
  showModal.value = true;
}

async function handleSubmit() {
  saving.value = true;
  formError.value = null;
  try {
    if (editing.value) {
      const payload: Record<string, unknown> = { full_name: form.value.full_name, role: form.value.role };
      if (form.value.password) payload.password = form.value.password;
      await usersStore.updateUser(editing.value.id, payload);
    } else {
      if (!form.value.password || form.value.password.length < 8) {
        formError.value = 'La contraseña debe tener al menos 8 caracteres';
        return;
      }
      await usersStore.createUser(form.value);
    }
    showModal.value = false;
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al guardar el usuario');
  } finally {
    saving.value = false;
  }
}

async function handleToggleActive(u: UserAccount) {
  const action = u.active ? 'desactivar' : 'activar';
  if (!confirm(`¿${action.charAt(0).toUpperCase() + action.slice(1)} a ${u.full_name ?? u.email}?`)) return;
  try {
    await usersStore.updateUser(u.id, { active: !u.active });
  } catch (e) {
    alert(getErrorMessage(e, `Error al ${action} el usuario`));
  }
}

async function handleDelete(u: UserAccount) {
  if (!confirm(`¿Eliminar a ${u.full_name ?? u.email}? Esta acción no se puede deshacer.`)) return;
  try {
    await usersStore.deleteUser(u.id);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al eliminar el usuario'));
  }
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Usuarios</h1>
        <p class="text-slate-600 text-sm mt-1">
          {{ searchQuery ? `${filteredUsers.length} de ${usersStore.users.length}` : `${usersStore.users.length} cuentas de staff` }}
        </p>
      </div>
      <button class="btn-primary" @click="openCreate()">+ Nuevo usuario</button>
    </div>

    <p v-if="usersStore.error" class="mb-4 text-sm text-red-600">{{ usersStore.error }}</p>

    <input v-model="searchQuery" placeholder="Buscar por nombre, correo o rol..." class="field-input mb-6" />

    <div class="table-shell mb-6">
      <table class="w-full text-sm min-w-[720px]">
        <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-3">Nombre</th>
            <th class="text-left px-4 py-3">Correo</th>
            <th class="text-left px-4 py-3">Rol</th>
            <th class="text-left px-4 py-3">Estado</th>
            <th class="text-right px-4 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="usersStore.loading">
            <td colspan="5" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
          </tr>
          <tr v-else-if="!filteredUsers.length">
            <td colspan="5" class="px-4 py-6 text-center text-slate-500">
              {{ searchQuery ? 'Sin resultados para esa búsqueda.' : 'No hay usuarios de staff todavía.' }}
            </td>
          </tr>
          <tr v-for="u in filteredUsers" :key="u.id" class="border-t border-slate-200 hover:bg-slate-50">
            <td class="px-4 py-3 font-medium text-slate-900">
              {{ u.full_name || '—' }}
              <span v-if="u.id === auth.user?.id" class="text-[10px] text-slate-400 ml-1">(tú)</span>
            </td>
            <td class="px-4 py-3 text-slate-600">{{ u.email }}</td>
            <td class="px-4 py-3">
              <span class="badge bg-sky-500/15 text-sky-600">{{ ROLE_LABEL[u.role] }}</span>
            </td>
            <td class="px-4 py-3">
              <span class="badge" :class="u.active ? 'bg-green-500/15 text-green-600' : 'bg-slate-500/15 text-slate-600'">
                {{ u.active ? 'Activo' : 'Desactivado' }}
              </span>
            </td>
            <td class="px-4 py-3 text-right space-x-3 whitespace-nowrap text-xs">
              <button class="text-slate-600 hover:text-slate-900" @click="openEdit(u)">Editar</button>
              <button
                v-if="u.id !== auth.user?.id"
                class="text-amber-600 hover:text-amber-700"
                @click="handleToggleActive(u)"
              >
                {{ u.active ? 'Desactivar' : 'Activar' }}
              </button>
              <button v-if="u.id !== auth.user?.id" class="text-red-500/80 hover:text-red-600" @click="handleDelete(u)">
                Eliminar
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay">
        <form class="w-full max-w-lg modal-panel max-h-[90vh] overflow-y-auto" @submit.prevent="handleSubmit">
          <h2 class="text-lg font-semibold mb-4">{{ editing ? 'Editar usuario' : 'Nuevo usuario' }}</h2>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Nombre completo</label>
            <input v-model="form.full_name" required class="field-input" />
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Correo</label>
            <input v-model="form.email" type="email" required :disabled="!!editing" class="field-input disabled:opacity-60" />
            <p v-if="editing" class="text-[11px] text-slate-400 mt-1">El correo no se puede cambiar desde aquí.</p>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Rol</label>
            <select v-model="form.role" class="field-input">
              <option v-for="r in ROLES" :key="r" :value="r">{{ ROLE_LABEL[r] }}</option>
            </select>
          </div>

          <div class="mb-4">
            <div class="flex items-center justify-between mb-1">
              <label class="block text-xs text-slate-600">{{ editing ? 'Nueva contraseña (opcional)' : 'Contraseña' }}</label>
              <button type="button" class="text-xs text-sky-600 hover:text-sky-700" @click="generatePassword">Generar</button>
            </div>
            <input
              v-model="form.password"
              type="text"
              :placeholder="editing ? 'Dejar en blanco para no cambiarla' : 'Mínimo 8 caracteres'"
              class="field-input font-mono"
            />
          </div>

          <p v-if="formError" class="text-sm text-red-600 mb-3">{{ formError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showModal = false">Cancelar</button>
            <button type="submit" :disabled="saving" class="btn-primary">
              {{ saving ? 'Guardando...' : 'Guardar' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
