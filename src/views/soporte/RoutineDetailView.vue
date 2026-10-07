<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import CrewAssignEditor from '@/components/soporte/CrewAssignEditor.vue';
import PhotoLightbox, { type LightboxPhoto } from '@/components/PhotoLightbox.vue';
import { useRoutinesStore } from '@/stores/routines';
import { useCatalogsStore } from '@/stores/catalogs';
import { useTicketApprovalsStore, parseEquipmentType } from '@/stores/ticketApprovals';
import { supabase } from '@/lib/supabase';
import { PRIORITY_CLASS, PRIORITY_LABEL } from '@/lib/ticketPriority';
import { EQUIPMENT_TYPE_LABEL } from '@/lib/equipmentPhotoType';
import type { Routine, RoutineStatus, RoutineTipo } from '@/types/domain';

// Fase 133 — detalle dedicado de una rutina, misma necesidad que ya resolvio
// Fase 122 para Instalaciones: antes "ver el detalle" de una rutina desde el
// Historico de Atendidos solo reabria el modal de creacion/edicion de
// RutinasView.vue (titulo/tipo/fecha/etc, editable) sin mostrar nada de lo
// que el tecnico registro al cerrarla en la App de Campo (GPS, fotos, quien
// y cuando) — esos datos SI se guardaban bien (work_order_closures/
// work_order_photos, igual que Tickets/Instalaciones, Fase 32/94) pero no
// habia ningun lugar en el Panel Web que los mostrara juntos para una
// rutina. Esta vista es de SOLO LECTURA a proposito: cambiar estado/
// prioridad/cuadrilla sigue siendo desde el modal de RutinasView.vue, igual
// que antes — no se duplica esa gestion aqui.

const route = useRoute();
const router = useRouter();
const routinesStore = useRoutinesStore();
const catalogsStore = useCatalogsStore();
const ticketApprovalsStore = useTicketApprovalsStore();

const routineId = computed(() => route.params.id as string);
const routine = ref<Routine | null>(null);
const loading = ref(true);
const notFound = ref(false);

const technicians = computed(() => catalogsStore.staff.filter((s) => s.role === 'TECNICO_RED'));

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
const TIPO_RUTINA_LABEL: Record<RoutineTipo, string> = {
  servicio_cliente: 'Servicio a Cliente / Adicional',
  logistica: 'Logística / Trámites',
  planta_interna: 'PEXT / Planta Interna',
};

