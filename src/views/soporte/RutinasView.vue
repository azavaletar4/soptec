<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import SoporteModeTabs from '@/components/soporte/SoporteModeTabs.vue';
import CrewAssignEditor from '@/components/soporte/CrewAssignEditor.vue';
import DateRangeFilter, { type DateRange } from '@/components/soporte/DateRangeFilter.vue';
import { useRoutinesStore } from '@/stores/routines';
import { useClientsStore } from '@/stores/clients';
import { useCatalogsStore } from '@/stores/catalogs';
import { useInfraElementosStore } from '@/stores/infraElementos';
import { useAuthStore } from '@/stores/auth';
import { useToast } from '@/composables/useToast';
import { getErrorMessage } from '@/lib/errors';
import type { Routine, RoutineCategory, RoutineStatus } from '@/types/domain';

// Mantenimiento preventivo / peinado de NAPs (Fase 101) — 3er tipo de orden
// junto a Tickets (averias) e Instalaciones (altas). Reusa job_assignees
// (cuadrilla) y la App de Campo igual que esos dos; a diferencia de ellos,
// una rutina puede apuntar a una zona/caja NAP sin ser de un cliente puntual
// (zone_id/nap_elemento_id/client_id son todos opcionales).

const router = useRouter();
const routinesStore = useRoutinesStore();
const clientsStore = useClientsStore();
const catalogsStore = useCatalogsStore();
const infraStore = useInfraElementosStore();
const auth = useAuthStore();
const toast = useToast();

// Armar la cuadrilla y crear/borrar rutinas es una decision de despacho,
// mismo set de roles que ya abre job_assignees (Fase 94) e Instalaciones.
const canManage = computed(() => ['SUPERADMIN', 'ADMIN', 'SOPORTE'].includes(auth.role ?? ''));

function canEdit(r: Routine): boolean {
  if (canManage.value) return true;
  return auth.role === 'TECNICO_RED' && r.assigned_to === auth.user?.id;
}

const napElementos = computed(() => infraStore.elementos.filter((e) => e.tipo === 'caja_nap'));

const CATEGORY_LABEL: Record<RoutineCategory, string> = {
  peinado_nap: 'Peinado de NAP',
  mantenimiento_preventivo: 'Mantenimiento preventivo',
  revision_zona: 'Revisión de zona',
  otro: 'Otro',
};
const STATUS_LABEL: Record<RoutineStatus, string> = {
  pending: 'Pendiente',
  scheduled: 'Programada',
  in_progress: 'En progreso',
  completed: 'Completada',
  cancelled: 'Cancelada',
};
const STATUS_CLASS: Record<RoutineStatus, string> = {
  pending: 'bg-yellow-500/15 text-yellow-600',
  scheduled: 'bg-sky-500/15 text-sky-700',
  in_progress: 'bg-sky-500/15 text-sky-700',
  completed: 'bg-green-500/15 text-green-600',
  cancelled: 'bg-slate-500/15 text-slate-600',
};
const STATUS_TABS: { value: RoutineStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'scheduled', label: 'Programadas' },
  { value: 'in_progress', label: 'En progreso' },
  { value: 'completed', label: 'Completadas' },
  { value: 'cancelled', label: 'Canceladas' },
];
const STATUS_SORT_TIER: Record<RoutineStatus, number> = {
  pending: 0,
  scheduled: 0,
  in_progress: 0,
  completed: 1,
  cancelled: 1,
};

const statusFilter = ref<RoutineStatus | 'all'>('all');
const searchQuery = ref('');
const dateRange = ref<DateRange | null>(null);

function targetLabel(r: Routine): string {
  if (r.clients) return `${r.clients.first_name} ${r.clients.last_name}`;
  if (r.nap_elemento) return `Caja NAP · ${r.nap_elemento.name}`;
  if (r.zones) return `Zona · ${r.zones.name}`;
  return '—';
}

