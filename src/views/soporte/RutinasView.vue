<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import CrewAssignEditor from '@/components/soporte/CrewAssignEditor.vue';
import DateRangeFilter, { type DateRange } from '@/components/soporte/DateRangeFilter.vue';
import { useRoutinesStore } from '@/stores/routines';
import { useClientsStore } from '@/stores/clients';
import { useCatalogsStore } from '@/stores/catalogs';
import { useInfraElementosStore } from '@/stores/infraElementos';
import { useJobAssigneesStore } from '@/stores/jobAssignees';
import { useAuthStore } from '@/stores/auth';
import { useToast } from '@/composables/useToast';
import { getErrorMessage } from '@/lib/errors';
import { PRIORITY_CLASS, PRIORITY_LABEL } from '@/lib/ticketPriority';
import { TURNOS, todayStr, dateTimeToIso } from '@/lib/turnos';
import type { Routine, RoutineStatus, RoutineTipo, TicketPriority } from '@/types/domain';

// Mantenimiento preventivo / peinado de NAPs (Fase 101) — 3er tipo de orden
// junto a Tickets (averias) e Instalaciones (altas). Reusa job_assignees
// (cuadrilla) y la App de Campo igual que esos dos; a diferencia de ellos,
// una rutina puede apuntar a una zona/caja NAP sin ser de un cliente puntual
// (zone_id/nap_elemento_id/client_id son todos opcionales).

const route = useRoute();
const router = useRouter();
const routinesStore = useRoutinesStore();
const clientsStore = useClientsStore();
const catalogsStore = useCatalogsStore();
const infraStore = useInfraElementosStore();
const jobAssigneesStore = useJobAssigneesStore();
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
const technicians = computed(() => catalogsStore.staff.filter((s) => s.role === 'TECNICO_RED'));

// Fase 129: clasificacion amplia (tipo_rutina) + subtipo especifico dentro
// del grupo — reemplaza al selector de `category` (Fase 101) en el modal de
// creacion/edicion, que solo cubria trabajo de Planta Interna.
const TIPO_RUTINA_LABEL: Record<RoutineTipo, string> = {
  servicio_cliente: 'Servicio a Cliente / Adicional',
  logistica: 'Logística / Trámites',
  planta_interna: 'PEXT / Planta Interna',
};
const SUBTIPOS: Record<RoutineTipo, { value: string; label: string }[]> = {
  servicio_cliente: [
    { value: 'tv_box', label: 'Instalación de TV Box' },
    { value: 'mesh', label: 'Instalación de Repetidor Mesh' },
    { value: 'inspeccion', label: 'Inspección' },
  ],
  logistica: [
    { value: 'recojo', label: 'Recojo de encomienda' },
    { value: 'cobranza', label: 'Cobranza' },
    { value: 'publicidad', label: 'Publicidad' },
    { value: 'compras', label: 'Compras' },
  ],
  planta_interna: [
    { value: 'instalacion_nap', label: 'Instalación de NAP' },
    { value: 'trabajos_olt', label: 'Trabajos en OLT' },
    { value: 'cableado_ramal', label: 'Cableado de Ramal' },
    { value: 'clivar', label: 'Clivar' },
    { value: 'otro', label: 'Otro' },
  ],
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
  if (r.direccion_destino) return r.direccion_destino;
  return '—';
}

const filteredRoutines = computed(() => {
  let list = routinesStore.routines;
  if (statusFilter.value !== 'all') list = list.filter((r) => r.status === statusFilter.value);
  const q = searchQuery.value.trim().toLowerCase();
  // Buscar por texto consulta TODA la base, ignorando el rango de fecha
  // activo (igual criterio que Instalaciones/Operaciones de Hoy/Historico).
  if (dateRange.value && !q) {
    const { start, end } = dateRange.value;
    list = list.filter((r) => {
      const ref = r.scheduled_date ? new Date(`${r.scheduled_date}T12:00:00`) : new Date(r.created_at);
      const t = ref.getTime();
      return t >= start.getTime() && t <= end.getTime();
    });
  }
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
  // Deep link desde "Operaciones de Hoy" (Fase 107): ?q= precarga el
  // buscador (click en una fila de Rutina), ?create=1 abre el modal de
  // creación directo (botón "+ Rutina").
  const q = route.query.q as string | undefined;
  if (q) searchQuery.value = q;
  if (route.query.create) openCreate();
});

