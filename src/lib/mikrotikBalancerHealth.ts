// Fase 174 (continuación) — helpers puros de presentación para los
// indicadores de salud del router BALANCEADOR (CPU ya se mostraba desde la
// primera entrega; esto agrega RAM, uptime y el conteo de conexiones WAN).
// Sin red/Supabase aquí a propósito, para poder probarlos sin mockear nada
// (mismo criterio que mikrotikBorderTraffic.ts).

/** Bytes crudos (como los reporta /system/resource) a "512 MB" / "1.95 GB". */
export function formatMemoryBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export interface MemoryUsageSummary {
  usedLabel: string;
  totalLabel: string;
  freeLabel: string;
  usedPercent: number | null;
}

/** RAM usada = total - libre (RouterOS solo reporta la libre) + % de uso. */
export function summarizeMemoryUsage(freeBytes: number | null | undefined, totalBytes: number | null | undefined): MemoryUsageSummary {
  if (freeBytes == null || totalBytes == null || !Number.isFinite(freeBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0) {
    return { usedLabel: '—', totalLabel: '—', freeLabel: '—', usedPercent: null };
  }
  const used = Math.max(0, totalBytes - freeBytes);
  return {
    usedLabel: formatMemoryBytes(used),
    totalLabel: formatMemoryBytes(totalBytes),
    freeLabel: formatMemoryBytes(freeBytes),
    usedPercent: Math.round((used / totalBytes) * 100),
  };
}

/**
 * RouterOS reporta el uptime como "4w3d12h5m33s" (semanas/dias/horas/min/seg
 * concatenados, cualquiera puede faltar). El pedido es dias/horas/minutos
 * legibles -- los segundos se ignoran a propósito (demasiado detalle para
 * un indicador de cabecera) y las semanas se pliegan a días.
 */
export function formatRouterUptime(raw: string | null | undefined): string {
  if (!raw) return '—';
  const matches = [...raw.matchAll(/(\d+)(w|d|h|m|s)/g)];
  if (!matches.length) return raw; // formato inesperado -- se muestra tal cual, nunca se inventa

  let days = 0;
  let hours = 0;
  let minutes = 0;
  for (const [, numStr, unit] of matches) {
    const n = Number(numStr);
    if (unit === 'w') days += n * 7;
    else if (unit === 'd') days += n;
    else if (unit === 'h') hours += n;
    else if (unit === 'm') minutes += n;
  }

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} día${days === 1 ? '' : 's'}`);
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes} min`);
  return parts.join(', ');
}

export interface WanConnectionCounts {
  up: number;
  down: number;
  disabled: number;
  unknown: number;
}

/**
 * Requisito 1: cantidad de conexiones WAN por estado. `disabled` es una
 * configuración ya confirmada en la última lectura buena y se mantiene
 * aunque los datos estén obsoletos (no es un hecho "en vivo" que caduque);
 * en cambio conectada/sin-conexión SI depende de una lectura reciente --
 * con `isStale=true` esas se cuentan como "desconocidas" en vez de inventar
 * que siguen igual que la última vez que se supo algo.
 */
export function summarizeWanConnectionCounts(connections: Array<{ disabled: boolean; running: boolean }>, isStale: boolean): WanConnectionCounts {
  const counts: WanConnectionCounts = { up: 0, down: 0, disabled: 0, unknown: 0 };
  for (const c of connections) {
    if (c.disabled) {
      counts.disabled++;
      continue;
    }
    if (isStale) {
      counts.unknown++;
      continue;
    }
    if (c.running) counts.up++;
    else counts.down++;
  }
  return counts;
}
