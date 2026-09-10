<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useClientsStore } from '@/stores/clients';
import { useContractsStore } from '@/stores/contracts';
import { useCatalogsStore } from '@/stores/catalogs';
import { getErrorMessage } from '@/lib/errors';
import type { ContractStatus, ServiceContract } from '@/types/domain';

const route = useRoute();
const router = useRouter();
const clientsStore = useClientsStore();
const contractsStore = useContractsStore();
const catalogs = useCatalogsStore();

const clientId = computed(() => route.params.id as string);
const client = computed(() => clientsStore.clients.find((c) => c.id === clientId.value));
const contracts = ref<ServiceContract[]>([]);
const loadingContracts = ref(true);

const showContractModal = ref(false);
const savingContract = ref(false);
const contractError = ref<string | null>(null);
const contractForm = ref({
  plan_id: '',
  monthly_fee: 0,
  billing_day: 1,
  payment_method: 'cash',
});

const STATUS_LABEL: Record<ContractStatus, string> = {
  active: 'Activo',
  suspended: 'Suspendido',
  cancelled: 'Cancelado',
};
const STATUS_CLASS: Record<ContractStatus, string> = {
  active: 'bg-green-500/15 text-green-400',
  suspended: 'bg-red-500/15 text-red-400',
  cancelled: 'bg-slate-500/15 text-slate-400',
};

async function loadContracts() {
  loadingContracts.value = true;
  contracts.value = await contractsStore.fetchContractsByClient(clientId.value);
  loadingContracts.value = false;
}

onMounted(async () => {
  if (!clientsStore.clients.length) await clientsStore.fetchClients();
  await Promise.all([catalogs.fetchPlans(), loadContracts()]);
});

function openContractModal() {
  const firstPlan = catalogs.plans[0];
  contractForm.value = {
    plan_id: firstPlan?.id ?? '',
    monthly_fee: firstPlan ? Number(firstPlan.price) : 0,
    billing_day: 1,
    payment_method: 'cash',
  };
  contractError.value = null;
  showContractModal.value = true;
}

function onPlanChange() {
  const plan = catalogs.plans.find((p) => p.id === contractForm.value.plan_id);
  if (plan) contractForm.value.monthly_fee = Number(plan.price);
}

async function handleCreateContract() {
  savingContract.value = true;
  contractError.value = null;
  try {
    await contractsStore.createContract({
      client_id: clientId.value,
      plan_id: contractForm.value.plan_id || null,
      monthly_fee: contractForm.value.monthly_fee,
      billing_day: contractForm.value.billing_day,
      payment_method: contractForm.value.payment_method,
    });
    showContractModal.value = false;
    await loadContracts();
  } catch (e) {
    contractError.value = getErrorMessage(e, 'Error al crear el contrato');
  } finally {
    savingContract.value = false;
  }
}
</script>

<template>
  <AppLayout>
    <button class="text-sm text-slate-400 hover:text-slate-100 mb-4" @click="router.push('/clientes')">
      ← Volver a clientes
    </button>

    <div v-if="!client" class="text-slate-500">Cliente no encontrado.</div>
    <template v-else>
      <div class="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 class="text-2xl font-semibold">{{ client.first_name }} {{ client.last_name }}</h1>
          <p class="text-slate-400 text-sm mt-1">
            {{ client.document_type.toUpperCase() }} {{ client.document_number }} · {{ client.phone || 'sin telefono' }}
          </p>
        </div>
        <button class="px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold text-sm" @click="openContractModal">
          + Nuevo contrato
        </button>
      </div>

      <div class="grid gap-4 mb-8 text-sm" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))">
        <div class="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div class="text-slate-500 text-xs mb-1">Correo</div>
          <div>{{ client.email || '—' }}</div>
        </div>
        <div class="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div class="text-slate-500 text-xs mb-1">Direccion</div>
          <div>{{ client.address || '—' }}</div>
        </div>
        <div class="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div class="text-slate-500 text-xs mb-1">Zona</div>
          <div>{{ client.zones?.name || '—' }}</div>
        </div>
      </div>

      <h2 class="text-lg font-semibold mb-3">Contratos e historial</h2>
      <p v-if="loadingContracts" class="text-slate-500 text-sm">Cargando...</p>
      <p v-else-if="!contracts.length" class="text-slate-500 text-sm">Este cliente aun no tiene contratos.</p>
      <div v-else class="rounded-xl border border-slate-800 overflow-hidden overflow-x-auto">
        <table class="w-full text-sm min-w-[560px]">
          <thead class="bg-slate-900 text-slate-400 text-xs uppercase">
            <tr>
              <th class="text-left px-4 py-3">Contrato</th>
              <th class="text-left px-4 py-3">Plan</th>
              <th class="text-left px-4 py-3">Mensualidad</th>
              <th class="text-left px-4 py-3">Inicio</th>
              <th class="text-left px-4 py-3">Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ct in contracts" :key="ct.id" class="border-t border-slate-800">
              <td class="px-4 py-3 font-mono text-xs">{{ ct.contract_number }}</td>
              <td class="px-4 py-3">{{ ct.plans?.name || '—' }}</td>
              <td class="px-4 py-3">${{ Number(ct.monthly_fee).toFixed(2) }}</td>
              <td class="px-4 py-3 text-slate-400">{{ ct.start_date }}</td>
              <td class="px-4 py-3">
                <span class="px-2 py-1 rounded-md text-xs font-medium" :class="STATUS_CLASS[ct.status]">
                  {{ STATUS_LABEL[ct.status] }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <Teleport to="body">
      <div v-if="showContractModal" class="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
        <form class="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6" @submit.prevent="handleCreateContract">
          <h2 class="text-lg font-semibold mb-4">Nuevo contrato</h2>

          <div class="mb-3">
            <label class="block text-xs text-slate-400 mb-1">Plan</label>
            <select
              v-model="contractForm.plan_id"
              required
              class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm"
              @change="onPlanChange"
            >
              <option value="" disabled>Selecciona un plan</option>
              <option v-for="p in catalogs.plans" :key="p.id" :value="p.id">
                {{ p.name }} — ↓{{ p.download_speed }}/↑{{ p.upload_speed }} Mbps — ${{ Number(p.price).toFixed(2) }}
              </option>
            </select>
            <p v-if="!catalogs.plans.length" class="text-xs text-amber-400 mt-1">
              No hay planes activos. Crea uno primero en Supabase (tabla <code>plans</code>).
            </p>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Mensualidad (USD)</label>
              <input
                v-model.number="contractForm.monthly_fee"
                type="number"
                step="0.01"
                min="0"
                required
                class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm"
              />
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Dia de corte</label>
              <input
                v-model.number="contractForm.billing_day"
                type="number"
                min="1"
                max="28"
                required
                class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm"
              />
            </div>
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-400 mb-1">Metodo de pago</label>
            <select v-model="contractForm.payment_method" class="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-sm">
              <option value="cash">Efectivo</option>
              <option value="transfer">Transferencia</option>
              <option value="card">Tarjeta</option>
            </select>
          </div>

          <p v-if="contractError" class="text-sm text-red-400 mb-3">{{ contractError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-100" @click="showContractModal = false">
              Cancelar
            </button>
            <button type="submit" :disabled="savingContract" class="px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold text-sm disabled:opacity-60">
              {{ savingContract ? 'Guardando...' : 'Crear contrato' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
