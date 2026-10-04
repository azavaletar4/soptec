<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import CrewAssignEditor from '@/components/soporte/CrewAssignEditor.vue';
import { useTicketsStore } from '@/stores/tickets';
import { useCatalogsStore } from '@/stores/catalogs';
import { useInventoryStore } from '@/stores/inventory';
import { useTicketApprovalsStore, type PendingPhotoWithUrl } from '@/stores/ticketApprovals';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/lib/errors';
import { waLink } from '@/lib/phone';
import { supabase } from '@/lib/supabase';
import { AVERIA_TICKET_CATEGORIES } from '@/types/domain';
import type { Ticket, TicketComment, TicketPriority, TicketStatus, TicketMotivoAveria, InventoryMovement, InventoryUnit } from '@/types/domain';

const route = useRoute();
const router = useRouter();
const ticketsStore = useTicketsStore();
const catalogs = useCatalogsStore();
const inventoryStore = useInventoryStore();
const ticketApprovalsStore = useTicketApprovalsStore();
const auth = useAuthStore();

// TECNICO_RED ve todos los tickets pero solo puede editar (estado,
// prioridad, comentar, materiales) los que tiene asignados — el resto de
// roles de staff puede editar cualquiera. Reglas equivalentes viven en RLS
// (Fase 15); esto solo evita mostrar controles que la BD va a rechazar.
const canEdit = computed(() => {
  if (!ticket.value) return false;
  if (auth.role !== 'TECNICO_RED') return true;
  return ticket.value.assigned_to === auth.user?.id;
});

// Eliminar es solo para limpiar tickets de prueba — mismo rol que crear.
const canDelete = computed(() => auth.role === 'SUPERADMIN' || auth.role === 'ADMIN');
const deleting = ref(false);

// TECNICO_RED solo pasa su averia asignada a "en progreso" o "resuelto" —
// cerrar el ticket es la validacion final que le corresponde a
// admin/soporte (confirma que quedo bien y archiva). Mismo criterio debe
// reforzarse en RLS (ver Fase 15), esto solo evita ofrecer una opcion que
// la BD va a rechazar.
const availableStatuses = computed(() => {
  const entries = Object.entries(STATUS_LABEL) as [TicketStatus, string][];
  if (auth.role !== 'TECNICO_RED') return entries;
  // Si ya esta cerrado (lo cerro admin/soporte) se deja la opcion visible
  // para que el <select> muestre el valor real — no para que el tecnico
  // pueda volver a elegirla desde otro estado.
  return entries.filter(([value]) => value !== 'closed' || ticket.value?.status === 'closed');
});

// La prioridad (que tan urgente es atender la averia/alta) la fija
// admin/soporte al crear o triar el ticket — el tecnico asignado solo
// ejecuta, no puede subirse o bajarse la urgencia de lo que le tocó.
const canChangePriority = computed(() => canEdit.value && auth.role !== 'TECNICO_RED');

// Armar la cuadrilla (Fase 94) y fijar el puntaje manual es una decision de
// despacho — mismo grupo de roles que puede escribir en job_assignees via
// RLS (ver migracion); el tecnico asignado ejecuta pero no se auto-asigna
// apoyo ni se pone puntaje.
const canEditCrew = computed(() => ['SUPERADMIN', 'ADMIN', 'SOPORTE'].includes(auth.role ?? ''));

const gpsMapsLink = computed(() => {
  const lat = ticket.value?.clients?.latitude;
  const lng = ticket.value?.clients?.longitude;
  return lat != null && lng != null ? `https://www.google.com/maps/@${lat},${lng},18z` : null;
});

const ticketId = computed(() => route.params.id as string);
const ticket = ref<Ticket | null>(null);
const loading = ref(true);
const notFound = ref(false);
const comments = ref<TicketComment[]>([]);
const loadingComments = ref(true);
const newComment = ref('');
const savingComment = ref(false);
const updating = ref(false);
const actionError = ref<string | null>(null);

