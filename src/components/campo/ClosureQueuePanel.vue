<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useCampoStore } from '@/stores/campo';
import { useAuthStore } from '@/stores/auth';
import { discardFinalRejection, listQueuedClosures, setQueuedIptvMode, type QueuedClosure } from '@/lib/offlineQueue';
import { IPTV_INSTALLATION_OPTIONS, type IptvInstallationMode } from '@/lib/installationIptv';
import { getErrorMessage } from '@/lib/errors';
const campo = useCampoStore(), auth = useAuthStore();
const items = ref<QueuedClosure[]>([]), error = ref(''), busy = ref(false);
const choices = ref<Record<string, IptvInstallationMode | ''>>({});
const expanded = ref<Record<string, boolean>>({});
const previewUrls = ref<Record<string, string[]>>({}); // localId -> object URLs a revocar al recargar/desmontar
async function load() {
  revokePreviews();
  try { items.value = await listQueuedClosures(); error.value = ''; }
  catch (e) { error.value = getErrorMessage(e, 'No se pudieron leer los cierres guardados. No borres datos.'); }
}
function revokePreviews() {
  for (const urls of Object.values(previewUrls.value)) for (const url of urls) URL.revokeObjectURL(url);
  previewUrls.value = {};
}
function toggleReview(item: QueuedClosure) {
  if (expanded.value[item.localId]) { expanded.value[item.localId] = false; return; }
  const all = [...item.photos, ...item.equipmentPhotos];
  previewUrls.value[item.localId] = all.map(p => URL.createObjectURL(p.blob));
  expanded.value[item.localId] = true;
}
const photoLabels = (item: QueuedClosure) => [
  ...item.photos.map(p => p.category),
  ...item.equipmentPhotos.map(p => 'equipo: ' + p.equipmentType),
];
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
async function discard(item: QueuedClosure) {
  if (!confirm('¿Ya revisaste las fotos/notas de este envío y confirmas que esta orden quedó cerrada correctamente? Esta acción borra el pendiente guardado en este dispositivo — no se puede deshacer.')) return;
  busy.value = true;
  try { await discardFinalRejection(item.localId, auth.user?.id); await load(); }
  catch (e) { error.value = getErrorMessage(e); }
  finally { busy.value = false; }
}
watch(() => campo.queuedCount, load);
onMounted(load);
onUnmounted(revokePreviews);
</script>
<template>
  <section v-if="items.length || error || campo.queueError" class="surface p-3 m-3 text-sm" aria-label="Cierres guardados">
    <h2 class="font-semibold">Cierres guardados · {{ items.length }}</h2>
    <p v-if="error || campo.queueError" class="text-red-600" role="alert">{{ error || campo.queueError }}</p>
    <div v-for="item in items" :key="item.localId" class="border-t border-slate-100 py-2">
      <router-link :to="'/campo/' + item.jobType + '/' + item.jobId" class="underline">Revisar {{ item.jobType === 'installation' ? 'Alta' : item.jobType === 'ticket' ? 'Avería' : 'Rutina' }}</router-link>
      <span class="text-xs text-slate-500"> · {{ item.jobId.slice(0, 8) }}</span>

      <template v-if="item.rejectedFinal">
        <p class="text-red-700 font-medium mt-1">Esta orden ya fue cerrada administrativamente por otra vía — no es un error de conexión y no se va a reintentar sola.</p>
        <p class="text-xs text-slate-600">{{ item.lastError }}</p>
        <button type="button" class="btn-secondary text-xs mt-1" @click="toggleReview(item)">{{ expanded[item.localId] ? 'Ocultar contenido guardado' : 'Ver contenido guardado antes de descartar' }}</button>
        <div v-if="expanded[item.localId]" class="mt-2 pl-2 border-l-2 border-slate-200">
          <p v-if="item.closureNotes" class="text-xs"><span class="font-medium">Notas:</span> {{ item.closureNotes }}</p>
          <p v-if="item.justificacionCierre" class="text-xs"><span class="font-medium">Justificación:</span> {{ item.justificacionCierre }}</p>
          <p v-if="item.motivoAveria" class="text-xs"><span class="font-medium">Causa técnica:</span> {{ item.motivoAveria }}<span v-if="item.motivoAveriaDetalle"> — {{ item.motivoAveriaDetalle }}</span></p>
          <div class="flex flex-wrap gap-2 mt-1">
            <figure v-for="(url, i) in previewUrls[item.localId] ?? []" :key="url" class="text-[10px] text-center">
              <img :src="url" class="w-16 h-16 object-cover rounded border border-slate-200" />
              <figcaption>{{ photoLabels(item)[i] }}</figcaption>
            </figure>
            <p v-if="item.signatureBlob" class="text-xs">Incluye firma guardada.</p>
          </div>
          <button type="button" class="btn-secondary text-xs mt-2" :disabled="busy" @click="discard(item)">Ya lo revisé — descartar este pendiente</button>
        </div>
      </template>
      <template v-else>
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
      </template>
    </div>
    <button type="button" class="btn-secondary mt-2" :disabled="busy || campo.syncing" @click="retry">Reintentar pendientes</button>
    <p class="text-xs text-slate-500 mt-1">Un envío rechazado se conserva para revisión; otras órdenes pueden sincronizarse.</p>
  </section>
</template>
