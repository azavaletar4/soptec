<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useCatalogsStore } from '@/stores/catalogs';
import { useInfraElementosStore } from '@/stores/infraElementos';
import { useOltStore } from '@/stores/olt';
import { useMapImportStore } from '@/stores/mapImport';
import { getErrorMessage } from '@/lib/errors';
import { INFRA_LABEL } from './mapIcons';

const catalogs = useCatalogsStore();
const infraStore = useInfraElementosStore();
const oltStore = useOltStore();
const mapImport = useMapImportStore();

const loadingBase = ref(true);
const commitError = ref<string | null>(null);
const reverting = ref(false);
const expanded = ref<Record<string, boolean>>({});

onMounted(async () => {
  await Promise.all([catalogs.fetchZones(), infraStore.fetchElementos(), oltStore.fetchDevices()]);
  loadingBase.value = false;
});

function toggleExpanded(name: string) {
  expanded.value[name] = !expanded.value[name];
}

async function handleFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  await mapImport.loadFile(file);
}

async function handleCommit() {
  commitError.value = null;
  const ok = confirm(
    `Vas a crear ${mapImport.totals.create} elemento(s) nuevo(s), actualizar ${mapImport.totals.update} y crear ${mapImport.totals.lines} cable(s) en la base de datos real. ¿Continuar?`,
  );
  if (!ok) return;
  try {
    await mapImport.commit();
  } catch (e) {
    commitError.value = getErrorMessage(e, 'Error al importar');
  }
}

async function handleRevert() {
  if (!mapImport.lastResult) return;
  const ok = confirm('¿Deshacer esta importación? Se eliminarán solo los elementos y cables que ella creó (lo que solo actualizó posición no se toca).');
  if (!ok) return;
  reverting.value = true;
  try {
    await mapImport.revertBatch(mapImport.lastResult.batchId);
  } catch (e) {
    commitError.value = getErrorMessage(e, 'Error al deshacer la importación');
  } finally {
    reverting.value = false;
  }
}

