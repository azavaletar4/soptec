<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useClientsStore } from '@/stores/clients';
import { useOltStore } from '@/stores/olt';
import { useMikrotikStore } from '@/stores/mikrotik';
import { useInfraElementosStore, type InfraElementoWithUrl } from '@/stores/infraElementos';
import { useFoFibraStore, type TraceResult } from '@/stores/foFibra';
import { useCatalogsStore } from '@/stores/catalogs';
import CableFormModal from './CableFormModal.vue';
import CableHilosModal from './CableHilosModal.vue';
import SpliceDiagramModal from './SpliceDiagramModal.vue';
import { INFRA_STYLE, INFRA_LABEL, INACTIVE_COLOR, OLT_GLYPH, MIKROTIK_GLYPH, teardropIcon, infraIcon, permanentLabel } from './mapIcons';
import { getErrorMessage } from '@/lib/errors';
import type { FoCable, FoCableTipo, FoFusion, FoNapPuerto, InfraElemento, InfraElementoTipo, LatLngPoint } from '@/types/domain';

const router = useRouter();
const clientsStore = useClientsStore();
const oltStore = useOltStore();
const mikrotikStore = useMikrotikStore();
const infraStore = useInfraElementosStore();
const fibra = useFoFibraStore();
const catalogs = useCatalogsStore();

const loading = ref(true);
const showOlt = ref(true);
const showMikrotik = ref(true);
const showInfra = ref(true);
const showCables = ref(true);
const legendOpen = ref(false);
const mapEl = ref<HTMLDivElement | null>(null);
let map: L.Map | null = null;
let oltLayer: L.LayerGroup | null = null;
let mikrotikLayer: L.LayerGroup | null = null;
let infraLayer: L.LayerGroup | null = null;
let cableLayer: L.LayerGroup | null = null;
let drawLayer: L.LayerGroup | null = null;
let traceLayer: L.LayerGroup | null = null;

const oltsWithGps = computed(() => oltStore.devices.filter((d) => d.lat != null && d.lng != null));
const oltsWithoutGps = computed(() => oltStore.devices.filter((d) => d.lat == null || d.lng == null));
const mikrotiksWithGps = computed(() => mikrotikStore.devices.filter((d) => d.latitude != null && d.longitude != null));
const mikrotiksWithoutGps = computed(() => mikrotikStore.devices.filter((d) => d.latitude == null || d.longitude == null));

// ---- Historial de deshacer/rehacer (mover u eliminar un elemento por error) ----
interface LatLng {
  lat: number;
  lng: number;
}
interface MoveAction {
  kind: 'move';
  target: 'olt' | 'mikrotik' | 'infra';
  id: string;
  before: LatLng;
  after: LatLng;
}
interface DeleteInfraAction {
  kind: 'delete-infra';
  snapshot: InfraElemento;
  puertos: FoNapPuerto[];
  fusiones: FoFusion[];
}
type HistoryAction = MoveAction | DeleteInfraAction;

const MAX_HISTORY = 50;
const undoStack = ref<HistoryAction[]>([]);
const redoStack = ref<HistoryAction[]>([]);

function pushHistory(action: HistoryAction) {
  undoStack.value.push(action);
  if (undoStack.value.length > MAX_HISTORY) undoStack.value.shift();
  redoStack.value = [];
}

async function applyMove(action: MoveAction, coords: LatLng) {
  if (action.target === 'olt') {
    await oltStore.updateCoords(action.id, coords.lat, coords.lng);
    renderOltMarkers();
  } else if (action.target === 'mikrotik') {
    await mikrotikStore.updateDevice(action.id, { latitude: coords.lat, longitude: coords.lng });
    renderMikrotikMarkers();
  } else {
    await infraStore.updateCoords(action.id, coords.lat, coords.lng);
    renderInfraMarkers();
  }
}

/** Recrea el elemento pasivo borrado (nuevo id: los originales ya se perdieron en cascada) junto con sus fusiones y puertos NAP. */
async function undoDeleteInfra(action: DeleteInfraAction) {
  const created = await infraStore.createElemento({
    name: action.snapshot.name,
    tipo: action.snapshot.tipo,
    potencia: action.snapshot.potencia,
    spliteo: action.snapshot.spliteo,
    puertos_total: action.snapshot.puertos_total,
    is_active: action.snapshot.is_active,
    latitude: action.snapshot.latitude ?? 0,
    longitude: action.snapshot.longitude ?? 0,
    notes: action.snapshot.notes,
    zone_id: action.snapshot.zone_id,
  });
  const fusionIdMap = await fibra.restoreFusiones(created.id, action.fusiones);
  await fibra.restoreNapPuertos(created.id, action.puertos, fusionIdMap);
  action.snapshot = { ...action.snapshot, id: created.id };
  renderInfraMarkers();
}

