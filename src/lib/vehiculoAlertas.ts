import { VEHICULO_DIAS_ADVERTENCIA, VEHICULO_DIAS_CRITICO, VEHICULO_KM_ADVERTENCIA, type AlertaNivel, type Vehiculo } from '@/types/domain';

export interface Alerta {
  nivel: AlertaNivel;
  label: string;
}

const MS_POR_DIA = 1000 * 60 * 60 * 24;

function diasRestantes(fecha: string): number {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const venc = new Date(`${fecha}T00:00:00`);
  return Math.round((venc.getTime() - hoy.getTime()) / MS_POR_DIA);
}

function nivelPorDias(dias: number): AlertaNivel {
  if (dias < VEHICULO_DIAS_CRITICO) return 'rojo';
  if (dias <= VEHICULO_DIAS_ADVERTENCIA) return 'amarillo';
  return 'verde';
}

/** Semaforo del SOAT: rojo si vencido o vence en menos de 7 dias, amarillo entre 8 y 30, verde en adelante. */
export function alertaSoat(v: Pick<Vehiculo, 'soat_fecha_vencimiento'>): Alerta {
  if (!v.soat_fecha_vencimiento) return { nivel: 'sin_datos', label: 'Sin SOAT registrado' };
  const dias = diasRestantes(v.soat_fecha_vencimiento);
  const nivel = nivelPorDias(dias);
  if (dias < 0) return { nivel, label: `SOAT vencido hace ${Math.abs(dias)} día(s)` };
  return { nivel, label: `SOAT vence en ${dias} día(s)` };
}

/**
 * Semaforo de mantenimiento: combina el proximo vencimiento por fecha y por
 * kilometraje (lo que ocurra primero) y se queda con el nivel mas critico de
 * los dos. Sin ninguno de los dos datos configurados, no hay alerta que mostrar.
 */
export function alertaMantenimiento(v: Pick<Vehiculo, 'proximo_mantenimiento_fecha' | 'proximo_mantenimiento_km' | 'kilometraje_actual'>): Alerta {
  const porFecha = v.proximo_mantenimiento_fecha ? diasRestantes(v.proximo_mantenimiento_fecha) : null;
  const kmRestantes = v.proximo_mantenimiento_km != null ? v.proximo_mantenimiento_km - v.kilometraje_actual : null;

  if (porFecha == null && kmRestantes == null) return { nivel: 'sin_datos', label: 'Sin próximo mantenimiento programado' };

  const nivelFecha = porFecha != null ? nivelPorDias(porFecha) : null;
  const nivelKm = kmRestantes != null ? (kmRestantes < 0 ? 'rojo' : kmRestantes <= VEHICULO_KM_ADVERTENCIA ? 'amarillo' : 'verde') : null;

  const orden: Record<AlertaNivel, number> = { rojo: 0, amarillo: 1, verde: 2, sin_datos: 3 };
  const nivel = [nivelFecha, nivelKm].filter((n): n is AlertaNivel => n != null).sort((a, b) => orden[a] - orden[b])[0];

  const partes: string[] = [];
  if (porFecha != null) partes.push(porFecha < 0 ? `venció hace ${Math.abs(porFecha)}d` : `en ${porFecha}d`);
  if (kmRestantes != null) partes.push(kmRestantes < 0 ? `excedido por ${Math.abs(kmRestantes)} km` : `en ${kmRestantes} km`);

  return { nivel, label: `Próximo mantenimiento: ${partes.join(' · ')}` };
}

export const ALERTA_BADGE_CLASS: Record<AlertaNivel, string> = {
  rojo: 'bg-red-500/15 text-red-600',
  amarillo: 'bg-amber-500/15 text-amber-600',
  verde: 'bg-green-500/15 text-green-600',
  sin_datos: 'bg-slate-500/15 text-slate-500',
};

const ORDEN_NIVEL: Record<AlertaNivel, number> = { rojo: 0, amarillo: 1, sin_datos: 2, verde: 3 };

/** Peor de los dos niveles (SOAT/mantenimiento), usado para ordenar y resaltar la fila del vehiculo. */
export function peorNivel(a: AlertaNivel, b: AlertaNivel): AlertaNivel {
  return ORDEN_NIVEL[a] <= ORDEN_NIVEL[b] ? a : b;
}
