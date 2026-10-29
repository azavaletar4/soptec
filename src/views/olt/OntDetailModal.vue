<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useOltStore, type OltOnt, type OltDevice, type Tr069EnableStatusResult } from '@/stores/olt';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/lib/errors';
import { runSignalRefresh } from '@/lib/signalRefreshFlow';
import { gponVendorFromSerial, isThirdPartyOnt } from '@/lib/gponVendorId';
import { deriveTr069EnableStatus, canManageTr069, shouldKeepPollingTr069, TR069_ENABLE_STATUS_LABEL, type Tr069EnableStatus } from '@/lib/tr069EnableStatus';

// Replica el layout del panel de detalle de ONU estilo SmartOLT (columna de
// identidad/config a la izquierda, grafico + estado en vivo a la derecha,
// acciones abajo) pero con datos reales de esta app.
const props = defineProps<{
  ont: OltOnt;
  device: OltDevice;
  zoneName: string | null;
}>();

const emit = defineEmits<{ close: []; openTr069: [ont: OltOnt]; editZone: [ont: OltOnt] }>();

const oltStore = useOltStore();
const auth = useAuthStore();

const signalLoading = ref(false);
const signalError = ref<string | null>(null);

// ---- Habilitacion GUIADA de TR-069 (boton individual, 2026-10-27) ----
// Solo ADMIN/SUPERADMIN ven el boton — el backend (POST .../tr069/enable-guided,
// requireRole(...TR069_ENABLE_ROLES)) es quien realmente lo exige; esto es
// solo para no mostrar una accion que de todas formas el servidor rechazaria.
const canEnableTr069Guided = computed(() => ['SUPERADMIN', 'ADMIN'].includes(auth.role ?? ''));

const detectedVendor = computed(() => gponVendorFromSerial(props.ont.serial));
const thirdPartyVendor = computed(() => isThirdPartyOnt(detectedVendor.value, props.device.brand));

const tr069Status = ref<Tr069EnableStatusResult | null>(null);
const tr069Enabling = ref(false);
const tr069EnableError = ref<string | null>(null);
const showEnableConfirm = ref(false);
let tr069PollTimer: ReturnType<typeof setTimeout> | null = null;
let tr069PollAttempts = 0;
const TR069_POLL_MAX_ATTEMPTS = 12; // ~3 min a 15s por intento — suficiente para un primer Inform real, sin sondear para siempre.
const TR069_POLL_INTERVAL_MS = 15000;

const tr069EnableStatus = computed<Tr069EnableStatus>(() =>
  deriveTr069EnableStatus({
    tr069Enabled: props.ont.tr069_enabled,
    requestInFlight: tr069Enabling.value || (tr069Status.value?.requestInFlight ?? false),
    lastError: tr069EnableError.value,
    matchedDevice: tr069Status.value?.matchedDevice ?? null,
    enabledAt: props.ont.tr069_enabled_at ?? null,
    nowMs: Date.now(),
  }),
);

async function refreshTr069Status() {
  try {
    tr069Status.value = await oltStore.fetchTr069EnableStatus(props.device.id, props.ont.id);
  } catch {
    // Solo-lectura de apoyo visual: si falla, el badge se queda con el ultimo valor conocido.
  }
}

function stopTr069Poll() {
  if (tr069PollTimer) clearTimeout(tr069PollTimer);
  tr069PollTimer = null;
}

function scheduleTr069Poll() {
  stopTr069Poll();
  if (tr069PollAttempts >= TR069_POLL_MAX_ATTEMPTS) return;
  tr069PollTimer = setTimeout(async () => {
    tr069PollAttempts += 1;
    await refreshTr069Status();
    if (shouldKeepPollingTr069(tr069EnableStatus.value)) scheduleTr069Poll();
  }, TR069_POLL_INTERVAL_MS);
}

async function confirmEnableTr069Guided() {
  showEnableConfirm.value = false;
  tr069Enabling.value = true;
  tr069EnableError.value = null;
  try {
    await oltStore.enableTr069Guided(props.device.id, props.ont.id);
    tr069PollAttempts = 0;
    await refreshTr069Status();
    scheduleTr069Poll();
  } catch (e) {
    tr069EnableError.value = getErrorMessage(e, 'Error al habilitar TR-069 en la OLT');
  } finally {
    tr069Enabling.value = false;
  }
}

