/**
 * Fase 3 comercial OLT — deteccion de alertas proactivas (caida/recuperacion
 * de ONT, cruce de umbral de senal optica). Puramente funcional: recibe el
 * estado YA PERSISTIDO antes del ciclo (`before`, lo que ya habia en
 * olt_onts) y lo que acaba de leer este ciclo (`after`), sin guardar nada en
 * memoria propia — oltSyncService.ts es quien llama esto dentro de
 * performFullSync, con los datos que ya tenia cargados para decidir que
 * actualizar.
 *
 * Por que no hace falta un "snapshot anterior" aparte: `before` YA es el
 * valor persistido en Supabase (sobrevive un reinicio del backend). Una
 * transicion solo se reporta una vez porque, tras guardarse, el siguiente
 * ciclo compara contra el valor YA actualizado — sin cambio, sin alerta
 * nueva. La unica perdida real al reiniciar el backend es la lista de
 * alertas ya emitidas que un cliente SSE no llego a ver (ver oltEvents.ts);
 * esta funcion no tiene ese problema porque no es ahi donde vive el estado.
 */

export type OltAlertKind = 'offline' | 'recovered' | 'lowSignal' | 'signalRecovered';

/**
 * Transicion real online<->offline. Nunca dispara si la ONU quedo
 * deshabilitada a proposito (admin_state 'disable') — eso es una accion
 * administrativa, no una caida que alertar. Tampoco dispara si `before` no
 * es ni 'online' ni 'offline' (ej. 'unknown', primera vez que se sincroniza
 * esa fila) — sin un estado previo real no hay "transicion" que reportar.
 */
export function detectStatusAlert(
  before: { status: string; adminState: string },
  after: { status: string; adminState: string },
): OltAlertKind | null {
  if (after.adminState === 'disable') return null;
  if (before.status === 'online' && after.status === 'offline') return 'offline';
  if (before.status === 'offline' && after.status === 'online') return 'recovered';
  return null;
}

/**
 * Cruce del umbral de senal optica (dBm, mas negativo = peor). `beforeRx`
 * null = sin lectura previa (ONT nueva o primer sync) -> nunca alerta,
 * nada que "cruzar" todavia. `afterRx` undefined = este ciclo no trajo una
 * lectura nueva para esa ONU (puerto fallido o se salto el paso de senal,
 * ver OLT_SYNC_SIGNAL_EVERY_N_RUNS) -> tampoco alerta, un fallo de lectura
 * NUNCA se interpreta como una caida de senal.
 */
export function detectSignalAlert(
  beforeRx: number | null,
  afterRx: number | undefined,
  thresholdDbm: number,
): OltAlertKind | null {
  if (beforeRx === null || afterRx === undefined) return null;
  const wasOk = beforeRx >= thresholdDbm;
  const isOk = afterRx >= thresholdDbm;
  if (wasOk && !isOk) return 'lowSignal';
  if (!wasOk && isOk) return 'signalRecovered';
  return null;
}
