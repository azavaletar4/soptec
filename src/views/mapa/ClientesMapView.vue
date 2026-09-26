<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useClientsStore } from '@/stores/clients';
import { useContractsStore } from '@/stores/contracts';
import { useInstallationsStore } from '@/stores/installations';
import { useInfraElementosStore, type InfraElementoWithUrl } from '@/stores/infraElementos';
import { useFoFibraStore } from '@/stores/foFibra';
import SpliceDiagramModal from './SpliceDiagramModal.vue';
import { CONTRACT_COLOR, infraIcon, permanentLabel } from './mapIcons';

const router = useRouter();
const clientsStore = useClientsStore();
const contractsStore = useContractsStore();
const installationsStore = useInstallationsStore();
const infraStore = useInfraElementosStore();
const fibra = useFoFibraStore();

const loading = ref(true);
const showClients = ref(true);
const showInstallations = ref(true);
const showNaps = ref(true);
const legendOpen = ref(false);
const mapEl = ref<HTMLDivElement | null>(null);
let map: L.Map | null = null;
let clientLayer: L.LayerGroup | null = null;
let installationLayer: L.LayerGroup | null = null;
let napLayer: L.LayerGroup | null = null;

// Un pin por SERVICIO, no por cliente (Fase 38) — un cliente con 2 lineas en
// direcciones distintas ahora aparece con 2 pines, cada uno con su propia
// ubicacion (service_contracts.latitude/longitude), no con el punto unico
// del titular.
const contractsWithGps = computed(() => contractsStore.contracts.filter((c) => c.latitude != null && c.longitude != null));
const pendingInstallations = computed(() =>
  installationsStore.installations
    .filter((i) => i.status === 'pending' || i.status === 'scheduled')
    .map((i) => ({ installation: i, contract: contractsStore.contracts.find((c) => c.id === i.contract_id) ?? null }))
    .filter((x) => x.contract?.latitude != null && x.contract?.longitude != null),
);
const napsConGps = computed(() => infraStore.elementos.filter((e) => e.tipo === 'caja_nap' && e.latitude != null && e.longitude != null));

function renderClientMarkers() {
  if (!clientLayer) return;
  clientLayer.clearLayers();
  if (!showClients.value) return;
  for (const ct of contractsWithGps.value) {
    const marker = L.circleMarker([ct.latitude as number, ct.longitude as number], {
      radius: 7,
      color: '#0f172a',
      weight: 1.5,
      fillColor: CONTRACT_COLOR[ct.status],
      fillOpacity: 0.9,
    });
    marker.bindPopup(
      `<div style="font-size:13px">
        <b>${ct.clients?.first_name ?? ''} ${ct.clients?.last_name ?? ''}</b> <span style="color:#64748b">(${ct.contract_number})</span><br/>
        ${ct.installation_address ?? 'Sin dirección'}<br/>
        <span style="color:${CONTRACT_COLOR[ct.status]}">● ${ct.status}</span><br/>
        <a href="/clientes/${ct.client_id}/servicios/${ct.id}" style="color:#38bdf8">Ver servicio →</a>
      </div>`,
    );
    marker.addTo(clientLayer);
  }
}

