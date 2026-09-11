<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useClientsStore } from '@/stores/clients';
import { useInstallationsStore } from '@/stores/installations';
import type { ClientStatus } from '@/types/domain';

const router = useRouter();
const clientsStore = useClientsStore();
const installationsStore = useInstallationsStore();

const loading = ref(true);
const showClients = ref(true);
const showInstallations = ref(true);
const mapEl = ref<HTMLDivElement | null>(null);
let map: L.Map | null = null;
let clientLayer: L.LayerGroup | null = null;
let installationLayer: L.LayerGroup | null = null;

const CLIENT_COLOR: Record<ClientStatus, string> = {
  active: '#22c55e',
  suspended: '#ef4444',
  prospect: '#f59e0b',
  retired: '#64748b',
};

const clientsWithGps = computed(() => clientsStore.clients.filter((c) => c.latitude != null && c.longitude != null));

const pendingInstallations = computed(() =>
  installationsStore.installations.filter(
    (i) => (i.status === 'pending' || i.status === 'scheduled') && i.clients?.latitude != null && i.clients?.longitude != null,
  ),
);

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

function fitToMarkers() {
  if (!map) return;
  const points: L.LatLngExpression[] = [
    ...clientsWithGps.value.map((c) => [c.latitude as number, c.longitude as number] as L.LatLngExpression),
    ...pendingInstallations.value.map((i) => [i.clients!.latitude as number, i.clients!.longitude as number] as L.LatLngExpression),
  ];
  if (points.length) {
    map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 15 });
  } else {
    map.setView([-1.83, -78.18], 6); // centro aproximado de Ecuador, sin marcadores todavia
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

  loading.value = true;
  try {
    await Promise.all([clientsStore.fetchClients(), installationsStore.fetchInstallations()]);
  } finally {
    loading.value = false;
  }
  renderClientMarkers();
  renderInstallationMarkers();
  fitToMarkers();
});

onBeforeUnmount(() => {
  map?.remove();
  map = null;
});

watch(showClients, renderClientMarkers);
watch(showInstallations, renderInstallationMarkers);

function goTo(path: string) {
  router.push(path);
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div>
        <h1 class="text-2xl font-semibold">Mapa</h1>
        <p class="text-slate-400 text-sm mt-1">
          {{ clientsWithGps.length }} clientes con GPS · {{ pendingInstallations.length }} instalaciones pendientes/programadas
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          class="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
          :class="showClients ? 'bg-sky-500 text-slate-950' : 'bg-slate-900 text-slate-400 hover:text-slate-100'"
          @click="showClients = !showClients"
        >
          <span class="w-2 h-2 rounded-full bg-green-500"></span> Clientes
        </button>
        <button
          class="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
          :class="showInstallations ? 'bg-sky-500 text-slate-950' : 'bg-slate-900 text-slate-400 hover:text-slate-100'"
          @click="showInstallations = !showInstallations"
        >
          🔧 Instalaciones
        </button>
        <button class="btn-secondary text-xs" @click="goTo('/instalaciones')">Ver lista →</button>
      </div>
    </div>

    <div class="flex flex-wrap gap-4 mb-3 text-xs text-slate-400">
      <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full inline-block" style="background:#22c55e"></span>Activo</span>
      <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full inline-block" style="background:#f59e0b"></span>Prospecto</span>
      <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full inline-block" style="background:#ef4444"></span>Suspendido</span>
      <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full inline-block" style="background:#64748b"></span>Retirado</span>
      <span class="flex items-center gap-1.5">🔧 Instalación pendiente/programada</span>
    </div>

    <div class="relative rounded-xl overflow-hidden border border-slate-800" style="height: 70vh;">
      <div v-if="loading" class="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/60 text-slate-400 text-sm">
        Cargando mapa...
      </div>
      <div ref="mapEl" class="w-full h-full"></div>
    </div>

    <p class="text-xs text-slate-500 mt-3">
      Los clientes sin coordenadas GPS registradas (ver ficha del cliente) no aparecen en el mapa.
    </p>
  </AppLayout>
</template>
