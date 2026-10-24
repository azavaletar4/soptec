// Fase 174 (continuacion) — nucleo puro de las alertas de caida/recuperacion
// de enlaces WAN del balanceador (sesiones PPPoE-WAN y puertos fisicos
// SFP). Sin I/O aqui a proposito -- mikrotikBalancerDiscoveryService.ts
// hace la parte con I/O usando esta funcion.

import type { ConnectionStatus } from './balancerDiscovery';

export type WanLinkKind = 'pppoe_connection' | 'physical_port';

export interface AlertTransition {
  shouldFire: boolean;
  shouldResolve: boolean;
}

/**
 * Decide si hay que abrir o cerrar una alerta de enlace caido. Mismo
 * criterio que decideAlertTransition de saturacion (Fase 172):
 *  - 'down' sin alerta activa -> dispara una nueva (requisito: nunca
 *    duplicar -- si ya hay una activa, no se abre otra).
 *  - cualquier estado que NO sea 'down' con una alerta activa -> la
 *    resuelve. Esto incluye 'disabled': una linea que se deshabilita
 *    mientras tenia una averia activa deja de mostrarse como caida (no es
 *    una averia, es una decision administrativa) -- requisito explicito
 *    del pedido ("las deshabilitadas no deben tratarse como averias").
 *  - 'disabled'/'up' sin alerta activa -> no hace nada (nunca dispara una
 *    alerta para un estado que no es 'down').
 *
 * Esta funcion SOLO debe llamarse con un `currentStatus` proveniente de una
 * lectura fresca y exitosa del router (ver discoverAndSyncBalancerConnections
 * -- si el router no respondio, el ciclo entero se aborta antes de llegar
 * aqui) -- nunca con un estado reconstruido de datos obsoletos.
 */
export function decideWanLinkAlertTransition(currentStatus: ConnectionStatus, hasActiveAlert: boolean): AlertTransition {
  if (currentStatus === 'down' && !hasActiveAlert) return { shouldFire: true, shouldResolve: false };
  if (currentStatus !== 'down' && hasActiveAlert) return { shouldFire: false, shouldResolve: true };
  return { shouldFire: false, shouldResolve: false };
}

export interface WanLinkIdentity {
  kind: WanLinkKind;
  name: string;
}

/** Clave estable para indexar alertas activas por enlace (device_id ya se filtra aparte en la consulta). */
export function wanLinkAlertKey(link: WanLinkIdentity): string {
  return `${link.kind}:${link.name}`;
}
