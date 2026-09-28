import { reactive } from 'vue';

// Estado compartido a nivel de modulo (singleton) — cualquier componente que
// llame useToast() ve/empuja a la MISMA lista, y <ToastHost> (montado una
// sola vez en AppLayout/CampoLayout) es lo unico que la renderiza. Asi no
// hace falta pasar props/eventos de toast a traves de toda la app.
export interface ToastItem {
  id: number;
  type: 'error' | 'success' | 'info';
  message: string;
}

const toasts = reactive<ToastItem[]>([]);
let nextId = 1;

// Los de error quedan mas tiempo (8s) porque suelen requerir leerse con mas
// cuidado (un mensaje tecnico de por que algo fallo) que un "Guardado" (6s).
const DURATION_MS: Record<ToastItem['type'], number> = { error: 8000, success: 6000, info: 6000 };

function push(type: ToastItem['type'], message: string): number {
  const id = nextId++;
  toasts.push({ id, type, message });
  setTimeout(() => dismiss(id), DURATION_MS[type]);
  return id;
}

function dismiss(id: number) {
  const idx = toasts.findIndex((t) => t.id === id);
  if (idx !== -1) toasts.splice(idx, 1);
}

/**
 * Uso: const toast = useToast(); toast.error('Algo fallo'); toast.success('Listo');
 * Reemplaza los alert() nativos del navegador — no bloquea, se apila, y
 * anuncia solo a lectores de pantalla via role="alert"/"status" en <ToastHost>.
 */
export function useToast() {
  return {
    toasts,
    error: (message: string) => push('error', message),
    success: (message: string) => push('success', message),
    info: (message: string) => push('info', message),
    dismiss,
  };
}
