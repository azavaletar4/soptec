/**
 * Caso real (Diego Villanueva Bernabe, CTR-2026-00727, 2026-10-21): la
 * ficha administrativa mostraba ~30 filas de "Materiales usados" para 4
 * materiales reales -- varios intentos de registrar el mismo kit
 * quedaron revertidos ("Reversión contextual de Campo") antes del
 * intento final que sí quedó vigente. inventory_order_read('materials')
 * devuelve el Kardex crudo (egreso + ingreso de reversión, sin netear) a
 * propósito -- es la fuente de auditoría. Esta función es solo de
 * PRESENTACIÓN: no borra ni corrige ningún movimiento, únicamente decide
 * cuáles mostrar como "material vigente" en la ficha -- un egreso ya
 * revertido y su ingreso de reversión se excluyen de la lista (se
 * cancelan entre sí), nunca de la base de datos.
 */
export interface MaterialMovementLike {
  id: string;
  movement_type: 'ingreso' | 'egreso';
  reverses_movement_id: string | null;
}

export function activeMaterialMovements<T extends MaterialMovementLike>(movements: T[]): T[] {
  const reversedIds = new Set(movements.filter((m) => m.reverses_movement_id).map((m) => m.reverses_movement_id as string));
  return movements.filter((m) => !m.reverses_movement_id && !reversedIds.has(m.id));
}