// ---- Crear / Editar ----
const showModal = ref(false);
const saving = ref(false);
const formError = ref<string | null>(null);
const editingRoutine = ref<Routine | null>(null);
const clientFilter = ref('');

type TargetKind = 'none' | 'client' | 'zone' | 'nap' | 'direccion';
const targetKind = ref<TargetKind>('none');

const emptyForm = () => ({
  title: '',
  description: '',
  tipo_rutina: 'planta_interna' as RoutineTipo,
  subtipo: SUBTIPOS.planta_interna[0].value,
  priority: 'medium' as TicketPriority,
  // Fase 130 — puntaje para el Ranking de tecnicos, obligatorio (>0): sin
  // regla automatica como Tickets, el admin decide cuanto vale cada rutina.
  points: '' as number | '',
  client_id: '',
  zone_id: '',
  nap_elemento_id: '',
  direccion_destino: '',
  wants_tv_box: false,
  tv_box_qty: 1,
  wants_mesh: false,
  mesh_qty: 1,
  // Mismo default que el agendamiento de Tickets (Fase 104) — asi un turno
  // elegido sin tocar la fecha siempre cae en un dia valido (hoy).
  scheduled_date: todayStr(),
  schedule_turno: '',
  schedule_tech_id: '',
});
const form = ref(emptyForm());

// Al cambiar de grupo, el subtipo elegido deja de pertenecer a ese grupo —
// se reposiciona en la primera opcion del grupo nuevo.
function onTipoRutinaChange() {
  form.value.subtipo = SUBTIPOS[form.value.tipo_rutina][0].value;
}

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
    tipo_rutina: r.tipo_rutina,
    subtipo: r.subtipo ?? SUBTIPOS[r.tipo_rutina][0].value,
    priority: r.priority,
    points: r.points ?? '',
    client_id: r.client_id ?? '',
    zone_id: r.zone_id ?? '',
    nap_elemento_id: r.nap_elemento_id ?? '',
    direccion_destino: r.direccion_destino ?? '',
    wants_tv_box: !!r.adicionales_json?.tv_box,
    tv_box_qty: r.adicionales_json?.tv_box || 1,
    wants_mesh: !!r.adicionales_json?.mesh,
    mesh_qty: r.adicionales_json?.mesh || 1,
    scheduled_date: r.scheduled_date ?? '',
    schedule_turno: '',
    schedule_tech_id: '',
  };
  targetKind.value = r.client_id ? 'client' : r.nap_elemento_id ? 'nap' : r.zone_id ? 'zone' : r.direccion_destino ? 'direccion' : 'none';
  clientFilter.value = '';
  formError.value = null;
  showModal.value = true;
}

