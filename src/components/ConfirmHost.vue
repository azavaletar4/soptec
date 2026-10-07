<script setup lang="ts">
// Montado UNA VEZ en AppLayout.vue y CampoLayout.vue — el <ConfirmModal>
// real que atiende useConfirm().confirmDialog(). No es "loading" (ese
// concepto sigue siendo del llamador, ver comentario en useConfirm.ts) —
// solo abre, espera un clic, y se cierra.
import ConfirmModal from './ConfirmModal.vue';
import { useConfirm } from '@/composables/useConfirm';

const { state, handleConfirm, handleCancel } = useConfirm();
</script>

<template>
  <ConfirmModal
    :open="state.open"
    :title="state.title"
    :message="state.message"
    :danger="state.danger"
    :warning="state.warning"
    :confirm-label="state.confirmLabel"
    :cancel-label="state.cancelLabel"
    @confirm="handleConfirm"
    @cancel="handleCancel"
  />
</template>