function targetLabel(r: Routine): string {
  if (r.clients) return `${r.clients.first_name} ${r.clients.last_name}`;
  if (r.nap_elemento) return `Caja NAP · ${r.nap_elemento.name}`;
  if (r.zones) return `Zona · ${r.zones.name}`;
  if (r.direccion_destino) return r.direccion_destino;
  return 'General / sin destino puntual';
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(`${value}T12:00:00`).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function timeRange(r: Routine): string | null {
  if (!r.scheduled_start_at || !r.scheduled_end_at) return null;
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  return `${fmt(r.scheduled_start_at)} – ${fmt(r.scheduled_end_at)}`;
}

// ---- Cierre de campo (work_order_closures) — mismas tablas/criterio que
// Tickets/Instalaciones (Fase 32), aca recien se consultan para una rutina. ----
interface ClosureRow {
  latitude: number | null;
  longitude: number | null;
  closure_notes: string | null;
  closed_by: string | null;
  created_at: string;
}
const closure = ref<ClosureRow | null>(null);
const loadingClosure = ref(false);

async function loadClosure() {
  loadingClosure.value = true;
  try {
    const { data } = await supabase
      .from('work_order_closures')
      .select('latitude, longitude, closure_notes, closed_by, created_at')
      .eq('job_type', 'routine')
      .eq('job_id', routineId.value)
      .maybeSingle();
    closure.value = (data as ClosureRow | null) ?? null;
  } finally {
    loadingClosure.value = false;
  }
}

const closedByName = computed(() => {
  const id = closure.value?.closed_by ?? routine.value?.assigned_to;
  if (!id) return null;
  const tech = catalogsStore.staff.find((s) => s.id === id);
  return tech?.full_name || tech?.email || null;
});

const gpsMapsLink = computed(() => {
  const lat = closure.value?.latitude;
  const lng = closure.value?.longitude;
  if (lat == null || lng == null) return null;
  return `https://www.google.com/maps/@${lat},${lng},18z`;
});

// ---- Evidencias (work_order_photos) — mismo fetchJobPhotos generico que ya
// usa el boton "Evidencias" de Historico (ese SI ya funcionaba para
// rutinas); aca se muestran en linea con miniaturas en vez de un boton aparte. ----
const PHOTO_LABELS: Record<string, string> = {
  facade: 'Fachada',
  service_sheet: 'Hoja de servicio',
  modem_position: 'Posición del módem',
  nap_box: 'Caja NAP',
  pon_power: 'Potencia Óptica Recibida',
  evidencia_1: 'Evidencia 1',
  evidencia_2: 'Evidencia 2',
};
function photoLabel(category: string): string {
  const equipmentType = parseEquipmentType(category);
  if (equipmentType) return EQUIPMENT_TYPE_LABEL[equipmentType];
  return PHOTO_LABELS[category] ?? category;
}

const photos = ref<LightboxPhoto[]>([]);
const loadingPhotos = ref(false);
const lightboxPhotos = ref<LightboxPhoto[]>([]);
const lightboxIndex = ref(0);

function openLightbox(photoId: string) {
  lightboxIndex.value = Math.max(0, photos.value.findIndex((p) => p.id === photoId));
  lightboxPhotos.value = photos.value;
}

async function loadPhotos() {
  loadingPhotos.value = true;
  try {
    const rows = await ticketApprovalsStore.fetchJobPhotos('routine', routineId.value);
    photos.value = rows.map((p) => ({ id: p.id, url: p.url ?? '', label: photoLabel(p.category) }));
  } finally {
    loadingPhotos.value = false;
  }
}

onMounted(async () => {
  if (!routinesStore.routines.length) await routinesStore.fetchRoutines();
  if (!catalogsStore.staff.length) await catalogsStore.fetchStaff();
  const found = routinesStore.routines.find((r) => r.id === routineId.value);
  routine.value = found ?? null;
  notFound.value = !found;
  loading.value = false;
  if (routine.value) await Promise.all([loadClosure(), loadPhotos()]);
});
</script>

<template>
  <AppLayout>
    <button class="text-sm text-slate-600 hover:text-slate-900 mb-4" @click="router.push('/soporte/rutinas')">
      ← Volver a rutinas
    </button>

    <p v-if="loading" class="text-slate-500 text-sm">Cargando...</p>
    <div v-else-if="notFound || !routine" class="text-slate-500">Rutina no encontrada.</div>
    <template v-else>
      <div class="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 class="text-2xl font-semibold">{{ routine.title }}</h1>
          <p class="text-slate-600 text-sm mt-1">
            <span class="font-mono">{{ routine.routine_number }}</span>
            · {{ TIPO_RUTINA_LABEL[routine.tipo_rutina] }}
            <span v-if="routine.subtipo"> · {{ routine.subtipo }}</span>
          </p>
        </div>
        <div class="flex items-center gap-2">
          <span class="badge" :class="PRIORITY_CLASS[routine.priority]">{{ PRIORITY_LABEL[routine.priority] }}</span>
          <span class="badge" :class="STATUS_CLASS[routine.status]">{{ STATUS_LABEL[routine.status] }}</span>
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <!-- Columna izquierda: info de la orden -->
        <div class="flex flex-col gap-4">
          <div class="surface p-4 text-sm">
            <div class="text-slate-500 text-xs mb-2">Destino</div>
            <p class="text-slate-800">{{ targetLabel(routine) }}</p>
          </div>

          <div class="surface p-4 text-sm">
            <div class="text-slate-500 text-xs mb-2">Programación</div>
            <p class="text-slate-800">
              {{ formatDate(routine.scheduled_date) }}
              <span v-if="timeRange(routine)"> · {{ timeRange(routine) }}</span>
            </p>
          </div>

          <div v-if="routine.description" class="surface p-4 text-sm">
            <div class="text-slate-500 text-xs mb-2">Descripción</div>
            <p class="text-slate-800 whitespace-pre-wrap">{{ routine.description }}</p>
          </div>

          <div class="surface p-4 text-sm">
            <h2 class="text-sm font-semibold mb-2">Cuadrilla asignada</h2>
            <CrewAssignEditor job-type="routine" :job-id="routine.id" :technicians="technicians" :readonly="true" />
          </div>

          <p class="text-xs text-slate-400">
            Para cambiar estado, prioridad, puntaje o reasignar técnico, usa "Editar" desde la lista de
            <router-link to="/soporte/rutinas" class="text-sky-700 hover:underline">Rutinas</router-link>.
          </p>
        </div>

        <!-- Columna derecha: lo que registro el tecnico al cerrarla en campo -->
        <div class="flex flex-col gap-4">
          <div class="surface p-4 text-sm">
            <h2 class="text-sm font-semibold mb-3">✅ Cierre registrado en campo</h2>
            <template v-if="routine.status === 'completed' || routine.status === 'cancelled'">
              <p v-if="loadingClosure" class="text-slate-400 text-xs">Cargando...</p>
              <template v-else>
                <div class="grid grid-cols-2 gap-3 mb-3 text-xs">
                  <div>
                    <div class="text-slate-400">Completado por</div>
                    <div class="text-slate-800 font-medium">{{ closedByName ?? '—' }}</div>
                  </div>
                  <div>
                    <div class="text-slate-400">Fecha/hora exacta</div>
                    <div class="text-slate-800 font-medium">{{ formatDateTime(closure?.created_at ?? routine.completed_at) }}</div>
                  </div>
                </div>

                <div class="text-slate-400 text-xs mb-1">Notas de cierre</div>
                <p v-if="routine.closure_notes" class="text-slate-700 whitespace-pre-wrap mb-3">{{ routine.closure_notes }}</p>
                <p v-else class="text-slate-400 text-xs mb-3">Sin notas de cierre registradas.</p>

                <div class="text-slate-400 text-xs mb-1">Ubicación GPS del cierre</div>
                <a v-if="gpsMapsLink" :href="gpsMapsLink" target="_blank" rel="noopener" class="text-sky-700 text-xs hover:underline mb-3 block">
                  📍 {{ closure!.latitude!.toFixed(5) }}, {{ closure!.longitude!.toFixed(5) }} — Ver en Google Maps
                </a>
                <p v-else class="text-slate-400 text-xs mb-3">Sin ubicación GPS registrada al cierre.</p>

                <div class="pt-3 border-t border-slate-100">
                  <div class="text-slate-400 text-xs mb-1">Materiales / repuestos</div>
                  <p class="text-slate-400 text-xs">Las rutinas todavía no registran materiales (alcance actual, Fase 101).</p>
                </div>
              </template>
            </template>
            <p v-else class="text-slate-400 text-xs">
              Esta rutina todavía no se completó — el cierre aparece aquí en cuanto el técnico la termine desde la App de Campo.
            </p>
          </div>

          <div class="surface p-4 text-sm">
            <h2 class="text-sm font-semibold mb-3">📷 Evidencias</h2>
            <p v-if="loadingPhotos" class="text-slate-400 text-xs">Cargando...</p>
            <p v-else-if="!photos.length" class="text-slate-400 text-xs">Sin fotos registradas desde la App de Campo.</p>
            <div v-else class="grid grid-cols-3 gap-2">
              <button v-for="p in photos" :key="p.id" type="button" class="block text-left" @click="openLightbox(p.id)">
                <img :src="p.url" class="w-full h-20 object-cover rounded-lg border border-slate-200" />
                <span class="text-[10px] text-slate-500 block truncate mt-0.5">{{ p.label }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <PhotoLightbox v-if="lightboxPhotos.length" :photos="lightboxPhotos" :start-index="lightboxIndex" @close="lightboxPhotos = []" />
  </AppLayout>
</template>
