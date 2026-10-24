// Fase 171 — clasificacion de routers MikroTik por funcion.
//
// Hasta ahora todo router registrado se trataba como administrador PPPoE.
// 'pppoe_admin' es el UNICO rol que participa en reconciliacion PPPoE
// (mikrotikReconcileService.ts), corte por deuda y cambio de perfil
// (debtHoldService.ts) — los routers de borde solo se consultan de
// solo lectura (recurso, interfaces).
export const MIKROTIK_DEVICE_ROLES = ['pppoe_admin', 'borde_dedicado', 'borde_balanceador'] as const;

export type MikrotikDeviceRole = (typeof MIKROTIK_DEVICE_ROLES)[number];

export const DEFAULT_MIKROTIK_DEVICE_ROLE: MikrotikDeviceRole = 'pppoe_admin';

export function isValidMikrotikDeviceRole(value: unknown): value is MikrotikDeviceRole {
  return typeof value === 'string' && (MIKROTIK_DEVICE_ROLES as readonly string[]).includes(value);
}

/** true solo para el router que administra PPPoE de clientes — nunca para un borde (dedicado o balanceador). */
export function isPppoeAdminRole(role: string | null | undefined): boolean {
  return role === DEFAULT_MIKROTIK_DEVICE_ROLE;
}
