/**
 * Limite de hardware GPON tipico en tarjetas ZTE (onu-id 1-128 por puerto
 * PON) — fuente unica para no repetir el numero en cada pantalla que
 * muestra ocupacion (AuthorizeOnuModal.vue la usa para "este puerto").
 */
export const PON_PORT_MAX_ONUS = 128;

export interface PonZoneCount {
  zoneId: string;
  zoneName: string;
  count: number;
}

export interface PonPortOccupancy {
  /** Identificador fisico real de la OLT (ZTE) — nunca se altera ni se renombra. */
  slot: number;
  port: number;
  /**
   * Numero operativo correlativo (PON 01, 02, ...), calculado SOLO sobre los
   * puertos ya conocidos (los que tienen al menos una ONT sincronizada aqui
   * alguna vez) — no sobre el total fisico real de la tarjeta, que este
   * codigo no conoce (ver comentario de `computePonOccupancy`). Si un puerto
   * de un slot anterior que hoy no tiene ninguna ONT llega a tener su
   * primera, este numero se corre para los puertos posteriores — limitacion
   * documentada, no un bug.
   */
  ponNumber: number;
  count: number;
  max: number;
  pct: number;
  /**
   * Zona con mas ONTs vinculadas en este puerto (via olt_onts.zone_id, dato
   * ya existente, ninguna tabla nueva) — NO es necesariamente "la" zona
   * comercial asignada a este PON, solo la que predomina hoy entre las ONTs
   * ya sincronizadas. null = ninguna ONT de este puerto tiene zona vinculada
   * (pendiente de vincular, no se adivina).
   */
  dominantZone: PonZoneCount | null;
  /** Cuantas zonas DISTINTAS, ademas de la predominante, tienen al menos una ONT en este puerto. */
  otherZonesCount: number;
  /** Desglose completo (predominante primero), para el detalle expandible. */
  zoneBreakdown: PonZoneCount[];
}

/**
 * Agrupa ONTs ya conocidos (olt_onts, tal como llegan de la cache local) por
 * puerto PON (slot/port) para una vista de ocupacion por puerto, con el
 * numero operativo correlativo y la zona predominante de cada uno.
 *
 * No refleja ONUs que existan en la OLT real pero aun no se hayan
 * importado/sincronizado — mismo limite que ya tienen los contadores de
 * resumen (summary) de esta pantalla. Por el mismo motivo, `ponNumber` es
 * correlativo sobre los puertos YA conocidos, no sobre el total fisico real
 * de cada tarjeta (este codigo no tiene forma de leer eso sin un comando
 * nuevo contra la OLT real, fuera de alcance aqui).
 *
 * La zona de cada puerto NO es 1 a 1 confiable: datos reales de produccion
 * (2026-10-13) muestran puertos con ONTs de mas de una zona mezcladas (ver
 * ESTADO_DESARROLLO.md, Fase 3) — por eso se expone la zona predominante MAS
 * el desglose completo, nunca una sola zona "adivinada" por el nombre.
 */
export function computePonOccupancy(
  onts: readonly { slot: number; port: number; zones?: { id: string; name: string } | null }[],
): PonPortOccupancy[] {
  const map = new Map<string, { slot: number; port: number; count: number; zones: Map<string, PonZoneCount> }>();
  for (const o of onts) {
    const key = `${o.slot}/${o.port}`;
    const entry = map.get(key) ?? { slot: o.slot, port: o.port, count: 0, zones: new Map<string, PonZoneCount>() };
    entry.count += 1;
    if (o.zones) {
      const z = entry.zones.get(o.zones.id) ?? { zoneId: o.zones.id, zoneName: o.zones.name, count: 0 };
      z.count += 1;
      entry.zones.set(o.zones.id, z);
    }
    map.set(key, entry);
  }
  return [...map.values()]
    .sort((a, b) => a.slot - b.slot || a.port - b.port)
    .map((e, i) => {
      const zoneBreakdown = [...e.zones.values()].sort((a, b) => b.count - a.count || a.zoneName.localeCompare(b.zoneName));
      return {
        slot: e.slot,
        port: e.port,
        ponNumber: i + 1,
        count: e.count,
        max: PON_PORT_MAX_ONUS,
        pct: Math.min(100, (e.count / PON_PORT_MAX_ONUS) * 100),
        dominantZone: zoneBreakdown[0] ?? null,
        otherZonesCount: Math.max(0, zoneBreakdown.length - 1),
        zoneBreakdown,
      };
    });
}
