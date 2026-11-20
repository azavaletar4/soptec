<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import L from 'leaflet';
import { cloneRoute, routeLocks, translateRoute, validateRoute } from '@/lib/cableRoute';
import type { FoCable, LatLngPoint } from '@/types/domain';

const props = defineProps<{ map: L.Map; cable: FoCable; saving: boolean; error: string | null; allowed: boolean }>();
const emit = defineEmits<{ save: [points: LatLngPoint[]]; cancel: [] }>();
const original = cloneRoute(props.cable.path);
const points = ref(cloneRoute(original));
const selected = ref<number | null>(null);
const moving = ref(false);
const localError = ref<string | null>(null);
const locks = routeLocks(props.cable);
const canTranslate = !locks.start && !locks.end;
const dirty = computed(() => JSON.stringify(points.value) !== JSON.stringify(original));
const canRemove = computed(() => selected.value != null && selected.value > 0 && selected.value < points.value.length - 1 && points.value.length > 2);
const meters = computed(() => Math.round(points.value.slice(1).reduce((n, p, i) => n + L.latLng(points.value[i]).distanceTo(L.latLng(p)), 0)));
let layer: L.LayerGroup;
let line: L.Polyline;
let controls: L.LayerGroup;
const round = (p: L.LatLng): LatLngPoint => [Number(p.lat.toFixed(7)), Number(p.lng.toFixed(7))];
const editable = () => props.allowed && !props.saving;
const locked = (i: number) => (i === 0 && locks.start) || (i === points.value.length - 1 && locks.end);

function render() {
  if (!layer) return;
  line.setLatLngs(points.value);
  controls.clearLayers();
  if (moving.value && canTranslate) {
    const center = L.latLngBounds(points.value).getCenter();
    const marker = L.marker(center, {
      draggable: true, keyboard: true, title: 'Mover recorrido completo',
      icon: L.divIcon({ className: 'route-move-handle', html: '↔', iconSize: [36, 36], iconAnchor: [18, 18] }),
    }).addTo(controls);
    let before = cloneRoute(points.value), start = center;
    marker.on('dragstart', () => { before = cloneRoute(points.value); start = marker.getLatLng(); });
    marker.on('drag', () => {
      if (!editable()) return;
      const current = marker.getLatLng();
      try {
        points.value = translateRoute(before, [current.lat - start.lat, current.lng - start.lng]);
        line.setLatLngs(points.value);
        localError.value = null;
      } catch { localError.value = 'El desplazamiento sale de los límites del mapa.'; }
    });
    marker.on('dragend', render);
    return;
  }
  points.value.forEach((point, i) => {
    const marker = L.marker(point, {
      draggable: !locked(i), keyboard: true,
      title: locked(i) ? `Extremo conectado ${i + 1} (fijo)` : `Vértice ${i + 1}: arrastrar o seleccionar`,
      icon: L.divIcon({ className: `route-vertex ${locked(i) ? 'route-locked' : ''} ${selected.value === i ? 'route-selected' : ''}`, html: String(i + 1), iconSize: [26, 26], iconAnchor: [13, 13] }),
    }).addTo(controls);
    marker.on('click', () => { if (!editable()) return; selected.value = i; render(); });
    marker.on('drag', () => {
      if (!editable() || locked(i)) return;
      points.value[i] = round(marker.getLatLng());
      line.setLatLngs(points.value);
    });
    marker.on('dragend', () => { selected.value = i; render(); });
  });
  for (let i = 0; i < points.value.length - 1; i++) {
    const a = points.value[i], b = points.value[i + 1];
    const marker = L.marker([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], {
      keyboard: true, title: `Agregar vértice en tramo ${i + 1}`,
      icon: L.divIcon({ className: 'route-midpoint', html: '+', iconSize: [22, 22], iconAnchor: [11, 11] }),
    }).addTo(controls);
    marker.on('click', () => {
      if (!editable() || points.value.length >= 10000) return;
      points.value.splice(i + 1, 0, round(marker.getLatLng()));
      selected.value = i + 1;
      render();
    });
  }
}

