import type { InfraElementoTipo } from '@/types/domain';

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Mayusculas, sin acentos, sin puntuacion — para comparar nombres de zonas/NAPs escritos de forma inconsistente. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

export interface ZoneLite {
  id: string;
  name: string;
}

export interface ZoneMatchSuggestion {
  zoneId: string;
  zoneName: string;
  score: number;
}

/**
 * Sugiere a que Zona de SmartRayco corresponde una carpeta de primer nivel
 * del KML (ej. "PON B4" → "PON 12 - ALTO TRUJILLO B4"). Es heuristico: se
 * usa solo como sugerencia por defecto en la vista previa, siempre
 * corregible por el usuario antes de confirmar la importacion.
 */
export function suggestZoneMatch(folderName: string, zones: ZoneLite[]): ZoneMatchSuggestion | null {
  const target = normalizeName(folderName).replace(/^PON\s*/, '');
  let best: ZoneMatchSuggestion | null = null;
  for (const z of zones) {
    const zn = normalizeName(z.name);
    const znSuffix = zn.replace(/^PON\s*\d+\s*-?\s*/, '');
    let score = 0;
    if (zn === normalizeName(folderName) || znSuffix === target) score = 100;
    else if (znSuffix.includes(target) || target.includes(znSuffix)) score = 75;
    else {
      const zt = new Set(znSuffix.split(' ').filter((t) => t.length > 2));
      const ft = new Set(target.split(' ').filter((t) => t.length > 2));
      const shared = [...ft].filter((t) => zt.has(t));
      score = shared.length && ft.size ? (shared.length / ft.size) * 60 : 0;
    }
    if (score > 0 && (!best || score > best.score)) best = { zoneId: z.id, zoneName: z.name, score };
  }
  return best;
}

export interface ExistingPointLite {
  id: string;
  name: string;
  tipo: InfraElementoTipo;
  lat: number;
  lng: number;
  zoneId: string | null;
  kmlRef: string | null;
}

export type PointMatchAction = 'create' | 'update' | 'conflict';

export interface PointMatchResult {
  action: PointMatchAction;
  matchId: string | null;
  reason: string | null;
  distanceMeters: number | null;
}

const NEARBY_METERS = 25;

/**
 * Empareja un punto del KML con un elemento pasivo existente de la MISMA
 * zona y tipo: primero por kml_ref exacto (re-importacion), luego por
 * nombre normalizado, y por ultimo por cercania. Ambiguo → 'conflict' (se
 * excluye siempre de la escritura automatica, se reporta para revisar a mano).
 */
export function matchPoint(
  point: { name: string; lat: number; lng: number },
  tipo: InfraElementoTipo,
  kmlRef: string,
  zoneId: string | null,
  existing: ExistingPointLite[],
): PointMatchResult {
  const byRef = existing.filter((e) => e.kmlRef === kmlRef);
  if (byRef.length === 1) {
    const d = haversineMeters(point.lat, point.lng, byRef[0].lat, byRef[0].lng);
    return { action: 'update', matchId: byRef[0].id, reason: 'misma referencia de una importación anterior', distanceMeters: d };
  }

  const scoped = existing.filter((e) => e.zoneId === zoneId && e.tipo === tipo);

  const byName = scoped.filter((e) => normalizeName(e.name) === normalizeName(point.name));
  if (byName.length === 1) {
    const d = haversineMeters(point.lat, point.lng, byName[0].lat, byName[0].lng);
    return { action: 'update', matchId: byName[0].id, reason: 'mismo nombre en la zona', distanceMeters: d };
  }
  if (byName.length > 1) {
    return { action: 'conflict', matchId: null, reason: `${byName.length} elementos con ese nombre en la zona`, distanceMeters: null };
  }

  const near = scoped
    .map((e) => ({ e, d: haversineMeters(point.lat, point.lng, e.lat, e.lng) }))
    .filter((x) => x.d <= NEARBY_METERS)
    .sort((a, b) => a.d - b.d);
  if (near.length === 1 || (near.length > 1 && near[0].d < near[1].d * 0.5)) {
    return { action: 'update', matchId: near[0].e.id, reason: `caja más cercana (${Math.round(near[0].d)} m)`, distanceMeters: near[0].d };
  }
  if (near.length > 1) {
    return { action: 'conflict', matchId: null, reason: `${near.length} cajas cercanas sin nombre claro`, distanceMeters: null };
  }

  return { action: 'create', matchId: null, reason: null, distanceMeters: null };
}

export interface EndpointCandidate {
  kind: 'infra' | 'olt';
  id: string;
  lat: number;
  lng: number;
}

const ENDPOINT_MAX_METERS = 30;

/** Busca el punto (NAP/MUFA/OLT) mas cercano a un extremo de cable, dentro de un radio razonable. */
export function nearestEndpoint(lat: number, lng: number, candidates: EndpointCandidate[]): { kind: 'infra' | 'olt'; id: string; distanceMeters: number } | null {
  let best: { kind: 'infra' | 'olt'; id: string; distanceMeters: number } | null = null;
  for (const c of candidates) {
    const d = haversineMeters(lat, lng, c.lat, c.lng);
    if (d <= ENDPOINT_MAX_METERS && (!best || d < best.distanceMeters)) best = { kind: c.kind, id: c.id, distanceMeters: d };
  }
  return best;
}