const pointsDraft = ref<number | null>(null);
const savingPoints = ref(false);
const pointsError = ref<string | null>(null);

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Abierto',
  in_progress: 'En progreso',
  resolved: 'Resuelto',
  closed: 'Cerrado',
};
const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  urgent: 'Urgente',
};
const CATEGORY_LABEL: Record<string, string> = {
  no_service: 'Sin servicio',
  slow_speed: 'Lentitud',
  billing: 'Facturación',
  installation: 'Instalación',
  equipment: 'Equipo',
  reconnection_relocation: 'Reconexión / Traslado',
  other: 'Otro',
};
const MOTIVO_LABEL: Record<TicketMotivoAveria, string> = {
  bad_installation: 'Mala instalación',
  material_wear: 'Deterioro de material',
  client_damage: 'Daño provocado por el cliente',
  external_factor: 'Factor externo',
  defective_equipment: 'Equipo defectuoso',
};

// Liquidar una averia (categorias en AVERIA_TICKET_CATEGORIES) exige elegir
// un motivo antes de marcarla resuelta/cerrada — alimenta el ranking de
// puntos (Fase 49) y evita penalizar al tecnico sin justificacion cuando la
// causa fue el cliente o un factor externo. El resto de categorias (billing,
// instalacion, reconexion, otro) se cierran directo, como antes.
const isAveriaCategory = computed(() => !!ticket.value && AVERIA_TICKET_CATEGORIES.includes(ticket.value.category));

const showCloseAveriaModal = ref(false);
const closeAveriaForm = ref({ status: 'resolved' as TicketStatus, motivoAveria: '' as TicketMotivoAveria | '', observacion: '' });
const savingCloseAveria = ref(false);
const closeAveriaError = ref<string | null>(null);
const requiresJustification = computed(
  () => closeAveriaForm.value.motivoAveria === 'client_damage' || closeAveriaForm.value.motivoAveria === 'external_factor',
);

async function loadTicket() {
  loading.value = true;
  notFound.value = false;
  try {
    if (!ticketsStore.tickets.length) await ticketsStore.fetchTickets();
    const found = ticketsStore.tickets.find((t) => t.id === ticketId.value);
    ticket.value = found ?? null;
    notFound.value = !found;
    pointsDraft.value = found?.points ?? null;
  } finally {
    loading.value = false;
  }
}

async function loadComments() {
  loadingComments.value = true;
  comments.value = await ticketsStore.fetchComments(ticketId.value);
  loadingComments.value = false;
}

// ---- Materiales usados (Fase 11b: vincula Inventario con Soporte) ----
const materials = ref<InventoryMovement[]>([]);
const loadingMaterials = ref(true);
const materialForm = ref({ productId: '', quantity: 1 });
const savingMaterial = ref(false);
const materialError = ref<string | null>(null);

async function loadMaterials() {
  loadingMaterials.value = true;
  try {
    materials.value = await inventoryStore.fetchMovementsByTicket(ticketId.value);
  } finally {
    loadingMaterials.value = false;
  }
}

async function handleAddMaterial() {
  if (!ticket.value || !materialForm.value.productId || materialForm.value.quantity <= 0) return;
  savingMaterial.value = true;
  materialError.value = null;
  try {
    await inventoryStore.registerUsage({
      productId: materialForm.value.productId,
      quantity: materialForm.value.quantity,
      ticketId: ticket.value.id,
      reason: `Ticket ${ticket.value.ticket_number}`,
    });
    materialForm.value = { productId: '', quantity: 1 };
    await loadMaterials();
  } catch (e) {
    materialError.value = getErrorMessage(e, 'Error al registrar el material (revisa el stock disponible)');
  } finally {
    savingMaterial.value = false;
  }
}

// ---- Fotos y equipos del censo pendientes de aprobacion (Fase 95) ----
const pendingPhotos = ref<PendingPhotoWithUrl[]>([]);
const pendingEquipment = ref<InventoryUnit[]>([]);
const loadingApprovals = ref(true);
const approvalBusyId = ref<string | null>(null);
const approvalError = ref<string | null>(null);

async function loadApprovals() {
  loadingApprovals.value = true;
  try {
    const [photos, equipment] = await Promise.all([
      ticketApprovalsStore.fetchPendingPhotos(ticketId.value),
      ticketApprovalsStore.fetchPendingEquipment(ticketId.value),
    ]);
    pendingPhotos.value = photos;
    pendingEquipment.value = equipment;
  } finally {
    loadingApprovals.value = false;
  }
}

