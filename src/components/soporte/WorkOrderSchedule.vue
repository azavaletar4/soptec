<script setup lang="ts">
import { computed } from 'vue';
import { scheduleLabel, scheduleValues, type ScheduleFields, type ScheduleKind } from '@/lib/workOrderSchedule';
const props = defineProps<{ jobType: ScheduleKind; order: ScheduleFields }>();
const label = computed(() => scheduleLabel(props.jobType, props.order));
const rescheduled = computed(() => scheduleValues(props.jobType, props.order).rescheduled);
</script>

<template>
  <p data-work-order-schedule class="text-xs text-slate-600 mt-1 break-words">
    <span class="font-medium">{{ rescheduled ? 'Reprogramado' : 'Programado' }}:</span> {{ label }}
  </p>
</template>
