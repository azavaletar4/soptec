import { ref } from 'vue';

// Estado compartido a nivel de modulo (Fase 114): una vista de detalle (ej.
// TicketDetailView) puede agregar UN crumb final dinamico (numero de
// ticket, nombre de cliente, etc.) sin que Breadcrumbs.vue/AppLayout tengan
// que conocer cada vista una por una. Quien lo setea es responsable de
// limpiarlo en onUnmounted — el valor no se resetea solo entre rutas.
const extraLabel = ref<string | null>(null);

export function useBreadcrumbExtra() {
  return {
    extraLabel,
    setBreadcrumbExtra: (label: string | null) => {
      extraLabel.value = label;
    },
  };
}
