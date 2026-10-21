import { supabaseAdmin } from '../lib/supabaseAdmin';
import { ontTelemetry, type OntIdentity } from './oltTelemetry';
import { oltEvents } from './oltEvents';

export interface MeasurementPatch { status?: 'online' | 'offline'; admin_state?: 'enable' | 'disable'; rx_power?: number; tx_power?: number; last_synced_at: string }
/** Position AND stored serial are atomic write predicates: a concurrent import cannot receive old observations. */
export async function persistOntMeasurement(row: OntIdentity, patch: MeasurementPatch, db = supabaseAdmin, signal?: AbortSignal) {
  const query = db.from('olt_onts').update(patch)
    .eq('id', row.id).eq('olt_device_id', row.olt_device_id).eq('serial', row.serial)
    .eq('frame', row.frame).eq('slot', row.slot).eq('port', row.port).eq('ont_id', row.ont_id)
    .select('*');
  const { data, error } = await (signal ? query.abortSignal(signal) : query).maybeSingle();
  if (error || !data) {
    ontTelemetry.invalidate(row.id);
    oltEvents.emitOntChanged({ oltDeviceId: row.olt_device_id, ont: ontTelemetry.project(row) });
    throw Error(error ? 'No se pudo guardar la lectura verificada de la ONT.' : 'La identidad o posición cambió; no se aplicó la lectura.');
  }
  return data;
}
