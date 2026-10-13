import { EventEmitter } from 'node:events';
import type { OltAlertKind } from './oltAlerts';

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

/**
 * Fase 3 comercial OLT: alerta proactiva (caida/recuperacion online-offline,
 * cruce de umbral de senal) detectada en oltSyncService.ts (ver
 * oltAlerts.ts para la logica pura de deteccion). Solo en memoria, exclusivo
 * del panel vivo (SSE) — no se persiste en ninguna tabla nueva. Si no hay
 * nadie escuchando este SSE en el momento exacto del evento (nadie con el
 * panel de esa OLT abierto, o el backend se reinicio), la alerta se pierde:
 * no hay cola ni historial que la vuelva a entregar despues.
 */
export interface OltAlertEvent {
  oltDeviceId: string;
  ontDbId: string;
  kind: OltAlertKind;
  message: string;
  at: string;
}

class OltEventBus extends EventEmitter {
  emitOntChanged(payload: OntChangedEvent) {
    this.emit('ontChanged', payload);
  }

  emitSummaryChanged(payload: SummaryChangedEvent) {
    this.emit('summaryChanged', payload);
  }

  emitOltAlert(payload: OltAlertEvent) {
    this.emit('oltAlert', payload);
  }
}

// Muchos listeners posibles (una pestana por tecnico conectada al SSE de
// una OLT) — sube el limite por defecto de Node (10) para no llenar la
// consola de warnings de "MaxListenersExceeded".
export const oltEvents = new OltEventBus();
oltEvents.setMaxListeners(100);
