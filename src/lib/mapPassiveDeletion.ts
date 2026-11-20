import { supabase } from '@/lib/supabase';
import { useConfirm } from '@/composables/useConfirm';
import type { FoHiloEstado } from '@/types/domain';

export type MapRemovalKind = 'cable' | 'infra' | 'hilo';
export interface MapRemovalPreview {
  id: string;
  kind: MapRemovalKind;
  hilo: number | null;
  token: string;
  clientes: number;
  asignaciones: number;
  ordenes: number;
  conexiones: number;
  empalmes: number;
}
export interface MapRemovalResult {
  id: string;
  kind: MapRemovalKind;
  hilo: number | null;
  removedAt: string;
  fusionIds: string[];
  thread?: FoHiloEstado;
}

export function canDeleteMapPassive(role: string | null): boolean {
  return role === 'SUPERADMIN';
}

function checkError(error: { code?: string; message?: string } | null) {
  if (error?.code === 'PGRST202') throw new Error('La eliminación segura no está disponible. Contacta al administrador.');
  if (error?.code === '55P03' || error?.code === '40P01') throw new Error('Hay otra operación en curso. Espera un momento y revisa de nuevo el resumen antes de confirmar.');
  if (error) throw error;
}

export async function previewMapRemoval(kind: MapRemovalKind, id: string, hilo: number | null = null): Promise<MapRemovalPreview> {
  const { data, error } = await supabase.rpc('preview_map_removal', { p_kind: kind, p_id: id, p_hilo: hilo });
  checkError(error);
  if (data?.id !== id || data.kind !== kind || data.hilo !== hilo || !data.token) throw new Error('No se pudo verificar el resumen. Actualiza el mapa.');
  return data as MapRemovalPreview;
}

export async function confirmMapRemoval(kind: MapRemovalKind, id: string, name: string, hilo: number | null = null): Promise<MapRemovalPreview | null> {
  const preview = await previewMapRemoval(kind, id, hilo);
  const inUse = preview.clientes + preview.asignaciones + preview.ordenes
    + (kind === 'infra' ? preview.conexiones + preview.empalmes : 0) > 0;
  const ok = await useConfirm().confirmDialog({
    title: kind === 'infra' && inUse ? 'Elemento en uso' : 'Eliminar del mapa',
    message: `¿Eliminar "${name}" del mapa?\n${preview.conexiones} conexiones · ${preview.empalmes} empalmes.\n${preview.clientes} clientes · ${preview.asignaciones} asignaciones · ${preview.ordenes} órdenes relacionadas.\nSe conservarán los registros, las referencias operativas y el historial. Solo se retirará la representación del mapa y sus empalmes visibles.`,
    wrapMessage: true,
    warning: inUse,
    focusCancel: true,
    confirmLabel: 'Eliminar del mapa',
  });
  return ok ? preview : null;
}

/** Baja digital atómica; PostgreSQL conserva todas las FK y asignaciones. */
export async function deleteMapPassive(kind: MapRemovalKind, id: string, preview?: MapRemovalPreview, hilo: number | null = null): Promise<MapRemovalResult> {
  const expected = preview ?? await previewMapRemoval(kind, id, hilo);
  if (expected.id !== id || expected.kind !== kind || expected.hilo !== hilo) throw new Error('El resumen no corresponde al elemento seleccionado.');
  const { data, error } = await supabase.rpc('remove_from_network_map', { p_kind: kind, p_id: id, p_hilo: hilo, p_token: expected.token });
  checkError(error);
  if (data?.id !== id || data.kind !== kind || data.hilo !== hilo || !data.removedAt || !Array.isArray(data.fusionIds)) throw new Error('No se confirmó la eliminación. Actualiza el mapa antes de reintentar.');
  if (kind === 'hilo' && (data.thread?.cable_id !== id || data.thread.hilo_index !== hilo || !data.thread.map_removed_at)) throw new Error('No se confirmó la baja del hilo. Actualiza el mapa antes de reintentar.');
  return data as MapRemovalResult;
}
