/**
 * Fase 3 comercial OLT — Fase A de "automatización PON–zona–contrato–App
 * Campo–Gestión de ONTs": relación VERIFICABLE (no automática, no de
 * escritura) entre el puerto PON físico (slot/puerto, numerado
 * correlativamente — ver computePonOccupancy en oltCapacity.ts) y la zona
 * comercial que le corresponde.
 *
 * Fuente de verdad OFICIAL: el propio catálogo `zones` ya codifica su
 * número de PON en el nombre ("PON 1 - AO", "PON 13  - REV" — convención
 * real del equipo, con espaciado inconsistente que este parser tolera).
 * Esto es INDEPENDIENTE de `olt_onts.zone_id` ("zona observada" —
 * computePonOccupancy.dominantZone), que es editable ONT por ONT desde el
 * panel y puede quedar desactualizada sin que nadie lo note (confirmado
 * con datos reales de producción en 13ac/13ad: un mismo puerto llegó a
 * tener ONTs de 2-3 zonas distintas vinculadas).
 *
 * Esta Fase A SOLO compara y reporta — nunca escribe, nunca reasigna zona
 * ni vincula nada. Ver ESTADO_DESARROLLO.md (13ak) para el plan de Fases
 * B-D, que sí tocarían escritura, con autorización aparte.
 */

export interface ZoneLike {
  id: string;
  name: string;
}

/** Extrae el número de PON del nombre de una zona ("PON 13  - REV" -> 13). null si el nombre no sigue la convención. */
export function parsePonNumberFromZoneName(name: string): number | null {
  const m = /^PON\s+(\d+)\s*-/i.exec(name.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface PonZoneCatalog<Z extends ZoneLike> {
  /** Número de PON -> única zona oficial que lo declara. */
  byPonNumber: Map<number, Z>;
  /** Número de PON -> 2+ zonas que lo declaran a la vez (dato sucio del propio catálogo, no de olt_onts). */
  duplicatePonNumbers: Map<number, Z[]>;
}

/** Construye el catálogo oficial PON->zona a partir de `zones` ya cargado (catalogsStore), sin tocar nada. */
export function buildOfficialPonZoneCatalog<Z extends ZoneLike>(zones: readonly Z[]): PonZoneCatalog<Z> {
  const seen = new Map<number, Z[]>();
  for (const z of zones) {
    const n = parsePonNumberFromZoneName(z.name);
    if (n == null) continue;
    const list = seen.get(n) ?? [];
    list.push(z);
    seen.set(n, list);
  }
  const byPonNumber = new Map<number, Z>();
  const duplicatePonNumbers = new Map<number, Z[]>();
  for (const [n, list] of seen) {
    if (list.length === 1) byPonNumber.set(n, list[0]);
    else duplicatePonNumbers.set(n, list);
  }
  return { byPonNumber, duplicatePonNumbers };
}

export type PonZoneMatch =
  | { status: 'match' }
  | { status: 'no_official' }
  | { status: 'no_observed' }
  | { status: 'mismatch'; officialZone: ZoneLike; observedZone: ZoneLike }
  | { status: 'ambiguous_catalog'; candidates: ZoneLike[] };

/**
 * Compara, para UN puerto PON (ya con su número operativo resuelto), la
 * zona oficial (del catálogo) contra la zona observada (la predominante
 * entre las ONTs ya vinculadas en ese puerto, calculada aparte por
 * computePonOccupancy). Nunca decide cuál tiene razón — solo clasifica la
 * relación para que un administrador la revise si hace falta.
 */
export function comparePonZone<Z extends ZoneLike>(
  ponNumber: number,
  observedZone: Z | null,
  catalog: PonZoneCatalog<Z>,
): PonZoneMatch {
  const duplicates = catalog.duplicatePonNumbers.get(ponNumber);
  if (duplicates) return { status: 'ambiguous_catalog', candidates: duplicates };

  const official = catalog.byPonNumber.get(ponNumber) ?? null;
  if (!official) return { status: 'no_official' };
  if (!observedZone) return { status: 'no_observed' };
  if (official.id === observedZone.id) return { status: 'match' };
  return { status: 'mismatch', officialZone: official, observedZone };
}
