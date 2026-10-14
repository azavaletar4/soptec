/**
 * Fase 4 OLT — historial de desconexiones/reconexiones (ver
 * ESTADO_DESARROLLO.md 13at). Construye las filas a insertar en
 * `olt_alert_log` a partir de las MISMAS alertas ya detectadas
 * (`oltAlerts.ts`, sin tocar su lógica) y de la fila de `olt_onts` que
 * `oltSyncService.ts` ya tiene cargada en memoria para esa corrida —
 * ninguna consulta nueva, ningún cálculo de vínculo nuevo.
 *
 * Regla dura (misma que Fase B, `ontZoneDiscrepancy.ts`): el snapshot de
 * `client_id`/`contract_id` solo se guarda cuando AMBOS existen en la ONT
 * en ese momento — nunca un vínculo a medias. Es una FOTOGRAFÍA verificada
 * al momento del evento, no un link vivo: si la ONT se traslada o se
 * desvincula después (Fase 159), este registro histórico no se corrige
 * retroactivamente — es intencional, un historial no se reescribe.
 */

export type OltAlertLogKind = 'offline' | 'recovered' | 'lowSignal' | 'signalRecovered';

export interface OltAlertLogSourceEvent {
  oltDeviceId: string;
  ontDbId: string;
  kind: OltAlertLogKind;
  message: string;
  at: string;
}

export interface OltAlertLogSourceOnt {
  client_id: string | null;
  contract_id: string | null;
}

export interface OltAlertLogRow {
  olt_device_id: string;
  olt_ont_id: string;
  kind: OltAlertLogKind;
  at: string;
  client_id: string | null;
  contract_id: string | null;
  detail: string;
}

export function buildOltAlertLogRows(
  alerts: readonly OltAlertLogSourceEvent[],
  ontsById: ReadonlyMap<string, OltAlertLogSourceOnt>,
): OltAlertLogRow[] {
  return alerts.map((a) => {
    const ont = ontsById.get(a.ontDbId) ?? null;
    const linked = Boolean(ont?.client_id) && Boolean(ont?.contract_id);
    return {
      olt_device_id: a.oltDeviceId,
      olt_ont_id: a.ontDbId,
      kind: a.kind,
      at: a.at,
      client_id: linked ? (ont!.client_id as string) : null,
      contract_id: linked ? (ont!.contract_id as string) : null,
      detail: a.message,
    };
  });
}
