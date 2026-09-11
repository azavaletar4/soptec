<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useOltStore, type OltOnt, type OltHealth, type UnconfiguredOnt } from '@/stores/olt';
import { useTr069Store } from '@/stores/tr069';
import { useCatalogsStore } from '@/stores/catalogs';
import { getErrorMessage } from '@/lib/errors';
import OntDetailModal from './OntDetailModal.vue';
import OntZoneEditModal from './OntZoneEditModal.vue';

const route = useRoute();
const router = useRouter();
const oltStore = useOltStore();
const tr069Store = useTr069Store();
const catalogsStore = useCatalogsStore();

const deviceId = computed(() => route.params.id as string);
const device = computed(() => oltStore.devices.find((d) => d.id === deviceId.value));
const deviceZoneName = computed(
  () => catalogsStore.zones.find((z) => z.id === device.value?.zone_id)?.name ?? null,
);

const detailOntId = ref<string | null>(null);
const detailOnt = computed(() => oltStore.onts.find((o) => o.id === detailOntId.value) ?? null);
function openOntDetail(ont: OltOnt) {
  detailOntId.value = ont.id;
}
function handleOpenTr069FromDetail(ont: OltOnt) {
  detailOntId.value = null;
  openTr069Modal(ont);
}

const zoneEditOntId = ref<string | null>(null);
const zoneEditOnt = computed(() => oltStore.onts.find((o) => o.id === zoneEditOntId.value) ?? null);
function openZoneEdit(ont: OltOnt) {
  zoneEditOntId.value = ont.id;
}
function handleEditZoneFromDetail(ont: OltOnt) {
  detailOntId.value = null;
  openZoneEdit(ont);
}

const slot = ref(1);
const port = ref(1);
const syncing = ref(false);
const syncMessage = ref<string | null>(null);

const showRegisterModal = ref(false);
const registering = ref(false);
const registerError = ref<string | null>(null);
const registerForm = ref({
  onuId: '' as number | '',
  serial: '',
  onuType: '',
  description: '',
  vlan: 100,
  tcontProfile: '',
  trafficProfile: '',
});

const profiles = ref<{ tcontProfiles: string[]; trafficProfiles: string[] }>({ tcontProfiles: [], trafficProfiles: [] });
const profilesLoading = ref(false);
const profilesError = ref<string | null>(null);

const signalLoadingId = ref<string | null>(null);
const ontSearch = ref('');
const filteredOnts = computed(() => {
  const q = ontSearch.value.trim().toLowerCase();
  if (!q) return oltStore.onts;
  return oltStore.onts.filter((o) =>
    `${o.serial} ${o.clients?.first_name ?? ''} ${o.clients?.last_name ?? ''} ${o.frame}/${o.slot}/${o.port}:${o.ont_id}`
      .toLowerCase()
      .includes(q),
  );
});

const STATUS_CLASS: Record<string, string> = {
  online: 'bg-green-500/15 text-green-400',
  offline: 'bg-red-500/15 text-red-400',
  unknown: 'bg-slate-500/15 text-slate-400',
};

interface OltSummary {
  unconfigured: number;
  online: number;
  offline: number;
  lowSignal: number;
  scanComplete: boolean;
  checkedAt: string;
}

const summary = ref<OltSummary | null>(null);
const summaryLoading = ref(true);
const summaryError = ref<string | null>(null);

const checkedAtLabel = computed(() => {
  if (!summary.value) return '';
  const d = new Date(summary.value.checkedAt);
  return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
});

async function loadSummary() {
  summaryLoading.value = true;
  summaryError.value = null;
  try {
    summary.value = await oltStore.fetchSummary(deviceId.value);
  } catch (e) {
    summaryError.value = getErrorMessage(e, 'Error al consultar el resumen de la OLT');
  } finally {
    summaryLoading.value = false;
  }
}

// ---- Telemetria: uptime, temperatura, CPU/RAM por tarjeta ----
const health = ref<OltHealth | null>(null);
const healthLoading = ref(true);
const healthError = ref<string | null>(null);

async function loadHealth() {
  healthLoading.value = true;
  healthError.value = null;
  try {
    health.value = await oltStore.fetchHealth(deviceId.value);
  } catch (e) {
    healthError.value = getErrorMessage(e, 'Error al consultar la telemetría de la OLT');
  } finally {
    healthLoading.value = false;
  }
}

const unconfiguredOnts = ref<UnconfiguredOnt[]>([]);
const unconfiguredLoading = ref(false);
const unconfiguredError = ref<string | null>(null);

async function loadUnconfigured() {
  unconfiguredLoading.value = true;
  unconfiguredError.value = null;
  try {
    unconfiguredOnts.value = await oltStore.fetchUnconfiguredOnts(deviceId.value);
  } catch (e) {
    unconfiguredError.value = getErrorMessage(e, 'Error al consultar ONUs sin autorizar');
  } finally {
    unconfiguredLoading.value = false;
  }
}

onMounted(async () => {
  if (!oltStore.devices.length) await oltStore.fetchDevices();
  await Promise.all([oltStore.fetchOnts(deviceId.value), loadSummary(), loadHealth(), catalogsStore.fetchZones()]);
  // Secuencial (no sumada al Promise.all de arriba): evitar mas conexiones
  // Telnet simultaneas a la misma OLT (ver leccion aprendida en el backend).
  await loadUnconfigured();
});

async function handleSync() {
  syncing.value = true;
  syncMessage.value = null;
  try {
    const res = await oltStore.syncOnts(deviceId.value, slot.value, port.value);
    syncMessage.value = `La OLT reporta ${res.foundInOlt} ONT(s) en el puerto ${slot.value}/${port.value}. Se actualizo el estado de ${res.synced} ya registradas aqui.${
      res.notInDb.length ? ` ${res.notInDb.length} mas existen en la OLT pero no en SmartRayco (IDs: ${res.notInDb.join(', ')}) — registralas manualmente si son tuyas.` : ''
    }`;
    await oltStore.fetchOnts(deviceId.value);
  } catch (e) {
    syncMessage.value = getErrorMessage(e, 'Error al sincronizar con la OLT');
  } finally {
    syncing.value = false;
  }
}

