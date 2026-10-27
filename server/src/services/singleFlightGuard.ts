// Guardia generica contra solicitudes duplicadas sobre el MISMO recurso
// (requisito 9: "prevenir solicitudes duplicadas y activaciones masivas").
// A diferencia de withOltLock (que encola y ejecuta ambas, una tras otra),
// esta guardia RECHAZA la segunda solicitud mientras la primera esta en
// vuelo — para una accion sensible como habilitar TR-069 no interesa que
// un segundo clic (o un segundo admin) quede "en cola" para ejecutarse
// igual un poco despues; interesa que falle clara e inmediatamente.
//
// Mismo alcance que withOltLock (ver oltTelnetLock.ts): un Map en memoria
// de ESTE proceso Node — no coordina entre procesos/instancias distintas.
export function createSingleFlightGuard() {
  const inFlight = new Set<string>();
  return {
    /** true si se pudo reservar la llave (nadie mas la tenia); false si ya estaba en vuelo. */
    tryAcquire(key: string): boolean {
      if (inFlight.has(key)) return false;
      inFlight.add(key);
      return true;
    },
    release(key: string): void {
      inFlight.delete(key);
    },
    has(key: string): boolean {
      return inFlight.has(key);
    },
  };
}
