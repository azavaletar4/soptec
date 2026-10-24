// Fase 174 (ampliación) — agregacion de historico del BALANCEADOR, en
// memoria (sin SQL nuevo, sin migracion nueva — el esquema ya aplicado
// alcanza: connection_id y physical_interface_name ya permiten agrupar).
// Sin I/O aqui a proposito, para poder probarlo sin red/DB real.
//
// Dos etapas, siempre en este orden (nunca se salta la primera):
//   1) sumSamplesByTick: suma, EN CADA INSTANTE REAL de muestreo, los
//      bps de las conexiones del alcance pedido (total/puerto/conexion
//      unica) — nunca mezcla instantes distintos entre si.
//   2) bucketTicks: agrupa esos totales-por-instante en los buckets de
//      tiempo que pide el rango (15min/1h/24h/7d), igual semantica que
//      fn_mikrotik_interface_series (Fase 172): avg/max/samples/online_samples.

export interface RawSample {
  sampledAt: string;
  rxBps: number;
  txBps: number;
  online: boolean;
}

export interface TickTotal {
  sampledAt: string;
  rxBps: number;
  txBps: number;
  online: boolean;
}

/**
 * Agrupa por el instante EXACTO de muestreo (todas las conexiones de un
 * mismo ciclo de descubrimiento comparten el mismo `sampled_at`, porque el
 * servicio usa un solo `now` para todo el ciclo) y suma sus bps. Si en un
 * instante dado falta la muestra de alguna conexion (ciclo parcial), el
 * total de ese instante se marca `online=false` para no disfrazar un dato
 * incompleto como saludable — pero NUNCA se descarta el instante ni se
 * inventa el valor faltante.
 */
export function sumSamplesByTick(samplesByConnection: RawSample[][]): TickTotal[] {
  const totalsByTick = new Map<string, { rxBps: number; txBps: number; count: number; onlineCount: number }>();
  for (const series of samplesByConnection) {
    for (const s of series) {
      const acc = totalsByTick.get(s.sampledAt) ?? { rxBps: 0, txBps: 0, count: 0, onlineCount: 0 };
      acc.rxBps += s.online ? s.rxBps : 0;
      acc.txBps += s.online ? s.txBps : 0;
      acc.count += 1;
      acc.onlineCount += s.online ? 1 : 0;
      totalsByTick.set(s.sampledAt, acc);
    }
  }
  const connectionsCount = samplesByConnection.length;
  return [...totalsByTick.entries()]
    .map(([sampledAt, acc]) => ({
      sampledAt,
      rxBps: acc.rxBps,
      txBps: acc.txBps,
      // Solo se marca online si TODAS las conexiones del alcance aportaron
      // dato real ese instante -- un total parcial no es un total confiable.
      online: acc.onlineCount === connectionsCount && acc.count === connectionsCount,
    }))
    .sort((a, b) => a.sampledAt.localeCompare(b.sampledAt));
}

export interface BucketedPoint {
  bucket_start: string;
  avg_rx_bps: number | null;
  avg_tx_bps: number | null;
  max_rx_bps: number | null;
  max_tx_bps: number | null;
  samples: number;
  online_samples: number;
}

/**
 * Agrupa una serie de totales-por-instante en buckets de tiempo (misma
 * forma de salida que fn_mikrotik_interface_series, Fase 172, para que el
 * frontend reutilice el mismo componente de grafico sin cambios). Nunca
 * inventa un punto para un bucket sin muestras reales -- simplemente no
 * aparece en el resultado.
 */
export function bucketTicks(ticks: TickTotal[], bucketSeconds: number): BucketedPoint[] {
  const buckets = new Map<string, { rx: number[]; tx: number[]; onlineRx: number[]; onlineTx: number[]; total: number; online: number }>();
  for (const t of ticks) {
    const epochSeconds = new Date(t.sampledAt).getTime() / 1000;
    const bucketStart = new Date(Math.floor(epochSeconds / bucketSeconds) * bucketSeconds * 1000).toISOString();
    const acc = buckets.get(bucketStart) ?? { rx: [], tx: [], onlineRx: [], onlineTx: [], total: 0, online: 0 };
    acc.total += 1;
    if (t.online) {
      acc.online += 1;
      acc.onlineRx.push(t.rxBps);
      acc.onlineTx.push(t.txBps);
    }
    buckets.set(bucketStart, acc);
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null);
  return [...buckets.entries()]
    .map(([bucket_start, acc]) => ({
      bucket_start,
      avg_rx_bps: avg(acc.onlineRx),
      avg_tx_bps: avg(acc.onlineTx),
      max_rx_bps: max(acc.onlineRx),
      max_tx_bps: max(acc.onlineTx),
      samples: acc.total,
      online_samples: acc.online,
    }))
    .sort((a, b) => a.bucket_start.localeCompare(b.bucket_start));
}

export type BalancerHistoryRange = '15m' | '1h' | '24h' | '7d';

export const BALANCER_HISTORY_RANGES: Record<BalancerHistoryRange, { sinceMinutes: number; bucketSeconds: number }> = {
  '15m': { sinceMinutes: 15, bucketSeconds: 60 },
  '1h': { sinceMinutes: 60, bucketSeconds: 60 },
  '24h': { sinceMinutes: 24 * 60, bucketSeconds: 300 },
  '7d': { sinceMinutes: 7 * 24 * 60, bucketSeconds: 1800 },
};
