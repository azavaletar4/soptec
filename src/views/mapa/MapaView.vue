<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useClientsStore } from '@/stores/clients';
import { useInstallationsStore } from '@/stores/installations';
import { useOltStore } from '@/stores/olt';
import { useMikrotikStore } from '@/stores/mikrotik';
import { useInfraElementosStore, type InfraElementoWithUrl } from '@/stores/infraElementos';
import { getErrorMessage } from '@/lib/errors';
import type { ClientStatus, InfraElementoTipo } from '@/types/domain';

const router = useRouter();
const clientsStore = useClientsStore();
const installationsStore = useInstallationsStore();
const oltStore = useOltStore();
const mikrotikStore = useMikrotikStore();
const infraStore = useInfraElementosStore();

const loading = ref(true);
const showClients = ref(true);
const showInstallations = ref(true);
const showOlt = ref(true);
const showMikrotik = ref(true);
const showInfra = ref(true);
const legendOpen = ref(false);
const mapEl = ref<HTMLDivElement | null>(null);
let map: L.Map | null = null;
let clientLayer: L.LayerGroup | null = null;
let installationLayer: L.LayerGroup | null = null;
let oltLayer: L.LayerGroup | null = null;
let mikrotikLayer: L.LayerGroup | null = null;
let infraLayer: L.LayerGroup | null = null;

const CLIENT_COLOR: Record<ClientStatus, string> = {
  active: '#22c55e',
  suspended: '#ef4444',
  prospect: '#f59e0b',
  retired: '#64748b',
};

const INFRA_STYLE: Record<InfraElementoTipo, { color: string; shape: 'square' | 'diamond' | 'mufa' | 'nap' | 'circle' | 'pentagon' }> = {
  caja_nap: { color: '#e2e8f0', shape: 'nap' },
  splitter: { color: '#8b5cf6', shape: 'diamond' },
  manga: { color: '#1e293b', shape: 'mufa' },
  armario: { color: '#64748b', shape: 'square' },
  poste: { color: '#92400e', shape: 'circle' },
  camara: { color: '#dc2626', shape: 'circle' },
  otro: { color: '#6366f1', shape: 'pentagon' },
};
const INFRA_LABEL: Record<InfraElementoTipo, string> = {
  caja_nap: 'Caja NAP',
  splitter: 'Splitter',
  manga: 'Mufa',
  armario: 'Armario',
  poste: 'Poste',
  camara: 'Cámara',
  otro: 'Otro',
};
const INACTIVE_COLOR = '#9ca3af';

const clientsWithGps = computed(() => clientsStore.clients.filter((c) => c.latitude != null && c.longitude != null));
const pendingInstallations = computed(() =>
  installationsStore.installations.filter(
    (i) => (i.status === 'pending' || i.status === 'scheduled') && i.clients?.latitude != null && i.clients?.longitude != null,
  ),
);
const oltsWithGps = computed(() => oltStore.devices.filter((d) => d.lat != null && d.lng != null));
const oltsWithoutGps = computed(() => oltStore.devices.filter((d) => d.lat == null || d.lng == null));
const mikrotiksWithGps = computed(() => mikrotikStore.devices.filter((d) => d.latitude != null && d.longitude != null));
const mikrotiksWithoutGps = computed(() => mikrotikStore.devices.filter((d) => d.latitude == null || d.longitude == null));

// ---- Icono "gota" (teardrop) para equipos activos, estilo SmartOLT ----
function teardropIcon(color: string, glyphPath: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:30px;height:30px;border-radius:50% 50% 50% 0;background:${color};border:2px solid #0f172a;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.4)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" style="transform:rotate(45deg)">${glyphPath}</svg>
    </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -30],
  });
}
const OLT_GLYPH = '<rect x="3" y="4" width="18" height="6" rx="1"/><rect x="3" y="14" width="18" height="6" rx="1"/><circle cx="7" cy="7" r="0.5" fill="white"/><circle cx="7" cy="17" r="0.5" fill="white"/>';
const MIKROTIK_GLYPH = '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>';

