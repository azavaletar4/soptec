<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import {
  useMikrotikStore,
  type DhcpLease,
  type PppActive,
  type PppSecret,
  type RouterResource,
} from '@/stores/mikrotik';
import { getErrorMessage } from '@/lib/errors';

const route = useRoute();
const router = useRouter();
const mikrotikStore = useMikrotikStore();

const deviceId = computed(() => route.params.id as string);
const device = computed(() => mikrotikStore.devices.find((d) => d.id === deviceId.value));

const loading = ref(true);
const loadError = ref<string | null>(null);
const resource = ref<RouterResource | null>(null);
const secrets = ref<PppSecret[]>([]);
const active = ref<PppActive[]>([]);
const leases = ref<DhcpLease[]>([]);

const activeByName = computed(() => new Set(active.value.map((a) => a.name)));
// Cruce ONT <-> IP por MAC de WAN: pendiente hasta validar "wan-info" en la OLT real (ver Fase 4).

async function loadAll() {
  loading.value = true;
  loadError.value = null;
  try {
    const [res, sec, act, lea] = await Promise.all([
      mikrotikStore.fetchResource(deviceId.value),
      mikrotikStore.fetchPppSecrets(deviceId.value),
      mikrotikStore.fetchPppActive(deviceId.value),
      mikrotikStore.fetchDhcpLeases(deviceId.value),
    ]);
    resource.value = res;
    secrets.value = sec;
    active.value = act;
    leases.value = lea;
  } catch (e) {
    loadError.value = getErrorMessage(e, 'Error al consultar el router');
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  if (!mikrotikStore.devices.length) await mikrotikStore.fetchDevices();
  await loadAll();
});

async function handleToggleSecret(secret: PppSecret) {
  const willDisable = secret.disabled !== 'true';
  const ok = confirm(`¿${willDisable ? 'Deshabilitar' : 'Habilitar'} el usuario PPPoE "${secret.name}"?`);
  if (!ok) return;
  try {
    await mikrotikStore.togglePppSecret(deviceId.value, secret['.id'], willDisable);
    await loadAll();
  } catch (e) {
    alert(getErrorMessage(e, 'Error al actualizar en el router'));
  }
}
</script>

<template>
  <AppLayout>
    <button class="text-sm text-slate-400 hover:text-slate-100 mb-4" @click="router.push('/mikrotik')">
      ← Volver a MikroTik
    </button>

    <div v-if="!device" class="text-slate-500">Router no encontrado.</div>
    <template v-else>
      <h1 class="text-2xl font-semibold mb-1">{{ device.name }}</h1>
      <p class="text-slate-400 text-sm mb-6">{{ device.host }}:{{ device.port }}</p>

      <p v-if="loadError" class="mb-4 text-sm text-red-400">{{ loadError }}</p>
      <p v-else-if="loading" class="text-slate-500 text-sm mb-6">Consultando el router...</p>

      <template v-else>
        <div class="grid gap-4 mb-8" style="grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))">
          <div class="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div class="text-slate-500 text-xs mb-1">RouterOS</div>
            <div class="text-lg font-semibold">{{ resource?.version ?? '—' }}</div>
          </div>
          <div class="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div class="text-slate-500 text-xs mb-1">CPU</div>
            <div class="text-lg font-semibold">{{ resource?.['cpu-load'] ?? '—' }}%</div>
          </div>
          <div class="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div class="text-slate-500 text-xs mb-1">Memoria libre</div>
            <div class="text-lg font-semibold">{{ resource?.['free-memory'] ?? '—' }}</div>
          </div>
          <div class="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div class="text-slate-500 text-xs mb-1">Uptime</div>
            <div class="text-lg font-semibold">{{ resource?.uptime ?? '—' }}</div>
          </div>
        </div>

        <h2 class="text-lg font-semibold mb-3">Usuarios PPPoE ({{ secrets.length }})</h2>
        <div class="rounded-xl border border-slate-800 overflow-hidden overflow-x-auto mb-8">
          <table class="w-full text-sm min-w-[640px]">
            <thead class="bg-slate-900 text-slate-400 text-xs uppercase">
              <tr>
                <th class="text-left px-4 py-3">Usuario</th>
                <th class="text-left px-4 py-3">Perfil</th>
                <th class="text-left px-4 py-3">Conectado</th>
                <th class="text-left px-4 py-3">Estado</th>
                <th class="text-right px-4 py-3">Accion</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!secrets.length"><td colspan="5" class="px-4 py-6 text-center text-slate-500">Sin usuarios PPPoE.</td></tr>
              <tr v-for="s in secrets" :key="s['.id']" class="border-t border-slate-800">
                <td class="px-4 py-3 font-mono text-xs">{{ s.name }}</td>
                <td class="px-4 py-3 text-slate-400">{{ s.profile }}</td>
                <td class="px-4 py-3">
                  <span
                    class="px-2 py-1 rounded-md text-xs font-medium"
                    :class="activeByName.has(s.name) ? 'bg-green-500/15 text-green-400' : 'bg-slate-500/15 text-slate-400'"
                  >
                    {{ activeByName.has(s.name) ? 'Si' : 'No' }}
                  </span>
                </td>
                <td class="px-4 py-3">
                  <span
                    class="px-2 py-1 rounded-md text-xs font-medium"
                    :class="s.disabled === 'true' ? 'bg-red-500/15 text-red-400' : 'bg-green-500/15 text-green-400'"
                  >
                    {{ s.disabled === 'true' ? 'Deshabilitado' : 'Habilitado' }}
                  </span>
                </td>
                <td class="px-4 py-3 text-right">
                  <button class="text-sky-400 hover:underline text-xs" @click="handleToggleSecret(s)">
                    {{ s.disabled === 'true' ? 'Habilitar' : 'Deshabilitar' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2 class="text-lg font-semibold mb-3">Leases DHCP ({{ leases.length }})</h2>
        <div class="rounded-xl border border-slate-800 overflow-hidden overflow-x-auto">
          <table class="w-full text-sm min-w-[560px]">
            <thead class="bg-slate-900 text-slate-400 text-xs uppercase">
              <tr>
                <th class="text-left px-4 py-3">IP</th>
                <th class="text-left px-4 py-3">MAC</th>
                <th class="text-left px-4 py-3">Hostname</th>
                <th class="text-left px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!leases.length"><td colspan="4" class="px-4 py-6 text-center text-slate-500">Sin leases DHCP.</td></tr>
              <tr v-for="l in leases" :key="l['.id']" class="border-t border-slate-800">
                <td class="px-4 py-3 font-mono text-xs">{{ l.address }}</td>
                <td class="px-4 py-3 font-mono text-xs text-slate-400">{{ l['mac-address'] }}</td>
                <td class="px-4 py-3 text-slate-400">{{ l['host-name'] || '—' }}</td>
                <td class="px-4 py-3 text-slate-400">{{ l.status }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-xs text-slate-500 mt-3">
          Nota: el cruce automatico ONT ↔ IP (por MAC de WAN) llega cuando se valide el comando de
          "wan-info" contra la OLT real (ver Fase 4). Por ahora, la MAC se puede buscar aqui manualmente.
        </p>
      </template>
    </template>
  </AppLayout>
</template>
