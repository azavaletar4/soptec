<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useCampoStore } from '@/stores/campo';
import { useAuthStore } from '@/stores/auth';
import { listQueuedClosures, setQueuedIptvMode, type QueuedClosure } from '@/lib/offlineQueue';
import { IPTV_INSTALLATION_OPTIONS, type IptvInstallationMode } from '@/lib/installationIptv';
import { getErrorMessage } from '@/lib/errors';
const campo = useCampoStore(), auth = useAuthStore();
const items = ref<QueuedClosure[]>([]), error = ref(''), busy = ref(false);
const choices = ref<Record<string, IptvInstallationMode | ''>>({});
async function load() {
  try { items.value = await listQueuedClosures(); error.value = ''; }
  catch (e) { error.value = getErrorMessage(e, 'No se pudieron leer los cierres guardados. No borres datos.'); }
}
async function choose(item: QueuedClosure) {
  const mode = choices.value[item.localId];
  if (!mode) return;
  try { await setQueuedIptvMode(item.localId, mode, auth.user?.id); await load(); }
  catch (e) { error.value = getErrorMessage(e); }
}
async function retry() {
  busy.value = true;
  try { await campo.syncQueued(); await load(); }
  catch (e) { error.value = getErrorMessage(e); }
  finally { busy.value = false; }
}
watch(() => campo.queuedCount, load);
onMounted(load);
</script>
<template>
  <section v-if="items.length || error || campo.queueError" class="surface p-3 m-3 text-sm" aria-label="Cierres guardados">
    <h2 class="font-semibold">Cierres guardados · {{ items.length }}</h2>
    <p v-if="error || campo.queueError" class="text-red-600" role="alert">{{ error || campo.queueError }}</p>
    <div v-for="item in items" :key="item.localId" class="border-t border-slate-100 py-2">
      <router-link :to="'/campo/' + item.jobType + '/' + item.jobId" class="underline">Revisar {{ item.jobType === 'installation' ? 'Alta' : item.jobType === 'ticket' ? 'Avería' : 'Rutina' }}</router-link>
      <span class="text-xs text-slate-500"> · {{ item.jobId.slice(0, 8) }}</span>
      <p v-if="item.lastError" class="text-amber-700">{{ item.lastError }}</p>
      <div v-if="item.jobType === 'installation' && /IPTV|modalidad/i.test(item.lastError ?? '') && (!item.actorId || item.actorId === auth.user?.id)">
        <label class="block mt-1">Modalidad IPTV de este envío guardado
          <select v-model="choices[item.localId]" class="field-input">
            <option value="" disabled>Selecciona...</option>
            <option v-for="option in IPTV_INSTALLATION_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <button type="button" class="btn-secondary text-xs mt-1" :disabled="!choices[item.localId] || busy || campo.syncing" @click="choose(item)">Guardar modalidad sin cambiar fotos ni notas</button>
      </div>
    </div>
    <button type="button" class="btn-secondary mt-2" :disabled="busy || campo.syncing" @click="retry">Reintentar pendientes</button>
    <p class="text-xs text-slate-500 mt-1">Un envío rechazado se conserva para revisión; otras órdenes pueden sincronizarse.</p>
  </section>
</template>
