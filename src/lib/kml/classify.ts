import { FO_HILOS_TOTAL_OPCIONES, type FoCableTipo, type FoHilosTotal, type InfraElementoTipo } from '@/types/domain';

/** Adivina el tipo de elemento pasivo a partir del nombre del placemark (dato real: no hay ExtendedData en los KMZ de campo). */
export function classifyPointTipo(name: string): InfraElementoTipo {
  const n = name.toLowerCase();
  if (n.includes('mufa') || n.includes('empalme')) return 'manga';
  if (n.includes('splitter')) return 'splitter';
  if (n.includes('armario') || n.includes('gabinete')) return 'armario';
  if (n.includes('camara') || n.includes('cámara')) return 'camara';
  if (n.includes('poste')) return 'poste';
  if (n.includes('nap')) return 'caja_nap';
  return 'otro';
}

/** Adivina tipo de cable e hilos a partir del nombre (ej. "ramal de 6", "troncal 24 hilos"); marca `guessed` cuando no hubo pista clara. */
export function classifyCable(name: string): { tipo: FoCableTipo; hilos_total: FoHilosTotal; guessed: boolean } {
  const n = name.toLowerCase();
  const tipo: FoCableTipo = n.includes('troncal') ? 'troncal' : 'ramal';

  const match = n.match(/(\d+)\s*h(?:ilos?)?\b/) || n.match(/\bde\s+(\d+)\b/);
  const parsed = match ? parseInt(match[1], 10) : NaN;

  let guessed = false;
  let hilos: FoHilosTotal;
  if (Number.isFinite(parsed) && (FO_HILOS_TOTAL_OPCIONES as readonly number[]).includes(parsed)) {
    hilos = parsed as FoHilosTotal;
  } else if (Number.isFinite(parsed)) {
    // numero mencionado pero no es un valor valido en SmartRayco: se ajusta al mas cercano
    hilos = FO_HILOS_TOTAL_OPCIONES.reduce((best, v) => (Math.abs(v - parsed) < Math.abs(best - parsed) ? v : best));
    guessed = true;
  } else {
    hilos = 6;
    guessed = true;
  }
  return { tipo, hilos_total: hilos, guessed };
}
