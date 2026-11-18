// Fase 174 — nucleo puro del descubrimiento de conexiones WAN del
// MikroTik BALANCEADOR. Sin I/O aqui a proposito (ni Supabase ni REST),
// para poder probarlo sin red/DB real.
//
// Principio central (requisito 2 del pedido): la relacion entre una sesion
// PPPoE, su interfaz MACVLAN y su puerto fisico SIEMPRE se resuelve
// siguiendo el campo propio `interface` que cada nivel ya reporta en
// RouterOS -- JAMAS se adivina por el nombre (ej. "PPPoE-WAN031" no se
// asume que vive en el puerto 2 solo porque el numero "parece" cuadrar).

export interface MacvlanRaw {
  name: string;
  interface?: string; // puerto fisico real (RouterOS lo reporta asi)
  disabled?: string;
  running?: string;
}

export interface PppoeClientRaw {
  name: string;
  interface?: string; // macvlan real sobre la que corre (RouterOS lo reporta asi)
  user?: string;
  disabled?: string;
  running?: string;
}

export interface ResolvedConnection {
  pppoeInterfaceName: string;
  macvlanInterfaceName: string | null;
  physicalInterfaceName: string | null;
  pppoeUser: string | null;
  disabled: boolean;
  running: boolean;
}

/**
 * Arma la cadena real puerto-fisico <- macvlan <- PPPoE-client, siguiendo
 * SIEMPRE los campos `interface` que cada nivel reporta (nunca el nombre).
 * Si una sesion PPPoE referencia una macvlan que ya no existe (o nunca
 * existio), `macvlanInterfaceName`/`physicalInterfaceName` quedan en null
 * -- nunca se inventa un valor para rellenar el hueco (regla permanente
 * del proyecto: "Pendiente de vincular", nunca inferido).
 */
export function resolveConnectionTopology(macvlans: MacvlanRaw[], pppoeClients: PppoeClientRaw[]): ResolvedConnection[] {
  const macvlanByName = new Map(macvlans.map((m) => [m.name, m]));
  return pppoeClients.map((p) => {
    const macvlan = p.interface ? macvlanByName.get(p.interface) : undefined;
    return {
      pppoeInterfaceName: p.name,
      macvlanInterfaceName: p.interface ?? null,
      physicalInterfaceName: macvlan?.interface ?? null,
      pppoeUser: p.user || null,
      disabled: p.disabled === 'true',
      running: p.running === 'true',
    };
  });
}

export type ConnectionStatus = 'disabled' | 'down' | 'up';

/**
 * Requisito 8: una interfaz deshabilitada NUNCA es una averia confirmada
 * -- es simplemente una linea que hoy no se usa (ej. un puerto SFP
 * preparado pero sin contratar). Solo `disabled=false` + `running=false`
 * es un problema real de conectividad digno de revisar.
 */
export function classifyConnectionStatus(disabled: boolean, running: boolean): ConnectionStatus {
  if (disabled) return 'disabled';
  return running ? 'up' : 'down';
}

// Tolera ~2 ciclos de descubrimiento perdidos (cada ~60s, ver
// mikrotikBalancerDiscoveryScheduler.ts) antes de declarar los datos
// obsoletos -- un solo sondeo fallido puntual no debe mostrar "sin datos
// recientes" ni, mucho menos, "todas las conexiones caidas".
export const BALANCER_DISCOVERY_STALE_AFTER_SECONDS = 180;

/**
 * El router balanceador no respondio hace cuanto -- usado para decidir si
 * el estado running/disabled YA GUARDADO sigue siendo confiable para
 * mostrar "conectada"/"sin conexion", o si hay que mostrar "estado
 * desconocido" en vez de inventar que algo sigue (o dejo de estar) activo.
 * `lastSeenAtIso` null (nunca se descubrio nada todavia) tambien es
 * obsoleto por definicion.
 */
export function isBalancerDataStale(lastSeenAtIso: string | null, nowMs: number, staleAfterSeconds: number = BALANCER_DISCOVERY_STALE_AFTER_SECONDS): boolean {
  if (!lastSeenAtIso) return true;
  const lastSeenMs = new Date(lastSeenAtIso).getTime();
  if (Number.isNaN(lastSeenMs)) return true;
  return nowMs - lastSeenMs > staleAfterSeconds * 1000;
}

/**
 * Prepara `resolved` para un UPSERT en lote (una sola llamada con un array,
 * en vez de una llamada por conexion -- causa real del exceso de logs de
 * Supabase diagnosticado 18/11/2026, ver docs/SUPABASE-LOG-INGESTION-*).
 *
 * Un batch de Postgres con la MISMA clave de conflicto repetida dos veces
 * en el mismo INSERT ... ON CONFLICT falla ("ON CONFLICT DO UPDATE command
 * cannot affect row a second time"), algo que la version anterior (una
 * llamada por fila) nunca podia disparar. El router real no deberia repetir
 * `pppoeInterfaceName`, pero si llegara a pasar (dato inconsistente de un
 * ciclo puntual), se conserva solo la ULTIMA aparicion -- mismo resultado
 * final que tendria el loop anterior ejecutando sus upserts en orden.
 */
export function dedupeResolvedConnectionsByName(resolved: readonly ResolvedConnection[]): ResolvedConnection[] {
  const byName = new Map<string, ResolvedConnection>();
  for (const conn of resolved) byName.set(conn.pppoeInterfaceName, conn);
  return [...byName.values()];
}

// Tamano maximo de un solo lote hacia Supabase/PostgREST. Con los ~30
// conexiones reales de hoy un solo lote alcanza siempre; este limite es
// solo una salvaguarda para que, si el numero de conexiones monitoreadas
// crece mucho a futuro, el batch se divida en varias llamadas en vez de
// mandar un body sin limite (o volver, por error, a una llamada por fila).
export const BALANCER_BATCH_CHUNK_SIZE = 500;

export function chunkArray<T>(items: readonly T[], chunkSize: number = BALANCER_BATCH_CHUNK_SIZE): T[][] {
  if (chunkSize <= 0) throw new Error('chunkArray: chunkSize debe ser mayor a 0');
  if (!items.length) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) chunks.push(items.slice(i, i + chunkSize));
  return chunks;
}

export interface ConnectionDiff {
  /** Nombres que aparecen ahora pero no estaban antes en la BD (altas nuevas). */
  newNames: string[];
  /** Nombres que siguen existiendo en ambos lados. */
  stillPresentNames: string[];
  /** Nombres que estaban en la BD y ya no aparecen en el router -- se marcan removed_at, nunca se borran. */
  removedNames: string[];
}

/**
 * Requisitos 4 y 10: nunca asume una cantidad fija de conexiones -- compara
 * lo que YA se conocia (BD) contra lo que el router reporta AHORA MISMO,
 * sin importar cuantas sean de cada lado.
 */
export function diffDiscoveredConnections(previouslyKnownNames: readonly string[], currentlyDiscoveredNames: readonly string[]): ConnectionDiff {
  const previousSet = new Set(previouslyKnownNames);
  const currentSet = new Set(currentlyDiscoveredNames);
  return {
    newNames: currentlyDiscoveredNames.filter((n) => !previousSet.has(n)),
    stillPresentNames: currentlyDiscoveredNames.filter((n) => previousSet.has(n)),
    removedNames: previouslyKnownNames.filter((n) => !currentSet.has(n)),
  };
}
