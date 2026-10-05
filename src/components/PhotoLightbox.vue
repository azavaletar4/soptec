<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

// Visor de fotos a pantalla completa (Fase 105) — reusado en todo el panel
// (Pendientes de aprobación, Evidencias de cierre, Ficha del cliente, App de
// Campo) para no repetir zoom/rotar/navegar/aprobar-rechazar en cada vista.
export interface LightboxPhoto {
  id: string;
  url: string;
  label?: string;
}

const props = withDefaults(
  defineProps<{
    photos: LightboxPhoto[];
    startIndex?: number;
    /** Solo true en el panel de aprobacion (TicketDetailView) — las demas vistas son de solo lectura. */
    canApprove?: boolean;
  }>(),
  { startIndex: 0, canApprove: false },
);

const emit = defineEmits<{ close: []; approve: [id: string]; reject: [id: string] }>();

const index = ref(props.startIndex);
const zoom = ref(1);
const rotation = ref(0);
const panX = ref(0);
const panY = ref(0);
const dragging = ref(false);
let dragStartX = 0;
let dragStartY = 0;
let panStartX = 0;
let panStartY = 0;

const current = computed(() => props.photos[index.value]);

function resetView() {
  zoom.value = 1;
  rotation.value = 0;
  panX.value = 0;
  panY.value = 0;
}

watch(index, resetView);

function goPrev() {
  if (index.value > 0) index.value -= 1;
}
function goNext() {
  if (index.value < props.photos.length - 1) index.value += 1;
}

function zoomIn() {
  zoom.value = Math.min(4, zoom.value + 0.5);
}
function zoomOut() {
  zoom.value = Math.max(1, zoom.value - 0.5);
  if (zoom.value === 1) {
    panX.value = 0;
    panY.value = 0;
  }
}
function rotate() {
  rotation.value = (rotation.value + 90) % 360;
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  if (e.deltaY < 0) zoomIn();
  else zoomOut();
}

function startDrag(e: MouseEvent | TouchEvent) {
  if (zoom.value <= 1) return;
  dragging.value = true;
  const point = 'touches' in e ? e.touches[0] : e;
  dragStartX = point.clientX;
  dragStartY = point.clientY;
  panStartX = panX.value;
  panStartY = panY.value;
}
function onDrag(e: MouseEvent | TouchEvent) {
  if (!dragging.value) return;
  const point = 'touches' in e ? e.touches[0] : e;
  panX.value = panStartX + (point.clientX - dragStartX);
  panY.value = panStartY + (point.clientY - dragStartY);
}
function endDrag() {
  dragging.value = false;
}

function handleApprove() {
  if (current.value) emit('approve', current.value.id);
}
function handleReject() {
  if (current.value) emit('reject', current.value.id);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
  else if (e.key === 'ArrowLeft') goPrev();
  else if (e.key === 'ArrowRight') goNext();
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[100] bg-black/90 flex flex-col" @click.self="emit('close')">
      <!-- Barra superior -->
      <div class="flex items-center justify-between gap-2 p-3 text-white shrink-0">
        <div class="text-sm truncate">
          {{ current?.label }}
          <span v-if="photos.length > 1" class="text-white/50 ml-2">{{ index + 1 }} / {{ photos.length }}</span>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button type="button" class="p-2 rounded-lg bg-white/10 hover:bg-white/20" title="Alejar" @click="zoomOut">🔍−</button>
          <button type="button" class="p-2 rounded-lg bg-white/10 hover:bg-white/20" title="Acercar" @click="zoomIn">🔍+</button>
          <button type="button" class="p-2 rounded-lg bg-white/10 hover:bg-white/20" title="Rotar" @click="rotate">↻</button>
          <button type="button" class="p-2 rounded-lg bg-white/10 hover:bg-white/20" title="Cerrar (Esc)" @click="emit('close')">✕</button>
        </div>
      </div>

      <!-- Imagen -->
      <div
        class="flex-1 relative overflow-hidden flex items-center justify-center select-none"
        :class="zoom > 1 ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'"
        @wheel="onWheel"
        @mousedown="startDrag"
        @mousemove="onDrag"
        @mouseup="endDrag"
        @mouseleave="endDrag"
        @touchstart="startDrag"
        @touchmove="onDrag"
        @touchend="endDrag"
      >
        <img
          v-if="current"
          :src="current.url"
          :alt="current.label"
          class="max-w-[92vw] max-h-[75vh] object-contain transition-transform duration-100"
          :style="{ transform: `translate(${panX}px, ${panY}px) scale(${zoom}) rotate(${rotation}deg)` }"
          draggable="false"
        />

        <button
          v-if="photos.length > 1 && index > 0"
          type="button"
          class="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-lg"
          @click.stop="goPrev"
        >
          ←
        </button>
        <button
          v-if="photos.length > 1 && index < photos.length - 1"
          type="button"
          class="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-lg"
          @click.stop="goNext"
        >
          →
        </button>
      </div>

      <!-- Aprobar / Rechazar -->
      <div v-if="canApprove" class="flex items-center justify-center gap-3 p-3 shrink-0">
        <button type="button" class="btn-destructive px-5" @click="handleReject">✕ Rechazar</button>
        <button type="button" class="btn-primary px-5 !bg-green-500" @click="handleApprove">✓ Aprobar</button>
      </div>
    </div>
  </Teleport>
</template>
