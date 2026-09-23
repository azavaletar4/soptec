export interface ParsedPoint {
  name: string;
  lat: number;
  lng: number;
  styleUrl: string | null;
}

export interface ParsedLine {
  name: string;
  /** Vertices [lat, lng], ya convertidos desde el orden lng,lat del KML. */
  path: [number, number][];
  styleUrl: string | null;
}

export interface ParsedFolder {
  name: string;
  points: ParsedPoint[];
  lines: ParsedLine[];
  /** Polígonos encontrados (limites de cobertura, etc.) — se cuentan pero no se importan. */
  polygonsCount: number;
}

export interface ParsedKml {
  sourceFilename: string;
  /** Carpetas de primer nivel bajo <Document> — candidatas a Zona en SmartRayco. */
  folders: ParsedFolder[];
  /** Placemarks fuera de cualquier carpeta (caso raro). */
  loose: { points: ParsedPoint[]; lines: ParsedLine[] };
}
