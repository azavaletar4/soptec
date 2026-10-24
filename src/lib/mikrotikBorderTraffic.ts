// Fase 169 — helpers puros de presentacion para el panel de trafico del
// MikroTik de borde dedicado (CCR2004 Fiberlux). Sin llamadas a red/Supabase
// aqui a proposito, para poder probarlos sin mockear nada.

export type CapacityUnit = 'Mbps' | 'Gbps';

/** Convierte un valor + unidad elegida por el admin a Mbps (unidad en la que se guarda `capacity_*_mbps`). */
export function toMbps(value: number, unit: CapacityUnit): number {
  return unit === 'Gbps' ? value * 1000 : value;
}

/** Elige la representacion mas legible (Mbps si es chico, Gbps si ya es grande) para mostrar un valor guardado en Mbps. */
export function splitMbpsForDisplay(mbps: number): { value: number; unit: CapacityUnit } {
  if (mbps >= 1000) return { value: Math.round((mbps / 1000) * 100) / 100, unit: 'Gbps' };
  return { value: mbps, unit: 'Mbps' };
}

/** bps crudo (como lo da el calculo de delta) a un texto Mbps/Gbps legible. */
export function formatBpsAsMbps(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps) || bps <= 0) return '0 Mbps';
  const mbps = bps / 1_000_000;
  if (mbps < 1000) return `${mbps.toFixed(mbps < 10 ? 2 : 1)} Mbps`;
  return `${(mbps / 1000).toFixed(2)} Gbps`;
}

/** % de uso de una capacidad configurada (en Mbps) dado un bps actual — acotado a [0, 999] para que un pico puntual no rompa una barra de progreso. */
export function usagePercent(currentBps: number | null | undefined, capacityMbps: number): number {
  if (currentBps == null || !Number.isFinite(currentBps) || capacityMbps <= 0) return 0;
  const capacityBps = capacityMbps * 1_000_000;
  return Math.min(999, Math.max(0, Math.round((currentBps / capacityBps) * 100)));
}

export function usageBarClass(pct: number): string {
  if (pct >= 100) return 'bg-red-500';
  if (pct >= 85) return 'bg-amber-500';
  return 'bg-emerald-500';
}
export function usageTextClass(pct: number): string {
  if (pct >= 100) return 'text-red-600';
  if (pct >= 85) return 'text-amber-600';
  return 'text-emerald-600';
}
