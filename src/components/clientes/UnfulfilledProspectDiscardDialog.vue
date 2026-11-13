<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useClientsStore, type ClientWithLifecycle } from '@/stores/clients';
import { canDiscardUnfulfilledProspect } from '@/lib/unfulfilledProspect';
import { getErrorMessage } from '@/lib/errors';

const props = defineProps<{ client: ClientWithLifecycle }>();
const emit = defineEmits<{ close: []; completed: [] }>();
const auth = useAuthStore();
const clients = useClientsStore();
const reason = ref('');
const confirmed = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
const needsRefresh = ref(false);
const result = ref(false);
const canSubmit = computed(() => ['ADMIN', 'SUPERADMIN'].includes(auth.role ?? '')
  && canDiscardUnfulfilledProspect(props.client) && confirmed.value
  && reason.value.trim().length >= 5 && reason.value.trim().length <= 1000
  && !saving.value && !needsRefresh.value && !result.value);
async function submit() {
  if (!canSubmit.value) return;
  saving.value = true;
  error.value = null;
  try {
    await clients.discardUnfulfilledProspect(props.client, reason.value.trim());
    result.value = true;
    emit('completed');
  } catch (e) {
    error.value = getErrorMessage(e, 'No se confirmó el descarte. Cierra y actualiza el listado antes de reintentar.');
    needsRefresh.value = true;
    confirmed.value = false;
  } finally { saving.value = false; }
}
const date = (iso: string) => new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima' });
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay">
      <section role="dialog" aria-modal="true" aria-labelledby="discard-title" class="modal-panel w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 id="discard-title" class="text-lg font-semibold mb-3">No concretado / Descartado</h2>
        <p class="text-sm font-medium mb-3">{{ client.first_name }} {{ client.last_name }}</p>
        <p v-if="result" role="status" class="text-sm text-green-700 mb-3">Descarte confirmado. La ficha se conserva en No instalados.</p>
        <template v-else-if="client.prospect_discarded_at">
          <dl class="text-sm space-y-2 mb-4 break-words">
            <div><dt class="font-medium">Fecha · Perú</dt><dd>{{ date(client.prospect_discarded_at) }}</dd></div>
            <div><dt class="font-medium">Responsable · ID</dt><dd>{{ client.prospect_discarded_by }}</dd></div>
            <div><dt class="font-medium">Motivo</dt><dd class="whitespace-pre-wrap">{{ client.prospect_discard_reason }}</dd></div>
          </dl>
        </template>
        <template v-else>
          <p class="text-sm text-slate-600 mb-3">Solo para contrataciones que nunca se instalaron y ya no tienen contratos vigentes ni Altas abiertas. Se conserva la ficha para consulta histórica.</p>
          <label class="block text-sm mb-3">Motivo
            <textarea v-model="reason" minlength="5" maxlength="1000" rows="3" :disabled="saving || needsRefresh" class="mt-1 w-full rounded-lg border border-slate-300 p-2" />
          </label>
          <label class="flex items-start gap-2 text-sm mb-4"><input v-model="confirmed" type="checkbox" :disabled="saving || needsRefresh" class="mt-1" />Confirmo el descarte administrativo. Los contratos y las instalaciones conservan su estado.</label>
        </template>
        <p v-if="error" role="alert" class="text-sm text-red-600 mb-3">{{ error }} Actualiza el listado para verificar el estado actual.</p>
        <div class="flex flex-wrap justify-end gap-2">
          <button type="button" class="btn-ghost" :disabled="saving" @click="emit('close')">{{ result || client.prospect_discarded_at ? 'Cerrar' : 'Cancelar' }}</button>
          <button v-if="!result && !client.prospect_discarded_at" type="button" class="btn-primary" :disabled="!canSubmit" @click="submit">{{ saving ? 'Confirmando…' : 'Confirmar descarte' }}</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
