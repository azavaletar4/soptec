<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import CampoLayout from '@/components/campo/CampoLayout.vue';
import { useCampoStore, type TrabajoEstadoUi, type TrabajoItem } from '@/stores/campo';
import { telLink, waLink } from '@/lib/phone';

const router = useRouter();
const campoStore = useCampoStore();

const tabs: { value: TrabajoEstadoUi; label: string }[] = [
  { value: 'pendiente', label: 'Pendientes' },
  { value: 'en_proceso', label: 'En proceso' },
  { value: 'completado', label: 'Completadas' },
];
const activeTab = ref<TrabajoEstadoUi>('pendiente');
const search = ref('');

const filtered = computed(() => {
  let list = campoStore.trabajos.filter((t) => t.estadoUi === activeTab.value);
  const q = search.value.trim().toLowerCase();
  if (q) list = list.filter((t) => `${t.clienteNombre} ${t.direccion ?? ''}`.toLowerCase().includes(q));
  return list;
});

const counts = computed(() => {
  const c: Record<TrabajoEstadoUi, number> = { pendiente: 0, en_proceso: 0, completado: 0 };
  for (const t of campoStore.trabajos) c[t.estadoUi]++;
  return c;
});

function openTrabajo(t: TrabajoItem) {
  router.push(`/campo/${t.jobType}/${t.id}`);
}

function formatFecha(value: string | null) {
  if (!value) return '—';
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short' });
}

onMounted(() => {
  campoStore.fetchAll();
});
</script>

<template>
  <CampoLayout title="Mis trabajos">
    <input v-model="search" placeholder="Buscar cliente o dirección..." class="field-input mb-3" />

    <div class="grid grid-cols-3 gap-2 mb-3">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        class="rounded-xl py-2.5 text-xs font-semibold text-center transition-colors"
        :class="activeTab === tab.value ? 'bg-sky-500 text-slate-950' : 'bg-white border border-slate-200 text-slate-600'"
        @click="activeTab = tab.value"
      >
        {{ tab.label }}
        <span class="block text-[15px] font-bold mt-0.5">{{ counts[tab.value] }}</span>
      </button>
    </div>

    <p v-if="campoStore.loading" class="text-center text-sm text-slate-500 py-8">Cargando...</p>
    <p v-else-if="!filtered.length" class="text-center text-sm text-slate-500 py-8">No hay trabajos en este filtro.</p>

    <ul class="space-y-2.5">
      <li
        v-for="t in filtered"
        :key="`${t.jobType}-${t.id}`"
        class="surface p-3.5 active:scale-[0.99] transition-transform"
        @click="openTrabajo(t)"
      >
        <div class="flex items-start justify-between gap-2 mb-1.5">
          <span
            class="badge text-[10px]"
            :class="t.jobType === 'installation' ? 'bg-sky-500/15 text-sky-700' : 'bg-orange-500/15 text-orange-700'"
          >
            {{ t.jobType === 'installation' ? 'Instalación' : 'Avería' }}
          </span>
          <span class="text-[11px] text-slate-500">{{ formatFecha(t.fecha) }}</span>
        </div>
        <p class="font-semibold text-sm text-slate-900">{{ t.clienteNombre }}</p>
        <p v-if="t.direccion" class="text-xs text-slate-500 mt-0.5">{{ t.direccion }}</p>

        <div class="flex items-center gap-2 mt-3" @click.stop>
          <a
            v-if="t.telefono"
            :href="telLink(t.telefono)"
            class="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium"
          >
            📞 Llamar
          </a>
          <a
            v-if="t.telefono"
            :href="waLink(t.telefono)"
            target="_blank"
            rel="noopener"
            class="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-green-500/15 text-green-700 text-xs font-medium"
          >
            💬 WhatsApp
          </a>
        </div>
      </li>
    </ul>
  </CampoLayout>
</template>