onMounted(() => {
  if (props.ont.tr069_enabled) {
    refreshTr069Status().then(() => {
      if (shouldKeepPollingTr069(tr069EnableStatus.value)) scheduleTr069Poll();
    });
  }
});
onBeforeUnmount(stopTr069Poll);

// ---- WAN/PPPoE por OMCI (Fase 75/76) — ver zteCommands.ts
// configureWanPppoeCommands. "Autorizar ONU" ya lo hace solo cuando tiene la
// clave en texto plano (credencial nueva, o existente si el tecnico la
// escribio ahi); este boton manual queda para el resto de los casos (ej.
// secreto existente sin clave a mano, o si el paso automatico fallo). No
// persiste username/password en ningun lado. ----
const wanPppoeOpen = ref(false);
const wanPppoeForm = ref({ username: '', password: '', vlanProfile: '' });
const wanPppoeSaving = ref(false);
const wanPppoeError = ref<string | null>(null);
const wanPppoeOk = ref(false);

const configOpen = ref(false);
const configLoading = ref(false);
const configError = ref<string | null>(null);
const configText = ref<string | null>(null);

const interfaceRef = computed(
  () => `gpon-onu_${props.ont.frame}/${props.ont.slot}/${props.ont.port}:${props.ont.ont_id}`,
);

const profileLabel = computed(() => {
  const { tcont_profile, traffic_profile } = props.ont;
  if (!tcont_profile && !traffic_profile) return 'Ninguno';
  return `${tcont_profile ?? '—'} / ${traffic_profile ?? '—'}`;
});

const clientName = computed(() => {
  const c = props.ont.clients;
  if (c) return `${c.first_name} ${c.last_name}`;
  return props.ont.description ? `${props.ont.description} (de la OLT, sin vincular)` : 'Sin asignar';
});

const STATUS_LABEL: Record<OltOnt['status'], string> = { online: 'En línea', offline: 'Desconectada', unknown: 'No confirmado' };
const STATUS_DOT: Record<OltOnt['status'], string> = { online: 'bg-emerald-400', offline: 'bg-red-400', unknown: 'bg-slate-500' };
const EVIDENCE_LABEL: Record<string, string> = { failed: 'Consulta fallida', absent: 'Serial no encontrado en la OLT', moved: 'Serial detectado en otra posición', conflict: 'La posición corresponde a otro serial', ambiguous: 'Identidad ambigua', unconfirmed: 'Pendiente de verificación', expired: 'Lectura vencida' };