async function handleApprovePhoto(photo: PendingPhotoWithUrl) {
  if (!ticket.value?.contract_id) {
    approvalError.value = 'Este ticket no tiene un servicio/línea asociado — no se puede aplicar a la ficha del cliente.';
    return;
  }
  approvalBusyId.value = photo.id;
  approvalError.value = null;
  try {
    await ticketApprovalsStore.approvePhoto(photo, ticket.value.client_id, ticket.value.contract_id);
    await loadApprovals();
  } catch (e) {
    approvalError.value = getErrorMessage(e, 'Error al aprobar la foto');
  } finally {
    approvalBusyId.value = null;
  }
}

async function handleRejectPhoto(photo: PendingPhotoWithUrl) {
  approvalBusyId.value = photo.id;
  approvalError.value = null;
  try {
    await ticketApprovalsStore.rejectPhoto(photo);
    await loadApprovals();
  } catch (e) {
    approvalError.value = getErrorMessage(e, 'Error al rechazar la foto');
  } finally {
    approvalBusyId.value = null;
  }
}

async function handleApproveEquipment(unit: InventoryUnit) {
  approvalBusyId.value = unit.id;
  approvalError.value = null;
  try {
    await ticketApprovalsStore.approveEquipment(unit);
    await loadApprovals();
  } catch (e) {
    approvalError.value = getErrorMessage(e, 'Error al aprobar el equipo');
  } finally {
    approvalBusyId.value = null;
  }
}

async function handleRejectEquipment(unit: InventoryUnit) {
  approvalBusyId.value = unit.id;
  approvalError.value = null;
  try {
    await ticketApprovalsStore.rejectEquipment(unit);
    await loadApprovals();
  } catch (e) {
    approvalError.value = getErrorMessage(e, 'Error al rechazar el equipo');
  } finally {
    approvalBusyId.value = null;
  }
}

onMounted(async () => {
  await Promise.all([loadTicket(), loadComments(), loadMaterials(), catalogs.fetchStaff(), inventoryStore.fetchProducts(), loadApprovals()]);
});

async function handleStatusChange(status: TicketStatus) {
  if (!ticket.value) return;
  if (status === 'closed' && auth.role === 'TECNICO_RED') {
    actionError.value = 'Solo admin/soporte puede cerrar un ticket.';
    return;
  }
  // Resolver/cerrar una averia siempre pasa por el modal de liquidacion, para
  // que quede clasificado el motivo antes de que el ranking de puntos la use.
  if ((status === 'resolved' || status === 'closed') && isAveriaCategory.value) {
    closeAveriaForm.value = {
      status,
      motivoAveria: ticket.value.motivo_averia ?? '',
      observacion: ticket.value.observacion_cierre ?? '',
    };
    closeAveriaError.value = null;
    showCloseAveriaModal.value = true;
    return;
  }
  updating.value = true;
  actionError.value = null;
  try {
    ticket.value = await ticketsStore.updateTicketStatus(ticket.value.id, status);
  } catch (e) {
    actionError.value = getErrorMessage(e, 'Error al cambiar el estado');
  } finally {
    updating.value = false;
  }
}

async function handleCloseAveriaSubmit() {
  if (!ticket.value || !closeAveriaForm.value.motivoAveria) return;
  if (requiresJustification.value && !closeAveriaForm.value.observacion.trim()) {
    closeAveriaError.value = 'La justificación es obligatoria para este motivo.';
    return;
  }
  savingCloseAveria.value = true;
  closeAveriaError.value = null;
  try {
    // imputable_a_tecnico se deriva del motivo en un trigger de BD (Fase 49).
    ticket.value = await ticketsStore.updateTicket(ticket.value.id, {
      status: closeAveriaForm.value.status,
      motivo_averia: closeAveriaForm.value.motivoAveria,
      observacion_cierre: closeAveriaForm.value.observacion.trim() || null,
    });
    showCloseAveriaModal.value = false;
  } catch (e) {
    closeAveriaError.value = getErrorMessage(e, 'Error al liquidar la avería');
  } finally {
    savingCloseAveria.value = false;
  }
}

