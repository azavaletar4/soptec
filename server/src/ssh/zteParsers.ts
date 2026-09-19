/**
 * Parsers para la salida de texto de la ZTE C300 real de este proyecto
 * (10.15.15.2). Los dos primeros ya estan validados contra el equipo real
 * (ver docs/phases/fase-4-olt.html, seccion de verificacion); el resto sigue
 * siendo best-effort.
 */

export interface ParsedOnt {
  onuId: number;
  runState: string;
}

/**
 * Parsea "show gpon onu state gpon-olt_S/L/P" — VALIDADO contra el equipo real.
 * Formato real (no trae serial, solo estado):
 *   1/2/4:23    enable       enable      working      1(GPON)
 *   1/2/4:25    disable      disable     OffLine      1(GPON)
 *   ONU Number: 34/39
 */
export function parseOntList(raw: string): ParsedOnt[] {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const results: ParsedOnt[] = [];
  for (const line of lines) {
    const match = line.match(/^\d+\/\d+\/\d+:(\d+)\s+\S+\s+\S+\s+(\S+)/);
    if (match) {
      results.push({ onuId: Number(match[1]), runState: match[2].toLowerCase() });
    }
  }
  return results;
}

export interface GlobalOnt {
  frame: number;
  slot: number;
  port: number;
  onuId: number;
  runState: string;
}

/**
 * Igual que parseOntList, pero para "show gpon onu state" SIN filtrar por
 * puerto (listado global de toda la OLT) — captura tambien frame/slot/port
 * de cada fila, ya que abarca varios puertos a la vez. VALIDADO contra el
 * equipo real: 646/675 filas capturadas (ver zteCommands.ts).
 */
export function parseGlobalOntState(raw: string): GlobalOnt[] {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const results: GlobalOnt[] = [];
  for (const line of lines) {
    const match = line.match(/^(\d+)\/(\d+)\/(\d+):(\d+)\s+\S+\s+\S+\s+(\S+)/);
    if (match) {
      results.push({
        frame: Number(match[1]),
        slot: Number(match[2]),
        port: Number(match[3]),
        onuId: Number(match[4]),
        runState: match[5].toLowerCase(),
      });
    }
  }
  return results;
}

export interface UnconfiguredOnt {
  interfaceRef: string; // ej. "gpon-onu_1/2/4:1"
  serial: string;
}

/**
 * Parsea "show gpon onu uncfg" — VALIDADO contra el equipo real.
 * Formato real:
 *   OnuIndex                 Sn                  State
 *   ---------------------------------------------------------------------
 *   gpon-onu_1/2/4:1         MSTC8CBF86B4        unknown
 */
export function parseUnconfiguredOnts(raw: string): UnconfiguredOnt[] {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const results: UnconfiguredOnt[] = [];
  for (const line of lines) {
    const match = line.match(/^(gpon-onu_\d+\/\d+\/\d+:\d+)\s+([A-Za-z0-9]{6,20})\s+\S+/);
    if (match) {
      results.push({ interfaceRef: match[1], serial: match[2] });
    }
  }
  return results;
}

/**
 * Parsea "show pon power onu-rx/onu-tx gpon-olt_S/L/P" — VALIDADO contra el
 * equipo real: trae la potencia de TODAS las ONUs de un puerto en un solo
 * comando. El comando por-ONU individual ("show pon power attenuation
 * gpon-onu_S/L/P:ID") NO existe en este firmware (Error 20202, confirmado
 * 2026-09-19) — hasta para una sola ONU se usa este comando bulk, filtrando
 * el resultado (ver readOntSignal() en server/src/routes/olt.ts). Formato:
 *   Onu                 Rx power
 *   ------------------------------------
 *   gpon-onu_1/2/2:1    -21.368(dbm)
 *   gpon-onu_1/2/2:2    -14.831(dbm)
 */
export function parseBulkPower(raw: string): Map<number, number> {
  const result = new Map<number, number>();
  const re = /^gpon-onu_\d+\/\d+\/\d+:(\d+)\s+(-?\d+(?:\.\d+)?)\(dbm\)/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    result.set(Number(match[1]), Number(match[2]));
  }
  return result;
}

export interface FullConfigOnt {
  onuType: string;
  serial: string;
  name: string | null;
  description: string | null;
  tcontProfile: string | null;
  trafficProfile: string | null;
  vlan: number | null;
}

/**
 * Parsea "show running-config" (TODO el equipo, sin filtro) — VALIDADO
 * contra el equipo real: en un solo comando (~10s con 675 ONUs) trae tanto
 * los bindings "onu <id> type <tipo> sn <serial>" (bajo cada bloque
 * "interface gpon-olt_S/L/P") como el name/description/tcont/traffic/vlan
 * de cada ONU (bloques "interface gpon-onu_S/L/P:ID"). Evita tener que
 * consultar cada ONU por separado (675 comandos) para traer esos datos.
 * Devuelve un mapa clave "shelf/slot/port:onuId" -> datos combinados.
 */