async function redoDeleteInfra(action: DeleteInfraAction) {
  await infraStore.deleteElemento(action.snapshot.id);
  renderInfraMarkers();
}

const undoing = ref(false);

async function undo() {
  const action = undoStack.value.pop();
  if (!action) return;
  undoing.value = true;
  try {
    if (action.kind === 'move') await applyMove(action, action.before);
    else await undoDeleteInfra(action);
    redoStack.value.push(action);
  } catch (e) {
    undoStack.value.push(action);
    alert(getErrorMessage(e, 'No se pudo deshacer la acción'));
  } finally {
    undoing.value = false;
  }
}

async function redo() {
  const action = redoStack.value.pop();
  if (!action) return;
  undoing.value = true;
  try {
    if (action.kind === 'move') await applyMove(action, action.after);
    else await redoDeleteInfra(action);
    undoStack.value.push(action);
  } catch (e) {
    redoStack.value.push(action);
    alert(getErrorMessage(e, 'No se pudo rehacer la acción'));
  } finally {
    undoing.value = false;
  }
}

function onHistoryKeydown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (!(e.ctrlKey || e.metaKey) || undoing.value) return;
  if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) {
    e.preventDefault();
    redo();
  }
}

function renderOltMarkers() {
  if (!oltLayer) return;
  oltLayer.clearLayers();
  if (!showOlt.value) return;
  for (const d of oltsWithGps.value) {
    const marker = L.marker([d.lat as number, d.lng as number], { icon: teardropIcon('#2563eb', OLT_GLYPH), draggable: true });
    marker.bindTooltip(permanentLabel(d.name, 'OLT'), { permanent: true, direction: 'top', offset: [0, -30], className: 'leaflet-label-custom' });
    marker.bindPopup(
      `<div style="font-size:13px"><b>${d.name}</b><br/>${d.host}:${d.telnet_port}<br/><a href="/olt/${d.id}" style="color:#38bdf8">Ver OLT →</a></div>`,
    );
    marker.on('dragend', async () => {
      const pos = marker.getLatLng();
      const before = { lat: d.lat as number, lng: d.lng as number };
      const after = { lat: Number(pos.lat.toFixed(7)), lng: Number(pos.lng.toFixed(7)) };
      try {
        await oltStore.updateCoords(d.id, after.lat, after.lng);
        pushHistory({ kind: 'move', target: 'olt', id: d.id, before, after });
      } catch (e) {
        alert(getErrorMessage(e, 'Error al guardar la posición de la OLT'));
      }
    });
    marker.addTo(oltLayer);
  }
}

function renderMikrotikMarkers() {
  if (!mikrotikLayer) return;
  mikrotikLayer.clearLayers();
  if (!showMikrotik.value) return;
  for (const d of mikrotiksWithGps.value) {
    const marker = L.marker([d.latitude as number, d.longitude as number], { icon: teardropIcon('#7c3aed', MIKROTIK_GLYPH), draggable: true });
    marker.bindTooltip(permanentLabel(d.name, 'MikroTik'), { permanent: true, direction: 'top', offset: [0, -30], className: 'leaflet-label-custom' });
    marker.bindPopup(
      `<div style="font-size:13px"><b>${d.name}</b><br/>${d.host}<br/><a href="/mikrotik/${d.id}" style="color:#38bdf8">Ver router →</a></div>`,
    );
    marker.on('dragend', async () => {
      const pos = marker.getLatLng();
      const before = { lat: d.latitude as number, lng: d.longitude as number };
      const after = { lat: Number(pos.lat.toFixed(7)), lng: Number(pos.lng.toFixed(7)) };
      try {
        await mikrotikStore.updateDevice(d.id, { latitude: after.lat, longitude: after.lng });
        pushHistory({ kind: 'move', target: 'mikrotik', id: d.id, before, after });
      } catch (e) {
        alert(getErrorMessage(e, 'Error al guardar la posición del router'));
      }
    });
    marker.addTo(mikrotikLayer);
  }
}

const hoverTip = L.tooltip({ direction: 'top', offset: [0, -10], className: 'leaflet-hover-potencia', sticky: false });

