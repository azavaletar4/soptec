/**
 * Parsers best-effort para la salida de texto de una ZTE C300.
 * El formato exacto varia por firmware — ajustar los regex contra la
 * salida real de tu equipo (ver advertencia en zteCommands.ts).
 */

export interface ParsedOnt {
  onuId: number;
  serial: string;
  runState: string;
}

/**
 * Parsea "show gpon onu state gpon-olt_S/L/P".
 * Formato de referencia esperado (puede variar):
 *   OnuIndex  Serial          AdminState  OperState  Distance(m)
 *   1         ZTEGC1234567    enable      online     1024
 */
export function parseOntList(raw: string): ParsedOnt[] {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const results: ParsedOnt[] = [];
  for (const line of lines) {
    const match = line.match(/^(\d+)\s+([A-Za-z0-9]{8,20})\s+\S+\s+(\w+)/);
    if (match) {
      results.push({
        onuId: Number(match[1]),
        serial: match[2],
        runState: match[3].toLowerCase(),
      });
    }
  }
  return results;
}

export interface OpticalInfo {
  rxPower: number | null;
  txPower: number | null;
}

/** Busca valores tipo "Rx Power(dBm): -18.50" / "Tx Power(dBm): 2.10". */
export function parseOpticalInfo(raw: string): OpticalInfo {
  const rxMatch = raw.match(/Rx\s*Power.*?:\s*(-?\d+(\.\d+)?)/i);
  const txMatch = raw.match(/Tx\s*Power.*?:\s*(-?\d+(\.\d+)?)/i);
  return {
    rxPower: rxMatch ? Number(rxMatch[1]) : null,
    txPower: txMatch ? Number(txMatch[1]) : null,
  };
}
