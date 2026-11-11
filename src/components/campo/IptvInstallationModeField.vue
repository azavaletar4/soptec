<script setup lang="ts">
import { IPTV_INSTALLATION_OPTIONS, type IptvInstallationMode } from '@/lib/installationIptv';
defineProps<{ modelValue: IptvInstallationMode | null; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [IptvInstallationMode | null] }>();
</script>

<template>
  <label class="block text-sm mb-3">
    <span class="block font-medium mb-1">¿Cómo se instaló IPTV?</span>
    <select class="field-input" :value="modelValue ?? ''" :disabled="disabled" @change="emit('update:modelValue', (($event.target as HTMLSelectElement).value || null) as IptvInstallationMode | null)">
      <option value="" disabled>Selecciona la modalidad...</option>
      <option v-for="option in IPTV_INSTALLATION_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>
    <span class="block text-xs text-slate-500 mt-1">Solo la entrega de TV Box Rayco requiere ese equipo por serie/MAC desde custodia. La ONT de Internet sigue siendo obligatoria.</span>
  </label>
</template>
