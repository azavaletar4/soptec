// Habilitacion guiada de TR-069 por ONT (requisito del propietario,
// 2026-10-27): un boton individual, solo ADMIN/SUPERADMIN, que verifica
// identidad/vinculo ANTES de tocar la OLT. Logica pura y testeable —
// separada de server/src/routes/olt.ts (que hace el I/O real: Supabase,
// Telnet) para poder probar las reglas sin Docker ni la OLT real, mismo
// criterio que server/src/services/oltDisabledReason.ts.
import { gponVendorFromSerial, isThirdPartyOnt, type GponVendorInfo } from '../../../src/lib/gponVendorId';

export const TR069_ENABLE_ROLES = ['SUPERADMIN', 'ADMIN'] as const;
export type Tr069EnableRole = (typeof TR069_ENABLE_ROLES)[number];

export type Tr069EnableRejection =
  | 'FORBIDDEN_ROLE'
  | 'RETIRED'
  | 'ALREADY_ENABLED'
  | 'NOT_LINKED'
  | 'IN_FLIGHT';

export interface Tr069EnableOntInput {
  serial: string;
  retired_at: string | null;
  tr069_enabled: boolean;
  client_id: string | null;
  contract_id: string | null;
  /** Embed resuelto de service_contracts para contract_id — null si no se pudo resolver (contrato borrado/invalido). */
  service_contract: { id: string } | null;
}

export interface Tr069EnableCheckResult {
  ok: boolean;
  rejection?: Tr069EnableRejection;
  message?: string;
  vendor: GponVendorInfo;
  /** Informativo, nunca bloqueante: la ONT no es de la misma marca que la OLT (ver advertencia de compatibilidad, requisito 4). */
  thirdPartyVendor: boolean;
}

const REJECTION_MESSAGES: Record<Tr069EnableRejection, string> = {
  FORBIDDEN_ROLE: 'Solo ADMIN/SUPERADMIN pueden habilitar TR-069.',
  RETIRED: 'La ONT está retirada; su posición es histórica y no admite esta operación.',
  ALREADY_ENABLED: 'TR-069 ya está habilitado para esta ONT. Usa "Administrar TR-069" para cambiarlo.',
  NOT_LINKED: 'Pendiente de vincular: esta ONT no tiene cliente y contrato verificados todavía.',
  IN_FLIGHT: 'Ya hay una solicitud de habilitación en curso para esta ONT.',
};

/** Vinculo verificado = mismo criterio que isLinked() en src/lib/oltConnectionStatus.ts. */
function isVerifiedLinked(ont: Tr069EnableOntInput): boolean {
  return Boolean(ont.client_id) && Boolean(ont.contract_id) && Boolean(ont.service_contract);
}

export function validateTr069EnableRequest(input: {
  role: string;
  ont: Tr069EnableOntInput;
  oltBrand: string;
}): Tr069EnableCheckResult {
  const vendor = gponVendorFromSerial(input.ont.serial);
  const thirdPartyVendor = isThirdPartyOnt(vendor, input.oltBrand);
  const reject = (rejection: Tr069EnableRejection): Tr069EnableCheckResult => ({
    ok: false,
    rejection,
    message: REJECTION_MESSAGES[rejection],
    vendor,
    thirdPartyVendor,
  });

  if (!TR069_ENABLE_ROLES.includes(input.role as Tr069EnableRole)) return reject('FORBIDDEN_ROLE');
  if (input.ont.retired_at) return reject('RETIRED');
  if (input.ont.tr069_enabled) return reject('ALREADY_ENABLED');
  if (!isVerifiedLinked(input.ont)) return reject('NOT_LINKED');

  return { ok: true, vendor, thirdPartyVendor };
}

/**
 * Reverificacion en vivo (requisito 2/3): antes de escribir nada en la OLT,
 * confirma que la posicion seleccionada SIGUE teniendo el mismo serial que
 * SmartRayco tiene registrado — usando fullRunningConfigCommand()/
 * parseFullRunningConfig() (YA validado contra el equipo real), nunca
 * `show gpon onu state` (esa tabla no trae serial). Si no coincide: regla 8
 * de la migracion OLT — se detiene, nunca se adivina cual fuente tiene razon.
 */
export function verifyLivePosition(input: {
  expectedSerial: string;
  liveSerial: string | null;
}): { ok: boolean; message?: string } {
  if (!input.liveSerial) {
    return { ok: false, message: 'No se encontró esta posición en la configuración viva de la OLT. Deteniendo por seguridad.' };
  }
  if (input.liveSerial.trim().toUpperCase() !== input.expectedSerial.trim().toUpperCase()) {
    return {
      ok: false,
      message: `Discrepancia de serial en esta posición: la OLT reporta ${input.liveSerial}, SmartRayco tiene registrado ${input.expectedSerial}. Deteniendo por seguridad — regla 8 de la migración OLT.`,
    };
  }
  return { ok: true };
}
