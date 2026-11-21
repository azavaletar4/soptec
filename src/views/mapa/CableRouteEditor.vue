<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import L from 'leaflet';
import { cloneRoute, routeLocks, translateRoute, validateRoute } from '@/lib/cableRoute';
import type { FoCable, LatLngPoint } from '@/types/domain';

// originName/destName: nombre REAL del elemento vinculado (resuelto por el
// padre con el mismo elementoNombre() que ya usa el mapa), nunca inferido
// aqui por cercania ni coordenadas. routeLocks() solo mira si origen_*/
// destino_* tiene un id -- un id puede apuntar a un registro real pero
// incorrecto (caso real encontrado 21/11/2026: un "destino_infra_id" vivo
// apuntando a una caja NAP de prueba nunca borrada); mostrar el nombre deja
// que la persona lo note, en vez de que el codigo adivine cual conexion es
// "valida".
const props = defineProps<{ map: L.Map; cable: FoCable; saving: boolean; error: string | null; allowed: boolean; originName: string; destName: string }>();
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
const lockedName = (i: number) => (i === 0 ? props.originName : props.destName);
const lockStatusText = computed(() => {
  if (!locks.start && !locks.end) return 'Los extremos no están conectados. Puedes moverlos o desplazar el recorrido completo.';
  const parte = (connected: boolean, name: string, etiqueta: string) =>
    connected ? `${etiqueta} conectado a "${name}" (fijo)` : `${etiqueta} libre (puedes moverlo)`;
  return `${parte(locks.start, props.originName, 'Extremo inicial')}. ${parte(locks.end, props.destName, 'Extremo final')}. No se mueven cajas ni equipos.`;
});

// Deshacer/rehacer locales del borrador (nunca toca Supabase): una
// instantánea de `points` antes de CADA accion discreta (arrastrar un
// vertice, insertar, quitar, mover un tramo/recorrido completo, restaurar).
// Mismo patron visual/teclado (Ctrl+Z / Ctrl+Y) que el deshacer/rehacer ya
// existente en RedMapView.vue para mover/eliminar elementos pasivos -- ese
// otro stack queda intacto y bloqueado mientras se edita un trazado; este
// es uno nuevo, exclusivo del borrador de vertices.
const MAX_HISTORY = 100;
const undoStack = ref<LatLngPoint[][]>([]);
const redoStack = ref<LatLngPoint[][]>([]);
const canUndo = computed(() => undoStack.value.length > 0);
const canRedo = computed(() => redoStack.value.length > 0);
function commit() {
  undoStack.value.push(cloneRoute(points.value));
  if (undoStack.value.length > MAX_HISTORY) undoStack.value.shift();
  redoStack.value = [];
}
function undo() {
  if (!editable() || !canUndo.value) return;
  redoStack.value.push(cloneRoute(points.value));
  points.value = undoStack.value.pop()!;
  selected.value = null;
  localError.value = null;
  render();
}
function redo() {
  if (!editable() || !canRedo.value) return;
  undoStack.value.push(cloneRoute(points.value));
  points.value = redoStack.value.pop()!;
  selected.value = null;
  localError.value = null;
  render();
}
function onKeydown(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
}

let segmentHits: L.Polyline[] = [];
function render() {
  if (!layer) return;
  line.setLatLngs(points.value);
  controls.clearLayers();
  segmentHits = [];
  if (moving.value && canTranslate) {
    const center = L.latLngBounds(points.value).getCenter();
    const marker = L.marker(center, {
      draggable: true, keyboard: true, title: 'Mover recorrido completo',
      icon: L.divIcon({ className: 'route-move-handle', html: '↔', iconSize: [36, 36], iconAnchor: [18, 18] }),
    }).addTo(controls);
    let before = cloneRoute(points.value), start = center;
    marker.on('dragstart', () => { commit(); before = cloneRoute(points.value); start = marker.getLatLng(); });
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
  // Mover un tramo: una franja ancha e invisible sobre cada segmento CON
  // AMBOS extremos libres (mismo criterio que "mover recorrido completo" --
  // nunca ambiguo sobre un extremo conectado). Los marcadores (vertices y
  // "+") se dibujan en un pane por encima, asi que un clic exacto sobre
  // ellos sigue siendo insertar/seleccionar; arrastrar el resto del tramo
  // desplaza sus dos vertices juntos, sin tocar los demas.
  for (let i = 0; i < points.value.length - 1; i++) {
    if (locked(i) || locked(i + 1)) continue;
    // Color distinto del de la linea visible (#a21caf): el arnes de pruebas
    // identifica "el trazado en edicion" buscando la Polyline con ese color
    // exacto -- esta franja de agarre, invisible y de solo 2 puntos, nunca
    // debe poder confundirse con ella.
    const hit = L.polyline([points.value[i], points.value[i + 1]], {
      color: '#000000', weight: 22, opacity: 0, className: 'route-segment-hit',
    }).addTo(controls);
    hit.on('mousedown', (ev: L.LeafletMouseEvent) => {
      if (!editable()) return;
      L.DomEvent.stop(ev);
      commit();
      const before = cloneRoute(points.value);
      const start = ev.latlng;
      props.map.dragging.disable();
      const onMove = (mv: L.LeafletMouseEvent) => {
        try {
          const dLat = mv.latlng.lat - start.lat, dLng = mv.latlng.lng - start.lng;
          const next = cloneRoute(before);
          next[i] = round(L.latLng(before[i][0] + dLat, before[i][1] + dLng));
          next[i + 1] = round(L.latLng(before[i + 1][0] + dLat, before[i + 1][1] + dLng));
          validateRoute(next);
          points.value = next;
          line.setLatLngs(points.value);
          localError.value = null;
        } catch { localError.value = 'El desplazamiento sale de los límites del mapa.'; }
      };
      const onUp = () => {
        props.map.off('mousemove', onMove);
        props.map.off('mouseup', onUp);
        props.map.dragging.enable();
        render();
      };
      props.map.on('mousemove', onMove);
      props.map.on('mouseup', onUp);
    });
    segmentHits.push(hit);
  }
  points.value.forEach((point, i) => {
    const marker = L.marker(point, {
      draggable: !locked(i), keyboard: true,
      title: locked(i) ? `Extremo conectado a "${lockedName(i)}" (fijo) — no se puede arrastrar` : `Vértice ${i + 1}: arrastrar o seleccionar`,
      // Area real de agarre mas grande que el circulo dibujado (34px, antes
      // 26px) -- en la practica, con mouse/trackpad, 26px es dificil de
      // acertar y un fallo silencioso (clic justo al lado) se ve identico
      // a "no funciona". El numero/color va en un <span> INTERNO, nunca en
      // el div que Leaflet posiciona con su propio transform: si el :hover
      // de abajo escalara ese div exterior, pelearia con esa posicion y el
      // marcador "saltaria".
      icon: L.divIcon({
        className: `route-vertex ${locked(i) ? 'route-locked' : ''} ${selected.value === i ? 'route-selected' : ''}`,
        html: `<span class="route-vertex-dot">${i + 1}</span>`,
        iconSize: [34, 34], iconAnchor: [17, 17],
      }),
    }).addTo(controls);
    marker.on('click', () => { if (!editable()) return; selected.value = i; render(); });
    marker.on('dragstart', () => { if (editable() && !locked(i)) commit(); });
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
      icon: L.divIcon({ className: 'route-midpoint', html: '<span class="route-midpoint-dot">+</span>', iconSize: [28, 28], iconAnchor: [14, 14] }),
    }).addTo(controls);
    marker.on('click', () => {
      if (!editable() || points.value.length >= 10000) return;
      commit();
      points.value.splice(i + 1, 0, round(marker.getLatLng()));
      selected.value = i + 1;
      render();
    });
  }
}

