<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import ClientServiceDetailView from './ClientServiceDetailView.vue';
import ClientStatCard from '@/components/clientes/ClientStatCard.vue';
import { useClientsStore } from '@/stores/clients';
import { useContractsStore } from '@/stores/contracts';
import { useCatalogsStore } from '@/stores/catalogs';
import { useDescuentosCompensacionStore } from '@/stores/descuentosCompensacion';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/lib/errors';
import type { ClientStatus, ContractStatus, DocumentType, ServiceContract } from '@/types/domain';

// Ficha del CLIENTE (titular): datos que son del mismo para todos sus
// servicios (nombre, documento, contacto, saldo a favor) + el listado de
// "Puntos de Servicio" para elegir cual editar. Fase 37: cada servicio ya no
// se edita aca — tiene su propia pagina independiente
// (ClientServiceDetailView.vue) para que un cliente con 2+ lineas no las vea
// todas amontonadas en una sola pantalla ni corra el riesgo de editar los
// datos de una casa pensando que es la otra.
const route = useRoute();
const router = useRouter();
const clientsStore = useClientsStore();
const contractsStore = useContractsStore();
const catalogs = useCatalogsStore();
const descuentosStore = useDescuentosCompensacionStore();
const auth = useAuthStore();

const canManageServices = computed(() => auth.role !== 'TECNICO_RED');
const canApplyAveria = computed(() => auth.role === 'SUPERADMIN' || auth.role === 'ADMIN');

const clientId = computed(() => route.params.id as string);
const client = computed(() => clientsStore.clients.find((c) => c.id === clientId.value));
const contracts = ref<ServiceContract[]>([]);
const loadingContracts = ref(true);
const updatingClientStatus = ref(false);
const clientStatusError = ref<string | null>(null);

const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  cedula: 'DNI',
  ruc: 'RUC',
  pasaporte: 'Pasaporte',
};
const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = {
  prospect: 'Prospecto',
  active: 'Activo',
  suspended: 'Suspendido',
  retired: 'Baja',
};
const CLIENT_STATUS_CLASS: Record<ClientStatus, string> = {
  prospect: 'bg-yellow-500/15 text-yellow-600',
  active: 'bg-green-500/15 text-green-600',
  suspended: 'bg-red-500/15 text-red-600',
  retired: 'bg-slate-500/15 text-slate-600',
};
const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  active: 'Activo',
  suspended: 'Suspendido',
  cancelled: 'Cancelado',
};
const CONTRACT_STATUS_CLASS: Record<ContractStatus, string> = {
  active: 'bg-green-500/15 text-green-600',
  suspended: 'bg-red-500/15 text-red-600',
  cancelled: 'bg-slate-500/15 text-slate-600',
};

async function handleClientStatusChange(status: ClientStatus) {
  if (!client.value) return;
  updatingClientStatus.value = true;
  clientStatusError.value = null;
  try {
    await clientsStore.updateClient(client.value.id, { status });
  } catch (e) {
    clientStatusError.value = getErrorMessage(e, 'Error al cambiar el estado del cliente');
  } finally {
    updatingClientStatus.value = false;
  }
}

async function loadContracts() {
  loadingContracts.value = true;
  contracts.value = await contractsStore.fetchContractsByClient(clientId.value);
  loadingContracts.value = false;
}

// ---- Descuento por averia — compensacion para TODO el cliente (Fase 34) ----
// Para un descuento que solo debe afectar UNA linea, se crea desde la
// pestaña "Descuentos" de esa ficha de servicio (Fase 37), no aca.
const showAveriaModal = ref(false);
const averiaForm = ref({ monto: 0, motivo: '' });
const averiaSaving = ref(false);
const averiaError = ref<string | null>(null);
const averiaOk = ref(false);

function openAveriaModal() {
  averiaForm.value = { monto: 0, motivo: '' };
  averiaError.value = null;
  averiaOk.value = false;
  showAveriaModal.value = true;
}

async function handleAveriaSubmit() {
  if (averiaForm.value.monto <= 0 || !averiaForm.value.motivo.trim()) return;
  averiaSaving.value = true;
  averiaError.value = null;
  try {
    await descuentosStore.createIndividual(clientId.value, averiaForm.value.monto, averiaForm.value.motivo.trim());
    averiaOk.value = true;
  } catch (e) {
    averiaError.value = getErrorMessage(e, 'Error al registrar el descuento');
  } finally {
    averiaSaving.value = false;
  }
}

// ---- Nuevo servicio: alta minima, el resto (ubicacion/equipo/descuentos) ----
// se completa en la ficha propia del servicio recien creado, a la que se
// entra automaticamente al guardar.
const showNewServiceModal = ref(false);
const newServiceForm = ref({ plan_id: '', monthly_fee: 0, billing_day: 1, payment_method: 'cash' });
const savingNewService = ref(false);
const newServiceError = ref<string | null>(null);

