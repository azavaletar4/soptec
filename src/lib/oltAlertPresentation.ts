/**
 * Fase 3 comercial OLT — alertas operativas para administración (ver
 * ESTADO_DESARROLLO.md 13as). La sección "Alertas y sincronización" de
 * `OltDetailView.vue` solo mostraba `OltAlert.message` (texto técnico tipo
 * "ONT slot 2/puerto 1/onu-id 5 se desconectó"), sin fecha/hora, sin
 * cliente ni acceso directo a su ficha. Este módulo traduce una alerta +
 * la ONT ya cargada en el panel (`oltStore.onts`, sin consulta nueva) a un
 * modelo listo para mostrar — pura presentación, nunca escribe nada.
 *
 * Regla dura (igual que Fase B, `ontZoneDiscrepancy.ts`): cliente/contrato
 * solo se resuelven si AMBOS `client_id` y `contract_id` existen en la ONT
 * y el contrato fue efectivamente resuelto — nunca por nombre, descripción
 * o posición física.
 */

export type OltAlertKind = 'offline' | 'recovered' | 'lowSignal' | 'signalRecovered';

export const ALERT_KIND_LABEL: Record<OltAlertKind, string> = {
  offline: 'Internet desconectado',
  recovered: 'Internet reconectado',
  lowSignal: 'Señal óptica baja',
  signalRecovered: 'Señal óptica recuperada',
};

export type AlertSeverity = 'critical' | 'ok';

export const ALERT_KIND_SEVERITY: Record<OltAlertKind, AlertSeverity> = {
  offline: 'critical',
  lowSignal: 'critical',
  recovered: 'ok',
  signalRecovered: 'ok',
};

/**
 * Fecha/hora REAL del evento (la que ya manda el backend en `OltAlert.at`
 * — el momento en que el sync detectó la transición, no la hora de
 * renderizado del navegador) formateada siempre en horario de Perú,
 * independientemente de la zona horaria del dispositivo del técnico/admin.
 */
export function formatPeruDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export interface OltAlertOntInfo {
  id: string;
  serial: string;
  description: string | null;
  slot: number;
  port: number;
  ont_id: number;
  client_id: string | null;
  contract_id?: string | null;
  clients?: { id: string; first_name: string; last_name: string } | null;
  zones?: { id: string; name: string } | null;
  service_contracts?: {
    id: string;
    contract_number: string | null;
    client_code: string | null;
    zones?: { id: string; name: string } | null;
  } | null;
}

export interface OltAlertSource {
  id: string;
  ontDbId: string;
  kind: OltAlertKind;
  message: string;
  at: string;
}

export interface OltAlertView {
  id: string;
  kind: OltAlertKind;
  kindLabel: string;
  severity: AlertSeverity;
  atIso: string;
  atFormatted: string;
  technicalMessage: string;
  ontDbId: string;
  serial: string | null;
  description: string | null;
  slot: number | null;
  port: number | null;
  ontId: number | null;
  ponNumber: number | null;
  zoneName: string | null;
  /** true solo si client_id Y contract_id existen en la ONT y el contrato se resolvió — nunca se infiere de otra forma. */
  linked: boolean;
  client: { id: string; name: string } | null;
  contract: { id: string; contractNumber: string | null; clientCode: string | null } | null;
}

/**
 * Construye el modelo de presentación de una alerta. `ont` es la fila ya
 * cargada en `oltStore.onts` (puede ser `null` si todavía no llegó al
 * panel — ONT recién creada o sync en curso); `ponNumber` viene de
 * `buildPonNumberMap`/`computePonOccupancy`, ya calculados en el panel.
 */
export function buildOltAlertView(
  alert: OltAlertSource,
  ont: OltAlertOntInfo | null,
  ponNumber: number | null,
): OltAlertView {
  const contractRow = ont?.service_contracts ?? null;
  const linked = Boolean(ont?.client_id) && Boolean(ont?.contract_id) && Boolean(contractRow);

  const client = linked && ont?.clients ? { id: ont.clients.id, name: `${ont.clients.first_name} ${ont.clients.last_name}`.trim() } : null;
  const contract =
    linked && contractRow ? { id: contractRow.id, contractNumber: contractRow.contract_number, clientCode: contractRow.client_code } : null;

  return {
    id: alert.id,
    kind: alert.kind,
    kindLabel: ALERT_KIND_LABEL[alert.kind],
    severity: ALERT_KIND_SEVERITY[alert.kind],
    atIso: alert.at,
    atFormatted: formatPeruDateTime(alert.at),
    technicalMessage: alert.message,
    ontDbId: alert.ontDbId,
    serial: ont?.serial ?? null,
    description: ont?.description ?? null,
    slot: ont?.slot ?? null,
    port: ont?.port ?? null,
    ontId: ont?.ont_id ?? null,
    ponNumber,
    zoneName: contractRow?.zones?.name ?? ont?.zones?.name ?? null,
    linked,
    client,
    contract,
  };
}

/**
 * Fase 4 OLT — historial (ver ESTADO_DESARROLLO.md 13au). A diferencia de
 * `buildOltAlertView` (alertas EN VIVO, resueltas contra el vínculo ACTUAL
 * de la ONT en `oltStore.onts`), una fila de historial ya viene resuelta
 * desde el backend contra el SNAPSHOT guardado al momento del evento
 * (`GET /:id/alert-log`, 13at) — nunca el vínculo de hoy, que puede haber
 * cambiado si la ONT se trasladó o desvinculó después. Por eso esta
 * función NO vuelve a resolver cliente/contrato — solo le agrega las
 * etiquetas/formato (mismas `ALERT_KIND_LABEL`/`formatPeruDateTime` que ya
 * usan las alertas en vivo, sin duplicar esa lógica).
 */
export interface OltAlertLogEntryRaw {
  id: string;
  oltOntId: string | null;
  kind: OltAlertKind;
  at: string;
  detail: string;
  /** minutos desde el 'offline' mas reciente hasta este 'recovered' — null = no calculable (nunca inventado), ver computeRecoveryDurations en el backend. */
  durationMinutes: number | null;
  client: { id: string; name: string } | null;
  contract: { id: string; contractNumber: string | null; clientCode: string | null } | null;
  zoneName: string | null;
  ont: { serial: string | null; description: string | null; slot: number | null; port: number | null; ontId: number | null; status: string | null } | null;
}

export interface OltAlertLogEntryView extends OltAlertLogEntryRaw {
  kindLabel: string;
  severity: AlertSeverity;
  atFormatted: string;
  /** true solo si el backend ya resolvió AMBOS cliente y contrato (mismo snapshot verificado de 13at) — nunca se deduce aquí. */
  linked: boolean;
}

export function buildOltAlertLogEntryView(raw: OltAlertLogEntryRaw): OltAlertLogEntryView {
  return {
    ...raw,
    kindLabel: ALERT_KIND_LABEL[raw.kind],
    severity: ALERT_KIND_SEVERITY[raw.kind],
    atFormatted: formatPeruDateTime(raw.at),
    linked: Boolean(raw.client && raw.contract),
  };
}