function removeSelected() {
  if (!editable() || !canRemove.value || selected.value == null) return;
  commit();
  points.value.splice(selected.value, 1);
  selected.value = null;
  render();
}
function restore() {
  if (!editable() || !dirty.value) return;
  commit();
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
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  layer?.remove();
  window.removeEventListener('beforeunload', beforeUnload);
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <section class="rounded-xl border border-fuchsia-300 bg-fuchsia-50 p-3 mb-3 text-sm" aria-label="Editor de trazado" data-testid="route-editor">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="font-semibold">Editar trazado · {{ cable.codigo }}</h2>
        <p class="text-xs text-slate-600 mt-1">Arrastra los puntos numerados. Pulsa + para agregar un vértice y selecciona uno intermedio para quitarlo. Arrastra la línea entre dos vértices libres (fuera del +) para mover ese tramo completo.</p>
        <p class="text-xs text-slate-600 mt-1">{{ points.length }} vértices · Longitud geográfica: <b>{{ meters }} m</b> · Metraje registrado: <b>{{ cable.metraje == null ? 'Sin registrar' : cable.metraje + ' m' }}</b> (se conserva).</p>
        <p class="text-xs text-slate-600 mt-1">{{ lockStatusText }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn-secondary text-xs" :disabled="!canUndo || saving || !allowed" title="Ctrl+Z" @click="undo">↶ Deshacer{{ canUndo ? ` (${undoStack.length})` : '' }}</button>
        <button class="btn-secondary text-xs" :disabled="!canRedo || saving || !allowed" title="Ctrl+Y" @click="redo">↷ Rehacer{{ canRedo ? ` (${redoStack.length})` : '' }}</button>
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
/* El div exterior (.route-vertex / .route-midpoint) es el que Leaflet
   posiciona con su propio transform: translate3d(...) -- nunca ponerle un
   transform propio (ni :hover) aqui, o el marcador "salta" de lugar. El
   circulo visible vive en un <span> interno (.route-vertex-dot /
   .route-midpoint-dot) que sí se puede escalar al pasar el mouse, dando
   una señal clara de "esto se puede agarrar" ANTES de soltar el clic —
   confirmado con usuarios reales que el círculo pequeño (26px) se sentía
   roto: el clic caía al lado y no pasaba nada, sin ningún aviso.
   iconSize ya viene agrandado en el script (34px vértices, 28px "+"); esto
   solo agrega la retroalimentación visual encima. */
.route-vertex, .route-midpoint, .route-move-handle { display: flex; align-items: center; justify-content: center; }
.route-vertex-dot, .route-midpoint-dot {
  display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;
  border-radius: 50%; border: 2px solid #86198f; background: white; color: #701a75;
  font-weight: 700; box-shadow: 0 1px 5px #0005; transition: transform .08s ease-out;
}
.route-vertex:hover .route-vertex-dot, .route-midpoint:hover .route-midpoint-dot { transform: scale(1.3); }
.route-vertex.route-locked .route-vertex-dot { background: #e2e8f0; border-color: #64748b; color: #334155; cursor: not-allowed; }
.route-vertex.route-locked:hover .route-vertex-dot { transform: none; } /* fijo: ni agrandar simula que se puede arrastrar */
.route-vertex.route-selected .route-vertex-dot { outline: 3px solid #f0abfc; }
.route-midpoint-dot { border-style: dashed; font-size: 18px; cursor: copy; }
.route-move-handle { background: #fef3c7; border-color: #b45309; font-size: 24px; border-radius: 50%; border: 2px solid #b45309; }
.route-segment-hit { cursor: move; }
</style>
