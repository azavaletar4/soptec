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
  <section v-if="allowed" class="pppoe-section" :class="{ 'is-stale': stale }" aria-labelledby="pppoe-heading" data-testid="pppoe-section" :aria-busy="loading">
    <div class="pppoe-heading">
      <h2 id="pppoe-heading">PPPoE</h2>
      <span class="pppoe-source">Administrador · CCR2116</span>
      <button :disabled="loading" @click="refresh" aria-label="Actualizar PPPoE" title="Actualizar PPPoE" class="pppoe-refresh"><span :class="{ spinning: loading }" aria-hidden="true">↻</span></button>
    </div>
    <div class="pppoe-columns" aria-hidden="true"><span>Perfil</span><span>Conectados</span><span>Registrados</span></div>
    <div class="pppoe-grid">
      <article v-for="card in cards" :key="card.profile" class="pppoe-profile" data-testid="pppoe-card" :data-profile="card.profile">
        <h3>{{ card.label }}</h3>
        <p class="pppoe-value"><span class="sr-only">Conectados: </span><strong data-testid="pppoe-connected">{{ card.connected ?? '—' }}</strong></p>
        <span class="pppoe-label" aria-hidden="true">conectados</span>
        <p class="pppoe-registered"><span class="sr-only">Registrados: </span><strong data-testid="pppoe-registered">{{ card.registered ?? '—' }}</strong><span class="pppoe-label-inline" aria-hidden="true"> registrados</span></p>
        <div class="pppoe-track" aria-hidden="true"><span :style="{ width: card.connected !== null && card.registered ? Math.min(100, card.connected / card.registered * 100) + '%' : '0%' }"></span></div>
      </article>
    </div>
    <div class="pppoe-reading">
      <span role="status" :class="{ warning: stale || reading?.partial }" title="Estado recibido de la fuente; independiente de la consulta general"><i :class="{ fresh: reading?.status === 'fresh' && !stale && !reading.partial }"></i>{{ stateLabel === 'Lectura actual' ? 'Lectura disponible' : stateLabel }}</span>
      <span class="pppoe-date"><span>Lectura PPPoE · </span><time v-if="reading?.lastSuccessAt" :datetime="reading.lastSuccessAt">{{ lastRead }} · Perú</time><span v-else>{{ lastRead }}</span></span>
    </div>
    <p v-if="stale" class="pppoe-stale">Datos desactualizados</p>
    <p v-if="networkError || reading?.message" class="pppoe-message" role="status">
      {{ networkError ? (reading?.lastSuccessAt ? 'No se pudo actualizar. Se conserva la última lectura exitosa.' : 'No se pudo consultar el administrador. Sin datos disponibles.') : reading?.message }}
    </p>
  </section>
</template>

<style scoped>
.pppoe-section { color:var(--dv-ink,#172e40); container:rayco-pppoe / inline-size; }
.pppoe-heading { display:flex; align-items:center; gap:8px; padding:6px 16px; min-height:43px; position:relative; }
.pppoe-heading:before { content:''; position:absolute; left:-1px; height:16px; width:3px; background:var(--dv-brand,#087caa); }
h2 { font-size:13px; font-weight:600; }
.pppoe-source { margin-left:auto; font-size:11px; color:var(--dv-muted,#617585); }
.pppoe-refresh { width:34px; height:34px; border-radius:5px; color:var(--dv-muted,#617585); font-size:22px; }
.pppoe-refresh:hover { background:#f2f6f8; color:var(--dv-brand,#087caa); }
.pppoe-refresh:disabled { opacity:.5; cursor:wait; }
.pppoe-refresh span { display:inline-block; }
.pppoe-columns { display:none; }
.pppoe-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); padding:7px 16px 12px; }
.pppoe-profile { min-width:0; border-left:1px solid var(--dv-line,#dfe7ec); padding:0 14px; }
.pppoe-profile:first-child { padding-left:0; border-left:0; }
.pppoe-profile:last-child { padding-right:0; }
h3 { font-size:12px; font-weight:550; margin-bottom:5px; }
.pppoe-value strong { font-size:40px; line-height:1.1; font-weight:550; letter-spacing:-1.2px; font-variant-numeric:tabular-nums; }
.pppoe-label,.pppoe-registered { font-size:12px; color:var(--dv-muted,#617585); }
.pppoe-label { display:block; margin:1px 0 6px; }
.pppoe-registered strong { font-weight:600; color:var(--dv-ink,#172e40); font-size:14px; font-variant-numeric:tabular-nums; }
.pppoe-track { height:3px; background:#e5edf2; margin-top:10px; overflow:hidden; }
.pppoe-track span { display:block; height:100%; background:var(--dv-brand,#087caa); }
.is-stale .pppoe-track span { background:#956013; }
.pppoe-reading { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:4px 12px; padding:0 16px 12px; font-size:11px; line-height:1.5; color:var(--dv-muted,#617585); }
.pppoe-reading>span:first-child { display:flex; align-items:center; gap:5px; white-space:nowrap; }
.pppoe-reading i { height:5px; width:5px; border-radius:50%; background:#617585; }
.pppoe-reading i.fresh { background:#26785c; }
.pppoe-reading .warning { color:#956013; }
.pppoe-date { text-align:right; font-variant-numeric:tabular-nums; }
.pppoe-date>span:first-child { font-weight:600; }
.pppoe-date time { white-space:nowrap; }
.pppoe-message { margin:0 16px 12px; padding:7px 9px; border-radius:4px; background:#fbf5e9; color:#956013; font-size:11px; }
.pppoe-stale { color:#956013; font-size:11px; margin:-6px 16px 8px; }
button:focus-visible { outline:2px solid #087caa; outline-offset:2px; }
@container rayco-pppoe (max-width:540px) {
  .pppoe-heading { padding:4px 12px; min-height:39px; }
  .pppoe-source { font-size:11px; }
  .pppoe-columns { display:grid; grid-template-columns:1fr 78px 80px; gap:6px; padding:0 12px 5px; font-size:11px; color:#617585; }
  .pppoe-columns span:not(:first-child) { text-align:right; }
  .pppoe-grid { display:block; padding:0 12px 5px; }
  .pppoe-profile,.pppoe-profile:first-child,.pppoe-profile:last-child { display:grid; grid-template-columns:1fr 78px 80px; align-items:center; gap:6px; padding:5px 0; min-height:40px; border:0; border-top:1px solid #dfe7ec; }
  h3 { margin:0; font-size:12px; }
  .pppoe-value { text-align:right; }
  .pppoe-value strong { font-size:26px; line-height:1.1; letter-spacing:-.5px; }
  .pppoe-label,.pppoe-label-inline,.pppoe-track { display:none; }
  .pppoe-registered { text-align:right; }
  .pppoe-registered strong { font-size:18px; font-weight:400; color:#617585; }
  .pppoe-reading { padding:4px 12px 9px; font-size:11px; }
  .pppoe-message { margin:0 12px 10px; font-size:11px; }
}
@media(max-width:359px) {
  .pppoe-columns,.pppoe-profile,.pppoe-profile:first-child,.pppoe-profile:last-child { grid-template-columns:1fr 65px 67px; gap:4px; }
  .pppoe-columns { font-size:11px; }
  h3 { font-size:11px; }
  .pppoe-reading { flex-wrap:wrap; }
  .pppoe-date { margin-left:auto; }
}
@media(prefers-reduced-motion:no-preference) {
  .spinning { animation:pppoe-spin 1s linear infinite; }
  @keyframes pppoe-spin { to { transform:rotate(360deg); } }
}
</style>