const importing = ref(false);
const importMessage = ref<string | null>(null);
async function handleImportExisting() {
  const ok = confirm(
    'Esto escanea TODA la OLT (solo lectura, no cambia nada) y trae/actualiza serial, tipo, nombre, plan, VLAN y señal de todas las ONTs. Con cientos de ONTs puede tardar varios minutos. ¿Continuar?',
  );
  if (!ok) return;
  importing.value = true;
  importMessage.value = null;
  try {
    const res = await oltStore.importExistingOnts(deviceId.value);
    importMessage.value = `Escaneadas ${res.scanned} ONTs en ${res.ports} puertos PON. Importadas/actualizadas: ${res.imported}.${
      res.failedPorts.length ? ` Fallaron ${res.failedPorts.length} puertos: ${res.failedPorts.join(', ')}.` : ''
    }`;
    await oltStore.fetchOnts(deviceId.value);
  } catch (e) {
    importMessage.value = getErrorMessage(e, 'Error al importar las ONTs existentes');
  } finally {
    importing.value = false;
  }
}

async function openRegister(prefill?: { serial: string; slot: number; port: number }) {
  if (prefill) {
    slot.value = prefill.slot;
    port.value = prefill.port;
  }
  // onuId siempre vacio (= auto): el sufijo ":N" que trae "sin autorizar" NO
  // es un id libre confiable (ver advertencia en GET /onts/unconfigured) —
  // se deja que el backend lo calcule con un escaneo en vivo del puerto.
  registerForm.value = { onuId: '', serial: prefill?.serial ?? '', onuType: '', description: '', vlan: 100, tcontProfile: '', trafficProfile: '' };
  registerError.value = null;
  showRegisterModal.value = true;

  if (!profiles.value.tcontProfiles.length) {
    profilesLoading.value = true;
    profilesError.value = null;
    try {
      profiles.value = await oltStore.fetchProfiles(deviceId.value);
    } catch (e) {
      profilesError.value = getErrorMessage(e, 'Error al consultar los perfiles de ancho de banda de la OLT');
    } finally {
      profilesLoading.value = false;
    }
  }
}

async function handleRegister() {
  if (!registerForm.value.tcontProfile || !registerForm.value.trafficProfile) {
    registerError.value = 'Selecciona el perfil de subida y de bajada';
    return;
  }
  registering.value = true;
  registerError.value = null;
  try {
    await oltStore.registerOnt(deviceId.value, {
      slot: slot.value,
      port: port.value,
      onuId: registerForm.value.onuId === '' ? undefined : registerForm.value.onuId,
      serial: registerForm.value.serial,
      onuType: registerForm.value.onuType,
      description: registerForm.value.description,
      vlan: registerForm.value.vlan,
      tcontProfile: registerForm.value.tcontProfile,
      trafficProfile: registerForm.value.trafficProfile,
    });
    showRegisterModal.value = false;
    await Promise.all([oltStore.fetchOnts(deviceId.value), loadUnconfigured()]);
  } catch (e) {
    registerError.value = getErrorMessage(e, 'Error al registrar la ONT en la OLT');
  } finally {
    registering.value = false;
  }
}

async function handleToggle(ont: OltOnt) {
  const activate = ont.status !== 'online';
  const ok = confirm(`¿${activate ? 'Activar' : 'Desactivar'} la ONT ${ont.serial}?`);
  if (!ok) return;
  try {
    await oltStore.toggleOnt(deviceId.value, ont.id, activate);
    await oltStore.fetchOnts(deviceId.value);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al cambiar el estado de la ONT'));
  }
}

async function handleDelete(ont: OltOnt) {
  const ok = confirm(`¿Eliminar la ONT ${ont.serial}? Esto tambien la borra de la OLT (comando "no onu").`);
  if (!ok) return;
  try {
    await oltStore.deleteOnt(deviceId.value, ont.id);
    await oltStore.fetchOnts(deviceId.value);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al eliminar la ONT'));
  }
}

async function handleSignal(ont: OltOnt) {
  signalLoadingId.value = ont.id;
  try {
    const info = await oltStore.getSignal(deviceId.value, ont.id);
    alert(`Rx: ${info.rxPower ?? '—'} dBm\nTx: ${info.txPower ?? '—'} dBm`);
    await oltStore.fetchOnts(deviceId.value);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al leer la senal optica'));
  } finally {
    signalLoadingId.value = null;
  }
}

// ---- TR-069: asignar/quitar el ACS (GenieACS) de una ONT ----
const tr069Modal = ref<OltOnt | null>(null);
const tr069AcsUrl = ref('');
const tr069Veip = ref(1);
const tr069Saving = ref(false);
const tr069Error = ref<string | null>(null);

async function openTr069Modal(ont: OltOnt) {
  tr069Modal.value = ont;
  tr069Error.value = null;
  tr069Veip.value = 1;
  if (ont.tr069_acs_url) {
    tr069AcsUrl.value = ont.tr069_acs_url;
    return;
  }
  try {
    const profile = await tr069Store.fetchAcsProfile(deviceId.value);
    tr069AcsUrl.value = profile?.acs_url ?? '';
  } catch {
    tr069AcsUrl.value = '';
  }
}

async function handleTr069Assign() {
  if (!tr069Modal.value || !tr069AcsUrl.value) return;
  tr069Saving.value = true;
  tr069Error.value = null;
  try {
    await oltStore.assignTr069(deviceId.value, tr069Modal.value.id, tr069AcsUrl.value, tr069Veip.value);
    tr069Modal.value = null;
  } catch (e) {
    tr069Error.value = getErrorMessage(e, 'Error al asignar el ACS en la OLT');
  } finally {
    tr069Saving.value = false;
  }
}