function renderInfraMarkers() {
  if (!infraLayer) return;
  infraLayer.clearLayers();
  if (!showInfra.value) return;
  for (const el of infraStore.elementos) {
    if (el.latitude == null || el.longitude == null) continue;
    const marker = L.marker([el.latitude, el.longitude], { icon: infraIcon(el), draggable: true });
    marker.bindTooltip(permanentLabel(el.name, INFRA_LABEL[el.tipo]), { permanent: true, direction: 'top', offset: [0, -10], className: 'leaflet-label-custom' });

    let hoverHtml = `<b>${el.name}</b><br/><span style="opacity:0.8">${INFRA_LABEL[el.tipo]}</span>`;
    if (el.potencia) hoverHtml += `<br/>⚡ ${el.potencia}`;
    if (el.spliteo) hoverHtml += `<br/>⇉ ${el.spliteo}`;
    if (el.notes) hoverHtml += `<br/><span style="opacity:0.7">${el.notes}</span>`;
    marker.on('mouseover', () => {
      hoverTip.setContent(hoverHtml);
      hoverTip.setLatLng(marker.getLatLng());
      map!.openTooltip(hoverTip);
    });
    marker.on('mouseout', () => map!.closeTooltip(hoverTip));

    marker.bindPopup(() => infraPopupHtml(el));
    marker.on('popupopen', () => wireInfraPopup(el));

    marker.on('dragend', async () => {
      const pos = marker.getLatLng();
      const before = { lat: el.latitude as number, lng: el.longitude as number };
      const after = { lat: Number(pos.lat.toFixed(7)), lng: Number(pos.lng.toFixed(7)) };
      try {
        await infraStore.updateCoords(el.id, after.lat, after.lng);
        pushHistory({ kind: 'move', target: 'infra', id: el.id, before, after });
      } catch (e) {
        alert(getErrorMessage(e, 'Error al guardar la posición'));
      }
    });
    marker.addTo(infraLayer);
  }
}

function infraPopupHtml(el: InfraElementoWithUrl) {
  return `<div style="font-size:13px;min-width:160px">
    ${el.photoUrl ? `<img src="${el.photoUrl}" style="width:100%;border-radius:6px;margin-bottom:6px" />` : ''}
    <b>${el.name}</b><br/>
    <span style="opacity:0.8">${INFRA_LABEL[el.tipo]}</span><br/>
    ${el.potencia ? `⚡ ${el.potencia}<br/>` : ''}
    ${el.spliteo ? `⇉ ${el.spliteo}<br/>` : ''}
    ${el.notes ? `${el.notes}<br/>` : ''}
    <span style="color:${el.is_active ? '#22c55e' : '#9ca3af'}">● ${el.is_active ? 'Activo' : 'Inactivo'}</span>
    <div style="margin-top:6px;display:flex;gap:10px">
      <button id="infra-edit-${el.id}" style="color:#38bdf8;background:none;border:none;padding:0;cursor:pointer;font-size:12px">Editar →</button>
      ${
        el.tipo === 'manga' || el.tipo === 'caja_nap'
          ? `<button id="infra-splice-${el.id}" style="color:#22c55e;background:none;border:none;padding:0;cursor:pointer;font-size:12px">Empalmes →</button>`
          : ''
      }
    </div>
  </div>`;
}

function wireInfraPopup(el: InfraElementoWithUrl) {
  setTimeout(() => {
    document.getElementById(`infra-edit-${el.id}`)?.addEventListener('click', () => openInfraModal(el));
    document.getElementById(`infra-splice-${el.id}`)?.addEventListener('click', () => openSpliceModal(el.id));
  }, 0);
}

function fitToMarkers() {
  if (!map) return;
  const points: L.LatLngExpression[] = [
    ...oltsWithGps.value.map((d) => [d.lat as number, d.lng as number] as L.LatLngExpression),
    ...mikrotiksWithGps.value.map((d) => [d.latitude as number, d.longitude as number] as L.LatLngExpression),
    ...infraStore.elementos.filter((e) => e.latitude != null).map((e) => [e.latitude as number, e.longitude as number] as L.LatLngExpression),
  ];
  if (points.length) {
    map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 15 });
  } else {
    map.setView([-1.83, -78.18], 6);
  }
}

onMounted(async () => {
  map = L.map(mapEl.value as HTMLDivElement, { zoomControl: true }).setView([-1.83, -78.18], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
  oltLayer = L.layerGroup().addTo(map);
  mikrotikLayer = L.layerGroup().addTo(map);
  infraLayer = L.layerGroup().addTo(map);
  cableLayer = L.layerGroup().addTo(map);
  drawLayer = L.layerGroup().addTo(map);
  traceLayer = L.layerGroup().addTo(map);
  map.on('click', onMapClick);
  window.addEventListener('keydown', onHistoryKeydown);

  loading.value = true;
  try {
    await Promise.all([
      oltStore.fetchDevices(),
      mikrotikStore.fetchDevices(),
      infraStore.fetchElementos(),
      fibra.fetchCables(),
      fibra.fetchFusiones(),
      clientsStore.fetchClients(),
      catalogs.fetchZones(),
    ]);
  } finally {
    loading.value = false;
  }
  renderOltMarkers();
  renderMikrotikMarkers();
  renderInfraMarkers();
  renderCables();
  fitToMarkers();
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onHistoryKeydown);
  map?.remove();
  map = null;
});

