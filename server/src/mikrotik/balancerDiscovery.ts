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