async function handleTr069Remove() {
  if (!tr069Modal.value) return;
  tr069Saving.value = true;
  tr069Error.value = null;
  try {
    await oltStore.removeTr069(deviceId.value, tr069Modal.value.id, tr069Veip.value);
    tr069Modal.value = null;
  } catch (e) {
    tr069Error.value = getErrorMessage(e, 'Error al desactivar TR-069 en la OLT');
  } finally {
    tr069Saving.value = false;
  }
}

// ---- Perfil ACS (GenieACS) por defecto de esta OLT ----
const showAcsProfileModal = ref(false);
const acsProfileId = ref<string | null>(null);
const acsProfileForm = ref({
  acs_url: '',
  acs_username: '',
  acs_password: '',
  inform_interval: 300,
});
const acsProfileLoading = ref(false);
const acsProfileSaving = ref(false);
const acsProfileError = ref<string | null>(null);
const acsProfileSaved = ref(false);

async function openAcsProfileModal() {
  showAcsProfileModal.value = true;
  acsProfileError.value = null;
  acsProfileSaved.value = false;
  acsProfileLoading.value = true;
  try {
    const profile = await tr069Store.fetchAcsProfile(deviceId.value);
    acsProfileId.value = profile?.id ?? null;
    acsProfileForm.value = {
      acs_url: profile?.acs_url ?? '',
      acs_username: profile?.acs_username ?? '',
      acs_password: profile?.acs_password ?? '',
      inform_interval: profile?.inform_interval ?? 300,
    };
  } catch (e) {
    acsProfileError.value = getErrorMessage(e, 'Error al cargar el perfil ACS');
  } finally {
    acsProfileLoading.value = false;
  }
}

async function handleSaveAcsProfile() {
  if (!acsProfileForm.value.acs_url) return;
  acsProfileSaving.value = true;
  acsProfileError.value = null;
  acsProfileSaved.value = false;
  try {
    const saved = await tr069Store.saveAcsProfile(deviceId.value, acsProfileForm.value, acsProfileId.value ?? undefined);
    acsProfileId.value = saved.id;
    acsProfileSaved.value = true;
  } catch (e) {
    acsProfileError.value = getErrorMessage(e, 'Error al guardar el perfil ACS');
  } finally {
    acsProfileSaving.value = false;
  }
}

// ---- Detalle por tarjeta (barras) ----
const HEALTH_CHART_WIDTH = 320;
const HEALTH_PLOT_HEIGHT = 74;

interface HealthBar {
  slot: number;
  value: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  labelX: number;
}

function healthBarColor(value: number, warn: number, danger: number): string {
  if (value >= danger) return '#ef4444';
  if (value >= warn) return '#f59e0b';
  return '#22c55e';
}

function buildHealthBars(items: { slot: number; value: number }[], max: number, warn: number, danger: number): HealthBar[] {
  const n = items.length || 1;
  const groupWidth = HEALTH_CHART_WIDTH / n;
  const barWidth = Math.min(28, groupWidth - 8);
  return items.map((it, i) => {
    const h = Math.max(2, Math.min(HEALTH_PLOT_HEIGHT, (it.value / max) * HEALTH_PLOT_HEIGHT));
    return {
      slot: it.slot,
      value: it.value,
      x: i * groupWidth + (groupWidth - barWidth) / 2,
      y: HEALTH_PLOT_HEIGHT - h,
      width: barWidth,
      height: h,
      color: healthBarColor(it.value, warn, danger),
      labelX: i * groupWidth + groupWidth / 2,
    };
  });
}

// ---- Cluster de velocímetros estilo panel deportivo (temp/CPU/RAM) ----
const GAUGE_VIEWBOX = '0 0 220 160';
const GAUGE_CX = 110;
const GAUGE_CY = 108;
const GAUGE_R = 66;
const GAUGE_START = -120;
const GAUGE_END = 120;

function gaugePoint(angleDeg: number, r = GAUGE_R) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: GAUGE_CX + r * Math.cos(rad), y: GAUGE_CY + r * Math.sin(rad) };
}