watch(showOlt, renderOltMarkers);
watch(showMikrotik, renderMikrotikMarkers);
watch(showInfra, renderInfraMarkers);
watch(showCables, renderCables);

function goTo(path: string) {
  router.push(path);
}

async function placeOlt(id: string) {
  if (!map) return;
  const center = map.getCenter();
  try {
    await oltStore.updateCoords(id, Number(center.lat.toFixed(7)), Number(center.lng.toFixed(7)));
    renderOltMarkers();
  } catch (e) {
    alert(getErrorMessage(e, 'Error al ubicar la OLT'));
  }
}
async function placeMikrotik(id: string) {
  if (!map) return;
  const center = map.getCenter();
  try {
    await mikrotikStore.updateDevice(id, { latitude: Number(center.lat.toFixed(7)), longitude: Number(center.lng.toFixed(7)) });
    renderMikrotikMarkers();
  } catch (e) {
    alert(getErrorMessage(e, 'Error al ubicar el router'));
  }
}

// ---- Modal CRUD de elementos pasivos ----
const showInfraModal = ref(false);
const infraSaving = ref(false);
const infraError = ref<string | null>(null);
const editingInfraId = ref<string | null>(null);
const infraForm = ref({
  name: '',
  tipo: 'caja_nap' as InfraElementoTipo,
  potencia: '',
  spliteo: '',
  puertos_total: null as number | null,
  is_active: true,
  notes: '',
  latitude: 0,
  longitude: 0,
  zone_id: null as string | null,
});
const infraPhotoFile = ref<File | null>(null);
const infraPhotoPath = ref<string | null>(null);

function openInfraModal(el?: InfraElementoWithUrl) {
  infraError.value = null;
  infraPhotoFile.value = null;
  if (el) {
    editingInfraId.value = el.id;
    infraForm.value = {
      name: el.name,
      tipo: el.tipo,
      potencia: el.potencia ?? '',
      spliteo: el.spliteo ?? '',
      puertos_total: el.puertos_total ?? null,
      is_active: el.is_active,
      notes: el.notes ?? '',
      latitude: el.latitude ?? 0,
      longitude: el.longitude ?? 0,
      zone_id: el.zone_id ?? null,
    };
    infraPhotoPath.value = el.photo_path;
  } else {
    editingInfraId.value = null;
    const center = map?.getCenter();
    infraForm.value = {
      name: '',
      tipo: 'caja_nap',
      potencia: '',
      spliteo: '',
      puertos_total: null,
      is_active: true,
      notes: '',
      latitude: center ? Number(center.lat.toFixed(7)) : -1.83,
      longitude: center ? Number(center.lng.toFixed(7)) : -78.18,
      zone_id: null,
    };
    infraPhotoPath.value = null;
  }
  showInfraModal.value = true;
}

function onInfraPhotoChange(e: Event) {
  infraPhotoFile.value = (e.target as HTMLInputElement).files?.[0] ?? null;
}

async function handleSaveInfra() {
  infraSaving.value = true;
  infraError.value = null;
  try {
    let saved: InfraElementoWithUrl;
    if (editingInfraId.value) {
      saved = await infraStore.updateElemento(editingInfraId.value, {
        name: infraForm.value.name,
        tipo: infraForm.value.tipo,
        potencia: infraForm.value.potencia || null,
        spliteo: infraForm.value.spliteo || null,
        puertos_total: infraForm.value.puertos_total || null,
        is_active: infraForm.value.is_active,
        notes: infraForm.value.notes || null,
        zone_id: infraForm.value.tipo === 'caja_nap' ? infraForm.value.zone_id : null,
      });
    } else {
      saved = await infraStore.createElemento({
        name: infraForm.value.name,
        tipo: infraForm.value.tipo,
        potencia: infraForm.value.potencia || null,
        spliteo: infraForm.value.spliteo || null,
        puertos_total: infraForm.value.puertos_total || null,
        is_active: infraForm.value.is_active,
        notes: infraForm.value.notes || null,
        latitude: infraForm.value.latitude,
        longitude: infraForm.value.longitude,
        zone_id: infraForm.value.tipo === 'caja_nap' ? infraForm.value.zone_id : null,
      });
    }
    if (infraPhotoFile.value) {
      await infraStore.uploadPhoto(saved.id, infraPhotoFile.value, infraPhotoPath.value);
    }
    showInfraModal.value = false;
    renderInfraMarkers();
  } catch (e) {
    infraError.value = getErrorMessage(e, 'Error al guardar el elemento');
  } finally {
    infraSaving.value = false;
  }
}