function removeSelected() {
  if (!editable() || !canRemove.value || selected.value == null) return;
  points.value.splice(selected.value, 1);
  selected.value = null;
  render();
}
function restore() {
  if (!editable()) return;
  points.value = cloneRoute(original);
  selected.value = null;
  localError.value = null;
  render();
}
function toggleMove() {
  if (!editable() || !canTranslate) return;
  moving.value = !moving.value;
  render();
}
function save() {
  if (!editable() || !dirty.value) return;
  try { validateRoute(points.value); localError.value = null; emit('save', cloneRoute(points.value)); }
  catch (e) { localError.value = (e as Error).message; }
}
function beforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value) { e.preventDefault(); e.returnValue = ''; }
}
onMounted(() => {
  props.map.fitBounds(points.value, { padding: [70, 70], maxZoom: Math.max(props.map.getZoom(), 19), animate: false });
  layer = L.layerGroup().addTo(props.map);
  line = L.polyline(points.value, { color: '#a21caf', weight: 6, dashArray: '8 5', bubblingMouseEvents: false }).addTo(layer);
  controls = L.layerGroup().addTo(layer);
  render();
  window.addEventListener('beforeunload', beforeUnload);
});
onBeforeUnmount(() => {
  layer?.remove();
  window.removeEventListener('beforeunload', beforeUnload);
});
</script>

<template>
  <section class="rounded-xl border border-fuchsia-300 bg-fuchsia-50 p-3 mb-3 text-sm" aria-label="Editor de trazado" data-testid="route-editor">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="font-semibold">Editar trazado · {{ cable.codigo }}</h2>
        <p class="text-xs text-slate-600 mt-1">Arrastra los puntos numerados. Pulsa + para agregar un vértice y selecciona uno intermedio para quitarlo.</p>
        <p class="text-xs text-slate-600 mt-1">{{ points.length }} vértices · Longitud geográfica: <b>{{ meters }} m</b> · Metraje registrado: <b>{{ cable.metraje == null ? 'Sin registrar' : cable.metraje + ' m' }}</b> (se conserva).</p>
        <p class="text-xs text-slate-600 mt-1">{{ locks.start || locks.end ? 'Los extremos conectados permanecen fijos. No se mueven cajas ni equipos.' : 'Los extremos no están conectados. Puedes moverlos o desplazar el recorrido completo.' }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn-secondary text-xs" :disabled="!canRemove || saving || !allowed" @click="removeSelected">Quitar vértice seleccionado</button>
        <button class="btn-secondary text-xs" :disabled="!canTranslate || saving || !allowed" :aria-pressed="moving" title="Disponible cuando ambos extremos están libres" @click="toggleMove">{{ moving ? 'Editar vértices' : 'Mover recorrido completo' }}</button>
        <button class="btn-secondary text-xs" :disabled="!dirty || saving || !allowed" @click="restore">Restaurar trazado original</button>
        <button class="btn-ghost text-xs" :disabled="saving" @click="emit('cancel')">Cancelar trazado</button>
        <button class="btn-primary text-xs" :disabled="!dirty || saving || !allowed" @click="save">{{ saving ? 'Guardando…' : 'Guardar trazado' }}</button>
      </div>
    </div>
    <p v-if="moving" class="text-xs mt-2">Arrastra únicamente el control ↔. Arrastrar el fondo sigue desplazando el mapa.</p>
    <p v-if="!allowed" role="alert" class="text-red-700 mt-2">Ya no tienes permiso para guardar. Puedes cancelar el borrador.</p>
    <p v-if="localError || error" role="alert" class="text-red-700 mt-2">{{ localError || error }}</p>
  </section>
</template>

<style>
.route-vertex, .route-midpoint, .route-move-handle { display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 2px solid #86198f; background: white; color: #701a75; font-weight: 700; box-shadow: 0 1px 5px #0005; }
.route-vertex.route-locked { background: #e2e8f0; border-color: #64748b; color: #334155; }
.route-vertex.route-selected { outline: 3px solid #f0abfc; }
.route-midpoint { border-style: dashed; font-size: 18px; }
.route-move-handle { background: #fef3c7; border-color: #b45309; font-size: 24px; }
</style>
