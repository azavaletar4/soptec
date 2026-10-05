import type { EquipmentPhotoType } from '@/types/domain';

/**
 * Etiquetas del tipo de equipo para la galeria dinamica de fotos de serie
 * (Fase 105) — usado en App de Campo, Ficha del Cliente y Panel de
 * Aprobación, centralizado para que los 3 no se desincronicen.
 */
export const EQUIPMENT_TYPE_LABEL: Record<EquipmentPhotoType, string> = {
  modem: 'Módem / ONU',
  tv_box: 'TV Box',
  mesh: 'Repetidor Mesh',
  otro: 'Otro',
};

export const EQUIPMENT_TYPE_OPTIONS: { value: EquipmentPhotoType; label: string }[] = (
  Object.entries(EQUIPMENT_TYPE_LABEL) as [EquipmentPhotoType, string][]
).map(([value, label]) => ({ value, label }));