async function handleDeleteInfra() {
  if (!editingInfraId.value) return;
  const ok = confirm(`¿Eliminar "${infraForm.value.name}"? Puedes deshacerlo con el botón "Deshacer" o Ctrl+Z.`);
  if (!ok) return;
  infraSaving.value = true;
  try {
    const snapshot = infraStore.elementos.find((e) => e.id === editingInfraId.value);
    if (!snapshot) throw new Error('Elemento no encontrado');
    const puertos = await fibra.fetchNapPuertos(editingInfraId.value);
    const fusiones = fibra.fusiones.filter((f) => f.infra_elemento_id === editingInfraId.value);
    await infraStore.deleteElemento(editingInfraId.value);
    pushHistory({ kind: 'delete-infra', snapshot: { ...snapshot }, puertos, fusiones });
    showInfraModal.value = false;
    renderInfraMarkers();
  } catch (e) {
    infraError.value = getErrorMessage(e, 'Error al eliminar');
  } finally {
    infraSaving.value = false;
  }
}

// ---- Capa de cables de fibra (troncal/ramal) ----
const CABLE_STYLE: Record<FoCableTipo, { color: string; weight: number; dashArray?: string }> = {
  troncal: { color: '#0ea5e9', weight: 5 },
  ramal: { color: '#f97316', weight: 3, dashArray: '7 5' },
};

function elementoNombre(oltId: string | null, infraId: string | null): string {
  if (oltId) return oltStore.devices.find((d) => d.id === oltId)?.name ?? 'OLT';
  if (infraId) return infraStore.elementos.find((e) => e.id === infraId)?.name ?? 'Elemento';
  return 'Sin definir';
}

function renderCables() {
  if (!cableLayer) return;
  cableLayer.clearLayers();
  if (!showCables.value) return;
  for (const cable of fibra.cables) {
    if (!cable.path?.length) continue;
    const style = CABLE_STYLE[cable.tipo];
    const line = L.polyline(cable.path as L.LatLngExpression[], {
      color: cable.is_active ? style.color : INACTIVE_COLOR,
      weight: style.weight,
      dashArray: style.dashArray,
      opacity: 0.9,
    });
    line.bindTooltip(
      `<b>${cable.codigo}</b><br/>${cable.tipo === 'troncal' ? 'Troncal' : 'Ramal'} · ${cable.hilos_total} FO${cable.metraje ? ` · ${cable.metraje} m` : ''}<br/>${elementoNombre(cable.origen_olt_id, cable.origen_infra_id)} → ${elementoNombre(cable.destino_olt_id, cable.destino_infra_id)}`,
      { sticky: true, className: 'leaflet-hover-potencia' },
    );
    line.on('click', () => openCableHilos(cable));
    line.addTo(cableLayer);
  }
}

// ---- Modo de trazado de cables ----
const drawMode = ref<FoCableTipo | null>(null);
const drawPoints = ref<LatLngPoint[]>([]);

function startDrawMode(tipo: FoCableTipo) {
  cancelDrawing();
  drawMode.value = tipo;
  drawPoints.value = [];
}

function onMapClick(e: L.LeafletMouseEvent) {
  if (!drawMode.value || !drawLayer) return;
  drawPoints.value.push([Number(e.latlng.lat.toFixed(7)), Number(e.latlng.lng.toFixed(7))]);
  drawLayer.clearLayers();
  L.polyline(drawPoints.value as L.LatLngExpression[], {
    color: CABLE_STYLE[drawMode.value].color,
    weight: CABLE_STYLE[drawMode.value].weight,
    dashArray: '4 4',
  }).addTo(drawLayer);
  for (const pt of drawPoints.value) {
    L.circleMarker(pt as L.LatLngExpression, { radius: 4, color: '#0f172a', fillColor: '#fff', fillOpacity: 1 }).addTo(drawLayer!);
  }
}

function undoLastPoint() {
  drawPoints.value.pop();
  if (drawLayer) drawLayer.clearLayers();
  if (drawPoints.value.length && drawLayer && drawMode.value) {
    L.polyline(drawPoints.value as L.LatLngExpression[], { color: CABLE_STYLE[drawMode.value].color }).addTo(drawLayer);
  }
}

function cancelDrawing() {
  drawMode.value = null;
  drawPoints.value = [];
  drawLayer?.clearLayers();
}

function metrajeCalculado(path: LatLngPoint[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += L.latLng(path[i - 1][0], path[i - 1][1]).distanceTo(L.latLng(path[i][0], path[i][1]));
  }
  return Math.round(total);
}

const showCableForm = ref(false);
const editingCable = ref<FoCable | null>(null);
const pendingPath = ref<LatLngPoint[] | null>(null);

function finishDrawing() {
  if (drawPoints.value.length < 2) {
    alert('Traza al menos dos puntos para definir el cable.');
    return;
  }
  pendingPath.value = [...drawPoints.value];
  editingCable.value = null;
  showCableForm.value = true;
}

