import type { SupabaseClient } from '@supabase/supabase-js';
import type { FoCable, LatLngPoint } from '@/types/domain';

// Matches fo_cables_staff_only. Route access remains controlled by the router.
export function canEditCableRoute(role: string | null): boolean {
  return ['SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'].includes(role ?? '');
}

export function cloneRoute(points: LatLngPoint[]): LatLngPoint[] {
  return points.map(([lat, lng]) => [lat, lng]);
}

export function validateRoute(points: unknown): asserts points is LatLngPoint[] {
  if (!Array.isArray(points) || points.length < 2 || points.length > 10000
    || points.some(p => !Array.isArray(p) || p.length !== 2
      || !Number.isFinite(p[0]) || !Number.isFinite(p[1])
      || Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180)
    || points.every(p => p[0] === points[0][0] && p[1] === points[0][1])) {
    throw new Error('El recorrido debe tener entre 2 y 10.000 puntos válidos y una longitud mayor que cero.');
  }
}

export function routeLocks(cable: FoCable): { start: boolean; end: boolean } {
  return { start: !!(cable.origen_olt_id || cable.origen_infra_id), end: !!(cable.destino_olt_id || cable.destino_infra_id) };
}

export function translateRoute(points: LatLngPoint[], delta: LatLngPoint): LatLngPoint[] {
  const moved = points.map(([lat, lng]): LatLngPoint => [
    Number((lat + delta[0]).toFixed(7)), Number((lng + delta[1]).toFixed(7)),
  ]);
  validateRoute(moved);
  return moved;
}

export class CableRouteConflictError extends Error {
  constructor() {
    super('El cable cambió, fue retirado o ya no tienes permiso. Conservamos tu borrador. Cancela y vuelve a abrir el cable para cargar la versión actual.');
  }
}

/** One atomic PATCH with optimistic concurrency; only path is written. */
export async function persistCableRoute(client: SupabaseClient, cable: FoCable, points: LatLngPoint[], role: string | null): Promise<FoCable> {
  if (!canEditCableRoute(role)) throw new Error('No tienes permiso para editar trazados.');
  if (cable.map_removed_at || !cable.updated_at) throw new Error('Recarga el cable antes de editar su trazado.');
  validateRoute(points);
  const locks = routeLocks(cable);
  if ((locks.start && JSON.stringify(points[0]) !== JSON.stringify(cable.path[0]))
    || (locks.end && JSON.stringify(points.at(-1)) !== JSON.stringify(cable.path.at(-1)))) {
    throw new Error('Los extremos conectados deben permanecer en su posición original.');
  }
  const path = cloneRoute(points);
  const { data, error } = await client.from('fo_cables').update({ path })
    .eq('id', cable.id).eq('updated_at', cable.updated_at)
    .eq('path', JSON.stringify(cable.path)).is('map_removed_at', null).select('*').maybeSingle();
  if (error) throw error;
  if (!data) throw new CableRouteConflictError();
  if (data.id !== cable.id || data.map_removed_at || JSON.stringify(data.path) !== JSON.stringify(path) || !data.updated_at) {
    throw new Error('No se pudo confirmar el recorrido guardado. Recarga el cable antes de reintentar.');
  }
  return data as FoCable;
}
