import { ref } from 'vue';
import { getErrorMessage } from '@/lib/errors';

/**
 * Envuelve una funcion async (cargar datos, guardar un formulario, etc.)
 * con el mismo patron loading/error que hoy se repite a mano en casi todas
 * las vistas del panel (ref(false) + try/catch/finally + getErrorMessage).
 * No inventa nada nuevo — solo evita reescribir ese mismo bloque cada vez.
 *
 * Uso tipico (reemplaza un onMounted con loading/try/catch/finally):
 *   const { loading, error, run: load } = useAsyncAction(async () => {
 *     await Promise.all([storeA.fetchX(), storeB.fetchY()]);
 *   }, 'Error al cargar los datos');
 *   onMounted(load);
 *
 * O para una sub-accion que devuelve datos:
 *   const { loading: savingX, error: errorX, run: save } = useAsyncAction(
 *     (payload: Foo) => store.createFoo(payload),
 *     'Error al guardar',
 *   );
 *   await save(form.value); // loading/error ya quedan manejados
 */
export function useAsyncAction<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  fallbackMessage = 'Ocurrió un error inesperado',
) {
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function run(...args: TArgs): Promise<TResult | undefined> {
    loading.value = true;
    error.value = null;
    try {
      return await fn(...args);
    } catch (e) {
      error.value = getErrorMessage(e, fallbackMessage);
      return undefined;
    } finally {
      loading.value = false;
    }
  }

  return { loading, error, run };
}
