import type { TicketMotivoAveria } from '@/types/domain';

/**
 * "Causa técnica encontrada en campo" (Fase 103, antes "Motivo de la
 * avería") — causa raíz que el técnico elige al cerrar un ticket. Se usa en
 * 4 lugares (App de Campo, TicketDetailView, el selector de causa
 * preliminar al crear el ticket, y el reporte "Averías por causa") — vive
 * centralizado aquí para que los 4 no se desincronicen.
 */
export const MOTIVO_AVERIA_LABEL: Record<TicketMotivoAveria, string> = {
  bad_installation: 'Mala instalación',
  material_wear: 'Deterioro de material',
  client_damage: 'Daño provocado por el cliente (ej. mascota, golpe)',
  external_factor: 'Factor externo (corte de fibra troncal, corte eléctrico)',
  defective_equipment: 'Equipo defectuoso',
  other: 'Otra causa (especificar)',
};

export const MOTIVO_AVERIA_OPTIONS: { value: TicketMotivoAveria; label: string }[] = (
  Object.entries(MOTIVO_AVERIA_LABEL) as [TicketMotivoAveria, string][]
).map(([value, label]) => ({ value, label }));

/** Motivos que eximen al técnico de responsabilidad (Fase 49) — no dependen de su trabajo. */
export const MOTIVOS_EXIMEN_TECNICO: TicketMotivoAveria[] = ['client_damage', 'external_factor'];