const filteredRoutines = computed(() => {
  let list = routinesStore.routines;
  if (statusFilter.value !== 'all') list = list.filter((r) => r.status === statusFilter.value);
  if (dateRange.value) {
    const { start, end } = dateRange.value;
    list = list.filter((r) => {
      const ref = r.scheduled_date ? new Date(`${r.scheduled_date}T12:00:00`) : new Date(r.created_at);
      const t = ref.getTime();
      return t >= start.getTime() && t <= end.getTime();
    });
  }
  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    list = list.filter((r) => `${r.title} ${r.routine_number ?? ''} ${targetLabel(r)}`.toLowerCase().includes(q));
  }
  return [...list].sort((a, b) => {
    const tierDiff = STATUS_SORT_TIER[a.status] - STATUS_SORT_TIER[b.status];
    if (tierDiff !== 0) return tierDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
});

onMounted(async () => {
  await Promise.all([
    routinesStore.fetchRoutines(),
    clientsStore.fetchClients(),
    catalogsStore.fetchStaff(),
    catalogsStore.fetchZones(),
    infraStore.fetchElementos(),
  ]);
});

// ---- Crear / Editar ----
const showModal = ref(false);
const saving = ref(false);
const formError = ref<string | null>(null);
const editingRoutine = ref<Routine | null>(null);
const clientFilter = ref('');

type TargetKind = 'none' | 'client' | 'zone' | 'nap';
const targetKind = ref<TargetKind>('none');

const emptyForm = () => ({
  title: '',
  description: '',
  category: 'mantenimiento_preventivo' as RoutineCategory,
  client_id: '',
  zone_id: '',
  nap_elemento_id: '',
  scheduled_date: '',
});
const form = ref(emptyForm());

const filteredClients = computed(() => {
  const q = clientFilter.value.trim().toLowerCase();
  const list = clientsStore.clients;
  if (!q) return list.slice(0, 30);
  return list.filter((c) => `${c.first_name} ${c.last_name} ${c.document_number}`.toLowerCase().includes(q)).slice(0, 30);
});

function openCreate() {
  editingRoutine.value = null;
  form.value = emptyForm();
  targetKind.value = 'none';
  clientFilter.value = '';
  formError.value = null;
  showModal.value = true;
}

function openEdit(r: Routine) {
  editingRoutine.value = r;
  form.value = {
    title: r.title,
    description: r.description ?? '',
    category: r.category,
    client_id: r.client_id ?? '',
    zone_id: r.zone_id ?? '',
    nap_elemento_id: r.nap_elemento_id ?? '',
    scheduled_date: r.scheduled_date ?? '',
  };
  targetKind.value = r.client_id ? 'client' : r.nap_elemento_id ? 'nap' : r.zone_id ? 'zone' : 'none';
  clientFilter.value = '';
  formError.value = null;
  showModal.value = true;
}

async function handleSubmit() {
  if (!form.value.title.trim()) {
    formError.value = 'Ingresa un título';
    return;
  }
  saving.value = true;
  formError.value = null;
  const payload = {
    title: form.value.title.trim(),
    description: form.value.description.trim() || null,
    category: form.value.category,
    client_id: targetKind.value === 'client' ? form.value.client_id || null : null,
    zone_id: targetKind.value === 'zone' ? form.value.zone_id || null : null,
    nap_elemento_id: targetKind.value === 'nap' ? form.value.nap_elemento_id || null : null,
    scheduled_date: form.value.scheduled_date || null,
  };
  try {
    if (editingRoutine.value) {
      await routinesStore.updateRoutine(editingRoutine.value.id, payload);
      toast.success('Rutina actualizada');
    } else {
      await routinesStore.createRoutine({ ...payload, status: form.value.scheduled_date ? 'scheduled' : 'pending' });
      toast.success('Rutina creada');
    }
    showModal.value = false;
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al guardar la rutina');
  } finally {
    saving.value = false;
  }
}

async function handleStatusChange(r: Routine, status: RoutineStatus) {
  try {
    await routinesStore.updateStatus(r.id, status);
  } catch (e) {
    toast.error(getErrorMessage(e, 'Error al cambiar el estado'));
  }
}

const deletingId = ref<string | null>(null);
async function handleDelete(r: Routine) {
  if (!confirm(`¿Eliminar la rutina ${r.routine_number}? Esta acción no se puede deshacer.`)) return;
  deletingId.value = r.id;
  try {
    await routinesStore.deleteRoutine(r.id);
  } catch (e) {
    toast.error(getErrorMessage(e, 'Error al eliminar la rutina'));
  } finally {
    deletingId.value = null;
  }
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(`${value}T12:00:00`).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <h1 class="text-2xl font-semibold">Rutinas</h1>
        <p class="text-slate-600 text-sm mt-1">{{ routinesStore.routines.length }} rutinas registradas</p>
        <SoporteModeTabs active="rutinas" class="mt-3" />
      </div>
      <div class="flex gap-2">
        <button v-if="canManage" class="btn-ghost" @click="router.push('/soporte/agenda')">📅 Agenda</button>
        <button v-if="canManage" class="btn-primary" @click="openCreate">+ Nueva rutina</button>
      </div>
    </div>

    <div class="surface flex flex-col gap-3 p-3 mb-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input v-model="searchQuery" placeholder="Buscar por título, número o cliente/zona..." class="field-input sm:max-w-xs" />
        <div class="flex flex-wrap gap-2">
          <button
            v-for="tab in STATUS_TABS"
            :key="tab.value"
            class="px-3 py-1.5 rounded-lg text-xs font-medium"
            :class="statusFilter === tab.value ? 'bg-sky-500 text-slate-950' : 'bg-slate-100 text-slate-600 hover:text-slate-900'"
            @click="statusFilter = tab.value"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>
      <DateRangeFilter @change="dateRange = $event" />
    </div>

    <p v-if="routinesStore.error" class="mb-4 text-sm text-red-600">{{ routinesStore.error }}</p>
    <p v-if="routinesStore.loading" class="text-center text-slate-500 py-6">Cargando...</p>
    <p v-else-if="!filteredRoutines.length" class="text-center text-slate-500 py-6">No hay rutinas en este filtro.</p>

    <template v-else>
      <!-- Movil: cards -->
      <div class="flex flex-col gap-3 sm:hidden">
        <div v-for="r in filteredRoutines" :key="r.id" class="surface p-3 cursor-pointer" @click="canEdit(r) && openEdit(r)">
          <div class="flex items-start justify-between gap-2 mb-1.5">
            <span class="font-mono text-xs text-slate-500">{{ r.routine_number }}</span>
            <span class="badge text-[10px]" :class="STATUS_CLASS[r.status]">{{ STATUS_LABEL[r.status] }}</span>
          </div>
          <div class="text-slate-900 font-medium mb-1">{{ r.title }}</div>
          <div class="text-xs text-slate-500 mb-1">{{ CATEGORY_LABEL[r.category] }} · {{ targetLabel(r) }}</div>
          <div class="text-xs text-slate-500">
            {{ formatDate(r.scheduled_date) }} · {{ r.assigned_profile?.full_name || r.assigned_profile?.email || 'Sin asignar' }}
          </div>
        </div>
      </div>

      <!-- Desktop: tabla -->
      <div class="table-shell hidden sm:block">
        <table class="w-full text-sm min-w-[760px]">
          <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
            <tr>
              <th class="text-left px-4 py-3">Rutina</th>
              <th class="text-left px-4 py-3">Categoría</th>
              <th class="text-left px-4 py-3">Destino</th>
              <th class="text-left px-4 py-3">Fecha</th>
              <th class="text-left px-4 py-3">Estado</th>
              <th class="text-left px-4 py-3">Asignado</th>
              <th class="text-right px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in filteredRoutines"
              :key="r.id"
              class="border-t border-slate-200 hover:bg-slate-50"
              :class="canEdit(r) ? 'cursor-pointer' : ''"
              @click="canEdit(r) && openEdit(r)"
            >
              <td class="px-4 py-3">
                <div class="font-mono text-xs text-slate-500">{{ r.routine_number }}</div>
                <div class="text-slate-900">{{ r.title }}</div>
              </td>
              <td class="px-4 py-3 text-slate-600">{{ CATEGORY_LABEL[r.category] }}</td>
              <td class="px-4 py-3 text-slate-600">{{ targetLabel(r) }}</td>
              <td class="px-4 py-3 text-slate-600">{{ formatDate(r.scheduled_date) }}</td>
              <td class="px-4 py-3">
                <span class="badge" :class="STATUS_CLASS[r.status]">{{ STATUS_LABEL[r.status] }}</span>
              </td>
              <td class="px-4 py-3 text-slate-600">{{ r.assigned_profile?.full_name || r.assigned_profile?.email || 'Sin asignar' }}</td>
              <td class="px-4 py-3 text-right whitespace-nowrap" @click.stop>
                <button
                  v-if="canManage"
                  class="text-xs text-red-500/80 hover:text-red-600"
                  :disabled="deletingId === r.id"
                  @click="handleDelete(r)"
                >
                  {{ deletingId === r.id ? 'Eliminando...' : 'Eliminar' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay">
        <form class="w-full max-w-lg modal-panel max-h-[90vh] overflow-y-auto" @submit.prevent="handleSubmit">
          <h2 class="text-lg font-semibold mb-4">{{ editingRoutine ? 'Editar rutina' : 'Nueva rutina' }}</h2>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Título</label>
            <input v-model="form.title" required class="field-input" placeholder="Ej. Peinado de NAP sector 4" />
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Descripción</label>
            <textarea v-model="form.description" rows="2" class="field-input"></textarea>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Categoría</label>
              <select v-model="form.category" class="field-input">
                <option v-for="(label, value) in CATEGORY_LABEL" :key="value" :value="value">{{ label }}</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Fecha programada</label>
              <input v-model="form.scheduled_date" type="date" class="field-input" />
            </div>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Destino (opcional)</label>
            <select v-model="targetKind" class="field-input mb-2">
              <option value="none">General / sin destino puntual</option>
              <option value="client">Cliente puntual</option>
              <option value="zone">Zona</option>
              <option value="nap">Caja NAP</option>
            </select>

            <input
              v-if="targetKind === 'client'"
              v-model="clientFilter"
              placeholder="Buscar cliente por nombre o documento..."
              class="field-input mb-2"
            />
            <select v-if="targetKind === 'client'" v-model="form.client_id" class="field-input" size="5">
              <option v-for="c in filteredClients" :key="c.id" :value="c.id">{{ c.first_name }} {{ c.last_name }} — {{ c.document_number }}</option>
            </select>

            <select v-if="targetKind === 'zone'" v-model="form.zone_id" class="field-input">
              <option value="">Selecciona la zona...</option>
              <option v-for="z in catalogsStore.zones" :key="z.id" :value="z.id">{{ z.name }}</option>
            </select>

            <select v-if="targetKind === 'nap'" v-model="form.nap_elemento_id" class="field-input">
              <option value="">Selecciona la caja NAP...</option>
              <option v-for="n in napElementos" :key="n.id" :value="n.id">{{ n.name }}</option>
            </select>
          </div>

          <template v-if="editingRoutine">
            <div class="mb-3 pt-3 border-t border-slate-100">
              <label class="block text-xs text-slate-600 mb-1">Cuadrilla</label>
              <CrewAssignEditor
                job-type="routine"
                :job-id="editingRoutine.id"
                :technicians="catalogsStore.staff.filter((s) => s.role === 'TECNICO_RED')"
                :readonly="!canManage"
              />
            </div>

            <div class="mb-3">
              <label class="block text-xs text-slate-600 mb-1">Estado</label>
              <select
                :value="editingRoutine.status"
                class="field-input"
                :disabled="!canManage && auth.role !== 'TECNICO_RED'"
                @change="handleStatusChange(editingRoutine, ($event.target as HTMLSelectElement).value as RoutineStatus)"
              >
                <option v-for="(label, value) in STATUS_LABEL" :key="value" :value="value">{{ label }}</option>
              </select>
            </div>

            <p v-if="editingRoutine.closure_notes" class="text-xs text-slate-500 mb-3">
              Notas de cierre: {{ editingRoutine.closure_notes }}
            </p>
          </template>

          <p v-if="formError" class="text-sm text-red-600 mb-3">{{ formError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showModal = false">Cancelar</button>
            <button type="submit" :disabled="saving" class="btn-primary">
              {{ saving ? 'Guardando...' : editingRoutine ? 'Guardar cambios' : 'Crear rutina' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
