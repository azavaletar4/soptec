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

type PuertoConServicio = Pick<FoNapPuerto, 'estado' | 'client_id' | 'contract_id' | 'puerto_numero'>;

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
  const vistos = new Set<string>();
  return [...puertos]
    .filter((p) => p.estado === 'ocupado' && p.client_id)
    .sort((a, b) => a.puerto_numero - b.puerto_numero)
    .filter((p) => {
      const key = p.contract_id ?? p.client_id!;
      if (vistos.has(key)) return false;
      vistos.add(key);
      return true;
    });
}