export function parseFullRunningConfig(raw: string): Map<string, FullConfigOnt> {
  const result = new Map<string, FullConfigOnt>();
  const bindings = new Map<string, { onuType: string; serial: string }>();

  let oltRef: string | null = null; // "shelf/slot/port" mientras estamos dentro de un bloque gpon-olt_*
  let onuKey: string | null = null; // "shelf/slot/port:id" mientras estamos dentro de un bloque gpon-onu_*:N
  let current: Partial<FullConfigOnt> = {};

  for (const line of raw.split('\n')) {
    const oltHeader = line.match(/^interface gpon-olt_(\d+\/\d+\/\d+)\s*$/);
    if (oltHeader) {
      oltRef = oltHeader[1];
      onuKey = null;
      continue;
    }
    const onuHeader = line.match(/^interface gpon-onu_(\d+\/\d+\/\d+):(\d+)\s*$/);
    if (onuHeader) {
      if (onuKey) result.set(onuKey, current as FullConfigOnt);
      oltRef = null;
      onuKey = `${onuHeader[1]}:${onuHeader[2]}`;
      current = {};
      continue;
    }
    if (line.trim() === '!') {
      if (onuKey) {
        result.set(onuKey, current as FullConfigOnt);
        onuKey = null;
        current = {};
      }
      oltRef = null;
      continue;
    }

    if (oltRef) {
      const m = line.match(/^\s*onu (\d+) type (\S+) sn (\S+)/);
      if (m) bindings.set(`${oltRef}:${m[1]}`, { onuType: m[2], serial: m[3] });
      continue;
    }

    if (onuKey) {
      const name = line.match(/^\s*name\s+(.+?)\s*$/);
      if (name) current.name = name[1];
      const desc = line.match(/^\s*description\s+(.+?)\s*$/);
      if (desc) current.description = desc[1];
      const tcont = line.match(/^\s*tcont\s+\d+\s+profile\s+(\S+)/);
      if (tcont) current.tcontProfile = tcont[1];
      const traffic = line.match(/^\s*gemport\s+\d+\s+traffic-limit\s+downstream\s+(\S+)/);
      if (traffic) current.trafficProfile = traffic[1];
      const vlan = line.match(/^\s*service-port\s+\d+\s+vport\s+\d+\s+user-vlan\s+(\d+)/);
      if (vlan) current.vlan = Number(vlan[1]);
    }
  }
  if (onuKey) result.set(onuKey, current as FullConfigOnt);

  for (const [key, entry] of result) {
    const b = bindings.get(key);
    entry.onuType = b?.onuType ?? '';
    entry.serial = b?.serial ?? '';
    entry.name = entry.name ?? null;
    entry.description = entry.description ?? null;
    entry.tcontProfile = entry.tcontProfile ?? null;
    entry.trafficProfile = entry.trafficProfile ?? null;
    entry.vlan = entry.vlan ?? null;
  }
  // ONUs que solo tienen binding (type/sn) pero ningun bloque de servicio
  // (ej. autorizadas pero sin tcont/vlan configurado todavia).
  for (const [key, b] of bindings) {
    if (!result.has(key)) {
      result.set(key, { ...b, name: null, description: null, tcontProfile: null, trafficProfile: null, vlan: null });
    }
  }

  return result;
}

export interface OltUptime {
  /** Ej. "42d 4h 48m" */
  raw: string;
  totalHours: number;
}

/**
 * Parsea "show system-group" — VALIDADO contra el equipo real. Busca la
 * linea "Started before: 42 days, 4 hours, 48 minutes".
 */
export function parseUptime(raw: string): OltUptime | null {
  const match = raw.match(/Started before:\s*(\d+)\s*days?,\s*(\d+)\s*hours?,\s*(\d+)\s*minutes?/i);
  if (!match) return null;
  const days = Number(match[1]);
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  return {
    raw: `${days}d ${hours}h ${minutes}m`,
    totalHours: days * 24 + hours + minutes / 60,
  };
}

export interface SlotTemperature {
  slot: number;
  tempC: number;
}

/**
 * Parsea "show card-temperature" — VALIDADO contra el equipo real. Ignora
 * las tarjetas offline (temperatura "N/A.").
 */
export function parseCardTemperatures(raw: string): SlotTemperature[] {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const results: SlotTemperature[] = [];
  for (const line of lines) {
    const match = line.match(/^\d+\s+\d+\s+(\d+)\s+(\S+)\s+\S+\s+\S+\s+\S+/);
    if (!match) continue;
    const temp = Number(match[2]);
    if (Number.isNaN(temp)) continue;
    results.push({ slot: Number(match[1]), tempC: temp });
  }
  return results;
}

/**
 * Parsea "show gpon profile tcont" / "show gpon profile traffic" —
 * VALIDADO contra el equipo real. Cada bloque empieza con
 * "Profile name :NOMBRE" (espaciado variable antes del ":").
 */
export function parseProfileNames(raw: string): string[] {
  const names: string[] = [];
  const re = /^Profile name\s*:\s*(\S+)/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    names.push(match[1]);
  }
  return names;
}

export interface SlotLoad {
  slot: number;
  cpuPercent: number;
  memPercent: number;
}

/**
 * Parsea "show processor" — VALIDADO contra el equipo real. Usa el
 * promedio de 5 minutos como CPU representativa de cada tarjeta.
 */
export function parseProcessorLoad(raw: string): SlotLoad[] {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const results: SlotLoad[] = [];
  for (const line of lines) {
    const match = line.match(/^\d+\s+\d+\s+(\d+)\s+\d+%\s+\d+%\s+(\d+)%\s+\d+\s+(\d+)%/);
    if (!match) continue;
    results.push({ slot: Number(match[1]), cpuPercent: Number(match[2]), memPercent: Number(match[3]) });
  }
  return results;
}
