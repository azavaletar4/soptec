import type { ActivoTecnico, AlertaNivel } from '@/types/domain';

/**
 * % de vida util restante y costo depreciado sugerido de un activo fijo
 * (Fase 116) — se calculan al vuelo a partir de fecha_entrega + vida_util_
 * meses + costo_compra, igual que el semaforo de SOAT/mantenimiento de
 * vehiculos (ver lib/vehiculoAlertas.ts): no se persiste un numero que se
 * desactualice solo con el paso del tiempo.
 */
const DIAS_POR_MES = 30.4375;

function mesesTranscurridos(fechaEntrega: string): number {
  const hoy = new Date();
  const entrega = new Date(`${fechaEntrega}T00:00:00`);
  const dias = (hoy.getTime() - entrega.getTime()) / (1000 * 60 * 60 * 24);
  return dias / DIAS_POR_MES;
}

/** Null si el activo todavia no se entrego a nadie (sin fecha_entrega) — no hay reloj de depreciacion corriendo. */
export function vidaUtilRestantePct(activo: Pick<ActivoTecnico, 'fecha_entrega' | 'vida_util_meses'>): number | null {
  if (!activo.fecha_entrega || activo.vida_util_meses <= 0) return null;
  const transcurridos = mesesTranscurridos(activo.fecha_entrega);
  const pct = 100 * (1 - transcurridos / activo.vida_util_meses);
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/** Rojo = agotada (elegible para renovacion), amarillo = <=20% restante, verde = resto, sin_datos = aun no entregado. */
export function nivelVidaUtil(pct: number | null): AlertaNivel {
  if (pct == null) return 'sin_datos';
  if (pct <= 0) return 'rojo';
  if (pct <= 20) return 'amarillo';
  return 'verde';
}

/** Vida util agotada y el activo sigue en uso (no dado de baja todavia) — renovacion sin cargo al tecnico. */
export function esElegibleRenovacion(activo: Pick<ActivoTecnico, 'fecha_entrega' | 'vida_util_meses' | 'estado'>): boolean {
  if (activo.estado === 'baja') return false;
  return vidaUtilRestantePct(activo) === 0;
}

/**
 * Costo depreciado sugerido para reposicion ante una baja prematura (perdida
 * o dano) — depreciacion lineal simple: valor en libros = costo de compra *
 * % de vida util que todavia le quedaba. Null si nunca se entrego (no hay
 * depreciacion que calcular todavia).
 */
export function costoDepreciadoSugerido(activo: Pick<ActivoTecnico, 'costo_compra' | 'fecha_entrega' | 'vida_util_meses'>): number | null {
  const pct = vidaUtilRestantePct(activo);
  if (pct == null) return null;
  return Math.round(activo.costo_compra * (pct / 100) * 100) / 100;
}
