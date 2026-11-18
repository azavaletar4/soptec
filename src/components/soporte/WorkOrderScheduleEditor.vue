<script setup lang="ts">
import { ref } from 'vue';
import WorkOrderSchedule from './WorkOrderSchedule.vue';
import { schedulePatch, scheduleValues, type ScheduleFields, type ScheduleKind } from '@/lib/workOrderSchedule';
import { useTicketsStore } from '@/stores/tickets';
import { useInstallationsStore } from '@/stores/installations';
import { getErrorMessage } from '@/lib/errors';
const props = defineProps<{ jobType: Exclude<ScheduleKind, 'routine'>; order: ScheduleFields & { id: string }; readonly: boolean }>();
const emit = defineEmits<{ saved: [order: ScheduleFields] }>();
const tickets = useTicketsStore(), installations = useInstallationsStore();
const editing = ref(false), saving = ref(false), error = ref('');
const draft = ref({ date: '', time: '', endTime: '', endDate: '' });
function edit() {
  draft.value = scheduleValues(props.jobType, props.order);
  error.value = ''; editing.value = true;
}
function changeDate(event: Event) {
  const date = (event.target as HTMLInputElement).value;
  if (!draft.value.endDate || draft.value.endDate === draft.value.date) draft.value.endDate = date;
  draft.value.date = date;
}
async function save() {
  if (props.readonly || saving.value) return;
  error.value = ''; saving.value = true;
  try {
    const d = draft.value;
    const patch = schedulePatch(props.jobType, d.date, d.time, d.endTime, d.endDate || d.date);
    const updated = props.jobType === 'ticket'
      ? await tickets.updateTicket(props.order.id, props.order.status === 'rescheduled'
        ? { ...patch, rescheduled_to: patch.scheduled_start_at } : patch)
      : await installations.updateInstallation(props.order.id, patch);
    emit('saved', updated); editing.value = false;
  } catch (e) { error.value = getErrorMessage(e, 'No se pudo guardar la programación'); }
  finally { saving.value = false; }
}
</script>

<template>
  <div data-schedule-editor class="surface p-4 text-sm">
    <WorkOrderSchedule :job-type="jobType" :order="order" />
    <button v-if="!readonly && !editing" type="button" class="btn-secondary text-xs mt-2" @click="edit">Editar programación</button>
    <form v-if="editing && !readonly" class="grid gap-2 mt-2" @submit.prevent="save">
      <label>Fecha programada <input :value="draft.date" aria-label="Fecha programada" type="date" class="field-input" @input="changeDate" /></label>
      <label>{{ jobType === 'installation' ? 'Hora estimada' : 'Hora de inicio' }} <input v-model="draft.time" aria-label="Hora programada" type="time" class="field-input" /></label>
      <template v-if="jobType === 'ticket' || order.scheduled_end_at">
        <label>Fecha de fin <input v-model="draft.endDate" aria-label="Fecha de fin" type="date" class="field-input" /></label>
        <label>Hora de fin <input v-model="draft.endTime" aria-label="Hora de fin" type="time" class="field-input" /></label>
      </template>
      <p class="text-xs text-slate-500">Hora de Perú (America/Lima)</p>
      <p v-if="error" class="text-red-600">{{ error }}</p>
      <div class="flex gap-2">
        <button type="submit" class="btn-primary text-xs" :disabled="saving">Guardar programación</button>
        <button type="button" class="btn-ghost text-xs" :disabled="saving" @click="editing = false">Cancelar</button>
      </div>
    </form>
  </div>
</template>
