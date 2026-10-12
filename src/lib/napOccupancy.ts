import type { FoNapPuerto } from '@/types/domain';

/**
 * Fase 155: un puerto con estado='ocupado' pero sin client_id es un residuo
 * — el cliente o contrato al que pertenecia fue eliminado y la FK
 * (ON DELETE SET NULL) vacio client_id/contract_id, pero nada resetea el
 * estado de vuelta a 'libre'. No representa una ocupacion fisica real.
 */
export function countOcupadosReales(puertos: readonly Pick<FoNapPuerto, 'estado' | 'client_id'>[]): number {
  return puertos.filter((p) => p.estado === 'ocupado' && p.client_id).length;
}
