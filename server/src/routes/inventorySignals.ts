import { Hono } from 'hono';
// Mismo protocolo validado: un reloj global, sin Auth/SQL ni eventos operativos.
const frame = new TextEncoder().encode('event: invalidate\ndata: {"v":1}\n\n');
export function createInventorySignalHub(period = 10000) {
 const clients = new Map<ReadableStreamDefaultController<Uint8Array>, () => void>();
 const tick = setInterval(() => {
  for (const [client, stop] of clients) {
   try { if ((client.desiredSize ?? 0) <= 0) stop(); else client.enqueue(frame); }
   catch { stop(); }
  }
 }, period);
 tick.unref();
 return {
  response(signal: AbortSignal) {
   let controller: ReadableStreamDefaultController<Uint8Array>;
   const stop = () => { if (controller) { clients.delete(controller); try { controller.close(); } catch { /* ya cerrado */ } } signal.removeEventListener('abort', stop); };
   const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; if (signal.aborted) stop(); else { clients.set(c, stop); signal.addEventListener('abort', stop, { once: true }); } }, cancel: stop });
   return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
  },
  dispose() { clearInterval(tick); for (const stop of clients.values()) stop(); },
  size: () => clients.size,
 };
}
const hub = createInventorySignalHub();
export const inventorySignalRoutes = new Hono();
inventorySignalRoutes.get('/', c => {
 // Node añade Date por defecto: omitirlo en el stream genérico, si hay adaptador.
 const outgoing = (c.env as { outgoing?: { sendDate: boolean } } | undefined)?.outgoing;
 if (outgoing) outgoing.sendDate = false;
 return hub.response(c.req.raw.signal);
});
