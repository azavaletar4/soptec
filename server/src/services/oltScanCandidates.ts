import { evaluateOntEvidence, type TelemetryScan } from './oltTelemetry';
import type { GlobalOnt, FullConfigOnt } from '../ssh/zteParsers';

/**
 * Candidato real de la OLT con identidad VERIFICADA (antes+despues del
 * escaneo coinciden, ver evaluateOntEvidence) -- misma extraccion que ya
 * usaba exclusivamente `POST /:id/onts/import-existing` (routes/olt.ts),
 * factorizada aqui (2026-11-04) para que `oltSyncService.ts` (deteccion
 * automatica de ONT autorizadas externamente, sync periodico de 20 min) la
 * reutilice tal cual -- mismos datos, cero Telnet ni sesion adicional, un
 * solo lugar que decide que cuenta como "candidato real".
 *
 * Nunca incluye un onuId sin binding en `fullConfig`, ni una identidad cuya
 * evidencia no sea 'valid' (absent/moved/conflict/ambiguous/unconfirmed) --
 * un serial inconsistente entre el escaneo "antes" y "despues" simplemente
 * no aparece aqui, en vez de arriesgar un candidato con datos a medias.
 */
export interface ScannedOntCandidate {
  frame: number;
  slot: number;
  port: number;
  ontId: number;
  serial: string;
  binding: FullConfigOnt;
  state: GlobalOnt;
}

export function buildScannedCandidates(
  deviceId: string,
  globalOnts: readonly GlobalOnt[],
  fullConfig: ReadonlyMap<string, FullConfigOnt>,
  scan: TelemetryScan,
): ScannedOntCandidate[] {
  return globalOnts
    .map((o): ScannedOntCandidate | null => {
      const key = `${o.frame}/${o.slot}/${o.port}`;
      const b = fullConfig.get(`${key}:${o.onuId}`);
      if (!b || !b.serial) return null;
      const evidence = evaluateOntEvidence(
        { id: 'candidate', olt_device_id: deviceId, frame: o.frame, slot: o.slot, port: o.port, ont_id: o.onuId, serial: b.serial },
        scan,
      );
      if (evidence.outcome !== 'valid') return null;
      return { frame: o.frame, slot: o.slot, port: o.port, ontId: o.onuId, serial: b.serial, binding: b, state: o };
    })
    .filter((r): r is ScannedOntCandidate => r !== null);
}
