<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useContractsStore } from '@/stores/contracts';
import { getErrorMessage } from '@/lib/errors';
import type { ContractStatus, ServiceContract } from '@/types/domain';

const contractsStore = useContractsStore();

const COLUMNS: { status: ContractStatus; label: string; accent: string }[] = [
  { status: 'active', label: 'Activos', accent: 'border-green-500/40' },
  { status: 'suspended', label: 'Suspendidos', accent: 'border-red-500/40' },
  { status: 'cancelled', label: 'Cancelados', accent: 'border-slate-500/40' },
];

const draggingId = ref<string | null>(null);

onMounted(() => {
  contractsStore.fetchContracts();
});

function contractsFor(status: ContractStatus) {
  return contractsStore.contracts.filter((c) => c.status === status);
}

function onDragStart(contract: ServiceContract) {
  draggingId.value = contract.id;
}

async function onDrop(status: ContractStatus) {
  const id = draggingId.value;
  draggingId.value = null;
  if (!id) return;

  const contract = contractsStore.contracts.find((c) => c.id === id);
  if (!contract || contract.status === status) return;

  const ok = confirm(
    `¿Cambiar el contrato ${contract.contract_number ?? contract.id} de "${contract.status}" a "${status}"?`,
  );
  if (!ok) return;

  try {
    await contractsStore.updateContractStatus(contract.id, status);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al cambiar el estado del contrato'));
  }
}
</script>

<template>
  <AppLayout>
    <h1 class="text-2xl font-semibold mb-1">Contratos — Kanban</h1>
    <p class="text-slate-400 text-sm mb-6">Arrastra una tarjeta a otra columna para cambiar su estado.</p>

    <p v-if="contractsStore.loading" class="text-slate-500 text-sm">Cargando...</p>

    <div v-else class="grid gap-4" style="grid-template-columns: repeat(auto-fit, minmax(260px, 1fr))">
      <div
        v-for="col in COLUMNS"
        :key="col.status"
        class="rounded-xl border bg-slate-900/50 p-3"
        :class="col.accent"
        @dragover.prevent
        @drop="onDrop(col.status)"
      >
        <div class="flex items-center justify-between mb-3 px-1">
          <h2 class="font-semibold text-sm">{{ col.label }}</h2>
          <span class="text-xs text-slate-500">{{ contractsFor(col.status).length }}</span>
        </div>

        <div class="space-y-2 min-h-[80px]">
          <div
            v-for="ct in contractsFor(col.status)"
            :key="ct.id"
            draggable="true"
            class="rounded-lg border border-slate-800 bg-slate-900 p-3 cursor-grab active:cursor-grabbing"
            @dragstart="onDragStart(ct)"
          >
            <div class="font-medium text-sm">{{ ct.clients?.first_name }} {{ ct.clients?.last_name }}</div>
            <div class="text-xs text-slate-400 mt-1">{{ ct.plans?.name || 'Sin plan' }}</div>
            <div class="text-xs text-slate-500 mt-1 font-mono">{{ ct.contract_number }}</div>
          </div>
          <p v-if="!contractsFor(col.status).length" class="text-xs text-slate-600 italic px-1">Sin contratos</p>
        </div>
      </div>
    </div>
  </AppLayout>
</template>
