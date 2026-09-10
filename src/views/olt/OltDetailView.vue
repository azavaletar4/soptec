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

const STATUS_CLASS: Record<string, string> = {
  online: 'bg-green-500/15 text-green-400',
  offline: 'bg-red-500/15 text-red-400',
  unknown: 'bg-slate-500/15 text-slate-400',
};

onMounted(async () => {
  if (!oltStore.devices.length) await oltStore.fetchDevices();
  await oltStore.fetchOnts(deviceId.value);
});

async function handleSync() {
  syncing.value = true;
  syncMessage.value = null;
  try {
    const res = await oltStore.syncOnts(deviceId.value, slot.value, port.value);
    syncMessage.value = `Sincronizadas ${res.synced} ONT(s) en el puerto ${slot.value}/${port.value}`;
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
      <p class="text-slate-400 text-sm mb-6">{{ device.host }}:{{ device.ssh_port }} · {{ device.brand.toUpperCase() }}</p>

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
          <button :disabled="syncing" class="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm disabled:opacity-60" @click="handleSync">
            {{ syncing ? 'Sincronizando...' : 'Sincronizar desde la OLT' }}
          </button>
          <button class="px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold text-sm" @click="openRegister">
            + Registrar ONT
          </button>
        </div>
        <p v-if="syncMessage" class="text-xs text-slate-400 mt-3">{{ syncMessage }}</p>
        <p class="text-xs text-amber-400/80 mt-3">
          ⚠ Comandos ZTE C300 sin validar contra tu equipo real todavia — revisa el reporte de esta fase antes de usar en producción.
        </p>
      </div>

      <h2 class="text-lg font-semibold mb-3">ONTs registradas</h2>
      <div class="rounded-xl border border-slate-800 overflow-hidden overflow-x-auto">
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
            <tr v-if="!oltStore.onts.length">
              <td colspan="6" class="px-4 py-6 text-center text-slate-500">Sin ONTs. Sincroniza un puerto o registra una nueva.</td>
            </tr>
            <tr v-for="ont in oltStore.onts" :key="ont.id" class="border-t border-slate-800">
              <td class="px-4 py-3 font-mono text-xs">{{ ont.frame }}/{{ ont.slot }}/{{ ont.port }}:{{ ont.ont_id }}</td>
              <td class="px-4 py-3 font-mono text-xs">{{ ont.serial }}</td>
              <td class="px-4 py-3 text-slate-400">
                {{ ont.clients ? `${ont.clients.first_name} ${ont.clients.last_name}` : '—' }}
              </td>
              <td class="px-4 py-3">
                <span class="px-2 py-1 rounded-md text-xs font-medium" :class="STATUS_CLASS[ont.status]">{{ ont.status }}</span>
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
      <div v-if="showRegisterModal" class="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
        <form
          class="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 max-h-[90vh] overflow-y-auto"
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
              class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm font-mono"
            />
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-400 mb-1">ID de ONU (vacio = auto)</label>
              <input v-model.number="registerForm.onuId" type="number" min="0" placeholder="auto" class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm" />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">VLAN</label>
              <input v-model.number="registerForm.vlan" type="number" class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm" />
            </div>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-400 mb-1">Tipo de ONU (perfil configurado en la OLT)</label>
            <input
              v-model="registerForm.onuType"
              required
              placeholder="ej. ZTE-F660"
              class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm"
            />
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-400 mb-1">Descripcion</label>
            <input v-model="registerForm.description" placeholder="Nombre del cliente" class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm" />
          </div>

          <p v-if="registerError" class="text-sm text-red-400 mb-3">{{ registerError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-100" @click="showRegisterModal = false">
              Cancelar
            </button>
            <button type="submit" :disabled="registering" class="px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold text-sm disabled:opacity-60">
              {{ registering ? 'Registrando...' : 'Registrar en la OLT' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
