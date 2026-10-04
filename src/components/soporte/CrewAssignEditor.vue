<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useJobAssigneesStore } from '@/stores/jobAssignees';
import { getErrorMessage } from '@/lib/errors';
import type { JobAssignee, JobType, StaffProfile } from '@/types/domain';

// Modulo de cuadrilla (Fase 94): reemplaza el viejo selector de "1 solo
// tecnico" — un ticket/instalacion puede tener varios, con un lider (cuenta
// completo + puntaje base) y apoyos (comparten el reparto de puntos del
// ranking, calculado en get_technician_ranking). Reusado en
// TicketDetailView e InstalacionesView.
const props = defineProps<{
  jobType: JobType;
  jobId: string;
  technicians: StaffProfile[];
  /** RLS ya bloquea el write a quien no sea SUPERADMIN/ADMIN/SOPORTE — esto solo evita mostrar controles que la BD va a rechazar. */
  readonly?: boolean;
}>();

const store = useJobAssigneesStore();
const assignees = ref<JobAssignee[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const addingTechId = ref('');
const busyTechId = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    assignees.value = await store.fetchAssignees(props.jobType, props.jobId);
  } catch (e) {
    error.value = getErrorMessage(e, 'Error al cargar la cuadrilla');
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => props.jobId, load);

const availableTechnicians = computed(() => {
  const assignedIds = new Set(assignees.value.map((a) => a.technician_id));
  return props.technicians.filter((t) => !assignedIds.has(t.id));
});

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
}

function displayName(a: JobAssignee): string {
  return a.profile?.full_name || a.profile?.email || 'Tecnico';
}

async function handleAdd() {
  if (!addingTechId.value) return;
  busyTechId.value = addingTechId.value;
  error.value = null;
  try {
    await store.addAssignee(props.jobType, props.jobId, addingTechId.value, assignees.value);
    addingTechId.value = '';
    await load();
  } catch (e) {
    error.value = getErrorMessage(e, 'Error al agregar el tecnico');
  } finally {
    busyTechId.value = null;
  }
}

async function handleRemove(a: JobAssignee) {
  busyTechId.value = a.technician_id;
  error.value = null;
  try {
    await store.removeAssignee(props.jobType, props.jobId, a.technician_id);
    await load();
  } catch (e) {
    error.value = getErrorMessage(e, 'Error al quitar el tecnico');
  } finally {
    busyTechId.value = null;
  }
}

async function handleSetLeader(a: JobAssignee) {
  busyTechId.value = a.technician_id;
  error.value = null;
  try {
    await store.setLeader(props.jobType, props.jobId, a.technician_id);
    await load();
  } catch (e) {
    error.value = getErrorMessage(e, 'Error al cambiar el lider');
  } finally {
    busyTechId.value = null;
  }
}
</script>

<template>
  <div>
    <p v-if="loading" class="text-xs text-slate-500">Cargando cuadrilla...</p>
    <template v-else>
      <p v-if="!assignees.length" class="text-xs text-slate-500 mb-2">Sin tecnicos asignados.</p>
      <div v-else class="flex flex-wrap gap-2 mb-2">
        <span
          v-for="a in assignees"
          :key="a.technician_id"
          class="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 pl-1 pr-2 py-1 text-xs"
        >
          <span
            class="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-slate-950"
            :class="a.role === 'leader' ? 'bg-sky-400' : 'bg-slate-300'"
          >
            {{ initials(displayName(a)) }}
          </span>
          <span class="text-slate-800">{{ displayName(a) }}</span>
          <span class="text-slate-500">({{ a.role === 'leader' ? 'Líder' : 'Apoyo' }})</span>
          <button
            v-if="!readonly && a.role !== 'leader'"
            type="button"
            class="text-sky-700 hover:underline"
            :disabled="busyTechId === a.technician_id"
            @click="handleSetLeader(a)"
          >
            ★
          </button>
          <button
            v-if="!readonly"
            type="button"
            class="text-slate-400 hover:text-red-600"
            :disabled="busyTechId === a.technician_id"
            @click="handleRemove(a)"
          >
            ✕
          </button>
        </span>
      </div>

      <div v-if="!readonly" class="flex gap-2">
        <select v-model="addingTechId" class="field-input py-1.5 text-xs flex-1" :disabled="!availableTechnicians.length">
          <option value="">{{ availableTechnicians.length ? '+ Agregar técnico...' : 'Todos ya asignados' }}</option>
          <option v-for="t in availableTechnicians" :key="t.id" :value="t.id">{{ t.full_name || t.email }}</option>
        </select>
        <button
          type="button"
          class="btn-secondary text-xs px-3"
          :disabled="!addingTechId || busyTechId === addingTechId"
          @click="handleAdd"
        >
          Agregar
        </button>
      </div>
      <p v-if="error" class="text-xs text-red-600 mt-1">{{ error }}</p>
    </template>
  </div>
</template>
