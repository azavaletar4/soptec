/**
 * Motivo de "ONT deshabilitada/cortada" (ver GET /:id/onts/disabled en
 * olt.ts) — pura, sin I/O, para poder probar el caso real que importa sin
 * depender de Supabase/Docker: un cliente con 2+ contratos donde solo UNO
 * está en mora nunca debe "contagiar" ese motivo a los demás servicios de
 * ese mismo cliente (corrección 13ay, ver ESTADO_DESARROLLO.md).
 *
 * El cruce de mora es SIEMPRE por `contract_id` EXACTO de la ONT — nunca
 * por `client_id`. Si la ONT no tiene `contract_id` (sin vincular o
 * vínculo parcial), nunca puede calificar como 'billing': sin un contrato
 * exacto y verificable, no hay evidencia de deuda que mostrar — el motivo
 * queda genérico ('manual', o null si tampoco está admin-disabled).
 */

export interface DisabledReasonInput {
  admin_state: 'enable' | 'disable';
  contract_id: string | null;
}

export type DisabledReason = 'manual' | 'billing' | 'both';

export function resolveDisabledReason(
  ont: DisabledReasonInput,
  suspendedContractIds: ReadonlySet<string>,
): DisabledReason | null {
  const manual = ont.admin_state === 'disable';
  const billing = Boolean(ont.contract_id) && suspendedContractIds.has(ont.contract_id as string);
  if (manual && billing) return 'both';
  if (billing) return 'billing';
  if (manual) return 'manual';
  return null;
}
