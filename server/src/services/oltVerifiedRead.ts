import { runTelnetCommands } from '../telnet/client';
import { telnetTargetFor, type OltDeviceRow } from '../lib/oltDevice';
import { withOltLock } from './oltTelnetLock';
import { collectOltTelemetry, evaluateOntEvidence, rememberOntEvidence, ontTelemetry, type OntIdentity } from './oltTelemetry';
import { persistOntMeasurement } from './oltTelemetryPersistence';

export async function readVerifiedOntSignal(device: OltDeviceRow, row: OntIdentity) {
  if (device.id !== row.olt_device_id) throw Error('La ONT no pertenece a esta OLT.');
  const deadline = Date.now() + 80000; // fit the existing 90s client timeout
  const scan = await collectOltTelemetry((commands, timeoutMs) => withOltLock(device.id,
    () => {
      const remaining = deadline - Date.now();
      if (remaining < 500) throw Error('Se agotó el tiempo de lectura verificada.');
      return runTelnetCommands(telnetTargetFor(device), commands, { timeoutMs: Math.min(timeoutMs, remaining) });
    }),
  { includeSignal: true, port: { shelf: row.frame, slot: row.slot, port: row.port } });
  const e = evaluateOntEvidence(row, scan); rememberOntEvidence(row, e);
  if (e.outcome !== 'valid' || e.signalOutcome !== 'valid') throw Error(`Lectura no confirmada (${e.outcome}/${e.signalOutcome}); no se reutilizó la señal almacenada.`);
  const updated = await persistOntMeasurement(row, { status: e.status as 'online' | 'offline', admin_state: e.adminState, rx_power: e.rxPower!, tx_power: e.txPower!, last_synced_at: e.checkedAt });
  return { rxPower: e.rxPower, txPower: e.txPower, ont: ontTelemetry.project(updated) };
}