function openNewServiceModal() {
  const firstPlan = catalogs.plans[0];
  newServiceForm.value = {
    plan_id: firstPlan?.id ?? '',
    monthly_fee: firstPlan ? Number(firstPlan.price) : 0,
    billing_day: 1,
    payment_method: 'cash',
  };
  newServiceError.value = null;
  showNewServiceModal.value = true;
}

function onNewServicePlanChange() {
  const plan = catalogs.plans.find((p) => p.id === newServiceForm.value.plan_id);
  if (plan) newServiceForm.value.monthly_fee = Number(plan.price);
}

async function handleCreateNewService() {
  savingNewService.value = true;
  newServiceError.value = null;
  try {
    const created = await contractsStore.createContract({
      client_id: clientId.value,
      plan_id: newServiceForm.value.plan_id || null,
      monthly_fee: newServiceForm.value.monthly_fee,
      billing_day: newServiceForm.value.billing_day,
      payment_method: newServiceForm.value.payment_method,
      // Punto de partida = la direccion/GPS del titular; se ajusta en la
      // pestaña Ubicación de la ficha del servicio si esta linea va en una
      // casa distinta.
      installation_address: client.value?.address ?? null,
      latitude: client.value?.latitude ?? null,
      longitude: client.value?.longitude ?? null,
      zone_id: client.value?.zone_id ?? null,
    });
    router.push(`/clientes/${clientId.value}/servicios/${created.id}`);
  } catch (e) {
    newServiceError.value = getErrorMessage(e, 'Error al crear el servicio');
  } finally {
    savingNewService.value = false;
  }
}

onMounted(async () => {
  if (!clientsStore.clients.length) await clientsStore.fetchClients();
  await Promise.all([catalogs.fetchPlans(), loadContracts()]);
});
</script>