async function handleSaveCable(payload: Record<string, unknown>) {
  try {
    if (editingCable.value) {
      await fibra.updateCable(editingCable.value.id, payload as Partial<FoCable>);
    } else {
      await fibra.createCable(payload as Parameters<typeof fibra.createCable>[0]);
    }
    showCableForm.value = false;
    cancelDrawing();
    pendingPath.value = null;
    renderCables();
  } catch (e) {
    alert(getErrorMessage(e, 'Error al guardar el cable'));
  }
}

async function handleDeleteCable(cableOverride?: FoCable) {
  const cable = cableOverride ?? editingCable.value;
  if (!cable) return;
  if (!confirm(`¿Eliminar el cable "${cable.codigo}"? Se borrará también su traza, hilos y fusiones asociadas.`)) return;
  try {
    await fibra.deleteCable(cable.id);
    showCableForm.value = false;
    showCableHilos.value = false;
    renderCables();
  } catch (e) {
    alert(getErrorMessage(e, 'Error al eliminar el cable'));
  }
}

// ---- Inspección de hilos de un cable ----
const showCableHilos = ref(false);
const inspectingCable = ref<FoCable | null>(null);

function openCableHilos(cable: FoCable) {
  inspectingCable.value = cable;
  showCableHilos.value = true;
}

function openCableEditFromHilos() {
  editingCable.value = inspectingCable.value;
  pendingPath.value = null;
  showCableHilos.value = false;
  showCableForm.value = true;
}

// ---- Diagrama de fusión / puertos NAP ----
const showSpliceModal = ref(false);
const spliceElementoId = ref<string | null>(null);
const spliceElemento = computed(() => infraStore.elementos.find((e) => e.id === spliceElementoId.value) ?? null);

function openSpliceModal(infraElementoId: string) {
  spliceElementoId.value = infraElementoId;
  showSpliceModal.value = true;
  showCableHilos.value = false;
}

const activeTrace = ref<TraceResult | null>(null);

