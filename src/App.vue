<script setup lang="ts">
import { useRoute } from 'vue-router';
import { useTechTelemetry } from '@/composables/useTechTelemetry';

const route = useRoute();

// Fase 115: autoreporte de bateria/GPS del tecnico — vive aca (raiz, nunca
// se desmonta) y no en AppLayout/CampoLayout porque un tecnico pasa por
// AMBOS layouts (Operaciones de Hoy via AppLayout, App de Campo via
// CampoLayout) durante la misma sesion.
useTechTelemetry();
</script>

<template>
  <router-view v-slot="{ Component }">
    <component :is="Component" :key="route.fullPath" />
  </router-view>
</template>