function renderInstallationMarkers() {
  if (!installationLayer) return;
  installationLayer.clearLayers();
  if (!showInstallations.value) return;
  for (const { installation: inst, contract: ct } of pendingInstallations.value) {
    const lat = ct!.latitude as number;
    const lng = ct!.longitude as number;
    const icon = L.divIcon({
      html: `<div style="width:22px;height:22px;border-radius:50%;background:#0ea5e9;border:2px solid #0f172a;display:flex;align-items:center;justify-content:center;font-size:12px;box-shadow:0 0 0 3px rgba(14,165,233,0.35)">🔧</div>`,
      className: '',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    const marker = L.marker([lat, lng], { icon });
    marker.bindPopup(
      `<div style="font-size:13px">
        <b>${inst.clients?.first_name} ${inst.clients?.last_name}</b> <span style="color:#64748b">(${ct?.contract_number ?? ''})</span><br/>
        Instalación: <b>${inst.status === 'scheduled' ? 'Programada' : 'Pendiente'}</b><br/>
        ${inst.scheduled_date ? `Fecha: ${inst.scheduled_date}` : 'Sin fecha programada'}<br/>
        <a href="/instalaciones" style="color:#38bdf8">Ver instalaciones →</a>
      </div>`,
    );
    marker.addTo(installationLayer);
  }
}

function ocupacionDe(elId: string): { usados: number; total: number } | null {
  const el = infraStore.elementos.find((e) => e.id === elId);
  if (!el?.puertos_total) return null;
  const puertos = fibra.napPuertosPorElemento[elId] ?? [];
  const usados = puertos.filter((p) => p.estado === 'ocupado').length;
  return { usados, total: el.puertos_total };
}

function renderNapMarkers() {
  if (!napLayer) return;
  napLayer.clearLayers();
  if (!showNaps.value) return;
  for (const el of napsConGps.value) {
    const marker = L.marker([el.latitude as number, el.longitude as number], { icon: infraIcon(el) });
    const ocupacion = ocupacionDe(el.id);
    marker.bindTooltip(permanentLabel(el.name, ocupacion ? `${ocupacion.usados}/${ocupacion.total} puertos` : 'Caja NAP'), {
      permanent: true,
      direction: 'top',
      offset: [0, -10],
      className: 'leaflet-label-custom',
    });
    marker.bindPopup(() => napPopupHtml(el, ocupacion));
    marker.on('popupopen', () => wireNapPopup(el));
    marker.addTo(napLayer);
  }
}

function napPopupHtml(el: InfraElementoWithUrl, ocupacion: { usados: number; total: number } | null) {
  return `<div style="font-size:13px;min-width:160px">
    <b>${el.name}</b><br/>
    <span style="opacity:0.8">Caja NAP${el.spliteo ? ` · Splitter ${el.spliteo}` : ''}</span><br/>
    ${ocupacion ? `Puertos: <b>${ocupacion.usados}/${ocupacion.total}</b> ocupados<br/>` : 'Sin capacidad de puertos configurada<br/>'}
    ${el.notes ? `${el.notes}<br/>` : ''}
    <div style="margin-top:6px;display:flex;gap:10px">
      <button id="nap-puertos-${el.id}" style="color:#22c55e;background:none;border:none;padding:0;cursor:pointer;font-size:12px">Puertos de cliente →</button>
      <button id="nap-red-${el.id}" style="color:#38bdf8;background:none;border:none;padding:0;cursor:pointer;font-size:12px">Editar en Mapa de Red →</button>
    </div>
  </div>`;
}

function wireNapPopup(el: InfraElementoWithUrl) {
  setTimeout(() => {
    document.getElementById(`nap-puertos-${el.id}`)?.addEventListener('click', () => openPuertosModal(el.id));
    document.getElementById(`nap-red-${el.id}`)?.addEventListener('click', () => router.push('/mapa/red'));
  }, 0);
}

function fitToMarkers() {
  if (!map) return;
  const points: L.LatLngExpression[] = [
    ...contractsWithGps.value.map((c) => [c.latitude as number, c.longitude as number] as L.LatLngExpression),
    ...pendingInstallations.value.map((i) => [i.contract!.latitude as number, i.contract!.longitude as number] as L.LatLngExpression),
    ...napsConGps.value.map((e) => [e.latitude as number, e.longitude as number] as L.LatLngExpression),
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
  clientLayer = L.layerGroup().addTo(map);
  installationLayer = L.layerGroup().addTo(map);
  napLayer = L.layerGroup().addTo(map);

  loading.value = true;
  try {
    await Promise.all([
      clientsStore.fetchClients(),
      contractsStore.fetchContracts(),
      installationsStore.fetchInstallations(),
      infraStore.fetchElementos(),
      fibra.fetchTodosNapPuertos(),
    ]);
  } finally {
    loading.value = false;
  }
  renderClientMarkers();
  renderInstallationMarkers();
  renderNapMarkers();
  fitToMarkers();
});

onBeforeUnmount(() => {
  map?.remove();
  map = null;
});

watch(showClients, renderClientMarkers);
watch(showInstallations, renderInstallationMarkers);
watch(showNaps, renderNapMarkers);

function goTo(path: string) {
  router.push(path);
}

// ---- Modal de puertos de cliente de una caja NAP ----
const showPuertosModal = ref(false);
const puertosElementoId = ref<string | null>(null);
const puertosElemento = computed(() => infraStore.elementos.find((e) => e.id === puertosElementoId.value) ?? null);

function openPuertosModal(infraElementoId: string) {
  puertosElementoId.value = infraElementoId;
  showPuertosModal.value = true;
}

function handlePuertosClose() {
  showPuertosModal.value = false;
  renderNapMarkers(); // refresca el badge de ocupación tras asignar/quitar clientes
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div>
        <div class="flex items-center gap-2">
          <h1 class="text-2xl font-semibold">Mapa de Clientes</h1>
          <span class="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 font-medium">Clientes y cajas NAP</span>
        </div>
        <p class="text-slate-600 text-sm mt-1">{{ contractsWithGps.length }} servicios · {{ napsConGps.length }} cajas NAP</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn-secondary text-xs" @click="goTo('/mapa/red')">🕸️ Ver mapa de red →</button>
        <button
          class="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
          :class="showClients ? 'bg-sky-500 text-slate-950' : 'bg-slate-100 text-slate-600 hover:text-slate-900'"
          @click="showClients = !showClients"
        >
          <span class="w-2 h-2 rounded-full bg-green-500"></span> Servicios ({{ contractsWithGps.length }})
        </button>
        <button
          class="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
          :class="showNaps ? 'bg-sky-500 text-slate-950' : 'bg-slate-100 text-slate-600 hover:text-slate-900'"
          @click="showNaps = !showNaps"
        >
          <span class="w-2 h-2 rounded-full" style="background:#e2e8f0;border:1px solid #94a3b8"></span> Cajas NAP ({{ napsConGps.length }})
        </button>
        <button
          class="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
          :class="showInstallations ? 'bg-sky-500 text-slate-950' : 'bg-slate-100 text-slate-600 hover:text-slate-900'"
          @click="showInstallations = !showInstallations"
        >
          🔧 Instalaciones ({{ pendingInstallations.length }})
        </button>
        <button class="btn-secondary text-xs" @click="goTo('/instalaciones')">Ver lista →</button>
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
        <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 inline-block rounded" style="background:#e2e8f0;border:1px solid #94a3b8"></span>Caja NAP</span>
        <span class="text-slate-400">Para crear o mover cajas NAP, mufas y cables, usa el Mapa de Red.</span>
      </div>
    </div>

    <div class="relative rounded-xl overflow-hidden border border-slate-200" style="height: 75vh;">
      <div v-if="loading" class="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/40 text-slate-600 text-sm">
        Cargando mapa...
      </div>
      <div ref="mapEl" class="w-full h-full"></div>
    </div>

    <p class="text-xs text-slate-500 mt-3">
      Los servicios sin coordenadas GPS registradas (ver pestaña "Ubicación" en la ficha de cada servicio) no aparecen en el mapa.
    </p>

    <SpliceDiagramModal
      v-if="showPuertosModal && puertosElemento"
      :elemento="puertosElemento"
      :cables="fibra.cables"
      :clients="clientsStore.clients"
      solo-puertos
      @close="handlePuertosClose"
      @trace-result="() => {}"
    />
  </AppLayout>
</template>
