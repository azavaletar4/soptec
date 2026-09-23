/**
 * Código de colores estándar de 12 colores para fibra óptica (ANSI/TIA-598-C),
 * usado tanto para identificar cada tubo (loose tube) dentro de un cable como
 * cada hilo dentro de un tubo — ambos siguen la misma secuencia de 12 colores.
 */
export const FIBER_12_COLORS = [
  { n: 1, name: 'Azul', hex: '#0047AB' },
  { n: 2, name: 'Naranja', hex: '#FF6A00' },
  { n: 3, name: 'Verde', hex: '#00A651' },
  { n: 4, name: 'Marrón', hex: '#7B3F00' },
  { n: 5, name: 'Gris', hex: '#9CA3AF' },
  { n: 6, name: 'Blanco', hex: '#F8FAFC' },
  { n: 7, name: 'Rojo', hex: '#DC2626' },
  { n: 8, name: 'Negro', hex: '#111827' },
  { n: 9, name: 'Amarillo', hex: '#FACC15' },
  { n: 10, name: 'Violeta', hex: '#7C3AED' },
  { n: 11, name: 'Rosa', hex: '#EC4899' },
  { n: 12, name: 'Aqua', hex: '#22D3EE' },
] as const;

export const HILOS_POR_TUBO = 12;

export interface HiloUbicacion {
  /** Índice global del hilo dentro del cable, base 1. */
  hiloIndex: number;
  tuboNumero: number;
  tuboColor: (typeof FIBER_12_COLORS)[number];
  posicionEnTubo: number;
  hiloColor: (typeof FIBER_12_COLORS)[number];
}

/** Deriva tubo/color/posición/color de hilo a partir del índice global (1-based). */
export function ubicarHilo(hiloIndex: number): HiloUbicacion {
  const tuboNumero = Math.ceil(hiloIndex / HILOS_POR_TUBO);
  const posicionEnTubo = ((hiloIndex - 1) % HILOS_POR_TUBO) + 1;
  return {
    hiloIndex,
    tuboNumero,
    tuboColor: FIBER_12_COLORS[(tuboNumero - 1) % HILOS_POR_TUBO],
    posicionEnTubo,
    hiloColor: FIBER_12_COLORS[posicionEnTubo - 1],
  };
}

/** Agrupa los hilos de un cable en sus tubos, en orden. */
export function tubosDeCable(hilosTotal: number): { tuboNumero: number; hilos: HiloUbicacion[] }[] {
  const totalTubos = Math.ceil(hilosTotal / HILOS_POR_TUBO);
  return Array.from({ length: totalTubos }, (_, i) => {
    const tuboNumero = i + 1;
    const inicio = i * HILOS_POR_TUBO + 1;
    const fin = Math.min(inicio + HILOS_POR_TUBO - 1, hilosTotal);
    const hilos = Array.from({ length: fin - inicio + 1 }, (_, j) => ubicarHilo(inicio + j));
    return { tuboNumero, hilos };
  });
}

export const HILO_ESTADO_COLOR: Record<string, string> = {
  libre: '#22c55e',
  usado: '#0ea5e9',
  reservado: '#f59e0b',
  dañado: '#ef4444',
};

export const HILO_ESTADO_LABEL: Record<string, string> = {
  libre: 'Libre',
  usado: 'En uso',
  reservado: 'Reservado',
  dañado: 'Dañado',
};
