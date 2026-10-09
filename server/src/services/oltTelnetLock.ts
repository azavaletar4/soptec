// Mutex real por OLT: la ZTE C300 de este proyecto solo tolera UNA sesion
// Telnet a la vez (2 o mas conexiones simultaneas ya causaron un incidente
// real, 2026-09-11: 8/19 puertos fallaron por timeouts). Hasta ahora esa
// regla era solo una convencion en comentarios ("nunca Promise.all contra
// la misma OLT") — con el sync en background corriendo cada N minutos, ya
// no alcanza con la disciplina manual: una accion de un tecnico (registrar,
// activar, leer senal...) puede caer justo cuando el sync automatico esta
// a mitad de un escaneo. `withOltLock` encola ambas cosas para el mismo
// device y las corre en orden, nunca en paralelo.
//
// Fase 77 — dos colas por prioridad en vez de una sola FIFO: el sync
// automatico (background) antes mantenia la sesion ocupada ~6 minutos
// seguidos (20 puertos en UN SOLO withOltLock), y cualquier accion de un
// tecnico quedaba atras esperando eso entero. Ahora oltSyncService.ts pide
// el lock UNA VEZ POR CADA PASO chico (puerto por puerto) en vez de una vez
// para todo el sync — entre paso y paso, si hay algo 'interactive' esperando
// (un tecnico activo en el panel), se cuela antes de que el sync siga con
// el siguiente paso. Nunca interrumpe un comando Telnet YA EN VUELO (eso
// seguiria siendo peligroso contra este equipo) — solo decide que arranca
// DESPUES de que el actual termine.
//
// OJO — ALCANCE REAL DEL LOCK (Fase 1, auditoria Telnet): "queues" es un
// Map en memoria de ESTE proceso Node, nada mas. Solo serializa Telnet
// contra una OLT dentro del mismo proceso; NO protege entre procesos
// distintos (ej. dos "node" corriendo este codigo a la vez, o PM2 en modo
// "cluster"/varias instancias). Hoy esto es seguro porque ambos
// ecosystem*.config.cjs corren un solo proceso backend sin cluster (ver
// smartrayco-api / smartrayco) — si eso cambia alguna vez (mas instancias,
// cluster mode, multiples deploys hablandole a la misma OLT), este lock
// YA NO alcanza y habria que coordinarlo afuera del proceso (ej. un lock
// en la base de datos) antes de escalar.
export type OltLockPriority = 'interactive' | 'background';
type Priority = OltLockPriority;

interface QueueItem {
  fn: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

interface DeviceQueue {
  running: boolean;
  interactive: QueueItem[];
  background: QueueItem[];
}

const queues = new Map<string, DeviceQueue>();

function getQueue(deviceId: string): DeviceQueue {
  let q = queues.get(deviceId);
  if (!q) {
    q = { running: false, interactive: [], background: [] };
    queues.set(deviceId, q);
  }
  return q;
}

function runNext(deviceId: string) {
  const q = getQueue(deviceId);
  if (q.running) return;
  // Interactive siempre primero, aunque haya llegado despues — es lo que
  // resuelve el problema real: un tecnico esperando en el panel no debe
  // hacer cola detras de 20 puertos de un sync que nadie esta mirando.
  const next = q.interactive.shift() ?? q.background.shift();
  if (!next) return;

  q.running = true;
  next
    .fn()
    .then(
      (v) => next.resolve(v),
      (e) => next.reject(e),
    )
    .finally(() => {
      q.running = false;
      runNext(deviceId);
    });
}

export function withOltLock<T>(
  deviceId: string,
  fn: () => Promise<T>,
  opts: { priority?: Priority } = {},
): Promise<T> {
  const priority = opts.priority ?? 'interactive';
  return new Promise<T>((resolve, reject) => {
    const q = getQueue(deviceId);
    const item: QueueItem = { fn: fn as () => Promise<unknown>, resolve: resolve as (v: unknown) => void, reject };
    (priority === 'interactive' ? q.interactive : q.background).push(item);
    runNext(deviceId);
  });
}