// Icono de la mufa: domo con nervaduras y puertos de cable abajo, calcado
// de la foto de referencia (cierre de empalme tipo domo negro/anillado).
function mufaIconHtml(color: string) {
  return `<svg width="16" height="22" viewBox="0 0 16 22">
    <path d="M4 2 Q4 0 8 0 Q12 0 12 2 L12 15 Q12 16.5 8 16.5 Q4 16.5 4 15 Z" fill="${color}" stroke="#0f172a" stroke-width="1"/>
    <line x1="4" y1="4.5" x2="12" y2="4.5" stroke="#0f172a" stroke-width="0.6" opacity="0.6"/>
    <line x1="4" y1="7.5" x2="12" y2="7.5" stroke="#0f172a" stroke-width="0.6" opacity="0.6"/>
    <line x1="4" y1="10.5" x2="12" y2="10.5" stroke="#0f172a" stroke-width="0.6" opacity="0.6"/>
    <line x1="4" y1="13.5" x2="12" y2="13.5" stroke="#0f172a" stroke-width="0.6" opacity="0.6"/>
    <ellipse cx="8" cy="16.5" rx="4" ry="1.5" fill="${color}" stroke="#0f172a" stroke-width="1"/>
    <rect x="5.5" y="17" width="1.8" height="4" rx="0.8" fill="${color}" stroke="#0f172a" stroke-width="0.8"/>
    <rect x="8.7" y="17" width="1.8" height="4" rx="0.8" fill="${color}" stroke="#0f172a" stroke-width="0.8"/>
  </svg>`;
}

// Icono de la caja NAP: caja rectangular clara con pestillo y una fila de
// puertos de cable negros en el borde inferior, calcado de la foto de
// referencia (caja de distribucion de fibra tipo NAP-16).
function napIconHtml(color: string) {
  return `<svg width="20" height="20" viewBox="0 0 20 20">
    <rect x="2" y="1.5" width="16" height="13" rx="2" fill="${color}" stroke="#0f172a" stroke-width="1"/>
    <circle cx="10" cy="8" r="1" fill="#0f172a" opacity="0.7"/>
    <rect x="0.5" y="6" width="1.5" height="3" rx="0.5" fill="#0f172a" opacity="0.8"/>
    <rect x="18" y="6" width="1.5" height="3" rx="0.5" fill="#0f172a" opacity="0.8"/>
    ${[3, 5.5, 8, 10.5, 13, 15.5]
      .map((x) => `<rect x="${x}" y="13.5" width="1.6" height="4.5" rx="0.7" fill="#0f172a"/>`)
      .join('')}
  </svg>`;
}

