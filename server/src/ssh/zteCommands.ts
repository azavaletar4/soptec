/**
 * Comandos CLI para OLT ZTE serie C300 (ZXA10).
 *
 * ADVERTENCIA — nivel de confianza menor que si fuera Huawei/V-SOL:
 * el material del curso de referencia (curso/) solo documenta OLTs Huawei
 * MA5800 y V-SOL; NO cubre ZTE. Lo de aqui se basa en las convenciones
 * generales, publicamente conocidas, de la CLI ZXA10 C300 (estilo Cisco:
 * enable / configure terminal / interface gpon-olt_S/L/P), pero la sintaxis
 * exacta varia segun la version de firmware instalada.
 *
 * ANTES DE USAR EN PRODUCCION:
 *   1. Verifica cada comando de LECTURA (los "show ...") a mano por SSH
 *      contra tu equipo real y compara el formato de salida con los
 *      parsers en zteParsers.ts (ajusta los regex si difiere).
 *   2. Prueba los comandos de ESCRITURA (onu add / admin-state / delete)
 *      primero en un puerto de pruebas o con una ONU de repuesto — nunca
 *      directo contra un puerto con clientes activos.
 *   3. Corrige la sintaxis aqui mismo si tu firmware usa otra variante.
 */

export interface ZteInterfaceRef {
  /** "Shelf" del chasis. En un despliegue de un solo chasis, normalmente 1. */
  shelf: number;
  slot: number;
  port: number;
}

function oltInterface({ shelf, slot, port }: ZteInterfaceRef): string {
  return `gpon-olt_${shelf}/${slot}/${port}`;
}

function onuInterface(ref: ZteInterfaceRef, onuId: number): string {
  return `gpon-onu_${ref.shelf}/${ref.slot}/${ref.port}:${onuId}`;
}

export function testConnectionCommands(): string[] {
  // "show version" resulto ambiguo en esta CLI real (Error 20204); se usa
  // un comando de solo lectura ya validado contra el equipo real (10.15.15.2).
  return ['enable', 'show gpon onu uncfg'];
}

/** Lista las ONUs ya configuradas/registradas en un puerto PON especifico. */
export function listOntsCommands(ref: ZteInterfaceRef): string[] {
  return ['enable', `show gpon onu state ${oltInterface(ref)}`];
}

/**
 * Lista TODAS las ONUs configuradas de la OLT, de una sola vez (sin filtrar
 * por puerto) — VALIDADO contra el equipo real: 646/675 filas capturadas en
 * ~8s (paginacion "--More--" manejada por el cliente Telnet). Evita tener
 * que recorrer puerto por puerto para armar un resumen general.
 */
export function listAllOntsCommands(): string[] {
  return ['enable', 'show gpon onu state'];
}

/** Lista ONUs detectadas por la OLT pero AUN NO registradas (solo su serial). */
export function listUnconfiguredOntsCommands(): string[] {
  return ['enable', 'show gpon onu uncfg'];
}

export function registerOntCommands(params: {
  ref: ZteInterfaceRef;
  onuId: number;
  serial: string;
  onuType: string;
  vlan: number;
  description: string;
}): string[] {
  const { ref, onuId, serial, onuType, vlan, description } = params;
  const safeDesc = description.replace(/"/g, "'");
  return [
    'enable',
    'configure terminal',
    `interface ${oltInterface(ref)}`,
    `onu ${onuId} type ${onuType} sn ${serial}`,
    'exit',
    `interface ${onuInterface(ref, onuId)}`,
    `description "${safeDesc}"`,
    'tcont 1 name INTERNET',
    'gemport 1 tcont 1',
    `service-port 1 vport 1 user-vlan ${vlan} vlan ${vlan}`,
    'exit',
  ];
}

export function setAdminStateCommands(ref: ZteInterfaceRef, onuId: number, enable: boolean): string[] {
  return [
    'enable',
    'configure terminal',
    `interface ${oltInterface(ref)}`,
    `onu ${onuId} admin-state ${enable ? 'enable' : 'disable'}`,
    'exit',
  ];
}

export function deleteOntCommands(ref: ZteInterfaceRef, onuId: number): string[] {
  return [
    'enable',
    'configure terminal',
    `interface ${oltInterface(ref)}`,
    `no onu ${onuId}`,
    'exit',
  ];
}

export function opticalInfoCommands(ref: ZteInterfaceRef, onuId: number): string[] {
  return ['enable', `show pon power attenuation ${onuInterface(ref, onuId)}`];
}
