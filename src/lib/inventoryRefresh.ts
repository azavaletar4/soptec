// Promoción del controlador validado en laboratorio: caché efímero por contexto.
export function createInventoryRefresh<C, T>(options: {
 load: (context: C, signal: AbortSignal) => Promise<T>;
 clear: () => void;
 publish: (value: T) => void;
 state: (state: 'idle' | 'loading' | 'ready' | 'blocked' | 'offline' | 'unavailable') => void;
}) {
 let generation = 0, current: C | null = null, blocked = false, online = true, visible = true;
 let abort: AbortController | null = null, flight: Promise<void> | null = null, dirty = false;
 // Corta cualquier lectura en curso (nueva "generacion", invalida su resultado
 // si llega tarde) SIN borrar lo que ya esta en pantalla. Pasar a oculto/sin
 // red es un pase pasajero -- no implica que el contexto (orden/tecnico) haya
 // cambiado, asi que los materiales/equipos ya cargados deben seguir visibles.
 const abortFlight = () => { generation++; abort?.abort(); abort = null; flight = null; dirty = false; };
 // Solo el contexto (otra orden, otro tecnico) o recuperarse de un bloqueo
 // justifican borrar lo ya mostrado: ahi si puede corresponder a otra cosa.
 const reset = () => { abortFlight(); options.clear(); };
 function refresh(afterWrite = false): Promise<void> {
  if (!current || blocked || !online || !visible) return Promise.resolve();
  if (flight) { if (afterWrite) dirty = true; return flight; }
  const g = generation, context = current;
  const task = (async () => {
   do {
    dirty = false; const request = new AbortController(); abort = request;
    options.state('loading');
    try {
     const value = await options.load(context, request.signal);
     if (g !== generation || request.signal.aborted) return;
     // No publicar una lectura anterior a una escritura confirmada mientras cargaba.
     if (!dirty) { options.publish(value); options.state('ready'); }
    } catch (error) {
     if (g !== generation || request.signal.aborted) return;
     options.clear();
     if (error && typeof error === 'object' && 'status' in error && [401, 403].includes(Number(error.status))) {
      blocked = true; reset(); options.state('blocked'); return;
     }
     options.state('unavailable');
    }
   } while (dirty && g === generation && !blocked && online && visible);
  })();
  flight = task;
  void task.finally(() => { if (g === generation && flight === task) { flight = null; abort = null; } });
  return task;
 }
 return {
  setContext(context: C | null) { reset(); current = context; blocked = false; options.state('idle'); },
  refresh,
  retry() { blocked = false; reset(); return refresh(); },
  deny() { blocked = true; reset(); options.state('blocked'); },
  setOnline(value: boolean) { if (online === value) return; online = value; if (!value) { abortFlight(); options.state(blocked ? 'blocked' : 'offline'); } },
  setVisible(value: boolean) { if (visible === value) return; visible = value; if (!value) abortFlight(); else void refresh(); },
  dispose() { reset(); current = null; blocked = true; },
 };
}