async function handleSubmit() {
  if (!form.value.title.trim()) {
    formError.value = 'Ingresa un título';
    return;
  }
  // Fase 130 — sin esto la rutina no suma al Ranking de tecnicos. Solo se
  // exige a quien puede tocar el campo (admin/soporte, ver :disabled abajo);
  // un TECNICO_RED editando una rutina historica sin puntaje (el campo que
  // no puede tocar) no debe quedar bloqueado para guardar otros cambios.
  if (canManage.value && (!form.value.points || Number(form.value.points) <= 0)) {
    formError.value = 'Ingresa el puntaje de la rutina (mayor a 0) — lo necesita el Ranking de técnicos.';
    return;
  }
  // Mismo criterio que el agendamiento directo de Tickets (Fase 104): un
  // turno sin tecnico es valido (queda reservado), un tecnico sin turno no.
  if (form.value.schedule_tech_id && !form.value.schedule_turno) {
    formError.value = 'Asignaste un técnico — selecciona también el turno / hora estimada.';
    return;
  }
  saving.value = true;
  formError.value = null;
  const turno =
    form.value.schedule_turno && form.value.scheduled_date
      ? TURNOS.find((t) => t.value === form.value.schedule_turno)
      : undefined;
  const adicionales_json =
    targetKind.value === 'client' && form.value.client_id
      ? {
          ...(form.value.wants_tv_box ? { tv_box: Number(form.value.tv_box_qty) || 1 } : {}),
          ...(form.value.wants_mesh ? { mesh: Number(form.value.mesh_qty) || 1 } : {}),
        }
      : {};
  const payload = {
    title: form.value.title.trim(),
    description: form.value.description.trim() || null,
    tipo_rutina: form.value.tipo_rutina,
    subtipo: form.value.subtipo || null,
    priority: form.value.priority,
    points: form.value.points === '' ? null : Number(form.value.points),
    client_id: targetKind.value === 'client' ? form.value.client_id || null : null,
    zone_id: targetKind.value === 'zone' ? form.value.zone_id || null : null,
    nap_elemento_id: targetKind.value === 'nap' ? form.value.nap_elemento_id || null : null,
    direccion_destino: targetKind.value === 'direccion' ? form.value.direccion_destino.trim() || null : null,
    adicionales_json,
    scheduled_date: form.value.scheduled_date || null,
    scheduled_start_at: turno ? dateTimeToIso(form.value.scheduled_date, turno.start) : null,
    scheduled_end_at: turno ? dateTimeToIso(form.value.scheduled_date, turno.end) : null,
  };
  try {
    if (editingRoutine.value) {
      await routinesStore.updateRoutine(editingRoutine.value.id, payload);
      toast.success('Rutina actualizada');
    } else {
      const created = await routinesStore.createRoutine({
        ...payload,
        assigned_to: form.value.schedule_tech_id || null,
        status: turno || form.value.scheduled_date ? 'scheduled' : 'pending',
      });
      // El insert de arriba solo deja el "espejo" assigned_to — para que la
      // cuadrilla (job_assignees) quede consistente desde el inicio (igual
      // patron que Instalaciones/Tickets, Fase 94/104).
      if (form.value.schedule_tech_id) {
        await jobAssigneesStore.addAssignee('routine', created.id, form.value.schedule_tech_id, []);
      }
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
        <button class="text-xs text-sky-700 hover:underline mt-1" @click="router.push('/soporte')">
          ← Volver a Operaciones de Hoy
        </button>
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
            <span class="flex gap-1.5">
              <span class="badge text-[10px]" :class="PRIORITY_CLASS[r.priority]">{{ PRIORITY_LABEL[r.priority] }}</span>
              <span class="badge text-[10px]" :class="STATUS_CLASS[r.status]">{{ STATUS_LABEL[r.status] }}</span>
            </span>
          </div>
          <div class="text-slate-900 font-medium mb-1">{{ r.title }}</div>
          <div class="text-xs text-slate-500 mb-1">{{ TIPO_RUTINA_LABEL[r.tipo_rutina] }} · {{ targetLabel(r) }}</div>
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
              <th class="text-left px-4 py-3">Tipo</th>
              <th class="text-left px-4 py-3">Destino</th>
              <th class="text-left px-4 py-3">Fecha</th>
              <th class="text-left px-4 py-3">Prioridad</th>
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
              <td class="px-4 py-3 text-slate-600">
                {{ TIPO_RUTINA_LABEL[r.tipo_rutina] }}
                <span v-if="r.subtipo" class="text-slate-400">· {{ r.subtipo }}</span>
              </td>
              <td class="px-4 py-3 text-slate-600">{{ targetLabel(r) }}</td>
              <td class="px-4 py-3 text-slate-600">{{ formatDate(r.scheduled_date) }}</td>
              <td class="px-4 py-3">
                <span class="badge" :class="PRIORITY_CLASS[r.priority]">{{ PRIORITY_LABEL[r.priority] }}</span>
              </td>
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
              <label class="block text-xs text-slate-600 mb-1">Tipo de rutina</label>
              <select v-model="form.tipo_rutina" class="field-input" @change="onTipoRutinaChange">
                <option v-for="(label, value) in TIPO_RUTINA_LABEL" :key="value" :value="value">{{ label }}</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Subtipo</label>
              <select v-model="form.subtipo" class="field-input">
                <option v-for="s in SUBTIPOS[form.tipo_rutina]" :key="s.value" :value="s.value">{{ s.label }}</option>
              </select>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Fecha programada</label>
              <input v-model="form.scheduled_date" type="date" class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Turno / hora estimada</label>
              <select v-model="form.schedule_turno" class="field-input">
                <option value="">Sin agendar</option>
                <option v-for="t in TURNOS" :key="t.value" :value="t.value">{{ t.label }}</option>
              </select>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Prioridad</label>
              <select v-model="form.priority" class="field-input" :disabled="!canManage">
                <option v-for="(label, value) in PRIORITY_LABEL" :key="value" :value="value">{{ label }}</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Puntaje asignado *</label>
              <input
                v-model.number="form.points"
                type="number"
                min="1"
                step="1"
                required
                placeholder="Ej. 2 trámite simple, 15 mantenimiento NAP"
                class="field-input"
                :disabled="!canManage"
              />
            </div>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Destino (opcional)</label>
            <select v-model="targetKind" class="field-input mb-2">
              <option value="none">General / sin destino puntual</option>
              <option value="client">Cliente puntual</option>
              <option value="zone">Zona</option>
              <option value="nap">Caja NAP</option>
              <option value="direccion">Dirección de texto libre</option>
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

            <input
              v-if="targetKind === 'direccion'"
              v-model="form.direccion_destino"
              placeholder="Ej. Agencia de Transportes Flores, Sector 4 Alto Trujillo..."
              class="field-input"
            />

            <!-- Adicionales de stock (Fase 129): solo tiene sentido con un cliente puntual seleccionado. -->
            <div v-if="targetKind === 'client' && form.client_id" class="mt-3 pt-3 border-t border-slate-100">
              <p class="text-xs font-semibold text-slate-700 mb-2">Adicionales a llevar de stock</p>
              <div class="flex items-center gap-2 mb-2">
                <input id="wants_tv_box" v-model="form.wants_tv_box" type="checkbox" />
                <label for="wants_tv_box" class="text-sm text-slate-700">Agregar TV Box</label>
                <input
                  v-if="form.wants_tv_box"
                  v-model.number="form.tv_box_qty"
                  type="number"
                  min="1"
                  class="field-input w-20 text-sm"
                />
              </div>
              <div class="flex items-center gap-2">
                <input id="wants_mesh" v-model="form.wants_mesh" type="checkbox" />
                <label for="wants_mesh" class="text-sm text-slate-700">Agregar Repetidor Mesh</label>
                <input
                  v-if="form.wants_mesh"
                  v-model.number="form.mesh_qty"
                  type="number"
                  min="1"
                  class="field-input w-20 text-sm"
                />
              </div>
            </div>
          </div>

          <!-- Asignacion directa al crear (Fase 129, mismo patron que Tickets/Fase 104) — al editar se usa la Cuadrilla de abajo. -->
          <div v-if="!editingRoutine" class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Técnico / cuadrilla asignada (opcional)</label>
            <select v-model="form.schedule_tech_id" class="field-input">
              <option value="">Sin asignar</option>
              <option v-for="t in technicians" :key="t.id" :value="t.id">{{ t.full_name || t.email }}</option>
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
