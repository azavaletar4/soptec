<script setup lang="ts">
import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useTechnicianCustodyStore } from '@/stores/technicianCustody';
import { usePersonalRead } from '@/composables/usePersonalRead';
import { custodyPresentation, custodyQuantity } from '@/lib/custodyPresentation';
const auth = useAuthStore();
const store = useTechnicianCustodyStore();
const identity = computed(() => auth.role === 'TECNICO_RED' ? auth.user?.id ?? null : null);
const { data, loading, error, load } = usePersonalRead(identity, () => store.fetchMyCustody());
const summary = computed(() => data.value ? custodyPresentation(data.value) : null);
</script>

<template>
  <section class="surface p-3 mb-3 min-w-0" aria-labelledby="custodia-resumen-title">
    <router-link to="/campo/mi-custodia" class="block min-h-11 rounded-lg focus-visible:outline-2 focus-visible:outline-sky-600">
      <div class="flex items-center justify-between gap-2 text-sm text-sky-800">
      <h2 id="custodia-resumen-title" class="font-semibold">Mi custodia</h2>
      <span class="text-xs shrink-0">Ver detalle →</span>
      </div>
    <div class="text-xs text-slate-600 leading-5 mt-1" aria-live="polite">
      <p v-if="loading">Consultando tu custodia…</p>
      <template v-else-if="error">
        <p>No se pudo consultar el resumen.</p>
      </template>
      <template v-else-if="summary">
        <p><span class="font-medium text-slate-700">{{ summary.availableEquipment }} equipos disponibles</span><span v-if="summary.pendingEquipment"> · {{ summary.pendingEquipment }} en devolución</span></p>
        <p v-if="summary.materials.length" class="break-words">Materiales: <template v-for="(item, index) in summary.materials" :key="item.unit"><span v-if="index"> · </span>{{ custodyQuantity(item.quantity) }} {{ item.unit }}</template></p>
        <p v-else>Sin materiales disponibles.</p>
      </template>
      <p v-else>Resumen no disponible. Consulta el detalle.</p>
    </div>
    </router-link>
    <button v-if="error" class="text-sky-700 text-xs font-medium min-h-11 px-2 rounded-lg focus-visible:outline-2 focus-visible:outline-sky-600" aria-label="Reintentar resumen de custodia" @click="load">Reintentar</button>
  </section>
</template>
