<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useOltStore, type OltOnt } from '@/stores/olt';
import { getErrorMessage } from '@/lib/errors';

const route = useRoute();
const router = useRouter();
const oltStore = useOltStore();

const deviceId = computed(() => route.params.id as string);
const device = computed(() => oltStore.devices.find((d) => d.id === deviceId.value));

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
});

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

onMounted(async () => {
  if (!oltStore.devices.length) await oltStore.fetchDevices();
  await Promise.all([oltStore.fetchOnts(deviceId.value), loadSummary()]);
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

function openRegister() {
  registerForm.value = { onuId: '', serial: '', onuType: '', description: '', vlan: 100 };
  registerError.value = null;
  showRegisterModal.value = true;
}

async function handleRegister() {
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
    });
    showRegisterModal.value = false;
    await oltStore.fetchOnts(deviceId.value);
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
</script>

<template>
  <AppLayout>
    <button class="text-sm text-slate-400 hover:text-slate-100 mb-4" @click="router.push('/olt')">← Volver a OLTs</button>

    <div v-if="!device" class="text-slate-500">OLT no encontrada.</div>
    <template v-else>
      <h1 class="text-2xl font-semibold mb-1">{{ device.name }}</h1>
      <p class="text-slate-400 text-sm mb-6">{{ device.host }}:{{ device.telnet_port }} · {{ device.brand.toUpperCase() }}</p>

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
          <button class="btn-primary" @click="openRegister">
            + Registrar ONT
          </button>
        </div>
        <p v-if="syncMessage" class="text-xs text-slate-400 mt-3">{{ syncMessage }}</p>
        <p class="text-xs text-slate-500 mt-3">
          Registrar / activar / desactivar / eliminar ya validados contra tu OLT real (ver reporte de la Fase 4).
          Solo la lectura de señal óptica sigue sin probar.
        </p>
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
              <th class="text-left px-4 py-3">Estado</th>
              <th class="text-left px-4 py-3">Rx / Tx (dBm)</th>
              <th class="text-right px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!filteredOnts.length">
              <td colspan="6" class="px-4 py-6 text-center text-slate-500">
                {{ ontSearch ? 'Sin resultados para esa busqueda.' : 'Sin ONTs. Sincroniza un puerto o registra una nueva.' }}
              </td>
            </tr>
            <tr v-for="ont in filteredOnts" :key="ont.id" class="border-t border-slate-800">
              <td class="px-4 py-3 font-mono text-xs">{{ ont.frame }}/{{ ont.slot }}/{{ ont.port }}:{{ ont.ont_id }}</td>
              <td class="px-4 py-3 font-mono text-xs">{{ ont.serial }}</td>
              <td class="px-4 py-3 text-slate-400">
                {{ ont.clients ? `${ont.clients.first_name} ${ont.clients.last_name}` : '—' }}
              </td>
              <td class="px-4 py-3">
                <span class="badge" :class="STATUS_CLASS[ont.status]">{{ ont.status }}</span>
              </td>
              <td class="px-4 py-3 text-slate-400 text-xs">{{ ont.rx_power ?? '—' }} / {{ ont.tx_power ?? '—' }}</td>
              <td class="px-4 py-3 text-right space-x-3 whitespace-nowrap text-xs">
                <button class="text-sky-400 hover:underline" :disabled="signalLoadingId === ont.id" @click="handleSignal(ont)">
                  {{ signalLoadingId === ont.id ? 'Leyendo...' : 'Senal' }}
                </button>
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

          <p v-if="registerError" class="text-sm text-red-400 mb-3">{{ registerError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showRegisterModal = false">
              Cancelar
            </button>
            <button type="submit" :disabled="registering" class="btn-primary">
              {{ registering ? 'Registrando...' : 'Registrar en la OLT' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