const evidenciaLoading = ref(false);
async function openEvidencia() {
  if (!ticket.value?.evidencia_url) return;
  evidenciaLoading.value = true;
  try {
    const { data, error: err } = await supabase.storage.from('work-evidence').createSignedUrl(ticket.value.evidencia_url, 3600);
    if (err || !data?.signedUrl) throw err ?? new Error('Sin URL firmada');
    window.open(data.signedUrl, '_blank', 'noopener');
  } catch (e) {
    actionError.value = getErrorMessage(e, 'No se pudo abrir la evidencia');
  } finally {
    evidenciaLoading.value = false;
  }
}

async function handlePriorityChange(priority: TicketPriority) {
  if (!ticket.value) return;
  if (auth.role === 'TECNICO_RED') {
    actionError.value = 'Solo admin/soporte puede cambiar la prioridad.';
    return;
  }
  updating.value = true;
  actionError.value = null;
  try {
    ticket.value = await ticketsStore.updateTicketPriority(ticket.value.id, priority);
  } catch (e) {
    actionError.value = getErrorMessage(e, 'Error al cambiar la prioridad');
  } finally {
    updating.value = false;
  }
}

async function handleSavePoints() {
  if (!ticket.value) return;
  savingPoints.value = true;
  pointsError.value = null;
  try {
    ticket.value = await ticketsStore.updateTicket(ticket.value.id, { points: pointsDraft.value });
  } catch (e) {
    pointsError.value = getErrorMessage(e, 'Error al guardar el puntaje');
  } finally {
    savingPoints.value = false;
  }
}

