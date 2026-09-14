<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useTicketsStore } from '@/stores/tickets';
import { useCatalogsStore } from '@/stores/catalogs';
import { useInventoryStore } from '@/stores/inventory';
import { getErrorMessage } from '@/lib/errors';
import type { Ticket, TicketComment, TicketPriority, TicketStatus, InventoryMovement } from '@/types/domain';

const route = useRoute();
const router = useRouter();
const ticketsStore = useTicketsStore();
const catalogs = useCatalogsStore();
const inventoryStore = useInventoryStore();

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

const showAssignModal = ref(false);
const assignForm = ref({ assignedTo: '', points: null as number | null });
const savingAssign = ref(false);
const assignError = ref<string | null>(null);

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
  other: 'Otro',
};

async function loadTicket() {
  loading.value = true;
  notFound.value = false;
  try {
    if (!ticketsStore.tickets.length) await ticketsStore.fetchTickets();
    const found = ticketsStore.tickets.find((t) => t.id === ticketId.value);
    ticket.value = found ?? null;
    notFound.value = !found;
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

onMounted(async () => {
  await Promise.all([loadTicket(), loadComments(), loadMaterials(), catalogs.fetchStaff(), inventoryStore.fetchProducts()]);
});

async function handleStatusChange(status: TicketStatus) {
  if (!ticket.value) return;
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

async function handlePriorityChange(priority: TicketPriority) {
  if (!ticket.value) return;
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

function openAssignModal() {
  if (!ticket.value) return;
  assignForm.value = { assignedTo: ticket.value.assigned_to ?? '', points: ticket.value.points };
  assignError.value = null;
  showAssignModal.value = true;
}

async function handleAssignSubmit() {
  if (!ticket.value) return;
  savingAssign.value = true;
  assignError.value = null;
  try {
    ticket.value = await ticketsStore.assignTechnician(
      ticket.value.id,
      assignForm.value.assignedTo || null,
      assignForm.value.points,
    );
    showAssignModal.value = false;
  } catch (e) {
    assignError.value = getErrorMessage(e, 'Error al asignar el técnico');
  } finally {
    savingAssign.value = false;
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
  return new Date(value).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' });
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
      </div>

      <p v-if="actionError" class="mb-4 text-sm text-red-600">{{ actionError }}</p>

      <div class="grid gap-4 mb-8 text-sm" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))">
        <div class="surface p-4">
          <div class="text-slate-500 text-xs mb-2">Estado</div>
          <select
            :value="ticket.status"
            :disabled="updating"
            class="field-input"
            @change="handleStatusChange(($event.target as HTMLSelectElement).value as TicketStatus)"
          >
            <option v-for="(label, value) in STATUS_LABEL" :key="value" :value="value">{{ label }}</option>
          </select>
        </div>
        <div class="surface p-4">
          <div class="text-slate-500 text-xs mb-2">Prioridad</div>
          <select
            :value="ticket.priority"
            :disabled="updating"
            class="field-input"
            @change="handlePriorityChange(($event.target as HTMLSelectElement).value as TicketPriority)"
          >
            <option v-for="(label, value) in PRIORITY_LABEL" :key="value" :value="value">{{ label }}</option>
          </select>
        </div>
        <div class="surface p-4">
          <div class="flex items-center justify-between mb-2">
            <div class="text-slate-500 text-xs">Técnico designado</div>
            <button class="text-xs text-sky-600 hover:text-sky-700" @click="openAssignModal">
              {{ ticket.assigned_to ? 'Editar' : 'Asignar' }}
            </button>
          </div>
          <div class="font-medium">
            {{ ticket.assigned_profile?.full_name || ticket.assigned_profile?.email || 'Sin asignar' }}
          </div>
          <div class="text-xs text-slate-500 mt-1">
            {{ ticket.points != null ? `${ticket.points} puntos` : 'Sin puntaje' }}
          </div>
        </div>
      </div>

      <div class="rounded-xl border border-slate-200 bg-slate-100 p-4 mb-8 text-sm">
        <div class="text-slate-500 text-xs mb-2">Descripción</div>
        <p class="whitespace-pre-wrap">{{ ticket.description || 'Sin descripción.' }}</p>
      </div>

      <div class="rounded-xl border border-slate-200 bg-slate-100 p-4 mb-8 text-sm">
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

        <form class="flex flex-wrap items-end gap-2" @submit.prevent="handleAddMaterial">
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

      <h2 class="text-lg font-semibold mb-3">Seguimiento</h2>
      <p v-if="loadingComments" class="text-slate-500 text-sm">Cargando...</p>
      <div v-else class="space-y-3 mb-4">
        <p v-if="!comments.length" class="text-slate-500 text-sm">Sin comentarios todavía.</p>
        <div v-for="c in comments" :key="c.id" class="rounded-xl border border-slate-200 bg-slate-100 p-4 text-sm">
          <div class="flex items-center justify-between mb-1">
            <span class="font-medium text-slate-800">{{ c.author?.full_name || c.author?.email || 'Usuario' }}</span>
            <span class="text-xs text-slate-500">{{ formatDate(c.created_at) }}</span>
          </div>
          <p class="text-slate-700 whitespace-pre-wrap">{{ c.body }}</p>
        </div>
      </div>

      <form class="flex gap-2" @submit.prevent="handleAddComment">
        <input
          v-model="newComment"
          placeholder="Agregar una nota de seguimiento..."
          class="flex-1 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
        />
        <button
          type="submit"
          :disabled="savingComment || !newComment.trim()"
          class="btn-primary"
        >
          {{ savingComment ? 'Enviando...' : 'Comentar' }}
        </button>
      </form>
    </template>

    <Teleport to="body">
      <div v-if="showAssignModal" class="modal-overlay">
        <form class="w-full max-w-sm modal-panel" @submit.prevent="handleAssignSubmit">
          <h2 class="text-lg font-semibold mb-4">Asignar técnico</h2>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Técnico</label>
            <select
              v-model="assignForm.assignedTo"
              class="field-input"
            >
              <option value="">Sin asignar</option>
              <option v-for="s in catalogs.staff" :key="s.id" :value="s.id">{{ s.full_name || s.email }}</option>
            </select>
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-600 mb-1">Puntos por este ticket</label>
            <input
              v-model.number="assignForm.points"
              type="number"
              step="1"
              placeholder="Sin puntaje"
              class="field-input"
            />
          </div>

          <p v-if="assignError" class="text-sm text-red-600 mb-3">{{ assignError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showAssignModal = false">
              Cancelar
            </button>
            <button type="submit" :disabled="savingAssign" class="btn-primary">
              {{ savingAssign ? 'Guardando...' : 'Guardar' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
