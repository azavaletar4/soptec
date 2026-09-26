// Mutex real por OLT: la ZTE C300 de este proyecto solo tolera UNA sesion
// Telnet a la vez (2 o mas conexiones simultaneas ya causaron un incidente
// real, 2026-09-11: 8/19 puertos fallaron por timeouts). Hasta ahora esa
// regla era solo una convencion en comentarios ("nunca Promise.all contra
// la misma OLT") — con el sync en background corriendo cada N minutos, ya
// no alcanza con la disciplina manual: una accion de un tecnico (registrar,
// activar, leer senal...) puede caer justo cuando el sync automatico esta
// a mitad de un escaneo. `withOltLock` encola ambas cosas para el mismo
// device y las corre en orden, nunca en paralelo.

const queues = new Map<string, Promise<unknown>>();

export function withOltLock<T>(deviceId: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(deviceId) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  // Se guarda sin importar si fn() termino bien o mal, para que un fallo no
  // deje la cola trabada esperando una promesa rechazada para siempre.
  queues.set(
    deviceId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}
