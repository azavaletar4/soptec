/**
 * Fase 3 comercial OLT — Fase B (sigue a la Fase A de
 * src/lib/ponZoneMapping.ts, ver ESTADO_DESARROLLO.md 13ak/13al):
 * baja la comparación PON↔zona del nivel de PUERTO agregado (Fase A,
 * `dominantZone` de `computePonOccupancy` — la zona que predomina entre
 * TODAS las ONTs de un puerto) al nivel de CADA ONT individual, cruzando
 * con su cliente y contrato reales vía columnas ya existentes
 * (`olt_onts.client_id`/`contract_id`, `service_contracts.zone_id`) —
 * sin tabla ni columna nueva.
 *
 * Por qué hace falta además de la Fase A: un puerto con ONTs de 2-3 zonas
 * mezcladas (dato real de producción, 13ac/13ad) puede mostrar "mismatch"
 * a nivel de puerto sin que eso diga NADA sobre un cliente en particular
 * — puede ser el ONT equivocado, o puede ser exactamente el que sí
 * coincide. Esta Fase B evalúa cada ONT por separado para no generar
 * falsos positivos de ese tipo (requisito explícito del usuario).
 *
 * Regla dura (CLAUDE.md, migración OLT, punto 4 y pedido explícito de
 * Fase B): nunca se asume que el nombre/descr de la OLT equivale a un
 * vínculo real. Por eso `client`/`contract` del resultado solo se llenan
 * cuando AMBOS `client_id` y `contract_id` existen en `olt_onts` Y el
 * contrato fue efectivamente resuelto (`service_contracts` embebido) —
 * nunca a partir del `description` de la OLT.
 *
 * Solo compara y clasifica — nunca escribe, nunca vincula, nunca corrige
 * ninguna zona.
 */

import { type ZoneLike, type PonZoneCatalog } from './ponZoneMapping';

export interface OntZoneDiscrepancyOnt {
  id: string;
  serial: string;
  slot: number;
  port: number;
  ont_id: number;
  client_id: string | null;
  /** Opcional en OltOnt (Fase 37, llega solo si el backend ya lo lee) — ausente se trata igual que null. */
  contract_id?: string | null;
  /** Texto libre (puede venir de la OLT o de una edición administrativa, 13ai) — solo se MUESTRA, nunca se usa para inferir cliente/contrato. */
  description?: string | null;
  /** Zona registrada en la propia ONT (olt_onts.zone_id) — editable desde "Editar información", puede desactualizarse. */
  zones?: ZoneLike | null;
  clients?: { id: string; first_name: string; last_name: string } | null;
  /** Contrato vinculado (service_contracts), con su propia zona de instalación — fuente comercial real (Fase 38). */
  service_contracts?: {
    id: string;
    contract_number: string | null;
    client_code: string | null;
    status: string;
    zones?: ZoneLike | null;
  } | null;
}

export type ZoneVsOfficial = 'match' | 'mismatch' | 'not_set';

export type OntZoneCaseStatus =
  | 'match'
  | 'zone_mismatch'
  | 'unlinked'
  | 'no_official'
  | 'ambiguous_catalog';

export interface OntZoneDiscrepancy {
  ontDbId: string;
  serial: string;
  description: string | null;
  slot: number;
  port: number;
  ontId: number;
  ponNumber: number | null;
  caseStatus: OntZoneCaseStatus;
  officialZone: ZoneLike | null;
  ontZone: ZoneLike | null;
  contractZone: ZoneLike | null;
  ontVsOfficial: ZoneVsOfficial;
  contractVsOfficial: ZoneVsOfficial;
  /** Solo si caseStatus = 'ambiguous_catalog': las 2+ zonas que declaran el mismo numero de PON. */
  ambiguousCandidates: ZoneLike[] | null;
  /** null si no esta vinculado — nunca se infiere desde el nombre/descripcion de la OLT. */
  client: { id: string; name: string } | null;
  /** null si no esta vinculado. */
  contract: { id: string; contractNumber: string | null; clientCode: string | null } | null;
}

function zoneVs(a: ZoneLike | null, b: ZoneLike | null): ZoneVsOfficial {
  if (!a || !b) return 'not_set';
  return a.id === b.id ? 'match' : 'mismatch';
}

/** `computePonOccupancy(...)` ya calcula el numero de PON por slot/puerto — este mapa solo lo indexa para lookup O(1) por ONT. */
export function buildPonNumberMap(ponPorts: readonly { slot: number; port: number; ponNumber: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of ponPorts) m.set(`${p.slot}/${p.port}`, p.ponNumber);
  return m;
}

/**
 * Evalua, ONT por ONT, la relacion PON fisico -> zona oficial -> zona de
 * la propia ONT -> zona del contrato vinculado. No decide cual fuente
 * tiene razon ante una discrepancia (regla 8 de la migracion OLT,
 * CLAUDE.md) — solo clasifica para revision administrativa.
 */
