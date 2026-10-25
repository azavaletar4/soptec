<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useClientsStore } from '@/stores/clients';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/lib/errors';
import type { RetirementPreview, RetirementResult } from '@/types/clientRetirement';

const props = defineProps<{ clientId: string }>();
const emit = defineEmits<{ close: []; completed: [result: RetirementResult] }>();
const clients = useClientsStore();
const auth = useAuthStore();
const preview = ref<RetirementPreview | null>(null);
const loading = ref(false);
const saving = ref(false);
const confirmed = ref(false);
const error = ref<string | null>(null);
const result = ref<RetirementResult | null>(null);
const needsRefresh = ref(false);
const canRetire = computed(() => ['ADMIN', 'SUPERADMIN'].includes(auth.role ?? ''));
const affected = computed(() => preview.value?.contracts.filter(c => c.status !== 'cancelled') ?? []);
async function load() {
  preview.value = null;
  confirmed.value = false;
  error.value = null;
  needsRefresh.value = false;
  if (!canRetire.value) { error.value = 'La baja definitiva requiere ADMIN o SUPERADMIN.'; return; }
  loading.value = true;
  try { preview.value = await clients.previewRetirement(props.clientId); }
  catch (e) { error.value = getErrorMessage(e, 'No se pudo consultar la baja definitiva.'); }
  finally { loading.value = false; }
}
async function submit() {
  if (saving.value || !canRetire.value || !preview.value || !confirmed.value || preview.value.openInstallations.length || needsRefresh.value) return;
  saving.value = true;
  error.value = null;
  try {
    result.value = await clients.retireClient(props.clientId, {
      previewToken: preview.value.token,
      affectedContractIds: affected.value.map(c => c.id),
      confirmAllContracts: true,
    });
    emit('completed', result.value);
  } catch (e) {
    needsRefresh.value = true;
    confirmed.value = false;
    error.value = getErrorMessage(e, 'No se confirmó la baja. Recarga la ficha para verificar su estado.');
  } finally { saving.value = false; }
}
onMounted(load);
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay">
      <section role="dialog" aria-modal="true" aria-labelledby="retirement-title" class="w-full max-w-xl modal-panel max-h-[90vh] overflow-y-auto">
        <h2 id="retirement-title" class="text-lg font-semibold mb-3">Baja definitiva del cliente</h2>
        <p v-if="loading" class="text-sm text-slate-500">Consultando ficha, contratos y Altas…</p>
        <p v-if="error" role="alert" class="text-sm text-red-600 mb-3">{{ error }}</p>
        <template v-if="result">
          <p role="status" class="text-sm text-green-700 mb-3">Baja comercial confirmada. Se cancelaron {{ result.cancelledCount }} contratos.</p>
          <p class="text-sm text-amber-800 mb-3">Pendiente de revisión manual: ONT, PPPoE, IPTV y equipos. No se ejecutó ninguna acción de red ni de inventario.</p>
        </template>
        <template v-else-if="preview">
          <p class="text-sm font-medium mb-2">{{ preview.name }}</p>
          <p class="text-sm mb-3">La ficha pasará a Baja y se cancelarán <strong>{{ affected.length }} contratos vigentes</strong>, incluidos los suspendidos.</p>
          <ul class="text-sm mb-3 space-y-2">
            <li v-for="contract in affected" :key="contract.id" class="rounded border border-slate-200 p-2">
              <strong>{{ contract.number || contract.id }}</strong> · {{ contract.code || 'Sin código' }}
              · {{ contract.status === 'suspended' ? 'Suspendido' : 'Activo' }} · {{ contract.serviceType === 'solo_iptv' ? 'IPTV' : 'Internet/Combo' }}
              <p v-if="contract.pppoeLinked || contract.ontLinked || contract.iptvLinked" class="text-xs text-amber-800 mt-1">
                Revisar manualmente: {{ [contract.pppoeLinked ? 'PPPoE' : '', contract.ontLinked ? 'ONT' : '', contract.iptvLinked ? 'IPTV' : ''].filter(Boolean).join(', ') }}.
              </p>
            </li>
          </ul>
          <p v-if="!affected.length" class="text-sm mb-3">No hay contratos vigentes. Se confirmará únicamente el estado de Baja de la ficha.</p>
          <div v-if="preview.openInstallations.length" role="alert" class="rounded border border-amber-300 bg-amber-50 p-3 text-sm mb-3">
            Baja bloqueada: hay {{ preview.openInstallations.length }} Altas pendientes, programadas o en curso. Resuélvelas desde su flujo autorizado antes de continuar.
            <ul class="mt-2"><li v-for="order in preview.openInstallations" :key="order.id">Alta {{ order.id }} · {{ order.status }}</li></ul>
          </div>
          <p class="text-sm text-slate-600 mb-3">Se conservan facturas, deudas, pagos, órdenes e historial. {{ preview.linkedEquipmentCount }} equipos vinculados se conservan sin reasignar ni devolver.</p>
          <p class="text-sm text-amber-800 mb-3">Esta baja es comercial. No desactiva ONT, PPPoE ni IPTV y no ejecuta comandos OLT/MikroTik. La revisión de red y recupero queda pendiente, incluso si no hay vínculos registrados.</p>
          <p class="text-xs text-slate-500 mb-3">Los cambios de otros campos de la ficha deben guardarse por separado.</p>
          <label class="flex items-start gap-2 text-sm mb-4">
            <input v-model="confirmed" type="checkbox" :disabled="saving || !!preview.openInstallations.length || needsRefresh" class="mt-1" />
            Confirmo la baja definitiva del cliente y la cancelación de todos los {{ affected.length }} contratos indicados. Entiendo que la revisión de red queda pendiente.
          </label>
        </template>
        <div class="flex flex-wrap justify-end gap-2">
          <button type="button" class="btn-ghost" :disabled="saving" @click="emit('close')">{{ result ? 'Cerrar' : 'Cancelar' }}</button>
          <button v-if="!result && (needsRefresh || (!preview && !loading))" type="button" class="btn-secondary" @click="load">Actualizar vista previa</button>
          <button v-if="!result" type="button" class="btn-primary" :disabled="!canRetire || loading || saving || !preview || !confirmed || !!preview.openInstallations.length || needsRefresh" @click="submit">
            {{ saving ? 'Confirmando…' : 'Confirmar baja definitiva' }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
