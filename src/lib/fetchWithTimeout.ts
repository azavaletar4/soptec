/**
 * Envoltorio de `fetch` con límite de tiempo propio del cliente, via
 * AbortController. Sin dependencias (ni Supabase ni Vite) a propósito, para
 * poder probarlo con el runner nativo de Node (ver __tests__/fetchWithTimeout.test.ts).
 *
 * Por que hace falta: `apiFetch` (src/lib/api.ts) usaba un `fetch()` sin
 * ningun timeout propio — si el backend se queda esperando, la UI se queda
 * mostrando "Consultando..." indefinidamente, dependiendo solo del timeout
 * de nginx (180s, ver deploy/nginx.conf) para recuperarse, sin ninguna señal
 * de si sigue "viva" o esta realmente colgada. Bug real reportado:
 * "Consultar señal" en una ONT se quedo en "Consultando..." tras el
 * despliegue de la Fase 1 Telnet.
 *
 * OJO — lo que este modulo NO afirma: abortar el fetch en el navegador NO
 * garantiza que la tarea equivalente en el backend (la sesion Telnet contra
 * la OLT, ver readOntSignal() en server/src/routes/olt.ts) se haya
 * cancelado — Node sigue corriendola igual hasta que termine o timee-out por
 * su cuenta, el cliente simplemente deja de esperarla. Por eso el mensaje de
 * timeout no le atribuye la causa a la OLT ni a la cola Telnet: eso no esta
 * confirmado desde el lado del navegador.
 *
 * `onResponse(res)` recibe la Response ya con las cabeceras listas y hace lo
 * que haga falta con el body (ej. `res.json()`) — el timeout/AbortController
 * sigue activo durante ESE paso tambien, no solo mientras se esperan las
 * cabeceras. Antes, el timer se limpiaba en cuanto `fetch()` resolvia (justo
 * al llegar las cabeceras), dejando la lectura del body sin ninguna
 * proteccion — si el body se quedaba a medio enviar, nada lo cancelaba.
 */
export async function fetchWithTimeout<T>(
  input: string,
  init: RequestInit,
  timeoutMs: number | undefined,
  onResponse: (res: Response) => Promise<T>,
): Promise<T> {
  const externalSignal = init.signal ?? null;

  if (!timeoutMs) {
    // Sin timeout propio: se respeta tal cual cualquier signal externo que
    // haya mandado el caller, pero no hay nada mas que gestionar aqui.
    const res = await fetch(input, init);
    return onResponse(res);
  }

  // Un AbortController propio (no el signal externo directo) para poder
  // distinguir DESPUES, en el catch, si quien aborto fue nuestro timer o el
  // caller — y porque un signal ya puede venir "consumido" si se reusa.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort);
  }

  try {
    // El mismo controller.signal cubre TANTO la espera de cabeceras
    // (fetch(...)) COMO la lectura del body dentro de onResponse(...): si se
    // llama a controller.abort() mientras `res.json()` sigue leyendo el
    // stream, esa lectura tambien se rechaza — por eso el timer solo se
    // limpia en el finally de aqui abajo, despues de que onResponse termino,
    // no apenas llegan las cabeceras.
    const res = await fetch(input, { ...init, signal: controller.signal });
    return await onResponse(res);
  } catch (e) {
    if (controller.signal.aborted) {
      if (timedOut) {
        const seconds = Math.round(timeoutMs / 1000);
        throw new Error(
          `La consulta superó el tiempo de espera (${seconds}s) y se canceló desde el navegador. ` +
            `Esto no garantiza que la operación equivalente en el backend/OLT se haya detenido.`,
        );
      }
      // Lo abortó el signal externo del caller, no nuestro timer — se
      // propaga tal cual para que el caller lo distinga del timeout (puede
      // revisar su propio signal.reason si lo necesita).
      throw e;
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}
