import type { ContractStatus, FoNapPuerto } from '../types/domain';

export const COMMERCIAL_STATUS_LABEL = { active: 'Activo', suspended: 'Suspendido', cancelled: 'Cancelado' };
export const COMMERCIAL_STATUS_CLASS = {
  active: 'bg-green-500/15 text-green-600',
  suspended: 'bg-amber-500/15 text-amber-700',
  cancelled: 'bg-slate-500/15 text-slate-600',
};
export function occupiesCommercialCapacity(status: string): boolean {
  return status === 'active' || status === 'suspended';
}

/**
 * Fase 155: un puerto con estado='ocupado' pero sin client_id es un residuo
 * — el cliente o contrato al que pertenecia fue eliminado y la FK
 * (ON DELETE SET NULL) vacio client_id/contract_id, pero nada resetea el
 * estado de vuelta a 'libre'. No representa ocupación comercial vigente.
 */
export function countOcupadosReales(puertos: readonly PuertoConServicio[]): number {
  return serviciosOcupados(puertos).length;
}

type PuertoConServicio = Pick<FoNapPuerto, 'estado' | 'client_id'> & {
  contract_id?: string | null;
  puerto_numero?: number;
  service_contracts?: { status?: ContractStatus } | null;
};

/**
 * Fase 157: la caja NAP ya no se controla puerto por puerto — solo importa
 * qué SERVICIOS (contratos) están asociados y cuántos caben. Dedupe por
 * contract_id (o client_id si el puerto no tiene contrato ligado, caso
 * ambiguo de cliente multi-servicio) para no contar ni listar dos veces el
 * mismo abonado si, fuera del flujo normal (assign_provisioning_nap, que
 * nunca deja 2 puertos ocupados para el mismo contrato), una edición
 * manual de puertos (Mapa de Red > Puertos de cliente) llegara a dejarlo
 * así. Devuelve un puerto representativo por servicio (el de menor
 * puerto_numero), nunca el número de puerto en sí — no es parte de lo que
 * se muestra.
 */
export function serviciosOcupados<T extends PuertoConServicio>(puertos: readonly T[]): T[] {
  return classifyNapServices(puertos).occupied;
}

// Una regla para contadores/listas. Un vínculo sin estado verificable no
// libera capacidad: se conserva como ocupación pendiente de revisión.
export function classifyNapServices<T extends PuertoConServicio>(puertos: readonly T[]) {
  const occupied: T[] = [], history: T[] = [];
  const vistos = new Set<string>();
  for (const p of [...puertos].sort((a, b) => (a.puerto_numero ?? 0) - (b.puerto_numero ?? 0))) {
    if (!p.client_id) continue;
    const status = p.service_contracts?.status;
    if (status !== 'cancelled' && p.estado !== 'ocupado') continue;
    const key = p.contract_id ? `contract:${p.contract_id}` : `client:${p.client_id}`;
    if (vistos.has(key)) continue;
    vistos.add(key);
    if (status === 'cancelled') history.push(p);
    else if (!status || occupiesCommercialCapacity(status)) occupied.push(p);
  }
  return { occupied, history };
}
