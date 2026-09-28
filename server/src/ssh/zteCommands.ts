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

/**
 * runTelnetCommands (server/src/telnet/client.ts) manda cada string de estos
 * arrays tal cual, terminado en "\r\n", directo al CLI de la OLT real. Un
 * valor que venga de un campo del formulario (descripcion, serial, VLAN...)
 * con un salto de linea incrustado cortaria el comando antes de tiempo y
 * haria que el resto se ejecute como uno o mas comandos CLI aparte contra el
 * equipo real (10.15.15.2, ~675 clientes) — estas funciones son la unica
 * barrera antes de eso, asi que TODO valor no controlado por este archivo
 * (no venga de un literal fijo como 'enable'/'exit') debe pasar por aqui.
 */
function sanitizeIdentifier(value: string, fieldName: string, maxLen = 64): string {
  const v = String(value).trim();
  if (!v) throw new Error(`${fieldName} no puede estar vacio`);
  if (v.length > maxLen) throw new Error(`${fieldName} es demasiado largo (maximo ${maxLen} caracteres)`);
  // Identificadores tecnicos (serial, tipo de ONU, nombre de perfil): solo
  // letras/numeros/guion/guion-bajo/punto — nada que pueda alterar el CLI.
  if (!/^[A-Za-z0-9_.-]+$/.test(v)) {
    throw new Error(`${fieldName} tiene caracteres no permitidos (solo letras, numeros, "-", "_" y ".")`);
  }
  return v;
}

function sanitizeFreeText(value: string, fieldName: string, maxLen = 100): string {
  // Texto libre (ej. descripcion): se permite casi cualquier caracter, pero
  // se quitan saltos de linea / tabs / caracteres de control y comillas
  // dobles (que ya rompian el comando `description "..."`).
  const cleaned = String(value)
    .replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ')
    .replace(/"/g, "'")
    .trim();
  if (cleaned.length > maxLen) throw new Error(`${fieldName} es demasiado largo (maximo ${maxLen} caracteres)`);
  return cleaned;
}

function sanitizeInt(value: number, fieldName: string, opts: { min?: number; max?: number } = {}): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`${fieldName} debe ser un numero entero`);
  if (opts.min != null && n < opts.min) throw new Error(`${fieldName} debe ser >= ${opts.min}`);
  if (opts.max != null && n > opts.max) throw new Error(`${fieldName} debe ser <= ${opts.max}`);
  return n;
}

function sanitizeAcsUrl(value: string): string {
  const v = String(value).trim();
  if (/[\r\n\t\x00-\x1f\x7f\s]/.test(v)) throw new Error('acsUrl no puede contener espacios ni saltos de linea');
  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    throw new Error('acsUrl no es una URL valida (ej. http://192.168.1.10:7547)');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('acsUrl debe usar http:// o https://');
  }
  return v;
}

function safeRef({ shelf, slot, port }: ZteInterfaceRef): ZteInterfaceRef {
  return {
    shelf: sanitizeInt(shelf, 'shelf', { min: 0, max: 31 }),
    slot: sanitizeInt(slot, 'slot', { min: 0, max: 31 }),
    port: sanitizeInt(port, 'port', { min: 0, max: 127 }),
  };
}

function oltInterface(ref: ZteInterfaceRef): string {
  const { shelf, slot, port } = safeRef(ref);
  return `gpon-olt_${shelf}/${slot}/${port}`;
}

function onuInterface(ref: ZteInterfaceRef, onuId: number): string {
  const { shelf, slot, port } = safeRef(ref);
  return `gpon-onu_${shelf}/${slot}/${port}:${onuId}`;
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
  const safeOnuId = sanitizeInt(onuId, 'onuId', { min: 0, max: 127 });
  const safeVeip = sanitizeInt(veip, 'veip', { min: 1, max: 8 });
  const safeAcsUrl = sanitizeAcsUrl(acsUrl);
  return [
    'enable',
    'configure terminal',
    `pon-onu-mng ${onuInterface(ref, safeOnuId)}`,
    `tr069-mgmt ${safeVeip} acs ${safeAcsUrl}`,
    `tr069-mgmt ${safeVeip} state unlock`,
    'exit',
  ];
}

