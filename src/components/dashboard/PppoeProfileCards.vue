<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { apiFetch } from '@/lib/api';
import { PPPOE_DASHBOARD_PROFILES, formatPppoeReading, type PppoeProfileResult } from '@/lib/pppoeProfileCounts';

const auth = useAuthStore();
// Mismos permisos de lectura que /api/dashboard. Facturacion no los tiene.
const allowed = computed(() => ['SUPERADMIN', 'ADMIN', 'SOPORTE', 'TECNICO_RED'].includes(auth.role ?? ''));
const reading = ref<PppoeProfileResult | null>(null);
const loading = ref(false);
const networkError = ref(false);
let mounted = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | undefined;
let generation = 0;
const cards = computed(() => PPPOE_DASHBOARD_PROFILES.map(profile => ({ ...profile,
  registered: reading.value?.profiles.find(row => row.profile === profile.profile)?.registered ?? null,
  connected: reading.value?.profiles.find(row => row.profile === profile.profile)?.connected ?? null,
})));
const stale = computed(() => reading.value?.status === 'stale' || networkError.value && !!reading.value?.lastSuccessAt);
const stateLabel = computed(() => stale.value ? 'Desactualizado' : reading.value?.status === 'fresh'
  ? reading.value.partial ? 'Lectura parcial' : 'Lectura actual' : loading.value ? 'Consultando' : 'Sin datos');
const lastRead = computed(() => formatPppoeReading(reading.value?.lastSuccessAt ?? null));

async function refresh() {
  if (!mounted || !allowed.value || loading.value) return;
  if (timer) clearTimeout(timer);
  const request = ++generation;
  controller = new AbortController();
  loading.value = true;
  try {
    const result = await apiFetch<PppoeProfileResult>('/api/dashboard/pppoe-profiles', { signal: controller.signal }, 25_000);
    if (!mounted || request !== generation) return;
    reading.value = result;
    networkError.value = false;
  } catch (error) {
    if (!mounted || request !== generation) return;
    if (error && typeof error === 'object' && 'status' in error && [401, 403].includes(Number(error.status))) reading.value = null;
    networkError.value = true;
  } finally {
    if (mounted && request === generation) {
      loading.value = false;
      // 60 s desde completar la lectura: no se solapa ni cae antes del TTL.
      timer = setTimeout(refresh, 60_000);
    }
  }
}
function stop() {
  generation++;
  if (timer) clearTimeout(timer);
  controller?.abort();
  loading.value = false;
}
watch(allowed, enabled => {
  if (!enabled) { stop(); reading.value = null; networkError.value = false; }
  else if (mounted) void refresh();
});
onMounted(() => { mounted = true; void refresh(); });
onUnmounted(() => { mounted = false; stop(); });
</script>

<template>
  <section v-if="allowed" class="mb-8" aria-labelledby="pppoe-heading" data-testid="pppoe-section">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      <div>
        <h2 id="pppoe-heading" class="text-sm font-semibold text-slate-800">Clientes PPPoE por perfil</h2>
        <p class="text-xs text-slate-500 mt-0.5">MikroTik Administrador CCR2116 · actualización cada 60 s</p>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-xs rounded-full px-2.5 py-1" :class="stale || reading?.partial ? 'bg-amber-50 text-amber-800' : reading?.status === 'fresh' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'" role="status">{{ stateLabel }}</span>
        <button class="text-xs font-medium text-sky-700 disabled:text-slate-400" :disabled="loading" @click="refresh">Actualizar</button>
      </div>
    </div>
    <p v-if="networkError || reading?.message" class="text-xs text-amber-800 mb-3" role="status">
      {{ networkError ? (reading?.lastSuccessAt ? 'No se pudo actualizar. Se conserva la última lectura exitosa.' : 'No se pudo consultar el administrador. Sin datos disponibles.') : reading?.message }}
    </p>
    <div class="grid grid-cols-1 min-[360px]:grid-cols-2 lg:grid-cols-4 gap-3">
      <article v-for="card in cards" :key="card.profile" class="surface min-w-0 p-4 border-t-2" :class="stale ? 'border-t-amber-400' : 'border-t-sky-500'" data-testid="pppoe-card">
        <h3 class="text-sm font-semibold text-slate-700">{{ card.label }}</h3>
        <div class="flex items-baseline gap-2 mt-2">
          <strong class="text-3xl font-semibold tracking-tight tabular-nums text-slate-900" data-testid="pppoe-connected">{{ card.connected ?? '—' }}</strong>
          <span class="text-xs text-slate-500">conectados</span>
        </div>
        <p class="text-sm text-slate-600 mt-1"><span class="font-medium tabular-nums">{{ card.registered ?? '—' }}</span> registrados</p>
        <p class="text-[11px] text-slate-500 mt-3 leading-relaxed">Última lectura exitosa:<br><span class="tabular-nums">{{ lastRead }}{{ reading?.lastSuccessAt ? ' · Perú' : '' }}</span></p>
        <p v-if="stale" class="text-xs font-medium text-amber-800 mt-1">Datos desactualizados</p>
      </article>
    </div>
  </section>
</template>