export function evaluateOntZoneDiscrepancies(
  onts: readonly OntZoneDiscrepancyOnt[],
  ponNumberBySlotPort: ReadonlyMap<string, number>,
  catalog: PonZoneCatalog<ZoneLike>,
): OntZoneDiscrepancy[] {
  return onts.map((o) => {
    const ponNumber = ponNumberBySlotPort.get(`${o.slot}/${o.port}`) ?? null;
    const ontZone = o.zones ?? null;
    const contractRow = o.service_contracts ?? null;
    const contractZone = contractRow?.zones ?? null;
    const linked = Boolean(o.client_id) && Boolean(o.contract_id) && Boolean(contractRow);

    const client = linked && o.clients ? { id: o.clients.id, name: `${o.clients.first_name} ${o.clients.last_name}`.trim() } : null;
    const contract =
      linked && contractRow ? { id: contractRow.id, contractNumber: contractRow.contract_number, clientCode: contractRow.client_code } : null;

    const base = {
      ontDbId: o.id,
      serial: o.serial,
      description: o.description ?? null,
      slot: o.slot,
      port: o.port,
      ontId: o.ont_id,
      ponNumber,
      ontZone,
      contractZone,
      client,
      contract,
    };

    if (ponNumber == null) {
      return { ...base, caseStatus: 'no_official' as const, officialZone: null, ontVsOfficial: 'not_set' as const, contractVsOfficial: 'not_set' as const, ambiguousCandidates: null };
    }

    const duplicates = catalog.duplicatePonNumbers.get(ponNumber);
    if (duplicates) {
      return { ...base, caseStatus: 'ambiguous_catalog' as const, officialZone: null, ontVsOfficial: 'not_set' as const, contractVsOfficial: 'not_set' as const, ambiguousCandidates: duplicates };
    }

    const officialZone = catalog.byPonNumber.get(ponNumber) ?? null;
    if (!officialZone) {
      return { ...base, caseStatus: 'no_official' as const, officialZone: null, ontVsOfficial: 'not_set' as const, contractVsOfficial: 'not_set' as const, ambiguousCandidates: null };
    }

    const ontVsOfficial = zoneVs(ontZone, officialZone);
    const contractVsOfficial = zoneVs(contractZone, officialZone);

    if (!linked) {
      return { ...base, caseStatus: 'unlinked' as const, officialZone, ontVsOfficial, contractVsOfficial, ambiguousCandidates: null };
    }

    const caseStatus: OntZoneCaseStatus = ontVsOfficial === 'mismatch' || contractVsOfficial === 'mismatch' ? 'zone_mismatch' : 'match';
    return { ...base, caseStatus, officialZone, ontVsOfficial, contractVsOfficial, ambiguousCandidates: null };
  });
}

/**
 * Corrección puntual (2026-10-13, ver ESTADO_DESARROLLO.md 13aq): mientras
 * dura la migración desde SmartOLT (~400 ONTs sin cliente/contrato
 * vinculado todavía, ver CLAUDE.md — Situación A), la inmensa mayoría de
 * `evaluateOntZoneDiscrepancies` cae en `unlinked` — eso es ESPERADO, no
 * una discrepancia de zona. Contar `unlinked` junto con `zone_mismatch`/
 * `ambiguous_catalog`/`no_official` bajo un solo "N con revisión
 * pendiente" generaba falsas alarmas masivas (confirmado en producción:
 * casi todas las ONTs de un puerto marcadas como "problema" solo por
 * faltar vincular). Esta función separa los 3 grupos reales:
 *
 * - `pendienteVinculacion`: sin client_id/contract_id verificable —
 *   normal durante la migración, NUNCA se cuenta como discrepancia.
 * - `discrepanciaReal`: ONT vinculada (cliente+contrato reales) cuya
 *   zona no coincide con la oficial del PON — esto SÍ es un problema.
 * - `datosAmbiguos`: catálogo con 2+ zonas para el mismo número de PON,
 *   o PON sin ninguna zona oficial — requiere revisión del catálogo,
 *   pero no es (todavía) una discrepancia confirmada sobre un cliente.
 *
 * `match` no se cuenta en ningún grupo — no amerita revisión.
 */
export interface PonPortIssueCounts {
  pendienteVinculacion: number;
  discrepanciaReal: number;
  datosAmbiguos: number;
}

export function countPonPortIssues(rows: readonly OntZoneDiscrepancy[]): PonPortIssueCounts {
  let pendienteVinculacion = 0;
  let discrepanciaReal = 0;
  let datosAmbiguos = 0;
  for (const r of rows) {
    if (r.caseStatus === 'unlinked') pendienteVinculacion++;
    else if (r.caseStatus === 'zone_mismatch') discrepanciaReal++;
    else if (r.caseStatus === 'ambiguous_catalog' || r.caseStatus === 'no_official') datosAmbiguos++;
  }
  return { pendienteVinculacion, discrepanciaReal, datosAmbiguos };
}

/**
 * Ajuste puntual (2026-10-13, ver ESTADO_DESARROLLO.md 13ar): el desglose
 * de "Ocupación por puerto PON" (`computePonOccupancy`, Fase 3) solo suma
 * al `zoneBreakdown` las ONTs que SÍ tienen una zona propia asignada
 * (`olt_onts.zone_id`, ver oltCapacity.ts) — una ONT sin zona asignada
 * queda fuera de ese desglose aunque sí cuenta en `p.count` (el total del
 * puerto), lo que dejaba "ONTs sin explicar" (caso real reportado:
 * 61 total, 57 + 2 en el desglose, 2 sin ninguna fila que las muestre).
 *
 * `ontsInZone` filtra las ONTs de Fase B (`OntZoneDiscrepancy.ontZone`,
 * que es exactamente la misma zona propia que cuenta `zoneBreakdown` —
 * no la "zona oficial" de Fase A) por esa zona exacta, o por "sin zona"
 * (`zoneId === null`) — mismo criterio en ambos casos, sin inventar
 * ninguna cantidad por resta: usado tanto para abrir el detalle de una
 * fila del desglose como para contar cuántas quedan "sin zona
 * identificada".
 */
export function ontsInZone(rows: readonly OntZoneDiscrepancy[], zoneId: string | null): OntZoneDiscrepancy[] {
  return zoneId === null ? rows.filter((r) => !r.ontZone) : rows.filter((r) => r.ontZone?.id === zoneId);
}
