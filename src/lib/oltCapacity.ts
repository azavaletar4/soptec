/**
 * Limite de hardware GPON tipico en tarjetas ZTE (onu-id 1-128 por puerto
 * PON) — fuente unica para no repetir el numero en cada pantalla que
 * muestra ocupacion (AuthorizeOnuModal.vue la usa para "este puerto").
 */
export const PON_PORT_MAX_ONUS = 128;

export interface PonPortOccupancy {
  slot: number;
  port: number;
  count: number;
  max: number;
  pct: number;
}

/**
 * Agrupa ONTs ya conocidos (olt_onts, tal como llegan de la cache local)
 * por puerto PON (slot/port) para una vista de ocupacion por puerto. No
 * refleja ONUs que existan en la OLT real pero aun no se hayan
 * importado/sincronizado — mismo limite que ya tienen los contadores de
 * resumen (summary) de esta pantalla.
 */
export function computePonOccupancy(onts: readonly { slot: number; port: number }[]): PonPortOccupancy[] {
  const map = new Map<string, PonPortOccupancy>();
  for (const o of onts) {
    const key = `${o.slot}/${o.port}`;
    const entry = map.get(key) ?? { slot: o.slot, port: o.port, count: 0, max: PON_PORT_MAX_ONUS, pct: 0 };
    entry.count += 1;
    map.set(key, entry);
  }
  return [...map.values()]
    .map((e) => ({ ...e, pct: Math.min(100, (e.count / e.max) * 100) }))
    .sort((a, b) => a.slot - b.slot || a.port - b.port);
}
