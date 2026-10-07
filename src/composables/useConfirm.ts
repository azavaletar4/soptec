import { reactive } from 'vue';

// Mismo criterio de singleton que useToast.ts — un solo estado compartido,
// renderizado por UN <ConfirmHost> global (montado en AppLayout/CampoLayout).
// Pensado para reemplazar el confirm() nativo del navegador sin reescribir
// la logica de cada llamador:
//   if (!(await confirmDialog({ title: '...', message: '...', danger: true }))) return;
//   // ... codigo que antes iba despues del if (!confirm(...)) return; ...
export interface ConfirmOptions {
  title: string;
  message: string;
  /** true = boton de confirmar en rojo solido + "Esta accion no se puede deshacer." */
  danger?: boolean;
  /** true = caja ambar con icono ⚠️ alrededor del mensaje — advertencia no destructiva (ej. choque de horario) que de todos modos se puede confirmar. */
  warning?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  resolve: ((value: boolean) => void) | null;
}

const state = reactive<ConfirmState>({
  open: false,
  title: '',
  message: '',
  danger: false,
  warning: false,
  confirmLabel: undefined,
  cancelLabel: undefined,
  resolve: null,
});

function settle(value: boolean) {
  state.open = false;
  state.resolve?.(value);
  state.resolve = null;
}

export function useConfirm() {
  /** Devuelve una Promise<boolean>: true si el usuario confirmo, false si cancelo/cerro. */
  function confirmDialog(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      // Si ya habia un dialogo pendiente sin resolver (no deberia pasar en
      // uso normal, es un solo modal global a la vez), lo resolvemos como
      // "cancelado" antes de reemplazarlo — evita dejar una Promise colgada.
      if (state.resolve) settle(false);
      state.title = options.title;
      state.message = options.message;
      state.danger = options.danger ?? false;
      state.warning = options.warning ?? false;
      state.confirmLabel = options.confirmLabel;
      state.cancelLabel = options.cancelLabel;
      state.resolve = resolve;
      state.open = true;
    });
  }

  return { state, confirmDialog, handleConfirm: () => settle(true), handleCancel: () => settle(false) };
}
