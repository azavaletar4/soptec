import { EventEmitter } from 'node:events';

// Emisor de eventos en memoria para el tiempo real de la seccion OLT
// (server/src/routes/olt.ts: endpoint SSE /:id/events). Se usa un
// EventEmitter simple en vez de Supabase Realtime porque olt_devices/
// olt_onts tienen RLS activado SIN policies a proposito (Fase 4: solo el
// backend con service_role las toca) — este emisor deja ese limite intacto,
// el frontend nunca consulta esas tablas directo.
//
// Un solo proceso backend (PM2 sin balanceo, ver README de supabase/) ->
// alcanza con un EventEmitter de proceso, sin Redis pub/sub.

export interface OntChangedEvent {
  oltDeviceId: string;
  // Fila (o parche parcial) de olt_onts que cambio — se reenvia tal cual por
  // SSE via JSON.stringify, nunca se lee su forma en este archivo.
  ont: unknown;
}

export interface SummaryChangedEvent {
  oltDeviceId: string;
}

class OltEventBus extends EventEmitter {
  emitOntChanged(payload: OntChangedEvent) {
    this.emit('ontChanged', payload);
  }

  emitSummaryChanged(payload: SummaryChangedEvent) {
    this.emit('summaryChanged', payload);
  }
}

// Muchos listeners posibles (una pestana por tecnico conectada al SSE de
// una OLT) — sube el limite por defecto de Node (10) para no llenar la
// consola de warnings de "MaxListenersExceeded".
export const oltEvents = new OltEventBus();
oltEvents.setMaxListeners(100);
