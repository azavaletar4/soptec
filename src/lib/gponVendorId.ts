// Identifica el fabricante real de una ONT por el prefijo ASCII de 4
// caracteres de su serial GPON (estandar ITU-T G.984.3 — el mismo campo que
// GenieACS reporta como "_Manufacturer"/OUI, pero aqui leido directo del
// serial que ya trae la OLT, sin depender de ningun Inform). Deliberadamente
// NO se usa `onu_type` (src/views/olt/AuthorizeOnuModal.vue) para esto: es
// texto libre que tipea el tecnico al autorizar, no un dato verificado.
//
// Lista NO exhaustiva — cubre los fabricantes ya vistos en este despliegue.
// Un prefijo ausente del mapa no es un error: solo significa "no identificado".
const ITU_VENDOR_IDS: Record<string, string> = {
  HWTC: 'Huawei',
  ZTEG: 'ZTE',
  FHTT: 'FiberHome',
  ALCL: 'Nokia / Alcatel-Lucent',
  CIGG: 'CIG',
};

export interface GponVendorInfo {
  /** Los primeros 4 caracteres del serial, en mayusculas, tal como se leyeron. */
  prefix: string;
  /** Nombre del fabricante si el prefijo es conocido; null si no esta en la lista. */
  name: string | null;
}

export function gponVendorFromSerial(serial: string | null | undefined): GponVendorInfo {
  const prefix = (serial ?? '').trim().slice(0, 4).toUpperCase();
  return { prefix, name: ITU_VENDOR_IDS[prefix] ?? null };
}

/** Prefijo ASCII nativo de cada marca de OLT soportada (para detectar ONTs "de terceros"). */
const NATIVE_OLT_VENDOR_PREFIX: Record<string, string> = { zte: 'ZTEG' };

/** true si la ONT es de un fabricante distinto al de la OLT que la gestiona (ver olt_devices.brand). */
export function isThirdPartyOnt(vendor: GponVendorInfo, oltBrand: string): boolean {
  const nativePrefix = NATIVE_OLT_VENDOR_PREFIX[oltBrand.toLowerCase()];
  if (!nativePrefix) return vendor.prefix !== '' ; // marca de OLT desconocida: no podemos afirmar que sea nativa.
  return vendor.prefix !== nativePrefix;
}
