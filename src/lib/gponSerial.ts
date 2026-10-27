// Normaliza y compara seriales GPON entre dos fuentes que NO siempre usan la
// misma representacion del mismo valor de 8 bytes (estandar ITU-T G.984.3:
// 4 bytes de "vendor ID" ASCII + 4 bytes de identificador especifico del
// fabricante):
//
//   - La OLT (ZTE C300) reporta el vendor ID como texto ASCII literal + el
//     resto en hexadecimal: "HWTC1D3691B7" (4 letras + 8 hex = 12 caracteres).
//   - Algunos CPE (confirmado con una Huawei real, 2026-10-27) reportan por
//     TR-069 el MISMO valor de 8 bytes pero con el vendor ID TAMBIEN
//     hex-codificado: "485754431D3691B7" (16 hex). Decodificando
//     "48575443" como 4 bytes ASCII da exactamente "HWTC" — es el mismo
//     serial, otra representacion, no un dato distinto.
//
// Sin esta normalizacion, comparar ambas strings tal cual (como hacia
// `/tr069/status` antes) nunca encuentra la coincidencia aunque sea la
// misma ONT real — ver docs/TR069-HUAWEI-INCIDENTE-Y-RECUPERACION-20261027.md.

const CANONICAL_RE = /^[A-Z0-9]{4}[0-9A-F]{8}$/;
const HEX16_RE = /^[0-9A-F]{16}$/;

function isAsciiVendorByte(byte: number): boolean {
  return (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5a); // '0'-'9' o 'A'-'Z'
}

/**
 * Devuelve el serial en forma canonica "4 ASCII + 8 hex" (mayusculas), o
 * null si el formato no es un serial GPON valido en ninguna de las dos
 * representaciones conocidas — nunca adivina ni acepta un formato nuevo
 * sin verificar (requisito: "si hay... formatos invalidos, no vincular
 * automaticamente").
 */
export function normalizeGponSerial(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toUpperCase();
  if (CANONICAL_RE.test(v)) return v;
  if (HEX16_RE.test(v)) {
    const vendorHex = v.slice(0, 8);
    const suffix = v.slice(8);
    let vendor = '';
    for (let i = 0; i < 8; i += 2) {
      const byte = parseInt(vendorHex.slice(i, i + 2), 16);
      if (!isAsciiVendorByte(byte)) return null; // no decodifica a un vendor ID ASCII plausible
      vendor += String.fromCharCode(byte);
    }
    return vendor + suffix;
  }
  return null;
}

/** Igualdad EXACTA de dos seriales ya normalizados — nunca substring/prefijo/sufijo. */
export function gponSerialsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeGponSerial(a);
  const nb = normalizeGponSerial(b);
  return na !== null && na === nb;
}

export type Tr069SerialMatchRejection = 'INVALID_ONT_SERIAL' | 'NO_MATCH' | 'AMBIGUOUS';

export interface Tr069SerialMatchResult<T> {
  device: T | null;
  rejection?: Tr069SerialMatchRejection;
}

/**
 * Busca, entre una lista de dispositivos TR-069 (cada uno con su propio
 * `cpe_serial`, como lo reporta GenieACS), el que corresponde EXACTO al
 * serial GPON de una ONT — nunca por substring ni por el primero que se
 * parezca. Nunca vincula si el serial de la ONT no es un GPON valido, si
 * no hay ningun dispositivo que normalice igual, o si hay mas de uno
 * (ambiguo) — en los 3 casos devuelve `device: null` con el motivo.
 */
export function matchTr069Device<T extends { cpe_serial: string | null }>(
  ontSerial: string | null | undefined,
  devices: readonly T[],
): Tr069SerialMatchResult<T> {
  const normalizedOnt = normalizeGponSerial(ontSerial);
  if (!normalizedOnt) return { device: null, rejection: 'INVALID_ONT_SERIAL' };

  const matches = devices.filter((d) => normalizeGponSerial(d.cpe_serial) === normalizedOnt);
  if (matches.length === 0) return { device: null, rejection: 'NO_MATCH' };
  if (matches.length > 1) return { device: null, rejection: 'AMBIGUOUS' };
  return { device: matches[0] };
}
