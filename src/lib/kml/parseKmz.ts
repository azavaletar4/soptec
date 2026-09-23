import JSZip from 'jszip';
import type { ParsedFolder, ParsedKml, ParsedLine, ParsedPoint } from './types';

/** Firma ZIP ("PK"): un .kmz es un .kml comprimido; si no trae esa firma, se asume .kml plano. */
function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function directChild(el: Element, tag: string): Element | null {
  for (const child of Array.from(el.children)) {
    if (child.tagName === tag) return child;
  }
  return null;
}

function directChildText(el: Element, tag: string): string | null {
  const child = directChild(el, tag);
  const text = child?.textContent?.trim();
  return text || null;
}

/** KML da "lng,lat[,alt]"; SmartRayco usa [lat, lng] en todos lados (ver LatLngPoint). */
function parseCoordinatePair(raw: string): [number, number] | null {
  const parts = raw.trim().split(',');
  if (parts.length < 2) return null;
  const lng = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}

function parsePlacemark(pm: Element): { name: string; styleUrl: string | null; point: ParsedPoint | null; line: ParsedLine | null } {
  const name = directChildText(pm, 'name') || 'Sin nombre';
  const styleUrl = directChildText(pm, 'styleUrl');

  const pointEl = directChild(pm, 'Point');
  const pointCoords = pointEl ? directChildText(pointEl, 'coordinates') : null;
  if (pointCoords) {
    const pair = parseCoordinatePair(pointCoords);
    if (pair) return { name, styleUrl, point: { name, lat: pair[0], lng: pair[1], styleUrl }, line: null };
  }

  const lineEl = directChild(pm, 'LineString');
  const lineCoords = lineEl ? directChildText(lineEl, 'coordinates') : null;
  if (lineCoords) {
    const path = lineCoords
      .split(/\s+/)
      .map(parseCoordinatePair)
      .filter((p): p is [number, number] => p !== null);
    if (path.length >= 2) return { name, styleUrl, point: null, line: { name, path, styleUrl } };
  }

  return { name, styleUrl, point: null, line: null };
}

/**
 * Parsea un archivo .kml o .kmz (Google Earth) a una estructura plana por
 * carpeta de primer nivel. Corre en el navegador (JSZip + DOMParser), sin
 * backend: coherente con el resto de SmartRayco, que habla directo con
 * Supabase desde el cliente.
 */
export async function parseKmz(file: File): Promise<ParsedKml> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);

  let kmlText: string;
  if (looksLikeZip(bytes)) {
    const zip = await JSZip.loadAsync(buf);
    const entry = Object.values(zip.files).find((f) => !f.dir && /\.kml$/i.test(f.name));
    if (!entry) throw new Error('El .kmz no contiene ningún archivo .kml adentro.');
    kmlText = await entry.async('text');
  } else {
    kmlText = new TextDecoder('utf-8').decode(bytes);
  }

  const doc = new DOMParser().parseFromString(kmlText, 'text/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('El archivo KML no se pudo interpretar (XML inválido o corrupto).');
  }

  const root = doc.documentElement;
  const folders: ParsedFolder[] = [];
  const loose: { points: ParsedPoint[]; lines: ParsedLine[] } = { points: [], lines: [] };

  function walk(el: Element, bucket: { points: ParsedPoint[]; lines: ParsedLine[]; polygonsCount?: number } | null) {
    for (const child of Array.from(el.children)) {
      if (child.tagName === 'Placemark') {
        const { point, line } = parsePlacemark(child);
        const target = bucket ?? loose;
        if (point) target.points.push(point);
        else if (line) target.lines.push(line);
        else if (directChild(child, 'Polygon') && bucket) bucket.polygonsCount = (bucket.polygonsCount ?? 0) + 1;
      } else if (child.tagName === 'Folder') {
        const name = directChildText(child, 'name') || 'Sin nombre';
        if (bucket === null) {
          const folder: ParsedFolder = { name, points: [], lines: [], polygonsCount: 0 };
          folders.push(folder);
          walk(child, folder);
        } else {
          // subcarpeta: se acumula dentro de la carpeta de primer nivel que la contiene
          walk(child, bucket);
        }
      } else if (child.tagName === 'Document') {
        walk(child, bucket);
      }
    }
  }

  walk(root, null);

  return { sourceFilename: file.name, folders, loose };
}