function infraIcon(el: InfraElementoWithUrl) {
  const color = el.is_active ? INFRA_STYLE[el.tipo].color : INACTIVE_COLOR;
  const shape = INFRA_STYLE[el.tipo].shape;

  if (shape === 'nap') {
    return L.divIcon({
      className: '',
      html: `<div style="filter:drop-shadow(0 1px 3px rgba(0,0,0,0.5))">${napIconHtml(color)}</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 18],
    });
  }

  if (shape === 'mufa') {
    return L.divIcon({
      className: '',
      html: `<div style="filter:drop-shadow(0 1px 3px rgba(0,0,0,0.5))">${mufaIconHtml(color)}</div>`,
      iconSize: [16, 22],
      iconAnchor: [8, 21],
    });
  }

  const base = 'width:18px;height:18px;border:2px solid #0f172a;box-shadow:0 1px 4px rgba(0,0,0,0.4);';
  const shapeCss: Record<Exclude<typeof shape, 'mufa' | 'nap'>, string> = {
    square: `${base}background:${color};border-radius:3px;`,
    diamond: `${base}background:${color};transform:rotate(45deg);`,
    circle: `${base}background:${color};border-radius:50%;`,
    pentagon: `${base}background:${color};clip-path:polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%);`,
  };
  return L.divIcon({
    className: '',
    html: `<div style="${shapeCss[shape as Exclude<typeof shape, 'mufa' | 'nap'>]}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function permanentLabel(text: string, sub: string) {
  return `<div style="font-size:11px"><b>${text}</b><br/><span style="color:#64748b">${sub}</span></div>`;
}

function renderClientMarkers() {
  if (!clientLayer) return;
  clientLayer.clearLayers();
  if (!showClients.value) return;
  for (const c of clientsWithGps.value) {
    const marker = L.circleMarker([c.latitude as number, c.longitude as number], {
      radius: 7,
      color: '#0f172a',
      weight: 1.5,
      fillColor: CLIENT_COLOR[c.status],
      fillOpacity: 0.9,
    });
    marker.bindPopup(
      `<div style="font-size:13px">
        <b>${c.first_name} ${c.last_name}</b><br/>
        ${c.address ?? 'Sin dirección'}<br/>
        <span style="color:${CLIENT_COLOR[c.status]}">● ${c.status}</span><br/>
        <a href="/clientes/${c.id}" style="color:#38bdf8">Ver cliente →</a>
      </div>`,
    );
    marker.addTo(clientLayer);
  }
}

function renderInstallationMarkers() {
  if (!installationLayer) return;
  installationLayer.clearLayers();
  if (!showInstallations.value) return;
  for (const inst of pendingInstallations.value) {
    const lat = inst.clients!.latitude as number;
    const lng = inst.clients!.longitude as number;
    const icon = L.divIcon({
      html: `<div style="width:22px;height:22px;border-radius:50%;background:#0ea5e9;border:2px solid #0f172a;display:flex;align-items:center;justify-content:center;font-size:12px;box-shadow:0 0 0 3px rgba(14,165,233,0.35)">🔧</div>`,
      className: '',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    const marker = L.marker([lat, lng], { icon });
    marker.bindPopup(
      `<div style="font-size:13px">
        <b>${inst.clients?.first_name} ${inst.clients?.last_name}</b><br/>
        Instalación: <b>${inst.status === 'scheduled' ? 'Programada' : 'Pendiente'}</b><br/>
        ${inst.scheduled_date ? `Fecha: ${inst.scheduled_date}` : 'Sin fecha programada'}<br/>
        <a href="/instalaciones" style="color:#38bdf8">Ver instalaciones →</a>
      </div>`,
    );
    marker.addTo(installationLayer);
  }
}

function renderOltMarkers() {
  if (!oltLayer) return;
  oltLayer.clearLayers();
  if (!showOlt.value) return;
  for (const d of oltsWithGps.value) {
    const marker = L.marker([d.lat as number, d.lng as number], {
      icon: teardropIcon('#2563eb', OLT_GLYPH),
      draggable: true,
    });
    marker.bindTooltip(permanentLabel(d.name, 'OLT'), { permanent: true, direction: 'top', offset: [0, -30], className: 'leaflet-label-custom' });
    marker.bindPopup(
      `<div style="font-size:13px"><b>${d.name}</b><br/>${d.host}:${d.telnet_port}<br/><a href="/olt/${d.id}" style="color:#38bdf8">Ver OLT →</a></div>`,
    );
    marker.on('dragend', async () => {
      const pos = marker.getLatLng();
      try {
        await oltStore.updateCoords(d.id, Number(pos.lat.toFixed(7)), Number(pos.lng.toFixed(7)));
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
    const marker = L.marker([d.latitude as number, d.longitude as number], {
      icon: teardropIcon('#7c3aed', MIKROTIK_GLYPH),
      draggable: true,
    });
    marker.bindTooltip(permanentLabel(d.name, 'MikroTik'), { permanent: true, direction: 'top', offset: [0, -30], className: 'leaflet-label-custom' });
    marker.bindPopup(
      `<div style="font-size:13px"><b>${d.name}</b><br/>${d.host}<br/><a href="/mikrotik/${d.id}" style="color:#38bdf8">Ver router →</a></div>`,
    );
    marker.on('dragend', async () => {
      const pos = marker.getLatLng();
      try {
        await mikrotikStore.updateDevice(d.id, { latitude: Number(pos.lat.toFixed(7)), longitude: Number(pos.lng.toFixed(7)) });
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
      try {
        await infraStore.updateCoords(el.id, Number(pos.lat.toFixed(7)), Number(pos.lng.toFixed(7)));
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
    <div style="margin-top:6px"><button id="infra-edit-${el.id}" style="color:#38bdf8;background:none;border:none;padding:0;cursor:pointer;font-size:12px">Editar →</button></div>
  </div>`;
}

function wireInfraPopup(el: InfraElementoWithUrl) {
  setTimeout(() => {
    document.getElementById(`infra-edit-${el.id}`)?.addEventListener('click', () => openInfraModal(el));
  }, 0);
}

function fitToMarkers() {
  if (!map) return;
  const points: L.LatLngExpression[] = [
    ...clientsWithGps.value.map((c) => [c.latitude as number, c.longitude as number] as L.LatLngExpression),
    ...pendingInstallations.value.map((i) => [i.clients!.latitude as number, i.clients!.longitude as number] as L.LatLngExpression),
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
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  }).addTo(map);
  clientLayer = L.layerGroup().addTo(map);
  installationLayer = L.layerGroup().addTo(map);
  oltLayer = L.layerGroup().addTo(map);
  mikrotikLayer = L.layerGroup().addTo(map);
  infraLayer = L.layerGroup().addTo(map);

  loading.value = true;
  try {
    await Promise.all([
      clientsStore.fetchClients(),
      installationsStore.fetchInstallations(),
      oltStore.fetchDevices(),
      mikrotikStore.fetchDevices(),
      infraStore.fetchElementos(),
    ]);
  } finally {
    loading.value = false;
  }
  renderClientMarkers();
  renderInstallationMarkers();
  renderOltMarkers();
  renderMikrotikMarkers();
  renderInfraMarkers();
  fitToMarkers();
});

onBeforeUnmount(() => {
  map?.remove();
  map = null;
});

watch(showClients, renderClientMarkers);
watch(showInstallations, renderInstallationMarkers);
watch(showOlt, renderOltMarkers);
watch(showMikrotik, renderMikrotikMarkers);
watch(showInfra, renderInfraMarkers);

function goTo(path: string) {
  router.push(path);
}

// ---- Colocar equipos sin ubicar (centro del mapa actual) ----
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
  is_active: true,
  notes: '',
  latitude: 0,
  longitude: 0,
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
      is_active: el.is_active,
      notes: el.notes ?? '',
      latitude: el.latitude ?? 0,
      longitude: el.longitude ?? 0,
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
      is_active: true,
      notes: '',
      latitude: center ? Number(center.lat.toFixed(7)) : -1.83,
      longitude: center ? Number(center.lng.toFixed(7)) : -78.18,
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
        is_active: infraForm.value.is_active,
        notes: infraForm.value.notes || null,
      });
    } else {
      saved = await infraStore.createElemento({
        name: infraForm.value.name,
        tipo: infraForm.value.tipo,
        potencia: infraForm.value.potencia || null,
        spliteo: infraForm.value.spliteo || null,
        is_active: infraForm.value.is_active,
        notes: infraForm.value.notes || null,
        latitude: infraForm.value.latitude,
        longitude: infraForm.value.longitude,
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
  const ok = confirm(`¿Eliminar "${infraForm.value.name}"?`);
  if (!ok) return;
  infraSaving.value = true;
  try {
    await infraStore.deleteElemento(editingInfraId.value);
    showInfraModal.value = false;
    renderInfraMarkers();
  } catch (e) {
    infraError.value = getErrorMessage(e, 'Error al eliminar');
  } finally {
    infraSaving.value = false;
  }
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div>
        <h1 class="text-2xl font-semibold">Mapa de infraestructura</h1>
        <p class="text-slate-600 text-sm mt-1">
          {{ clientsWithGps.length }} clientes · {{ oltsWithGps.length }} OLTs · {{ mikrotiksWithGps.length }} MikroTiks ·
          {{ infraStore.elementos.length }} elementos pasivos
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          class="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
          :class="showClients ? 'bg-sky-500 text-slate-950' : 'bg-slate-100 text-slate-600 hover:text-slate-900'"
          @click="showClients = !showClients"
        >
          <span class="w-2 h-2 rounded-full bg-green-500"></span> Clientes ({{ clientsWithGps.length }})
        </button>
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
          :class="showInstallations ? 'bg-sky-500 text-slate-950' : 'bg-slate-100 text-slate-600 hover:text-slate-900'"
          @click="showInstallations = !showInstallations"
        >
          🔧 Instalaciones ({{ pendingInstallations.length }})
        </button>
        <button class="btn-secondary text-xs" @click="goTo('/instalaciones')">Ver lista →</button>
        <button class="btn-primary text-xs" @click="openInfraModal()">+ Elemento pasivo</button>
      </div>
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
        <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full inline-block" style="background:#22c55e"></span>Cliente activo</span>
        <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full inline-block" style="background:#f59e0b"></span>Prospecto</span>
        <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full inline-block" style="background:#ef4444"></span>Suspendido</span>
        <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full inline-block" style="background:#64748b"></span>Retirado</span>
        <span class="flex items-center gap-1.5">🔧 Instalación pendiente</span>
        <span v-for="(label, tipo) in INFRA_LABEL" :key="tipo" class="flex items-center gap-1.5">
          <span class="w-2.5 h-2.5 inline-block" :style="{ background: INFRA_STYLE[tipo as InfraElementoTipo].color, borderRadius: INFRA_STYLE[tipo as InfraElementoTipo].shape === 'circle' ? '50%' : '2px' }"></span>
          {{ label }}
        </span>
        <span class="text-slate-400">Arrastra cualquier marcador para reubicarlo — se guarda solo.</span>
      </div>
    </div>

    <div class="relative rounded-xl overflow-hidden border border-slate-200" style="height: 70vh;">
      <div v-if="loading" class="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/40 text-slate-600 text-sm">
        Cargando mapa...
      </div>
      <div ref="mapEl" class="w-full h-full"></div>
    </div>

    <p class="text-xs text-slate-500 mt-3">
      Los clientes sin coordenadas GPS registradas (ver ficha del cliente) no aparecen en el mapa.
    </p>

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
            <div class="flex items-end pb-2">
              <label class="flex items-center gap-2 text-sm">
                <input v-model="infraForm.is_active" type="checkbox" />
                Activo
              </label>
            </div>
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
  </AppLayout>
</template>

<style>
.leaflet-label-custom {
  background: rgba(15, 23, 42, 0.85) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: 6px !important;
  padding: 2px 6px !important;
  color: #e2e8f0 !important;
  backdrop-filter: blur(4px);
}
.leaflet-label-custom::before {
  display: none;
}
.leaflet-hover-potencia {
  background: rgba(15, 23, 42, 0.95) !important;
  color: #e2e8f0 !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  border-radius: 6px !important;
  padding: 6px 10px !important;
  font-size: 11px !important;
}
.leaflet-hover-potencia::before {
  display: none;
}
</style>
