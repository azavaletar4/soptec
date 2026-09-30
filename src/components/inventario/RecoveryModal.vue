<script setup lang="ts">
import { ref } from 'vue';
import type { InventoryUnit, StaffProfile } from '@/types/domain';

/**
 * Modal de "Marcar para Recupero" (Fase 51): el cliente dio de baja el
 * servicio / no pago / migro de equipo, y un tecnico debe ir a retirar el
 * equipo fisicamente. Distinto del flujo de "Averiado / Mantenimiento"
 * (equipo que fallo estando con el cliente) — ver ReporteModal en cada vista.
 * Controlado por el padre (sin boton disparador propio), mismo patron que
 * MoveAlbumMenu.vue.
 */
const props = defineProps<{
  unit: InventoryUnit;
  technicians: StaffProfile[];
}>();

const emit = defineEmits<{
  close: [];
  confirm: [payload: { technicianId: string; reason: string }];
}>();

const MOTIVOS = ['Baja de servicio', 'Falta de pago', 'Migración de equipo'];

const technicianId = ref('');
const motivo = ref(MOTIVOS[0]);
const condicion = ref<'Funcional' | 'Dañado'>('Funcional');

function submit() {
  const reason = `${motivo.value} — equipo reportado ${condicion.value.toLowerCase()}`;
  emit('confirm', { technicianId: technicianId.value, reason });
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <form class="w-full max-w-sm modal-panel" @submit.prevent="submit">
        <h3 class="text-lg font-semibold mb-1">Marcar para Recupero</h3>
        <p class="text-xs text-slate-500 mb-4 font-mono">{{ unit.serial_number || unit.mac_address }}</p>

        <div class="mb-3">
          <label class="block text-xs text-slate-600 mb-1">Cliente origen</label>
          <p class="field-input bg-slate-50 text-slate-600">
            {{ unit.clients ? `${unit.clients.first_name} ${unit.clients.last_name}` : 'Sin cliente vinculado' }}
          </p>
        </div>

        <div class="mb-3">
          <label class="block text-xs text-slate-600 mb-1">Técnico asignado al recojo</label>
          <select v-model="technicianId" required class="field-input">
            <option value="" disabled>Selecciona un técnico</option>
            <option v-for="t in props.technicians" :key="t.id" :value="t.id">{{ t.full_name || t.email }}</option>
          </select>
        </div>

        <div class="mb-3">
          <label class="block text-xs text-slate-600 mb-1">Motivo</label>
          <select v-model="motivo" class="field-input">
            <option v-for="m in MOTIVOS" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>

        <div class="mb-4">
          <label class="block text-xs text-slate-600 mb-1">Estado del equipo al recoger</label>
          <select v-model="condicion" class="field-input">
            <option value="Funcional">Funcional</option>
            <option value="Dañado">Dañado</option>
          </select>
        </div>

        <div class="flex justify-end gap-2">
          <button type="button" class="btn-ghost" @click="emit('close')">Cancelar</button>
          <button type="submit" :disabled="!technicianId" class="btn-primary">Marcar para Recupero</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>