function relativeTime(value: string | null): string {
  if (!value) return 'nunca';
  const ms = Date.now() - new Date(value).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'hace instantes';
  if (min < 60) return `hace ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  return `hace ${Math.round(hr / 24)} d`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' });
}

async function refreshSignal() {
  signalLoading.value = true;
  signalError.value = null;
  // runSignalRefresh() usa el rx/tx que devuelve getSignal() para actualizar
  // esta ONU en memoria (sin red) y dispara el refresco del listado completo
  // EN SEGUNDO PLANO, sin esperarlo — asi "Consultando..." se libera apenas
  // termina la consulta de señal (que ya tiene su propio timeout), nunca
  // detras de una recarga de todo el listado (ver src/lib/signalRefreshFlow.ts).
  const result = await runSignalRefresh({
    getSignal: () => oltStore.getSignal(props.device.id, props.ont.id),
    patchOntSignal: (rx, tx) => oltStore.patchOntSignal(props.ont.id, rx, tx),
    refreshList: () => oltStore.fetchOnts(props.device.id),
  });
  if (!result.ok) signalError.value = result.error ?? 'Error al leer la señal óptica';
  signalLoading.value = false;
}

async function submitWanPppoe() {
  wanPppoeSaving.value = true;
  wanPppoeError.value = null;
  wanPppoeOk.value = false;
  try {
    await oltStore.configureWanPppoe(props.device.id, props.ont.id, { ...wanPppoeForm.value });
    await oltStore.fetchOnts(props.device.id);
    wanPppoeOk.value = true;
  } catch (e) {
    wanPppoeError.value = getErrorMessage(e, 'Error al configurar el WAN/PPPoE en la OLT');
  } finally {
    wanPppoeSaving.value = false;
  }
}

async function toggleConfig() {
  configOpen.value = !configOpen.value;
  if (configOpen.value && configText.value == null) {
    configLoading.value = true;
    configError.value = null;
    try {
      const res = await oltStore.fetchRunningConfig(props.device.id, props.ont.id);
      configText.value = res.raw || '(sin salida)';
    } catch (e) {
      configError.value = getErrorMessage(e, 'Error al leer la configuración de la OLT');
    } finally {
      configLoading.value = false;
    }
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="w-full max-w-3xl modal-panel max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between mb-5">
          <div>
            <h2 class="text-lg font-semibold">{{ ont.serial }}</h2>
            <p class="text-xs text-slate-500 font-mono">{{ interfaceRef }}</p>
          </div>
          <button class="btn-ghost !p-2" @click="emit('close')" aria-label="Cerrar">✕</button>
        </div>

        <div class="grid md:grid-cols-2 gap-6">
          <!-- Columna izquierda: identidad / configuracion -->
          <dl class="space-y-2.5 text-sm">
            <div class="flex justify-between gap-3"><dt class="text-slate-500">OLT</dt><dd class="text-right">{{ device.name }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-slate-500">Slot</dt><dd class="text-right">{{ ont.slot }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-slate-500">Puerto</dt><dd class="text-right">{{ ont.port }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-slate-500">ONU</dt><dd class="text-right font-mono text-xs">{{ interfaceRef }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-slate-500">Canal GPON</dt><dd class="text-right">GPON</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-slate-500">SN</dt><dd class="text-right font-mono text-xs">{{ ont.serial }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-slate-500">Tipo de ONU</dt><dd class="text-right">{{ ont.onu_type ?? '—' }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-slate-500">Perfil (subida/bajada)</dt><dd class="text-right">{{ profileLabel }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-slate-500">Zona</dt><dd class="text-right">{{ zoneName ?? '—' }}</dd></div>
            <div class="flex justify-between gap-3">
              <dt class="text-slate-500">Splitter</dt>
              <dd class="text-right">{{ ont.splitter ?? '—' }}<span v-if="ont.splitter_port"> / {{ ont.splitter_port }}</span></dd>
            </div>
            <div class="flex justify-between gap-3"><dt class="text-slate-500">Nombre</dt><dd class="text-right">{{ clientName }}</dd></div>
            <div class="flex justify-between gap-3">
              <dt class="text-slate-500">Dirección</dt>
              <dd class="text-right">{{ ont.clients?.address ?? ont.address_comment ?? '—' }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-slate-500">Contacto</dt>
              <dd class="text-right">{{ ont.clients?.phone ?? ont.contact ?? '—' }}</dd>
            </div>
            <div class="flex justify-between gap-3"><dt class="text-slate-500">Registrado</dt><dd class="text-right">{{ formatDate(ont.created_at) }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-slate-500">ID externo (ONU)</dt><dd class="text-right font-mono text-xs">{{ ont.serial }}</dd></div>
          </dl>

          <!-- Columna derecha: grafico + estado en vivo -->
          <div class="flex flex-col gap-4">
            <svg viewBox="0 0 260 90" class="w-full h-auto">
              <rect x="4" y="4" width="252" height="82" rx="10" class="fill-slate-100" />
              <rect x="4" y="4" width="252" height="82" rx="10" fill="none" class="stroke-slate-400" stroke-width="1" />
              <g v-for="(label, i) in ['PON', 'Tel2', 'Tel1']" :key="label">
                <rect :x="16 + i * 30" y="24" width="22" height="16" rx="2" class="fill-slate-700" />
                <text :x="27 + i * 30" y="52" text-anchor="middle" font-size="8" class="fill-slate-600">{{ label }}</text>
              </g>
              <g v-for="(label, i) in ['LAN4', 'LAN3', 'LAN2', 'LAN1']" :key="label">
                <rect :x="108 + i * 26" y="24" width="20" height="16" rx="2" class="fill-amber-500" />
                <text :x="118 + i * 26" y="52" text-anchor="middle" font-size="8" class="fill-slate-600">{{ label }}</text>
              </g>
              <circle cx="228" cy="30" r="2.5" class="fill-slate-500" />
              <rect x="220" y="42" width="18" height="12" rx="2" class="fill-slate-800" />
              <circle cx="234" cy="48" r="3" class="fill-red-500" />
              <text x="130" y="80" text-anchor="middle" font-size="7" class="fill-slate-500">ONT genérica (ilustrativa)</text>
            </svg>

            <div class="surface p-4 space-y-2.5 text-sm">
              <div class="flex justify-between items-center">
                <span class="text-slate-500">Estado</span>
                <span class="flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full" :class="STATUS_DOT[ont.status]"></span>
                  {{ STATUS_LABEL[ont.status] }}
                  <span v-if="ont.telemetry?.stateReadAt" class="text-xs text-slate-500">({{ relativeTime(ont.telemetry.stateReadAt) }})</span>
                </span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-500">Señal Rx / Tx</span>
                <span>{{ ont.rx_power ?? '—' }} / {{ ont.tx_power ?? '—' }} dBm</span>
              </div>
              <p v-if="ont.telemetry?.signalReadAt" class="text-xs text-slate-500">Señal consultada: {{ relativeTime(ont.telemetry.signalReadAt) }}.</p>
              <p v-if="ont.telemetry?.outcome !== 'valid'" class="text-xs text-amber-700">
                Sin lectura vigente atribuible a este serial. {{ EVIDENCE_LABEL[ont.telemetry?.outcome ?? 'unconfirmed'] }}.
                <template v-if="ont.telemetry?.observedSerial">Serial observado: {{ ont.telemetry.observedSerial }}.</template>
              </p>
              <p v-if="ont.telemetry?.historical" class="text-xs text-slate-500">
                Registro guardado, sin validar como señal actual:
                {{ ont.telemetry.historical.rxPower ?? '—' }} / {{ ont.telemetry.historical.txPower ?? '—' }} dBm.
                <template v-if="ont.telemetry.historical.at">Registro: {{ ont.telemetry.historical.at }}.</template>
              </p>
              <div class="flex justify-between items-center">
                <span class="text-slate-500">TR-069</span>
                <span
                  class="badge"
                  :class="{
                    conectado: 'bg-emerald-500/15 text-emerald-700',
                    configurado: 'bg-sky-500/15 text-sky-700',
                    esperando_conexion: 'bg-amber-500/15 text-amber-700',
                    sin_comunicacion_reciente: 'bg-orange-500/15 text-orange-700',
                    habilitando: 'bg-amber-500/15 text-amber-700',
                    error: 'bg-red-500/15 text-red-600',
                    no_habilitado: 'bg-slate-200 text-slate-600',
                  }[tr069EnableStatus]"
                >
                  {{ TR069_ENABLE_STATUS_LABEL[tr069EnableStatus] }}
                </span>
              </div>
              <div v-if="ont.tr069_enabled" class="flex justify-between gap-3">
                <span class="text-slate-500">ACS</span>
                <span class="text-right font-mono text-xs break-all">{{ ont.tr069_acs_url }}</span>
              </div>
              <p v-if="tr069EnableError" class="text-xs text-red-600">{{ tr069EnableError }}</p>
              <div class="flex justify-between">
                <span class="text-slate-500">VLAN</span>
                <span>{{ ont.vlan ?? '—' }}</span>
              </div>
              <p v-if="signalError" class="text-xs text-red-600 pt-1">{{ signalError }}</p>
            </div>
          </div>
        </div>

        <div v-if="configOpen" class="mt-4">
          <p v-if="configLoading" class="text-xs text-slate-500">Consultando...</p>
          <p v-else-if="configError" class="text-xs text-red-600">{{ configError }}</p>
          <pre v-else class="text-xs bg-white border border-slate-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{{ configText }}</pre>
        </div>

        <div class="flex flex-wrap gap-2 mt-6">
          <button class="btn-secondary" :disabled="signalLoading" @click="refreshSignal">
            {{ signalLoading ? 'Consultando...' : 'Consultar señal' }}
          </button>
          <button class="btn-secondary" @click="emit('editZone', ont)">Editar información</button>
          <button class="btn-secondary" @click="toggleConfig">
            {{ configOpen ? 'Ocultar running-config' : 'Ver running-config' }}
          </button>
          <button v-if="canManageTr069(tr069EnableStatus)" class="btn-primary" @click="emit('openTr069', ont)">
            Administrar TR-069
          </button>
          <button
            v-else-if="canEnableTr069Guided && (tr069EnableStatus === 'no_habilitado' || tr069EnableStatus === 'error')"
            class="btn-primary"
            @click="showEnableConfirm = true"
          >
            Habilitar TR-069
          </button>
          <button
            v-else-if="tr069EnableStatus === 'habilitando' || tr069EnableStatus === 'esperando_conexion'"
            class="btn-secondary"
            disabled
          >
            {{ TR069_ENABLE_STATUS_LABEL[tr069EnableStatus] }}
          </button>
          <button class="btn-ghost ml-auto" @click="emit('close')">Cerrar</button>
        </div>

        <div class="mt-4 pt-3 border-t border-slate-200">
          <button class="text-xs text-amber-700 hover:underline" @click="wanPppoeOpen = !wanPppoeOpen">
            {{ wanPppoeOpen ? 'Ocultar' : 'Configurar WAN/PPPoE desde la OLT' }}
          </button>
          <div v-if="wanPppoeOpen" class="mt-3 surface p-4 border border-amber-300">
            <p class="text-xs text-amber-700 mb-3">
              Empuja el WAN/PPPoE por OMCI (<code>pon-onu-mng</code> / <code>wan-ip</code>) en vez de que el técnico
              lo configure a mano en la página web local del equipo — "Autorizar ONU" ya hace esto solo cuando tiene
              la clave a mano; usá este botón para el resto de los casos. El VLAN-profile debe existir YA creado en
              la OLT.
            </p>
            <form class="grid sm:grid-cols-3 gap-3" @submit.prevent="submitWanPppoe">
              <div>
                <label class="block text-xs text-slate-600 mb-1">Usuario PPPoE</label>
                <input v-model="wanPppoeForm.username" required class="field-input text-sm" />
              </div>
              <div>
                <label class="block text-xs text-slate-600 mb-1">Clave PPPoE</label>
                <input v-model="wanPppoeForm.password" type="password" autocomplete="new-password" required class="field-input text-sm" />
              </div>
              <div>
                <label class="block text-xs text-slate-600 mb-1">VLAN-profile (ya existente en la OLT)</label>
                <input v-model="wanPppoeForm.vlanProfile" required class="field-input text-sm" placeholder="Nombre real del perfil, ej. 120" />
              </div>
              <div class="sm:col-span-3">
                <button type="submit" :disabled="wanPppoeSaving" class="btn-secondary text-sm">
                  {{ wanPppoeSaving ? 'Configurando...' : 'Enviar a la OLT' }}
                </button>
              </div>
            </form>
            <p v-if="wanPppoeError" class="text-xs text-red-600 mt-2">{{ wanPppoeError }}</p>
            <p v-if="wanPppoeOk" class="text-xs text-emerald-600 mt-2">
              Comando enviado a la OLT. Revisá si el equipo ya empieza a navegar.
            </p>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Confirmacion de habilitacion guiada de TR-069 (boton individual, 2026-10-27) -->
  <Teleport to="body">
    <div v-if="showEnableConfirm" class="modal-overlay" @click.self="showEnableConfirm = false">
      <div class="w-full max-w-md modal-panel">
        <h2 class="text-lg font-semibold mb-1">Habilitar TR-069 — {{ ont.serial }}</h2>
        <p class="text-xs text-slate-500 font-mono mb-4">{{ interfaceRef }}</p>

        <dl class="space-y-2 text-sm mb-4">
          <div class="flex justify-between gap-3">
            <dt class="text-slate-500">Fabricante detectado</dt>
            <dd class="text-right">{{ detectedVendor.name ?? `Desconocido (${detectedVendor.prefix || '—'})` }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-slate-500">Metodo</dt>
            <dd class="text-right">OMCI via OLT (pon-onu-mng / tr069-mgmt)</dd>
          </div>
        </dl>

        <p v-if="thirdPartyVendor" class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
          <strong>Compatibilidad no verificada:</strong> esta ONT es {{ detectedVendor.name ?? 'de un fabricante distinto' }},
          no {{ device.brand.toUpperCase() }} (la marca de esta OLT). El comando OMCI que se va a ejecutar nunca se
          confirmó de punta a punta contra un equipo de este fabricante — puede que no reporte a GenieACS aunque la
          OLT acepte el comando sin error. Esta es la primera prueba real.
        </p>
        <p class="text-xs text-slate-600 mb-4">
          Solo se configura <strong>esta ONT</strong>: no se toca Internet, la VLAN de servicio, PPPoE ni ninguna
          otra ONT. Se usa siempre el perfil ACS por defecto de esta OLT. Se vuelve a verificar el serial en vivo en
          esta posición antes de escribir nada — si no coincide, se detiene sin aplicar ningún cambio.
        </p>
        <p v-if="tr069EnableError" class="text-xs text-red-600 mb-4">{{ tr069EnableError }}</p>

        <div class="flex justify-end gap-2">
          <button class="btn-ghost" :disabled="tr069Enabling" @click="showEnableConfirm = false">Cancelar</button>
          <button class="btn-primary" :disabled="tr069Enabling" @click="confirmEnableTr069Guided">
            {{ tr069Enabling ? 'Habilitando...' : 'Confirmar y habilitar' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
