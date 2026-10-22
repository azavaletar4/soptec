import { ontTelemetry, type OntTelemetryEvidence } from './oltTelemetry';

export interface AlertHistoryOnt {
  id: string; olt_device_id: string; serial: string; description: string | null;
  frame: number; slot: number; port: number; ont_id: number;
  status: string; retired_at: string | null;
}

/** Read-only projection. Stored status is neither the event snapshot nor live evidence. */
export function presentAlertHistoryOnt(row: AlertHistoryOnt | null, evidence: OntTelemetryEvidence = ontTelemetry) {
  if (!row) return null;
  const current = evidence.project(row);
  const confirmed = !row.retired_at && current.telemetry.outcome === 'valid';
  return {
    serial: row.serial, description: row.description,
    slot: row.slot, port: row.port, ontId: row.ont_id,
    retiredAt: row.retired_at,
    status: confirmed ? current.status : null,
    currentStatusConfirmed: confirmed,
    currentStatusAt: confirmed ? current.telemetry.stateReadAt : null,
  };
}