function handleTraceResult(result: TraceResult | null) {
  activeTrace.value = result;
  if (!traceLayer) return;
  traceLayer.clearLayers();
  if (!result) return;
  for (const hop of result.hops) {
    L.polyline(hop.cable.path as L.LatLngExpression[], { color: '#22c55e', weight: 7, opacity: 0.85 }).addTo(traceLayer);
  }
  if (result.hops.length && map) {
    const bounds = L.latLngBounds(result.hops.flatMap((h) => h.cable.path as L.LatLngExpression[]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }
}

function clearTrace() {
  handleTraceResult(null);
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div>
        <div class="flex items-center gap-2">
          <h1 class="text-2xl font-semibold">Mapa de Red</h1>
          <span class="text-xs px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-600 font-medium">Diseño de planta externa</span>
        </div>
        <p class="text-slate-600 text-sm mt-1">
          {{ oltsWithGps.length }} OLTs · {{ mikrotiksWithGps.length }} MikroTiks · {{ infraStore.elementos.length }} elementos pasivos ·
          {{ fibra.cables.length }} cables
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn-secondary text-xs" @click="goTo('/mapa/clientes')">👤 Ver mapa de clientes →</button>
        <button class="btn-secondary text-xs" @click="goTo('/mapa/importar')">⬆ Importar KML/KMZ</button>
        <button
          class="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
          :class="showOlt ? 'bg-sky-500 text-slate-950' : 'bg-slate-100 text-slate-600 hover:text-slate-900'"
          @click="showOlt = !showOlt"
        >
          <span class="w-2 h-2 rounded-full" style="background:#2563eb"></span> OLT ({{ oltsWithGps.length }})
        </button>
        <button
          class="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
          :class="showMikrotik ? 'bg-sky-500 text-slate-950' : 'bg-slate-100 text-slate-600 hover:text-slate-900'"
          @click="showMikrotik = !showMikrotik"
        >
          <span class="w-2 h-2 rounded-full" style="background:#7c3aed"></span> MikroTik ({{ mikrotiksWithGps.length }})
        </button>
        <button
          class="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
          :class="showInfra ? 'bg-sky-500 text-slate-950' : 'bg-slate-100 text-slate-600 hover:text-slate-900'"
          @click="showInfra = !showInfra"
        >
          <span class="w-2 h-2 rounded-full" style="background:#f97316"></span> Pasivos ({{ infraStore.elementos.length }})
        </button>
        <button
          class="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
          :class="showCables ? 'bg-sky-500 text-slate-950' : 'bg-slate-100 text-slate-600 hover:text-slate-900'"
          @click="showCables = !showCables"
        >
          <span class="w-3 h-0.5 rounded-full inline-block" style="background:#0ea5e9"></span> Cables ({{ fibra.cables.length }})
        </button>
        <button class="btn-primary text-xs" @click="openInfraModal()">+ Elemento pasivo</button>
        <button
          class="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!undoStack.length"
          title="Deshacer (Ctrl+Z)"
          @click="undo"
        >
          ↶ Deshacer{{ undoStack.length ? ` (${undoStack.length})` : '' }}
        </button>
        <button
          class="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!redoStack.length"
          title="Rehacer (Ctrl+Y)"
          @click="redo"
        >
          ↷ Rehacer{{ redoStack.length ? ` (${redoStack.length})` : '' }}
        </button>
        <button
          class="px-3 py-1.5 rounded-lg text-xs font-medium"
          :class="drawMode === 'troncal' ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600 hover:text-slate-900'"
          @click="drawMode === 'troncal' ? cancelDrawing() : startDrawMode('troncal')"
        >
          ✏️ Trazar troncal
        </button>
        <button
          class="px-3 py-1.5 rounded-lg text-xs font-medium"
          :class="drawMode === 'ramal' ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600 hover:text-slate-900'"
          @click="drawMode === 'ramal' ? cancelDrawing() : startDrawMode('ramal')"
        >
          ✏️ Trazar ramal
        </button>
      </div>
    </div>

    <div v-if="drawMode" class="rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 mb-3 text-xs flex flex-wrap items-center gap-3">
      <span>
        Trazando <b>{{ drawMode === 'troncal' ? 'cable troncal' : 'cable ramal' }}</b> — haz clic en el mapa para agregar vértices
        ({{ drawPoints.length }} punto(s){{ drawPoints.length >= 2 ? `, ~${metrajeCalculado(drawPoints)} m` : '' }}).
      </span>
      <button class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200" :disabled="!drawPoints.length" @click="undoLastPoint">Deshacer punto</button>
      <button class="btn-primary text-xs" :disabled="drawPoints.length < 2" @click="finishDrawing">Finalizar trazado</button>
      <button class="btn-ghost text-xs" @click="cancelDrawing">Cancelar</button>
    </div>

    <div v-if="activeTrace" class="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 mb-3 text-xs flex items-center gap-3">
      <span v-if="activeTrace.reachedOlt" class="text-emerald-700">✓ Ruta óptica resaltada en el mapa hasta la OLT ({{ activeTrace.hops.length }} tramo(s)).</span>
      <span v-else class="text-amber-700">⚠ Ruta parcial resaltada: {{ activeTrace.error }}</span>
      <button class="btn-ghost text-xs ml-auto" @click="clearTrace">Limpiar ruta</button>
    </div>

    <div v-if="oltsWithoutGps.length || mikrotiksWithoutGps.length" class="rounded-xl border border-amber-800/40 bg-amber-950/20 p-3 mb-3 text-xs">
      <span class="text-slate-600">Sin ubicar en el mapa — clic para colocar en el centro actual, luego arrastra para ajustar:</span>
      <div class="flex flex-wrap gap-2 mt-2">
        <button v-for="d in oltsWithoutGps" :key="d.id" class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-100 text-sky-600" @click="placeOlt(d.id)">
          📍 {{ d.name }} (OLT)
        </button>
        <button v-for="d in mikrotiksWithoutGps" :key="d.id" class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-100 text-violet-600" @click="placeMikrotik(d.id)">
          📍 {{ d.name }} (MikroTik)
        </button>
      </div>
    </div>

    <div class="mb-3">
      <button class="text-xs text-slate-600 hover:text-slate-900" @click="legendOpen = !legendOpen">
        {{ legendOpen ? '▾' : '▸' }} Leyenda
      </button>
      <div v-if="legendOpen" class="flex flex-wrap gap-4 mt-2 text-xs text-slate-600 rounded-xl border border-slate-200 bg-slate-100 p-3">
        <span v-for="(label, tipo) in INFRA_LABEL" :key="tipo" class="flex items-center gap-1.5">
          <span class="w-2.5 h-2.5 inline-block" :style="{ background: INFRA_STYLE[tipo as InfraElementoTipo].color, borderRadius: INFRA_STYLE[tipo as InfraElementoTipo].shape === 'circle' ? '50%' : '2px' }"></span>
          {{ label }}
        </span>
        <span class="flex items-center gap-1.5"><span class="w-4 h-1 rounded-full inline-block" style="background:#0ea5e9"></span>Cable troncal</span>
        <span class="flex items-center gap-1.5"><span class="w-4 h-1 rounded-full inline-block" style="background:#f97316;border-top:2px dashed #f97316"></span>Cable ramal</span>
        <span class="text-slate-400">Arrastra cualquier marcador para reubicarlo — se guarda solo.</span>
      </div>
    </div>

    <div class="relative rounded-xl overflow-hidden border border-slate-200" style="height: 75vh;">
      <div v-if="loading" class="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/40 text-slate-600 text-sm">
        Cargando mapa...
      </div>
      <div ref="mapEl" class="w-full h-full"></div>
    </div>

    <Teleport to="body">
      <div v-if="showInfraModal" class="modal-overlay" style="z-index: 2000" @click.self="showInfraModal = false">
        <form class="w-full max-w-md modal-panel max-h-[90vh] overflow-y-auto" @submit.prevent="handleSaveInfra">
          <h2 class="text-lg font-semibold mb-4">{{ editingInfraId ? 'Editar elemento' : 'Nuevo elemento pasivo' }}</h2>

          <div class="mb-3">
            <label class="field-label">Nombre</label>
            <input v-model="infraForm.name" required placeholder="ej. NAP-001" class="field-input" />
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="field-label">Tipo</label>
              <select v-model="infraForm.tipo" class="field-input">
                <option v-for="(label, tipo) in INFRA_LABEL" :key="tipo" :value="tipo">{{ label }}</option>
              </select>
            </div>
            <div>
              <label class="field-label">Spliteo</label>
              <select v-model="infraForm.spliteo" class="field-input">
                <option value="">—</option>
                <option v-for="s in ['1:2', '1:4', '1:8', '1:16', '1:32', '1:64']" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="field-label">Potencia óptica</label>
              <input v-model="infraForm.potencia" placeholder="ej. -15 dBm" class="field-input" />
            </div>
            <div v-if="infraForm.tipo === 'caja_nap'">
              <label class="field-label">Capacidad de puertos</label>
              <select v-model.number="infraForm.puertos_total" class="field-input">
                <option :value="null">—</option>
                <option v-for="n in [4, 8, 16, 24]" :key="n" :value="n">{{ n }} puertos</option>
              </select>
            </div>
          </div>

          <div v-if="infraForm.tipo === 'caja_nap'" class="mb-3">
            <label class="field-label">Zona</label>
            <select v-model="infraForm.zone_id" class="field-input">
              <option :value="null">Sin zona asignada</option>
              <option v-for="z in catalogs.zones" :key="z.id" :value="z.id">{{ z.name }}</option>
            </select>
          </div>

          <div class="mb-3">
            <label class="flex items-center gap-2 text-sm">
              <input v-model="infraForm.is_active" type="checkbox" />
              Activo
            </label>
          </div>

          <div class="mb-3">
            <label class="field-label">Notas</label>
            <textarea v-model="infraForm.notes" rows="2" class="field-input"></textarea>
          </div>

          <div class="mb-4">
            <label class="field-label">Foto (opcional)</label>
            <input type="file" accept="image/*" class="field-input" @change="onInfraPhotoChange" />
          </div>

          <p v-if="infraError" class="text-sm text-red-600 mb-3">{{ infraError }}</p>

          <div class="flex justify-between gap-2">
            <button
              v-if="editingInfraId"
              type="button"
              class="text-red-600 hover:underline text-xs"
              :disabled="infraSaving"
              @click="handleDeleteInfra"
            >
              Eliminar
            </button>
            <div class="flex gap-2 ml-auto">
              <button type="button" class="btn-ghost" @click="showInfraModal = false">Cancelar</button>
              <button type="submit" :disabled="infraSaving || !infraForm.name" class="btn-primary">
                {{ infraSaving ? 'Guardando...' : 'Guardar' }}
              </button>
            </div>
          </div>
        </form>
      </div>
    </Teleport>

    <CableFormModal
      v-if="showCableForm"
      :cable="editingCable"
      :path="pendingPath ?? undefined"
      :default-tipo="drawMode ?? undefined"
      :metraje-sugerido="pendingPath ? metrajeCalculado(pendingPath) : null"
      :infra-elementos="infraStore.elementos"
      :olt-devices="oltStore.devices"
      @save="handleSaveCable"
      @cancel="showCableForm = false"
      @delete="handleDeleteCable"
    />

    <CableHilosModal
      v-if="showCableHilos && inspectingCable"
      :cable="inspectingCable"
      :infra-elementos="infraStore.elementos"
      :olt-devices="oltStore.devices"
      @close="showCableHilos = false"
      @edit="openCableEditFromHilos"
      @delete="handleDeleteCable(inspectingCable!)"
      @open-splice="openSpliceModal"
    />

    <SpliceDiagramModal
      v-if="showSpliceModal && spliceElemento"
      :elemento="spliceElemento"
      :cables="fibra.cables"
      :clients="clientsStore.clients"
      @close="showSpliceModal = false"
      @trace-result="handleTraceResult"
    />
  </AppLayout>
</template>