/** Desactiva la gestion TR-069 de una ONT (sin borrar la URL configurada). */
export function disableTr069Commands(ref: ZteInterfaceRef, onuId: number, veip: number): string[] {
  const safeOnuId = sanitizeInt(onuId, 'onuId', { min: 0, max: 127 });
  const safeVeip = sanitizeInt(veip, 'veip', { min: 1, max: 8 });
  return [
    'enable',
    'configure terminal',
    `pon-onu-mng ${onuInterface(ref, safeOnuId)}`,
    `tr069-mgmt ${safeVeip} state lock`,
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
  const safeOnuId = sanitizeInt(onuId, 'onuId', { min: 0, max: 127 });
  const safeSerial = sanitizeIdentifier(serial, 'serial', 32);
  const safeOnuType = sanitizeIdentifier(onuType, 'onuType', 32);
  const safeVlan = sanitizeInt(vlan, 'vlan', { min: 1, max: 4094 });
  const safeTcontProfile = sanitizeIdentifier(tcontProfile, 'tcontProfile', 64);
  const safeTrafficProfile = sanitizeIdentifier(trafficProfile, 'trafficProfile', 64);
  const safeDesc = sanitizeFreeText(description, 'description', 100);
  return [
    'enable',
    'configure terminal',
    `interface ${oltInterface(ref)}`,
    `onu ${safeOnuId} type ${safeOnuType} sn ${safeSerial}`,
    'exit',
    `interface ${onuInterface(ref, safeOnuId)}`,
    `description "${safeDesc}"`,
    // "tcont 1 name ..." (sin perfil) es rechazado por el firmware real
    // ("Incomplete command") y deja la ONU sin ancho de banda real, aunque
    // el resto de la config se vea aplicada — CONFIRMADO contra el equipo
    // real. Los perfiles (ej. "SMARTOLT-100M-UP"/"SMARTOLT-100M-DOWN") ya
    // existen en la OLT (heredados de SmartOLT); listarlos con
    // "show gpon profile tcont" / "show gpon profile traffic".
    `tcont 1 profile ${safeTcontProfile}`,
    'gemport 1 tcont 1',
    `gemport 1 traffic-limit downstream ${safeTrafficProfile}`,
    `service-port 1 vport 1 user-vlan ${safeVlan} vlan ${safeVlan}`,
    'exit',
  ];
}

/**
 * Cambia el plan (perfiles tcont/traffic) de una ONT YA REGISTRADA, sin
 * recrearla (no toca serial/tipo/VLAN/service-port). Redeclarar "tcont 1
 * profile" y el traffic-limit del gemport sobre una interfaz ya existente
 * deberia sobreescribir el valor anterior (mismo mecanismo de
 * registerOntCommands, que si esta validado contra el equipo real) — pero
 * a diferencia de ese, ESTE COMANDO especifico (reconfigurar una ONU YA
 * activa con clientes) TODAVIA NO se probo contra el equipo real. Probar
 * primero con una ONU de baja criticidad antes de usarlo en masa.
 */
export function changeOntProfileCommands(
  ref: ZteInterfaceRef,
  onuId: number,
  tcontProfile: string,
  trafficProfile: string,
): string[] {
  const safeOnuId = sanitizeInt(onuId, 'onuId', { min: 0, max: 127 });
  const safeTcontProfile = sanitizeIdentifier(tcontProfile, 'tcontProfile', 64);
  const safeTrafficProfile = sanitizeIdentifier(trafficProfile, 'trafficProfile', 64);
  return [
    'enable',
    'configure terminal',
    `interface ${onuInterface(ref, safeOnuId)}`,
    `tcont 1 profile ${safeTcontProfile}`,
    `gemport 1 traffic-limit downstream ${safeTrafficProfile}`,
    'exit',
  ];
}

export function setAdminStateCommands(ref: ZteInterfaceRef, onuId: number, enable: boolean): string[] {
  const safeOnuId = sanitizeInt(onuId, 'onuId', { min: 0, max: 127 });
  return [
    'enable',
    'configure terminal',
    `interface ${oltInterface(ref)}`,
    `onu ${safeOnuId} admin-state ${enable ? 'enable' : 'disable'}`,
    'exit',
  ];
}

export function deleteOntCommands(ref: ZteInterfaceRef, onuId: number): string[] {
  const safeOnuId = sanitizeInt(onuId, 'onuId', { min: 0, max: 127 });
  return [
    'enable',
    'configure terminal',
    `interface ${oltInterface(ref)}`,
    `no onu ${safeOnuId}`,
    'exit',
  ];
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
 *
 * OJO — INTENTO FALLIDO (2026-09-22): se probo combinar "onu-rx" y "onu-tx"
 * en una sola conexion/login Telnet (bulkOnuPowerCommands, ya eliminado)
 * para ahorrar logins en el import masivo. Contra el equipo real, el
 * comando "onu-tx" devuelve la tabla completa y correcta pero el equipo
 * jamas regresa el prompt cuando se ejecuta justo despues de "onu-rx" en la
 * misma sesion — causa timeouts reales (confirmado, puerto 1/2/3). Mantener
 * SIEMPRE 2 conexiones Telnet separadas (una por direccion) para este par
 * de comandos.
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
