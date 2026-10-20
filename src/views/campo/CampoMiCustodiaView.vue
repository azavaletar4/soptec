<script setup lang="ts">
import { computed } from 'vue';
import CampoLayout from '@/components/campo/CampoLayout.vue';
import { useAuthStore } from '@/stores/auth';
import { useTechnicianCustodyStore } from '@/stores/technicianCustody';
import { usePersonalRead } from '@/composables/usePersonalRead';
const auth = useAuthStore();
const store = useTechnicianCustodyStore();
const identity = computed(() => auth.role === 'TECNICO_RED' ? auth.user?.id ?? null : null);
const { data, loading, error, load } = usePersonalRead(identity, async () => {
  const custody = await store.fetchMyCustody();
  if (!custody) throw new Error('Sin respuesta de custodia');
  return custody;
});
const status: Record<string, string> = { with_technician: 'En tu custodia', pending_return: 'Devolución en espera de recepción' };
</script>

<template>
  <CampoLayout title="Mi custodia" show-back>
    <div class="flex items-center justify-between mb-3 gap-2">
      <p class="text-xs text-slate-500">Solo consulta · equipos y materiales</p>
      <button class="btn-secondary text-xs" :disabled="loading" @click="load">Actualizar</button>
    </div>
    <p v-if="loading" role="status" class="text-sm text-slate-500 py-4">Consultando tu custodia…</p>
    <p v-else-if="error" role="alert" class="text-sm text-red-700">No se pudo consultar tu custodia. Intenta actualizar.</p>
    <template v-else-if="data">
      <section class="surface p-3 mb-3">
        <h2 class="text-sm font-semibold mb-2">Equipos serializados · {{ data.units.length }}</h2>
        <p v-if="!data.units.length" class="text-xs text-slate-500">No tienes equipos en custodia.</p>
        <ul class="divide-y divide-slate-100">
          <li v-for="u in data.units" :key="u.id" class="py-2 min-w-0">
            <p class="text-sm font-medium break-words">{{ u.product.name }}</p>
            <p class="text-xs text-slate-600 break-all">Serie: {{ u.serial_number || 'Sin registro' }}</p>
            <p class="text-xs text-slate-600 break-all">MAC: {{ u.mac_address || 'Sin registro' }}</p>
            <p class="text-xs text-slate-500">{{ status[u.status] || u.status }}</p>
          </li>
        </ul>
      </section>
      <section class="surface p-3">
        <h2 class="text-sm font-semibold mb-2">Materiales disponibles · {{ data.materials.length }}</h2>
        <p v-if="!data.materials.length" class="text-xs text-slate-500">No tienes materiales disponibles.</p>
        <ul class="divide-y divide-slate-100">
          <li v-for="m in data.materials" :key="m.product.id" class="py-2 text-sm break-words">
            <p class="font-medium">{{ m.product.name }}</p>
            <p class="text-slate-600">{{ m.quantity }} {{ m.product.unit }}</p>
          </li>
        </ul>
      </section>
    </template>
  </CampoLayout>
</template>
