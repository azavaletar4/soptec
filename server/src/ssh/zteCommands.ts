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

/**
 * Perfiles de ancho de banda ya configurados en la OLT (heredados de
 * SmartOLT: convencion "SMARTOLT-{N}M-UP" para tcont / "SMARTOLT-{N}M-DOWN"
 * para traffic) — VALIDADO contra el equipo real. Necesarios para registrar
 * una ONT con servicio real (ver registerOntCommands()).
 */
/**
 * Asigna el servidor ACS (GenieACS) a una ONT via TR-069 — VALIDADO
 * parcialmente contra el equipo real (10.15.15.2): la sintaxis fue
 * confirmada por el CLI (autocompletado + "?"), pero el "acs <url>" solo
 * se probo hasta el punto de aceptar la sintaxis, sin verificar aun que la
 * ONU efectivamente reporte a GenieACS (requiere una ONT con VEIP, ej. el
 * tipo ZTE-F660). A diferencia de Huawei (perfiles TR-069 numerados en la
 * OLT), la ZTE C300 apunta la URL del ACS directo por ONU:
 *   pon-onu-mng gpon-onu_S/L/P:ID
 *     tr069-mgmt {veip} acs <url>
 *     tr069-mgmt {veip} state {lock|unlock}
 * "veip" casi siempre es 1 (una sola interfaz virtual de gestion por ONU).
 */
export function setTr069AcsCommands(ref: ZteInterfaceRef, onuId: number, veip: number, acsUrl: string): string[] {
  return [
    'enable',
    'configure terminal',
    `pon-onu-mng ${onuInterface(ref, onuId)}`,
    `tr069-mgmt ${veip} acs ${acsUrl}`,
    `tr069-mgmt ${veip} state unlock`,
    'exit',
  ];
}

/** Desactiva la gestion TR-069 de una ONT (sin borrar la URL configurada). */
export function disableTr069Commands(ref: ZteInterfaceRef, onuId: number, veip: number): string[] {
  return [
    'enable',
    'configure terminal',
    `pon-onu-mng ${onuInterface(ref, onuId)}`,
    `tr069-mgmt ${veip} state lock`,
    'exit',
  ];
}

export function listTcontProfilesCommands(): string[] {
  return ['enable', 'show gpon profile tcont'];
}

export function listTrafficProfilesCommands(): string[] {
  return ['enable', 'show gpon profile traffic'];
}

export function registerOntCommands(params: {
  ref: ZteInterfaceRef;
  onuId: number;
  serial: string;
  onuType: string;
  vlan: number;
  description: string;
  tcontProfile: string;
  trafficProfile: string;
}): string[] {
  const { ref, onuId, serial, onuType, vlan, description, tcontProfile, trafficProfile } = params;
  const safeDesc = description.replace(/"/g, "'");
  return [
    'enable',
    'configure terminal',
    `interface ${oltInterface(ref)}`,
    `onu ${onuId} type ${onuType} sn ${serial}`,
    'exit',
    `interface ${onuInterface(ref, onuId)}`,
    `description "${safeDesc}"`,
    // "tcont 1 name ..." (sin perfil) es rechazado por el firmware real
    // ("Incomplete command") y deja la ONU sin ancho de banda real, aunque
    // el resto de la config se vea aplicada — CONFIRMADO contra el equipo
    // real. Los perfiles (ej. "SMARTOLT-100M-UP"/"SMARTOLT-100M-DOWN") ya
    // existen en la OLT (heredados de SmartOLT); listarlos con
    // "show gpon profile tcont" / "show gpon profile traffic".
    `tcont 1 profile ${tcontProfile}`,
    'gemport 1 tcont 1',
    `gemport 1 traffic-limit downstream ${trafficProfile}`,
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

/** Config aplicada en la OLT para una ONT puntual — solo lectura. */
export function runningConfigCommands(ref: ZteInterfaceRef, onuId: number): string[] {
  return ['enable', `show running-config interface ${onuInterface(ref, onuId)}`];
}

/**
 * Config COMPLETA del equipo (todas las OLT/ONU en un solo comando, ~10s
 * con 675 ONUs) — VALIDADO contra el equipo real. Fuente mas barata para
 * traer serial/tipo/nombre/descripcion/plan/VLAN de TODAS las ONUs a la
 * vez; ver parseFullRunningConfig() en zteParsers.ts.
 */
export function fullRunningConfigCommand(): string[] {
  return ['enable', 'show running-config'];
}

/**
 * Potencia optica de TODAS las ONUs de un puerto PON en un solo comando —
 * VALIDADO contra el equipo real. "onu-rx" = lo que la ONU recibe (downstream,
 * usado como rx_power); "onu-tx" = lo que la ONU transmite (upstream, usado
 * como tx_power). Ver parseBulkPower() en zteParsers.ts.
 */
export function bulkOnuRxCommands(ref: ZteInterfaceRef): string[] {
  return ['enable', `show pon power onu-rx ${oltInterface(ref)}`];
}

export function bulkOnuTxCommands(ref: ZteInterfaceRef): string[] {
  return ['enable', `show pon power onu-tx ${oltInterface(ref)}`];
}

/**
 * Salud del chasis (uptime, temperatura y carga por tarjeta) — VALIDADO
 * contra el equipo real (10.15.15.2):
 *   - "show system-group" trae "Started before: N days, N hours, N minutes".
 *   - "show card-temperature" trae una fila por slot con su temperatura.
 *   - "show processor" trae CPU% (5s/1m/5m) y memoria% por slot.
 */
export function oltHealthCommands(): string[] {
  return ['enable', 'show system-group', 'show card-temperature', 'show processor'];
}
