import { type OltDeviceRow } from '../lib/oltDevice';
import { collectOltTelemetry, evaluateOntEvidence, rememberOntEvidence, ontTelemetry, type OntIdentity } from './oltTelemetry';
import { persistOntMeasurement } from './oltTelemetryPersistence';
import { beginOltReadOperation, createOltReadBudget } from './oltReadOperation';

export async function readVerifiedOntSignal(device: OltDeviceRow, row: OntIdentity) {
  if (row.retired_at) throw Error('La ONT está retirada; su posición es histórica y no admite consultas operativas.');
  if (device.id !== row.olt_device_id) throw Error('La ONT no pertenece a esta OLT.');
  const release = beginOltReadOperation(device.id);
  if (!release) throw Error('Ya hay una lectura de esta OLT en curso.');
  try {
    const budget = createOltReadBudget(device, 80000);
    const scan = await collectOltTelemetry(budget.read,
      { includeSignal: true, port: { shelf: row.frame, slot: row.slot, port: row.port } });
    const e = evaluateOntEvidence(row, scan); rememberOntEvidence(row, e);
    if (e.outcome !== 'valid' || e.signalOutcome !== 'valid') throw Error(`Lectura no confirmada (${e.outcome}/${e.signalOutcome}); no se reutilizó la señal almacenada.`);
    const updated = await persistOntMeasurement(row, { status: e.status as 'online' | 'offline', admin_state: e.adminState, rx_power: e.rxPower!, tx_power: e.txPower!, last_synced_at: e.checkedAt }, undefined, budget.signal);
    return { rxPower: e.rxPower, txPower: e.txPower, ont: ontTelemetry.project(updated) };
  } finally { release(); }
}
