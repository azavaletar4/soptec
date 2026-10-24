// Fase 171 — clasificacion de routers MikroTik por funcion. Espejo del
// mismo contrato en server/src/mikrotik/deviceRole.ts (frontend y backend
// no comparten build, se duplica a proposito — igual criterio que el resto
// de tipos de mikrotik.ts).
export const MIKROTIK_DEVICE_ROLES = ['pppoe_admin', 'borde_dedicado', 'borde_balanceador'] as const;

export type MikrotikDeviceRole = (typeof MIKROTIK_DEVICE_ROLES)[number];

export const DEFAULT_MIKROTIK_DEVICE_ROLE: MikrotikDeviceRole = 'pppoe_admin';

// Lenguaje simple para personal administrativo sin conocimientos de redes
// (regla permanente de usabilidad, ver CLAUDE.md).
export const MIKROTIK_DEVICE_ROLE_LABELS: Record<MikrotikDeviceRole, string> = {
  pppoe_admin: 'Administrador PPPoE (clientes)',
  borde_dedicado: 'Borde dedicado (una sola línea)',
  borde_balanceador: 'Borde balanceador (varias líneas)',
};

export const MIKROTIK_DEVICE_ROLE_HINTS: Record<MikrotikDeviceRole, string> = {
  pppoe_admin: 'Administra los usuarios PPPoE de los clientes. Participa en la reconciliación automática y en los cortes por deuda.',
  borde_dedicado: 'Recibe una sola línea de internet del proveedor. Solo lectura: no administra clientes ni se ve afectado por cortes por deuda.',
  borde_balanceador: 'Recibe varias líneas de internet y balancea entre ellas. Solo lectura: no administra clientes ni se ve afectado por cortes por deuda.',
};

export function isPppoeAdminRole(role: string | null | undefined): boolean {
  return role === DEFAULT_MIKROTIK_DEVICE_ROLE;
}