function gaugeArc(startAngle: number, endAngle: number, r = GAUGE_R): string {
  const start = gaugePoint(endAngle, r);
  const end = gaugePoint(startAngle, r);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

const GAUGE_TRACK_PATH = gaugeArc(GAUGE_START, GAUGE_END);
const GAUGE_BEZEL_PATH = gaugeArc(GAUGE_START, GAUGE_END, GAUGE_R + 26);

function gaugeAngleFor(value: number, max: number): number {
  const t = Math.max(0, Math.min(1, value / max));
  return GAUGE_START + t * (GAUGE_END - GAUGE_START);
}

interface GaugeSpec {
  key: string;
  label: string;
  unit: string;
  value: number;
  max: number;
  warn: number;
  danger: number;
}

function average(nums: number[]): number {
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
}

interface GaugeTick {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  major: boolean;
  labelX: number;
  labelY: number;
  labelText: string;
}

const GAUGE_TICK_STEPS = 8;

function buildTicks(max: number): GaugeTick[] {
  const ticks: GaugeTick[] = [];
  for (let i = 0; i <= GAUGE_TICK_STEPS; i++) {
    const frac = i / GAUGE_TICK_STEPS;
    const angle = GAUGE_START + frac * (GAUGE_END - GAUGE_START);
    const major = i % 2 === 0;
    const inner = gaugePoint(angle, GAUGE_R + 9);
    const outer = gaugePoint(angle, GAUGE_R + (major ? 20 : 15));
    const labelPos = gaugePoint(angle, GAUGE_R + 34);
    ticks.push({
      x1: inner.x,
      y1: inner.y,
      x2: outer.x,
      y2: outer.y,
      major,
      labelX: labelPos.x,
      labelY: labelPos.y,
      labelText: major ? String(Math.round(frac * max)) : '',
    });
  }
  return ticks;
}

/** Aguja tipo rombo (mas ancha en la base, afilada en la punta) con contrapeso. */
function needlePolygon(angleDeg: number): string {
  const tip = gaugePoint(angleDeg, GAUGE_R - 18);
  const baseLeft = gaugePoint(angleDeg - 3.5, 9);
  const baseRight = gaugePoint(angleDeg + 3.5, 9);
  const tail = gaugePoint(angleDeg + 180, 16);
  return [tip, baseRight, tail, baseLeft].map((p) => `${p.x},${p.y}`).join(' ');
}

function statusLabel(value: number, warn: number, danger: number) {
  if (value >= danger) return { text: 'CRÍTICO', classes: 'bg-red-500/15 text-red-400' };
  if (value >= warn) return { text: 'ALERTA', classes: 'bg-amber-500/15 text-amber-400' };
  return { text: 'NORMAL', classes: 'bg-emerald-500/15 text-emerald-400' };
}

function buildGauge(g: GaugeSpec) {
  const warnAngle = gaugeAngleFor(g.warn, g.max);
  const dangerAngle = gaugeAngleFor(g.danger, g.max);
  const valueAngle = gaugeAngleFor(g.value, g.max);
  const color = g.value >= g.danger ? '#ef4444' : g.value >= g.warn ? '#f59e0b' : '#22c55e';
  return {
    ...g,
    zoneGreen: gaugeArc(GAUGE_START, warnAngle),
    zoneAmber: gaugeArc(warnAngle, dangerAngle),
    zoneRed: gaugeArc(dangerAngle, GAUGE_END),
    progressPath: g.value > 0 ? gaugeArc(GAUGE_START, valueAngle, GAUGE_R - 18) : '',
    needlePoints: needlePolygon(valueAngle),
    ticks: buildTicks(g.max),
    status: statusLabel(g.value, g.warn, g.danger),
    color,
    display: Math.round(g.value),
    glow: `drop-shadow(0 0 7px ${color}88)`,
  };
}

const gauges = computed(() => {
  const h = health.value;
  const maxTemp = h?.temperature.length ? Math.max(...h.temperature.map((t) => t.tempC)) : 0;
  const avgCpu = average((h?.load ?? []).map((l) => l.cpuPercent));
  const avgRam = average((h?.load ?? []).map((l) => l.memPercent));
  const specs: GaugeSpec[] = [
    { key: 'temp', label: 'Temperatura', unit: '°C', value: maxTemp, max: 80, warn: 50, danger: 65 },
    { key: 'cpu', label: 'CPU', unit: '%', value: avgCpu, max: 100, warn: 70, danger: 85 },
    { key: 'ram', label: 'RAM', unit: '%', value: avgRam, max: 100, warn: 70, danger: 85 },
  ];
  return specs.map(buildGauge);
});
</script>

<template>
  <AppLayout>
    <button class="text-sm text-slate-400 hover:text-slate-100 mb-4" @click="router.push('/olt')">← Volver a OLTs</button>

    <div v-if="!device" class="text-slate-500">OLT no encontrada.</div>
    <template v-else>
      <div class="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1 class="text-2xl font-semibold mb-1">{{ device.name }}</h1>
          <p class="text-slate-400 text-sm">{{ device.host }}:{{ device.telnet_port }} · {{ device.brand.toUpperCase() }}</p>
        </div>
        <button class="btn-ghost text-xs" @click="openAcsProfileModal">ACS (GenieACS) por defecto</button>
      </div>

      <!-- Resumen estilo SmartOLT -->
      <div class="grid gap-4 mb-2" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))">
        <div class="rounded-xl p-5 flex items-start justify-between" style="background:#2f6fed">
          <div>
            <div class="text-3xl font-bold text-white">{{ summaryLoading ? '—' : summary?.unconfigured ?? 0 }}</div>
            <div class="text-sm text-white/90 mt-1">Sin autorizar</div>
          </div>
          <span class="text-2xl">✨</span>
        </div>
        <div class="rounded-xl p-5 flex items-start justify-between" style="background:#16a34a">
          <div>
            <div class="text-3xl font-bold text-white">{{ summaryLoading ? '—' : summary?.online ?? 0 }}</div>
            <div class="text-sm text-white/90 mt-1">Online</div>
          </div>
          <span class="text-2xl">🖧</span>
        </div>
        <div class="rounded-xl p-5 flex items-start justify-between" style="background:#475569">
          <div>
            <div class="text-3xl font-bold text-white">{{ summaryLoading ? '—' : summary?.offline ?? 0 }}</div>
            <div class="text-sm text-white/90 mt-1">Total offline</div>
          </div>
          <span class="text-2xl">✕</span>
        </div>
        <div class="rounded-xl p-5 flex items-start justify-between" style="background:#ea580c">
          <div>
            <div class="text-3xl font-bold text-white">{{ summaryLoading ? '—' : summary?.lowSignal ?? 0 }}</div>
            <div class="text-sm text-white/90 mt-1">Señales bajas</div>
          </div>
          <span class="text-2xl">⚠</span>
        </div>
      </div>
      <p class="text-xs text-slate-500 text-right mb-1">
        {{ summaryLoading ? 'Consultando...' : `Informacion valida a las ${checkedAtLabel}` }}
        <button class="ml-2 text-sky-400 hover:underline" @click="loadSummary">Actualizar</button>
      </p>
      <p v-if="summaryError" class="text-xs text-red-400 mb-4">{{ summaryError }}</p>
      <p v-if="summary && !summary.scanComplete" class="text-xs text-amber-400/80 mb-4">
        ⚠ El escaneo completo de la OLT falló esta vez; "Online/Offline" se muestran con el último
        dato local disponible.
      </p>
      <p class="text-xs text-slate-500 mb-6">
        "Sin autorizar" y "Online/Offline" se consultan en vivo a toda la OLT en cada actualización
        (un solo comando, ~8-10s). "Señales bajas" todavía depende de leer la señal óptica ONT por
        ONT (ver botón "Señal" en la tabla) — se está evaluando automatizarlo.
      </p>

      <!-- Telemetria: cluster de velocimetros estilo deportivo -->
      <div class="surface p-5 mb-6 relative overflow-hidden">
        <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-500 via-emerald-500 to-amber-500"></div>

        <div class="flex items-center justify-between mb-5">
          <div class="text-sm font-semibold flex items-center gap-2">🏁 Telemetría</div>
          <div class="text-xs text-slate-500">
            {{ healthLoading ? 'Consultando...' : '' }}
            <button v-if="!healthLoading" class="text-sky-400 hover:underline" @click="loadHealth">Actualizar</button>
          </div>
        </div>

        <p v-if="healthError" class="text-xs text-red-400 mb-4">{{ healthError }}</p>

        <p
          v-else-if="!healthLoading && !health?.uptime && !health?.temperature.length && !health?.load.length"
          class="text-sm text-slate-500"
        >
          No se pudo consultar la salud de este equipo (revisa la conexión Telnet).
        </p>

        <template v-else-if="health">
          <!-- Cluster: temperatura / CPU / RAM / actividad -->
          <div class="grid gap-4 mb-6" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))">
            <div v-for="g in gauges" :key="g.key" class="flex flex-col items-center">
              <svg :viewBox="GAUGE_VIEWBOX" class="w-full" :style="{ filter: g.glow }">
                <!-- bisel decorativo -->
                <path :d="GAUGE_BEZEL_PATH" fill="none" stroke="#1e293b" stroke-width="1" opacity="0.8" />
                <!-- marcas de escala -->
                <g>
                  <line
                    v-for="(t, i) in g.ticks"
                    :key="'tick' + i"
                    :x1="t.x1"
                    :y1="t.y1"
                    :x2="t.x2"
                    :y2="t.y2"
                    stroke="#475569"
                    :stroke-width="t.major ? 1.5 : 1"
                  />
                  <text
                    v-for="(t, i) in g.ticks"
                    :key="'ticklabel' + i"
                    :x="t.labelX"
                    :y="t.labelY"
                    text-anchor="middle"
                    dominant-baseline="middle"
                    font-size="8"
                    fill="#64748b"
                  >{{ t.labelText }}</text>
                </g>
                <!-- pista base + zonas de color (verde/ambar/rojo) -->
                <path :d="GAUGE_TRACK_PATH" fill="none" stroke="#1e293b" stroke-width="14" stroke-linecap="round" />
                <path :d="g.zoneGreen" fill="none" stroke="#22c55e" stroke-width="14" stroke-linecap="round" opacity="0.9" />
                <path :d="g.zoneAmber" fill="none" stroke="#f59e0b" stroke-width="14" opacity="0.9" />
                <path :d="g.zoneRed" fill="none" stroke="#ef4444" stroke-width="14" stroke-linecap="round" opacity="0.9" />
                <!-- anillo de progreso (lectura exacta) -->
                <path v-if="g.progressPath" :d="g.progressPath" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" opacity="0.85" />
                <!-- aguja -->
                <polygon :points="g.needlePoints" :fill="g.color" stroke="#0f172a" stroke-width="0.5" />
                <circle :cx="GAUGE_CX" :cy="GAUGE_CY" r="8" fill="#0f172a" stroke="#475569" stroke-width="1" />
                <circle :cx="GAUGE_CX" :cy="GAUGE_CY" r="3" fill="white" />
                <text
                  :x="GAUGE_CX"
                  :y="GAUGE_CY + 40"
                  text-anchor="middle"
                  font-size="24"
                  font-weight="900"
                  font-style="italic"
                  :fill="g.color"
                >{{ g.display }}<tspan font-size="12">{{ g.unit }}</tspan></text>
              </svg>
              <div class="text-xs text-slate-500 uppercase tracking-wider -mt-1">{{ g.label }}</div>
              <span class="mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider" :class="g.status.classes">{{ g.status.text }}</span>
            </div>

            <!-- Actividad / uptime: estilo odometro de carreras -->
            <div class="flex flex-col items-center justify-center">
              <div class="text-4xl font-black italic tracking-tight text-sky-400">
                {{ health.uptime ? Math.round(health.uptime.totalHours) : '—' }}<span class="text-base align-top">h</span>
              </div>
              <div class="text-xs text-slate-500 mt-1">{{ health.uptime ? health.uptime.raw : 'sin datos' }}</div>
              <div class="flex gap-0.5 mt-3">
                <span
                  v-for="n in 16"
                  :key="n"
                  class="w-1.5 h-3 rounded-sm"
                  :class="health.uptime ? 'bg-emerald-500' : 'bg-slate-800'"
                ></span>
              </div>
              <div class="text-[10px] text-slate-500 uppercase tracking-wider mt-2">Actividad</div>
            </div>
          </div>

          <!-- Detalle por tarjeta -->
          <div class="grid gap-6 pt-4 border-t border-slate-800" style="grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))">
            <div>
              <div class="text-xs text-slate-500 mb-2">Temperatura por tarjeta (°C)</div>
              <svg v-if="health.temperature.length" viewBox="0 0 320 90" class="w-full h-24">
                <g
                  v-for="b in buildHealthBars(health.temperature.map((t) => ({ slot: t.slot, value: t.tempC })), 80, 50, 65)"
                  :key="'temp' + b.slot"
                >
                  <rect :x="b.x" y="0" :width="b.width" :height="HEALTH_PLOT_HEIGHT" rx="5" class="fill-slate-800" />
                  <rect :x="b.x" :y="b.y" :width="b.width" :height="b.height" rx="5" :fill="b.color">
                    <title>Slot {{ b.slot }}: {{ b.value }}°C</title>
                  </rect>
                  <text :x="b.labelX" y="88" text-anchor="middle" font-size="9" fill="#898781">{{ b.slot }}</text>
                </g>
              </svg>
              <p v-else class="text-xs text-slate-500">Sin datos.</p>
            </div>

            <div>
              <div class="text-xs text-slate-500 mb-2">CPU por tarjeta (%, prom. 5 min)</div>
              <svg v-if="health.load.length" viewBox="0 0 320 90" class="w-full h-24">
                <g
                  v-for="b in buildHealthBars(health.load.map((l) => ({ slot: l.slot, value: l.cpuPercent })), 100, 70, 85)"
                  :key="'cpu' + b.slot"
                >
                  <rect :x="b.x" y="0" :width="b.width" :height="HEALTH_PLOT_HEIGHT" rx="5" class="fill-slate-800" />
                  <rect :x="b.x" :y="b.y" :width="b.width" :height="b.height" rx="5" :fill="b.color">
                    <title>Slot {{ b.slot }}: {{ b.value }}%</title>
                  </rect>
                  <text :x="b.labelX" y="88" text-anchor="middle" font-size="9" fill="#898781">{{ b.slot }}</text>
                </g>
              </svg>
              <p v-else class="text-xs text-slate-500">Sin datos.</p>
            </div>

            <div>
              <div class="text-xs text-slate-500 mb-2">RAM por tarjeta (%)</div>
              <svg v-if="health.load.length" viewBox="0 0 320 90" class="w-full h-24">
                <g
                  v-for="b in buildHealthBars(health.load.map((l) => ({ slot: l.slot, value: l.memPercent })), 100, 70, 85)"
                  :key="'ram' + b.slot"
                >
                  <rect :x="b.x" y="0" :width="b.width" :height="HEALTH_PLOT_HEIGHT" rx="5" class="fill-slate-800" />
                  <rect :x="b.x" :y="b.y" :width="b.width" :height="b.height" rx="5" :fill="b.color">
                    <title>Slot {{ b.slot }}: {{ b.value }}%</title>
                  </rect>
                  <text :x="b.labelX" y="88" text-anchor="middle" font-size="9" fill="#898781">{{ b.slot }}</text>
                </g>
              </svg>
              <p v-else class="text-xs text-slate-500">Sin datos.</p>
            </div>
          </div>
        </template>

        <p v-else class="text-sm text-slate-500">Consultando telemetría...</p>
      </div>

      <div class="rounded-xl border border-slate-800 bg-slate-900 p-4 mb-6">
        <h2 class="text-sm font-semibold mb-3">Consultar puerto GPON</h2>
        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label class="block text-xs text-slate-400 mb-1">Slot</label>
            <input v-model.number="slot" type="number" min="1" class="w-24 px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm" />
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">Puerto</label>
            <input v-model.number="port" type="number" min="1" class="w-24 px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm" />
          </div>
          <button :disabled="syncing" class="btn-secondary" @click="handleSync">
            {{ syncing ? 'Sincronizando...' : 'Sincronizar desde la OLT' }}
          </button>
          <button class="btn-primary" @click="openRegister()">
            + Registrar ONT
          </button>
        </div>
        <p v-if="syncMessage" class="text-xs text-slate-400 mt-3">{{ syncMessage }}</p>
        <p class="text-xs text-slate-500 mt-3">
          Registrar / activar / desactivar / eliminar ya validados contra tu OLT real (ver reporte de la Fase 4).
          Solo la lectura de señal óptica sigue sin probar.
        </p>
      </div>

      <div class="rounded-xl border border-slate-800 bg-slate-900 p-4 mb-6">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-semibold">ONTs sin autorizar ({{ unconfiguredOnts.length }})</h2>
          <button class="text-xs text-sky-400 hover:underline" :disabled="unconfiguredLoading" @click="loadUnconfigured">
            {{ unconfiguredLoading ? 'Consultando...' : 'Actualizar' }}
          </button>
        </div>
        <p v-if="unconfiguredError" class="text-xs text-red-400 mb-3">{{ unconfiguredError }}</p>
        <p v-else-if="!unconfiguredLoading && !unconfiguredOnts.length" class="text-sm text-slate-500">
          No hay ONUs detectadas sin autorizar en este momento.
        </p>
        <div v-else class="table-shell">
          <table class="w-full text-sm min-w-[500px]">
            <thead class="bg-slate-900 text-slate-400 text-xs uppercase">
              <tr>
                <th class="text-left px-4 py-2">Serial</th>
                <th class="text-left px-4 py-2">Puerto detectado</th>
                <th class="text-right px-4 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in unconfiguredOnts" :key="u.interfaceRef" class="border-t border-slate-800">
                <td class="px-4 py-2 font-mono text-xs">{{ u.serial }}</td>
                <td class="px-4 py-2 font-mono text-xs text-slate-400">{{ u.frame }}/{{ u.slot }}/{{ u.port }}</td>
                <td class="px-4 py-2 text-right">
                  <button
                    class="text-sky-400 hover:underline text-xs"
                    :disabled="u.slot === null || u.port === null"
                    @click="openRegister({ serial: u.serial, slot: u.slot!, port: u.port! })"
                  >
                    Configurar
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-[11px] text-slate-600 mt-3">
          El ID de ONU se calcula automáticamente al registrar (el número que muestra la OLT aquí no es
          confiable como ID libre).
        </p>
      </div>

      <div class="rounded-xl border border-amber-800/40 bg-amber-950/20 p-4 mb-6">
        <h2 class="text-sm font-semibold mb-1">¿Ves menos ONTs de las que tienes, o sin nombre/señal?</h2>
        <p class="text-xs text-slate-400 mb-3">
          Si esta OLT ya tenia ONTs configuradas desde antes de usar SmartRayco (ej. desde SmartOLT), no
          apareceran aqui hasta importarlas. Trae serial, tipo, nombre (de la OLT), plan, VLAN y señal
          Rx/Tx de todas. Esto solo lee la OLT (sin cambiar nada) y puede tardar varios minutos con
          cientos de ONTs — se puede repetir cuando quieras para refrescar todo.
        </p>
        <button :disabled="importing" class="btn-secondary" @click="handleImportExisting">
          {{ importing ? 'Importando...' : 'Importar / actualizar ONTs desde la OLT' }}
        </button>
        <p v-if="importMessage" class="text-xs text-slate-400 mt-3">{{ importMessage }}</p>
      </div>

      <h2 class="text-lg font-semibold mb-3">ONTs registradas</h2>
      <input
        v-model="ontSearch"
        placeholder="Buscar por serial, cliente o shelf/slot/port..."
        class="field-input mb-3"
      />
      <div class="table-shell">
        <table class="w-full text-sm min-w-[760px]">
          <thead class="bg-slate-900 text-slate-400 text-xs uppercase">
            <tr>
              <th class="text-left px-4 py-3">Shelf/Slot/Port/ID</th>
              <th class="text-left px-4 py-3">Serial</th>
              <th class="text-left px-4 py-3">Cliente</th>
              <th class="text-left px-4 py-3">Zona</th>
              <th class="text-left px-4 py-3">Estado</th>
              <th class="text-left px-4 py-3">Rx / Tx (dBm)</th>
              <th class="text-left px-4 py-3">TR-069</th>
              <th class="text-right px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!filteredOnts.length">
              <td colspan="8" class="px-4 py-6 text-center text-slate-500">
                {{ ontSearch ? 'Sin resultados para esa busqueda.' : 'Sin ONTs. Sincroniza un puerto o registra una nueva.' }}
              </td>
            </tr>
            <tr
              v-for="ont in filteredOnts"
              :key="ont.id"
              class="border-t border-slate-800 cursor-pointer hover:bg-slate-900/40"
              @click="openOntDetail(ont)"
            >
              <td class="px-4 py-3 font-mono text-xs">{{ ont.frame }}/{{ ont.slot }}/{{ ont.port }}:{{ ont.ont_id }}</td>
              <td class="px-4 py-3 font-mono text-xs">{{ ont.serial }}</td>
              <td class="px-4 py-3 text-slate-400">
                <template v-if="ont.clients">{{ ont.clients.first_name }} {{ ont.clients.last_name }}</template>
                <template v-else-if="ont.description">
                  {{ ont.description }}
                  <span class="block text-[10px] text-slate-600">de la OLT, sin vincular</span>
                </template>
                <template v-else>—</template>
              </td>
              <td class="px-4 py-3 text-slate-400 text-xs">
                <span v-if="ont.zones">{{ ont.zones.name }}</span>
                <span v-else-if="ont.splitter">{{ ont.splitter }}<span v-if="ont.splitter_port"> / {{ ont.splitter_port }}</span></span>
                <span v-else class="text-slate-600">—</span>
              </td>
              <td class="px-4 py-3">
                <span class="badge" :class="STATUS_CLASS[ont.status]">{{ ont.status }}</span>
              </td>
              <td class="px-4 py-3 text-slate-400 text-xs">{{ ont.rx_power ?? '—' }} / {{ ont.tx_power ?? '—' }}</td>
              <td class="px-4 py-3">
                <span v-if="ont.tr069_enabled" class="badge bg-emerald-500/15 text-emerald-400">Activo</span>
                <span v-else class="text-slate-500 text-xs">—</span>
              </td>
              <td class="px-4 py-3 text-right space-x-3 whitespace-nowrap text-xs" @click.stop>
                <button class="text-sky-400 hover:underline" :disabled="signalLoadingId === ont.id" @click="handleSignal(ont)">
                  {{ signalLoadingId === ont.id ? 'Leyendo...' : 'Senal' }}
                </button>
                <button class="text-slate-400 hover:text-slate-100" @click="openZoneEdit(ont)">Zona</button>
                <button class="text-slate-400 hover:text-slate-100" @click="openTr069Modal(ont)">TR-069</button>
                <button class="text-slate-400 hover:text-slate-100" @click="handleToggle(ont)">
                  {{ ont.status === 'online' ? 'Desactivar' : 'Activar' }}
                </button>
                <button class="text-red-500/80 hover:text-red-400" @click="handleDelete(ont)">Eliminar</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <Teleport to="body">
      <div v-if="tr069Modal" class="modal-overlay">
        <form class="w-full max-w-md modal-panel" @submit.prevent="handleTr069Assign">
          <h2 class="text-lg font-semibold mb-1">TR-069 — {{ tr069Modal.serial }}</h2>
          <p class="text-xs text-slate-500 mb-4">
            Asigna el servidor ACS (GenieACS) a esta ONT via OMCI. Requiere una ONT con VEIP (ej. ZTE-F660).
          </p>

          <div class="mb-3">
            <label class="block text-xs text-slate-400 mb-1">URL del ACS</label>
            <input v-model="tr069AcsUrl" placeholder="http://192.168.100.136:7547" required class="field-input" />
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-400 mb-1">VEIP</label>
            <input v-model.number="tr069Veip" type="number" min="1" class="field-input" />
          </div>

          <p v-if="tr069Error" class="text-sm text-red-400 mb-3">{{ tr069Error }}</p>

          <div class="flex justify-between gap-2">
            <button
              v-if="tr069Modal.tr069_enabled"
              type="button"
              class="text-red-400 hover:underline text-xs"
              :disabled="tr069Saving"
              @click="handleTr069Remove"
            >
              Desactivar TR-069
            </button>
            <div class="flex gap-2 ml-auto">
              <button type="button" class="btn-ghost" @click="tr069Modal = null">Cancelar</button>
              <button type="submit" :disabled="tr069Saving || !tr069AcsUrl" class="btn-primary">
                {{ tr069Saving ? 'Guardando...' : 'Asignar' }}
              </button>
            </div>
          </div>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showAcsProfileModal" class="modal-overlay">
        <form class="w-full max-w-md modal-panel" @submit.prevent="handleSaveAcsProfile">
          <h2 class="text-lg font-semibold mb-1">ACS (GenieACS) por defecto</h2>
          <p class="text-xs text-slate-500 mb-4">
            Se usa para prellenar la URL del ACS al asignar TR-069 a cualquier ONT de esta OLT.
          </p>

          <p v-if="acsProfileLoading" class="text-xs text-slate-500 mb-3">Cargando...</p>
          <template v-else>
            <div class="mb-3">
              <label class="block text-xs text-slate-400 mb-1">URL del ACS</label>
              <input v-model="acsProfileForm.acs_url" required placeholder="http://192.168.100.136:7547" class="field-input" />
            </div>
            <div class="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label class="block text-xs text-slate-400 mb-1">Usuario (opcional)</label>
                <input v-model="acsProfileForm.acs_username" class="field-input" />
              </div>
              <div>
                <label class="block text-xs text-slate-400 mb-1">Contraseña (opcional)</label>
                <input v-model="acsProfileForm.acs_password" type="password" class="field-input" />
              </div>
            </div>
            <div class="mb-4">
              <label class="block text-xs text-slate-400 mb-1">Intervalo de Inform (segundos)</label>
              <input v-model.number="acsProfileForm.inform_interval" type="number" min="30" class="field-input" />
            </div>
          </template>

          <p v-if="acsProfileError" class="text-sm text-red-400 mb-3">{{ acsProfileError }}</p>
          <p v-if="acsProfileSaved" class="text-sm text-emerald-400 mb-3">Guardado.</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showAcsProfileModal = false">Cerrar</button>
            <button type="submit" :disabled="acsProfileSaving || acsProfileLoading || !acsProfileForm.acs_url" class="btn-primary">
              {{ acsProfileSaving ? 'Guardando...' : 'Guardar' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showRegisterModal" class="modal-overlay">
        <form
          class="w-full max-w-md modal-panel max-h-[90vh] overflow-y-auto"
          @submit.prevent="handleRegister"
        >
          <h2 class="text-lg font-semibold mb-1">Registrar ONT</h2>
          <p class="text-xs text-slate-500 mb-4">Puerto GPON 1/{{ slot }}/{{ port }} (shelf/slot/port)</p>

          <div class="mb-3">
            <label class="block text-xs text-slate-400 mb-1">Serial de la ONU</label>
            <input
              v-model="registerForm.serial"
              required
              placeholder="ZTEGC1234567"
              class="field-input font-mono"
            />
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-400 mb-1">ID de ONU (vacio = auto)</label>
              <input v-model.number="registerForm.onuId" type="number" min="0" placeholder="auto" class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">VLAN</label>
              <input v-model.number="registerForm.vlan" type="number" class="field-input" />
            </div>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-400 mb-1">Tipo de ONU (perfil configurado en la OLT)</label>
            <input
              v-model="registerForm.onuType"
              required
              placeholder="ej. ZTE-F660"
              class="field-input"
            />
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-400 mb-1">Descripcion</label>
            <input v-model="registerForm.description" placeholder="Nombre del cliente" class="field-input" />
          </div>

          <p v-if="profilesError" class="text-xs text-red-400 mb-3">{{ profilesError }}</p>
          <div class="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Perfil de subida (tcont)</label>
              <select v-model="registerForm.tcontProfile" required class="field-input" :disabled="profilesLoading">
                <option value="" disabled>{{ profilesLoading ? 'Cargando...' : 'Selecciona un plan' }}</option>
                <option v-for="p in profiles.tcontProfiles" :key="p" :value="p">{{ p }}</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Perfil de bajada (traffic)</label>
              <select v-model="registerForm.trafficProfile" required class="field-input" :disabled="profilesLoading">
                <option value="" disabled>{{ profilesLoading ? 'Cargando...' : 'Selecciona un plan' }}</option>
                <option v-for="p in profiles.trafficProfiles" :key="p" :value="p">{{ p }}</option>
              </select>
            </div>
          </div>

          <p v-if="registerError" class="text-sm text-red-400 mb-3">{{ registerError }}</p>
          <p class="text-[11px] text-slate-600 mb-3">
            Tras registrar, la app intenta asignar TR-069 automáticamente (si hay un ACS por defecto
            configurado) y leer la señal inicial — puede tardar ~10-15s extra.
          </p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showRegisterModal = false">
              Cancelar
            </button>
            <button type="submit" :disabled="registering" class="btn-primary">
              {{ registering ? 'Registrando (puede tardar ~15s)...' : 'Registrar en la OLT' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>

    <OntDetailModal
      v-if="detailOnt && device"
      :ont="detailOnt"
      :device="device"
      :zone-name="detailOnt.zones?.name ?? deviceZoneName"
      @close="detailOntId = null"
      @open-tr069="handleOpenTr069FromDetail"
      @edit-zone="handleEditZoneFromDetail"
    />

    <OntZoneEditModal
      v-if="zoneEditOnt"
      :ont="zoneEditOnt"
      :device-id="deviceId"
      @close="zoneEditOntId = null"
      @saved="zoneEditOntId = null"
    />
  </AppLayout>
</template>
