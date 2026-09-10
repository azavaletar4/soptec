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
 * Busca valores tipo "Rx Power(dBm): -18.50" / "Tx Power(dBm): 2.10".
 * Sin validar todavia contra el equipo real (ver docs/phases/fase-4-olt.html).
 */
export function parseOpticalInfo(raw: string): OpticalInfo {
  const rxMatch = raw.match(/Rx\s*Power.*?:\s*(-?\d+(\.\d+)?)/i);
  const txMatch = raw.match(/Tx\s*Power.*?:\s*(-?\d+(\.\d+)?)/i);
  return {
    rxPower: rxMatch ? Number(rxMatch[1]) : null,
    txPower: txMatch ? Number(txMatch[1]) : null,
  };
}