async function handleAddComment() {
  if (!ticket.value || !newComment.value.trim()) return;
  savingComment.value = true;
  actionError.value = null;
  try {
    const created = await ticketsStore.addComment(ticket.value.id, newComment.value.trim());
    comments.value.push(created);
    newComment.value = '';
  } catch (e) {
    actionError.value = getErrorMessage(e, 'Error al agregar el comentario');
  } finally {
    savingComment.value = false;
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' });
}

async function handleDelete() {
  if (!ticket.value) return;
  const ok = confirm(
    `¿Eliminar el ticket ${ticket.value.ticket_number}? Esta accion no se puede deshacer. Si tiene materiales asignados, se devuelven a bodega.`,
  );
  if (!ok) return;
  deleting.value = true;
  actionError.value = null;
  try {
    const { materialsReturned } = await ticketsStore.deleteTicket(ticket.value.id);
    if (materialsReturned) alert(`Ticket eliminado. Se devolvieron ${materialsReturned} material(es) a bodega.`);
    router.push('/soporte');
  } catch (e) {
    actionError.value = getErrorMessage(e, 'Error al eliminar el ticket');
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <AppLayout>
    <button class="text-sm text-slate-600 hover:text-slate-900 mb-4" @click="router.push('/soporte')">
      ← Volver a soporte
    </button>

    <p v-if="loading" class="text-slate-500 text-sm">Cargando...</p>
    <div v-else-if="notFound" class="text-slate-500">Ticket no encontrado.</div>
    <template v-else-if="ticket">
      <div class="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <div class="font-mono text-xs text-slate-500 mb-1">{{ ticket.ticket_number }}</div>
          <h1 class="text-2xl font-semibold">{{ ticket.title }}</h1>
          <p class="text-slate-600 text-sm mt-1">
            <router-link :to="`/clientes/${ticket.client_id}`" class="hover:text-sky-600">
              {{ ticket.clients ? `${ticket.clients.first_name} ${ticket.clients.last_name}` : 'Cliente' }}
            </router-link>
            · {{ ticket.clients?.phone || 'sin telefono' }} · {{ CATEGORY_LABEL[ticket.category] }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <a
            v-if="ticket.clients?.phone"
            :href="waLink(ticket.clients.phone)"
            target="_blank"
            rel="noopener"
            class="btn-secondary text-sm"
          >
            💬 WhatsApp
          </a>
          <a v-if="gpsMapsLink" :href="gpsMapsLink" target="_blank" rel="noopener" class="btn-secondary text-sm">
            📍 Ver ubicación
          </a>
          <button v-if="canDelete" class="btn-ghost text-red-500/80 hover:text-red-600 text-sm" :disabled="deleting" @click="handleDelete">
            {{ deleting ? 'Eliminando...' : 'Eliminar ticket' }}
          </button>
        </div>
      </div>

      <p v-if="actionError" class="mb-4 text-sm text-red-600">{{ actionError }}</p>

      <div class="grid gap-4 lg:grid-cols-2">
        <!-- Columna izquierda: cliente, descripcion, estado/prioridad -->
        <div class="flex flex-col gap-4">
          <div class="surface p-4 text-sm">
            <div class="text-slate-500 text-xs mb-2">Cliente</div>
            <router-link :to="`/clientes/${ticket.client_id}`" class="font-medium text-slate-900 hover:text-sky-600">
              {{ ticket.clients ? `${ticket.clients.first_name} ${ticket.clients.last_name}` : 'Cliente' }}
            </router-link>
            <a
              v-if="ticket.clients?.phone"
              :href="waLink(ticket.clients.phone)"
              target="_blank"
              rel="noopener"
              class="block text-sky-700 hover:underline mt-1"
            >
              💬 {{ ticket.clients.phone }}
            </a>
            <p v-else class="text-slate-500 mt-1">Sin teléfono</p>
            <p class="text-slate-500 text-xs mt-2">{{ CATEGORY_LABEL[ticket.category] }}</p>
          </div>

          <div class="grid grid-cols-2 gap-4 text-sm">
            <div class="surface p-4">
              <div class="text-slate-500 text-xs mb-2">Estado</div>
              <select
                :value="ticket.status"
                :disabled="updating || !canEdit"
                class="field-input"
                @change="handleStatusChange(($event.target as HTMLSelectElement).value as TicketStatus)"
              >
                <option v-for="[value, label] in availableStatuses" :key="value" :value="value">{{ label }}</option>
              </select>
            </div>
            <div class="surface p-4">
              <div class="text-slate-500 text-xs mb-2">Prioridad</div>
              <select
                :value="ticket.priority"
                :disabled="updating || !canChangePriority"
                class="field-input"
                @change="handlePriorityChange(($event.target as HTMLSelectElement).value as TicketPriority)"
              >
                <option v-for="(label, value) in PRIORITY_LABEL" :key="value" :value="value">{{ label }}</option>
              </select>
            </div>
          </div>

          <div class="surface p-4 text-sm">
            <div class="text-slate-500 text-xs mb-2">Descripción</div>
            <p class="whitespace-pre-wrap">{{ ticket.description || 'Sin descripción.' }}</p>
          </div>

          <div v-if="ticket.motivo_averia" class="surface p-4 text-sm">
            <div class="flex items-center justify-between mb-2">
              <div class="text-slate-500 text-xs">Motivo de cierre</div>
              <span
                class="badge text-[10px]"
                :class="ticket.imputable_a_tecnico ? 'bg-amber-500/15 text-amber-700' : 'bg-emerald-500/15 text-emerald-700'"
              >
                {{ ticket.imputable_a_tecnico ? 'Imputable al técnico' : 'No imputable al técnico' }}
              </span>
            </div>
            <p class="font-medium">{{ MOTIVO_LABEL[ticket.motivo_averia] }}</p>
            <p v-if="ticket.observacion_cierre" class="text-slate-700 whitespace-pre-wrap mt-2">{{ ticket.observacion_cierre }}</p>
            <button
              v-if="ticket.evidencia_url"
              type="button"
              class="text-xs text-sky-700 hover:text-sky-700 mt-2"
              :disabled="evidenciaLoading"
              @click="openEvidencia"
            >
              {{ evidenciaLoading ? 'Abriendo...' : '📷 Ver evidencia' }}
            </button>
          </div>
        </div>

        <!-- Columna derecha: cuadrilla, materiales, seguimiento -->
        <div class="flex flex-col gap-4">
          <div
            v-if="canEditCrew && (loadingApprovals || pendingPhotos.length || pendingEquipment.length)"
            class="surface p-4 text-sm border-amber-300"
          >
            <div class="text-amber-700 text-xs font-medium mb-2">⏳ Pendientes de aprobación (censo de avería)</div>
            <p v-if="loadingApprovals" class="text-xs text-slate-400">Cargando...</p>
            <template v-else>
              <div v-if="pendingPhotos.length" class="mb-3">
                <p class="text-xs text-slate-500 mb-1.5">Fotos</p>
                <div class="grid grid-cols-2 gap-2">
                  <div v-for="p in pendingPhotos" :key="p.id" class="rounded-lg border border-slate-200 overflow-hidden">
                    <img :src="p.url ?? undefined" class="w-full h-24 object-cover" />
                    <div class="p-1.5">
                      <p class="text-[11px] text-slate-600 truncate">{{ p.category }}</p>
                      <div class="flex gap-1 mt-1">
                        <button
                          class="flex-1 text-[11px] text-green-700 bg-green-50 rounded px-1.5 py-0.5"
                          :disabled="approvalBusyId === p.id"
                          @click="handleApprovePhoto(p)"
                        >
                          ✓ Aprobar
                        </button>
                        <button
                          class="flex-1 text-[11px] text-red-600 bg-red-50 rounded px-1.5 py-0.5"
                          :disabled="approvalBusyId === p.id"
                          @click="handleRejectPhoto(p)"
                        >
                          ✕ Rechazar
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div v-if="pendingEquipment.length">
                <p class="text-xs text-slate-500 mb-1.5">Equipos</p>
                <div v-for="u in pendingEquipment" :key="u.id" class="flex items-center justify-between gap-2 text-xs py-1">
                  <span class="truncate">{{ u.product?.name ?? 'Equipo' }} — {{ u.serial_number || u.mac_address }}</span>
                  <span class="flex gap-1 shrink-0">
                    <button
                      class="text-[11px] text-green-700 bg-green-50 rounded px-1.5 py-0.5"
                      :disabled="approvalBusyId === u.id"
                      @click="handleApproveEquipment(u)"
                    >
                      ✓ Aprobar
                    </button>
                    <button
                      class="text-[11px] text-red-600 bg-red-50 rounded px-1.5 py-0.5"
                      :disabled="approvalBusyId === u.id"
                      @click="handleRejectEquipment(u)"
                    >
                      ✕ Rechazar
                    </button>
                  </span>
                </div>
              </div>
            </template>
            <p v-if="approvalError" class="text-xs text-red-600 mt-2">{{ approvalError }}</p>
          </div>

          <div class="surface p-4 text-sm">
            <div class="text-slate-500 text-xs mb-2">Cuadrilla asignada</div>
            <CrewAssignEditor
              job-type="ticket"
              :job-id="ticket.id"
              :technicians="catalogs.staff.filter((s) => s.role === 'TECNICO_RED')"
              :readonly="!canEditCrew"
            />
            <div class="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
              <label class="text-xs text-slate-500 shrink-0">Puntaje de la orden</label>
              <input
                v-model.number="pointsDraft"
                type="number"
                step="1"
                placeholder="Automático (5/3)"
                class="field-input py-1.5 text-xs w-28"
                :disabled="!canEditCrew"
                @blur="handleSavePoints"
              />
              <span v-if="savingPoints" class="text-[11px] text-slate-400">Guardando...</span>
            </div>
            <p v-if="pointsError" class="text-xs text-red-600 mt-1">{{ pointsError }}</p>
            <p class="text-[11px] text-slate-400 mt-1">Se reparte en partes iguales entre los integrantes de la cuadrilla.</p>
          </div>

          <div class="surface p-4 text-sm">
            <h2 class="text-sm font-semibold mb-3">Materiales usados</h2>
            <p v-if="loadingMaterials" class="text-slate-500 text-xs">Cargando...</p>
            <template v-else>
              <p v-if="!materials.length" class="text-slate-500 text-xs mb-3">Sin materiales registrados en este ticket.</p>
              <ul v-else class="space-y-1.5 mb-3">
                <li v-for="m in materials" :key="m.id" class="flex justify-between text-xs">
                  <span>{{ m.product?.name ?? 'Producto' }}</span>
                  <span class="text-slate-600">{{ m.quantity }} {{ m.product?.unit }} · {{ formatDate(m.created_at) }}</span>
                </li>
              </ul>
            </template>

            <form v-if="canEdit" class="flex flex-wrap items-end gap-2" @submit.prevent="handleAddMaterial">
              <div class="flex-1 min-w-[160px]">
                <label class="block text-xs text-slate-600 mb-1">Producto</label>
                <select v-model="materialForm.productId" required class="field-input">
                  <option value="" disabled>Selecciona...</option>
                  <option v-for="p in inventoryStore.products" :key="p.id" :value="p.id">
                    {{ p.name }} ({{ p.current_stock }} {{ p.unit }} disp.)
                  </option>
                </select>
              </div>
              <div class="w-24">
                <label class="block text-xs text-slate-600 mb-1">Cantidad</label>
                <input v-model.number="materialForm.quantity" type="number" min="1" step="1" class="field-input" />
              </div>
              <button type="submit" :disabled="savingMaterial || !materialForm.productId" class="btn-secondary text-xs">
                {{ savingMaterial ? 'Registrando...' : '+ Usar' }}
              </button>
            </form>
            <p v-if="materialError" class="text-xs text-red-600 mt-2">{{ materialError }}</p>
          </div>

          <div class="surface p-4 text-sm">
            <h2 class="text-sm font-semibold mb-3">Seguimiento</h2>
            <p v-if="loadingComments" class="text-slate-500 text-xs">Cargando...</p>
            <div v-else class="space-y-3 mb-3">
              <p v-if="!comments.length" class="text-slate-500 text-xs">Sin comentarios todavía.</p>
              <div v-for="c in comments" :key="c.id" class="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div class="flex items-center justify-between mb-1">
                  <span class="font-medium text-slate-800 text-xs">{{ c.author?.full_name || c.author?.email || 'Usuario' }}</span>
                  <span class="text-[11px] text-slate-500">{{ formatDate(c.created_at) }}</span>
                </div>
                <p class="text-slate-700 whitespace-pre-wrap text-xs">{{ c.body }}</p>
              </div>
            </div>

            <form v-if="canEdit" class="flex gap-2" @submit.prevent="handleAddComment">
              <input
                v-model="newComment"
                placeholder="Agregar una nota de seguimiento..."
                class="field-input flex-1 text-xs"
              />
              <button type="submit" :disabled="savingComment || !newComment.trim()" class="btn-primary text-xs px-3">
                {{ savingComment ? 'Enviando...' : 'Comentar' }}
              </button>
            </form>
            <p v-else class="text-xs text-slate-400">Este ticket no está asignado a ti — solo puedes verlo.</p>
          </div>
        </div>
      </div>
    </template>

    <Teleport to="body">
      <div v-if="showCloseAveriaModal" class="modal-overlay">
        <form class="w-full max-w-sm modal-panel" @submit.prevent="handleCloseAveriaSubmit">
          <h2 class="text-lg font-semibold mb-4">Liquidar avería</h2>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Motivo de la avería</label>
            <select v-model="closeAveriaForm.motivoAveria" required class="field-input">
              <option value="" disabled>Selecciona el motivo...</option>
              <option value="bad_installation">Mala instalación</option>
              <option value="material_wear">Deterioro de material</option>
              <option value="client_damage">Daño provocado por el cliente (ej. mascota, golpe)</option>
              <option value="external_factor">Factor externo (corte de fibra troncal, corte eléctrico)</option>
              <option value="defective_equipment">Equipo defectuoso</option>
            </select>
          </div>

          <div v-if="requiresJustification" class="mb-4">
            <label class="block text-xs text-slate-600 mb-1">
              Justificación <span class="text-red-500">* (obligatoria, no cuenta contra los puntos del técnico)</span>
            </label>
            <textarea v-model="closeAveriaForm.observacion" rows="3" placeholder="Explica qué pasó..." class="field-input"></textarea>
          </div>

          <p v-if="closeAveriaError" class="text-sm text-red-600 mb-3">{{ closeAveriaError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showCloseAveriaModal = false">
              Cancelar
            </button>
            <button type="submit" :disabled="savingCloseAveria || !closeAveriaForm.motivoAveria" class="btn-primary">
              {{ savingCloseAveria ? 'Guardando...' : 'Guardar' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
