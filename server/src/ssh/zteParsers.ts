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

export interface OpticalInfo {
  rxPower: number | null;
  txPower: number | null;
}

/**
 * Parsea "show pon power attenuation" — VALIDADO contra el equipo real.
 * El formato real NO trae "Rx Power"/"Tx Power" como se asumia originalmente
 * (por eso nunca leia nada): son dos filas "up"/"down", cada una con la
 * lectura del lado OLT y del lado ONU:
 *   OLT                  ONU              Attenuation
 *   up      Rx :-25.087(dbm)      Tx:2.108(dbm)        27.195(dB)
 *   down    Tx :6.807(dbm)        Rx:-21.250(dbm)      28.057(dB)
 * La potencia de la ONT (lo que nos interesa) es siempre la 2da columna
 * ("ONU"): su Rx (fila "down") y su Tx (fila "up").
 */
export function parseOpticalInfo(raw: string): OpticalInfo {
  let rxPower: number | null = null;
  let txPower: number | null = null;

  const rowRe = /^\s*(up|down)\s+(Rx|Tx)\s*:\s*(-?\d+(?:\.\d+)?)\s*\(dbm\)\s+(Rx|Tx)\s*:\s*(-?\d+(?:\.\d+)?)\s*\(dbm\)/i;
  for (const line of raw.split('\n')) {
    const match = line.match(rowRe);
    if (!match) continue;
    const [, , , , onuLabel, onuValue] = match;
    if (onuLabel.toLowerCase() === 'rx') rxPower = Number(onuValue);
    else txPower = Number(onuValue);
  }

  // Respaldo: formato "Rx Power(dBm): -18.50" (visto en otros firmwares/documentacion).
  if (rxPower == null) {
    const rxMatch = raw.match(/Rx\s*Power.*?:\s*(-?\d+(\.\d+)?)/i);
    if (rxMatch) rxPower = Number(rxMatch[1]);
  }
  if (txPower == null) {
    const txMatch = raw.match(/Tx\s*Power.*?:\s*(-?\d+(\.\d+)?)/i);
    if (txMatch) txPower = Number(txMatch[1]);
  }

  return { rxPower, txPower };
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