<template>
  <AppLayout>
    <button class="text-sm text-slate-600 hover:text-slate-900 mb-4" @click="router.push('/clientes')">
      ← Volver a clientes
    </button>

    <div v-if="!client" class="text-slate-500">Cliente no encontrado.</div>
    <template v-else>
      <div class="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <h1 class="text-2xl font-semibold">{{ client.first_name }} {{ client.last_name }}</h1>
            <span class="badge" :class="CLIENT_STATUS_CLASS[client.status]">{{ CLIENT_STATUS_LABEL[client.status] }}</span>
          </div>
          <p class="text-slate-600 text-sm mt-1">
            {{ DOCUMENT_TYPE_LABEL[client.document_type] }} {{ client.document_number }} · {{ client.phone || 'sin telefono' }}<span v-if="client.phone_2"> · {{ client.phone_2 }}</span>
          </p>
        </div>
        <button v-if="canManageServices" class="btn-primary" @click="openNewServiceModal">+ Nuevo servicio</button>
      </div>

      <div class="grid gap-4 mb-8 text-sm" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))">
        <ClientStatCard icon="✉️" label="Correo">
          <div>{{ client.email || '—' }}</div>
        </ClientStatCard>
        <ClientStatCard icon="📍" label="Dirección de contacto">
          <div>{{ client.address || '—' }}</div>
        </ClientStatCard>
        <ClientStatCard icon="●" label="Estado del cliente">
          <select
            :value="client.status"
            :disabled="updatingClientStatus"
            class="field-input"
            @change="handleClientStatusChange(($event.target as HTMLSelectElement).value as ClientStatus)"
          >
            <option v-for="(label, value) in CLIENT_STATUS_LABEL" :key="value" :value="value">{{ label }}</option>
          </select>
          <p v-if="clientStatusError" class="text-xs text-red-600 mt-1">{{ clientStatusError }}</p>
        </ClientStatCard>
        <ClientStatCard icon="💰" label="Saldo a favor">
          <div class="font-semibold" :class="client.saldo_a_favor > 0 ? 'text-green-600' : ''">
            S/ {{ client.saldo_a_favor.toFixed(2) }}
          </div>
          <p v-if="client.saldo_a_favor > 0" class="text-[11px] text-slate-400 mt-0.5">Se aplica solo en la siguiente factura.</p>
          <button v-if="canApplyAveria" type="button" class="text-[11px] text-sky-600 hover:text-sky-700 mt-1" @click="openAveriaModal">
            + Descuento general (todos los servicios)
          </button>
        </ClientStatCard>
      </div>

      <p v-if="loadingContracts" class="text-slate-500 text-sm">Cargando...</p>
      <p v-else-if="!contracts.length" class="text-slate-500 text-sm">
        Este cliente aun no tiene servicios. Usa "+ Nuevo servicio" para crear el primero.
      </p>

      <!-- 2+ servicios: hay que elegir cual, cada uno con su propia ficha
      independiente — es el unico caso donde la vista cambia respecto a
      antes de la Fase 37 (ver ClientServiceDetailView.vue). -->
      <template v-else-if="contracts.length > 1">
        <h2 class="text-lg font-semibold mb-3">Servicios</h2>
        <div class="grid gap-3" style="grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))">
          <router-link
            v-for="ct in contracts"
            :key="ct.id"
            :to="`/clientes/${clientId}/servicios/${ct.id}`"
            class="block border border-slate-200 rounded-lg p-4 hover:border-sky-400 hover:shadow-sm transition bg-white"
          >
            <div class="flex items-center justify-between mb-1">
              <span class="font-mono text-xs text-slate-500">{{ ct.contract_number }}</span>
              <span class="badge" :class="CONTRACT_STATUS_CLASS[ct.status]">{{ CONTRACT_STATUS_LABEL[ct.status] }}</span>
            </div>
            <p class="font-medium">{{ ct.installation_address || 'Sin dirección registrada' }}</p>
            <p class="text-xs text-slate-500 mt-1">{{ ct.plans?.name || 'Sin plan' }} · S/ {{ Number(ct.monthly_fee).toFixed(2) }}/mes</p>
            <p class="text-xs text-slate-400">{{ ct.zones?.name || 'Sin zona' }}</p>
          </router-link>
        </div>
      </template>

      <!-- 1 solo servicio (el 99% de los casos): todo junto en la misma
      pagina, como antes de la Fase 37 — sin navegar a ningun lado. -->
      <ClientServiceDetailView v-else embedded :client-id-override="clientId" :contract-id-override="contracts[0].id" />
    </template>

    <Teleport to="body">
      <div v-if="showNewServiceModal" class="modal-overlay">
        <form class="w-full max-w-sm modal-panel" @submit.prevent="handleCreateNewService">
          <h2 class="text-lg font-semibold mb-1">Nuevo servicio</h2>
          <p class="text-xs text-slate-500 mb-4">
            Ubicación, ONT, equipo y descuentos se agregan en la ficha del servicio, justo después de crearlo.
          </p>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Plan</label>
            <select v-model="newServiceForm.plan_id" required class="field-input" @change="onNewServicePlanChange">
              <option value="" disabled>Selecciona un plan</option>
              <option v-for="p in catalogs.plans" :key="p.id" :value="p.id">
                {{ p.name }} — ↓{{ p.download_speed }}/↑{{ p.upload_speed }} Mbps — S/ {{ Number(p.price).toFixed(2) }}
              </option>
            </select>
            <p v-if="!catalogs.plans.length" class="text-xs text-amber-600 mt-1">
              No hay planes activos. Crea uno primero en Supabase (tabla <code>plans</code>).
            </p>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Mensualidad (S/)</label>
              <input v-model.number="newServiceForm.monthly_fee" type="number" step="0.01" min="0" required class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Fecha de emisión (día del mes)</label>
              <input v-model.number="newServiceForm.billing_day" type="number" min="1" max="28" required class="field-input" />
            </div>
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-600 mb-1">Metodo de pago</label>
            <select v-model="newServiceForm.payment_method" class="field-input">
              <option value="cash">Efectivo</option>
              <option value="transfer">Transferencia</option>
              <option value="card">Tarjeta</option>
            </select>
          </div>

          <p v-if="newServiceError" class="text-sm text-red-600 mb-3">{{ newServiceError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showNewServiceModal = false">Cancelar</button>
            <button type="submit" :disabled="savingNewService" class="btn-primary">
              {{ savingNewService ? 'Creando...' : 'Crear servicio' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showAveriaModal" class="modal-overlay" @click.self="showAveriaModal = false">
        <form class="w-full max-w-sm modal-panel" @submit.prevent="handleAveriaSubmit">
          <h2 class="text-lg font-semibold mb-1">Descuento general</h2>
          <p class="text-xs text-slate-500 mb-4">
            Se aplicará en la siguiente factura de CUALQUIERA de los servicios de este cliente. Para un descuento de una
            sola línea, hazlo desde la pestaña "Descuentos" de esa ficha de servicio.
          </p>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Monto (S/)</label>
            <input v-model.number="averiaForm.monto" type="number" step="0.01" min="0.01" required class="field-input" />
          </div>

          <div class="mb-4">
            <label class="block text-xs text-slate-600 mb-1">Motivo / Justificación</label>
            <textarea
              v-model="averiaForm.motivo"
              required
              rows="2"
              placeholder="ej. Compensación por avería masiva en sector Alto Trujillo del 12/10 - 18 hrs sin servicio"
              class="field-input"
            ></textarea>
          </div>

          <p v-if="averiaError" class="text-sm text-red-600 mb-3">{{ averiaError }}</p>
          <p v-if="averiaOk" class="text-sm text-green-600 mb-3">Listo: se aplicará en la siguiente factura.</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showAveriaModal = false">
              {{ averiaOk ? 'Cerrar' : 'Cancelar' }}
            </button>
            <button v-if="!averiaOk" type="submit" :disabled="averiaSaving" class="btn-primary">
              {{ averiaSaving ? 'Guardando...' : 'Aplicar descuento' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
