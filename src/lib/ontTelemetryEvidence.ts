export interface OntTelemetryPresentation {
  outcome: string; checkedAt: string | null; validUntil: string | null; signalOutcome: string;
  stateReadAt?: string | null; signalReadAt?: string | null;
  observedSerial?: string | null; observedPosition?: string | null;
  historical?: { status?: unknown; rxPower?: unknown; txPower?: unknown; at?: unknown };
}
export function enforceOntEvidence<T extends { status: 'online' | 'offline' | 'unknown'; rx_power: number | null; tx_power: number | null; telemetry?: OntTelemetryPresentation }>(row: T, now = Date.now()): T {
  const evidence = row.telemetry;
  if (!evidence || evidence.outcome !== 'valid' || !evidence.validUntil || now > Date.parse(evidence.validUntil) || !Number.isFinite(Date.parse(evidence.validUntil))) {
    return { ...row, status: 'unknown', rx_power: null, tx_power: null,
      ...(evidence ? { telemetry: { ...evidence, outcome: evidence.outcome === 'valid' ? 'expired' : evidence.outcome, signalOutcome: 'not-read' } } : {}) };
  }
  return evidence.signalOutcome === 'valid' ? row : { ...row, rx_power: null, tx_power: null };
}