function startOver() {
  mapImport.reset();
  commitError.value = null;
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Importar mapa desde KML/KMZ</h1>
        <p class="text-slate-600 text-sm mt-1">
          Sube el archivo exportado de Google Earth. Se muestra una vista previa (nada se guarda) antes de confirmar.
        </p>
      </div>
      <RouterLink to="/mapa/red" class="btn-secondary text-xs">← Volver al Mapa de Red</RouterLink>
    </div>

    <p v-if="loadingBase" class="text-slate-500 text-sm">Cargando...</p>

    <template v-else>
      <div v-if="!mapImport.parsed" class="surface p-6 mb-6">
        <label class="field-label">Archivo .kml o .kmz</label>
        <input type="file" accept=".kml,.kmz" class="field-input" :disabled="mapImport.parsing" @change="handleFileChange" />
        <p v-if="mapImport.parsing" class="text-xs text-slate-500 mt-2">Leyendo archivo...</p>
        <p v-if="mapImport.parseError" class="text-xs text-red-600 mt-2">{{ mapImport.parseError }}</p>
        <p class="text-xs text-slate-400 mt-3">
          Se reconocen puntos "NAP ..." (caja NAP), "MUFA ..." (manga/empalme) y trazados de cable por carpeta. Cada
          carpeta de primer nivel del KML se intenta emparejar con una Zona existente — la puedes corregir abajo antes
          de confirmar.
        </p>
      </div>

      <template v-else-if="!mapImport.lastResult">
        <div class="surface p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
          <div class="text-sm text-slate-600">
            <b>{{ mapImport.parsed.sourceFilename }}</b> — {{ mapImport.totals.create }} nuevo(s),
            {{ mapImport.totals.update }} a actualizar,
            <span :class="mapImport.totals.conflict ? 'text-amber-600 font-medium' : ''">{{ mapImport.totals.conflict }} conflicto(s) (se omiten)</span>,
            {{ mapImport.totals.lines }} cable(s) a crear.
          </div>
          <div class="flex gap-2">
            <button class="btn-ghost text-xs" @click="startOver">Cancelar</button>
            <button class="btn-primary text-xs" :disabled="mapImport.committing" @click="handleCommit">
              {{ mapImport.committing ? 'Importando...' : 'Confirmar importación' }}
            </button>
          </div>
        </div>

        <p v-if="commitError" class="text-sm text-red-600 mb-4">{{ commitError }}</p>

        <div class="table-shell mb-6">
          <table class="w-full text-sm min-w-[720px]">
            <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
              <tr>
                <th class="text-left px-4 py-3">Carpeta (KML)</th>
                <th class="text-left px-4 py-3">Zona destino</th>
                <th class="text-left px-4 py-3">Elementos</th>
                <th class="text-left px-4 py-3">Cables</th>
                <th class="text-center px-4 py-3">Incluir</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="folder in mapImport.preview" :key="folder.name">
                <tr class="border-t border-slate-200 hover:bg-slate-50">
                  <td class="px-4 py-3">
                    <button class="text-xs text-sky-600 hover:underline font-medium" @click="toggleExpanded(folder.name)">
                      {{ expanded[folder.name] ? '▾' : '▸' }} {{ folder.name }}
                    </button>
                  </td>
                  <td class="px-4 py-3">
                    <select v-model="mapImport.folderZoneChoice[folder.name]" class="field-input !py-1 !text-xs" :disabled="!folder.include">
                      <option value="">Sin zona</option>
                      <option :value="mapImport.NEW_ZONE">+ Crear zona "{{ folder.name }}"</option>
                      <option v-for="z in catalogs.zones" :key="z.id" :value="z.id">{{ z.name }}</option>
                    </select>
                    <p v-if="folder.zoneSuggestion && folder.zoneChoice !== folder.zoneSuggestion.zoneId" class="text-[11px] text-slate-400 mt-0.5">
                      sugerido: {{ folder.zoneSuggestion.zoneName }}
                    </p>
                  </td>
                  <td class="px-4 py-3 text-xs text-slate-600">
                    <span class="text-green-600">{{ folder.counts.create }} nuevo</span> ·
                    <span class="text-sky-600">{{ folder.counts.update }} actualizar</span>
                    <span v-if="folder.counts.conflict" class="text-amber-600"> · {{ folder.counts.conflict }} conflicto</span>
                  </td>
                  <td class="px-4 py-3 text-xs text-slate-600">{{ folder.counts.lines }}</td>
                  <td class="px-4 py-3 text-center">
                    <input v-model="mapImport.folderInclude[folder.name]" type="checkbox" />
                  </td>
                </tr>
                <tr v-if="expanded[folder.name]" class="border-t border-slate-100 bg-slate-50/60">
                  <td colspan="5" class="px-4 py-3">
                    <div v-if="folder.points.length" class="mb-3">
                      <p class="text-xs font-semibold text-slate-500 mb-1">Elementos</p>
                      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                        <div v-for="pp in folder.points" :key="pp.kmlRef" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                          <div class="flex items-center justify-between gap-2">
                            <span class="font-medium text-slate-700 truncate" :title="pp.point.name">{{ pp.point.name }}</span>
                            <span
                              class="badge shrink-0"
                              :class="{
                                'bg-green-500/15 text-green-600': pp.match.action === 'create',
                                'bg-sky-500/15 text-sky-600': pp.match.action === 'update',
                                'bg-amber-500/15 text-amber-600': pp.match.action === 'conflict',
                              }"
                            >
                              {{ pp.match.action === 'create' ? 'Nuevo' : pp.match.action === 'update' ? 'Actualizar' : 'Conflicto' }}
                            </span>
                          </div>
                          <p class="text-slate-400 mt-0.5">{{ INFRA_LABEL[pp.tipo] }}</p>
                          <p v-if="pp.match.reason" class="text-slate-400">
                            {{ pp.match.reason }}<span v-if="pp.match.distanceMeters != null"> ({{ Math.round(pp.match.distanceMeters) }} m)</span>
                          </p>
                        </div>
                      </div>
                    </div>
                    <div v-if="folder.lines.length">
                      <p class="text-xs font-semibold text-slate-500 mb-1">Cables ({{ folder.lines.length }})</p>
                      <div class="space-y-1">
                        <div v-for="(pl, i) in folder.lines" :key="pl.kmlRef" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs flex flex-wrap items-center gap-2">
                          <span class="font-medium text-slate-700">#{{ i + 1 }} {{ pl.tipo }}</span>
                          <span class="text-slate-400">{{ pl.hilosTotal }} hilos{{ pl.hilosGuessed ? ' (estimado)' : '' }} · ~{{ pl.metraje }} m</span>
                          <span class="text-slate-400">origen: {{ pl.origenHint ? `${pl.origenHint.label} (${Math.round(pl.origenHint.distanceMeters)} m)` : 'sin detectar' }}</span>
                          <span class="text-slate-400">destino: {{ pl.destinoHint ? `${pl.destinoHint.label} (${Math.round(pl.destinoHint.distanceMeters)} m)` : 'sin detectar' }}</span>
                        </div>
                      </div>
                    </div>
                    <p v-if="!folder.points.length && !folder.lines.length" class="text-xs text-slate-400">Sin elementos reconocidos en esta carpeta.</p>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </template>

      <div v-else class="surface p-6">
        <h2 class="text-lg font-semibold mb-3">Importación completada</h2>
        <ul class="text-sm text-slate-600 space-y-1 mb-4">
          <li>✅ {{ mapImport.lastResult.created }} elemento(s) creado(s)</li>
          <li>🔄 {{ mapImport.lastResult.updated }} elemento(s) actualizado(s)</li>
          <li>🧵 {{ mapImport.lastResult.cablesCreated }} cable(s) creado(s)</li>
          <li v-if="mapImport.lastResult.skipped">⚠ {{ mapImport.lastResult.skipped }} omitido(s) (conflictos o errores)</li>
        </ul>
        <div v-if="mapImport.lastResult.errors.length" class="mb-4">
          <p class="text-xs font-semibold text-amber-600 mb-1">Detalle de lo omitido:</p>
          <ul class="text-xs text-slate-500 space-y-0.5 max-h-40 overflow-y-auto">
            <li v-for="(err, i) in mapImport.lastResult.errors" :key="i">{{ err.ref }} — {{ err.message }}</li>
          </ul>
        </div>
        <p v-if="commitError" class="text-sm text-red-600 mb-3">{{ commitError }}</p>
        <div class="flex gap-2">
          <button class="btn-secondary text-sm" :disabled="reverting" @click="handleRevert">
            {{ reverting ? 'Deshaciendo...' : 'Deshacer esta importación' }}
          </button>
          <button class="btn-primary text-sm" @click="startOver">Importar otro archivo</button>
          <RouterLink to="/mapa/red" class="btn-ghost text-sm">Ver en el mapa →</RouterLink>
        </div>
      </div>
    </template>
  </AppLayout>
</template>
