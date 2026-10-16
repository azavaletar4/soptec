// Avisos anónimos y constantes. Sin identificadores de orden, usuario o sesión.
export function startInventorySignals(callbacks: { refresh: () => unknown; online: (value: boolean) => void; visible: (value: boolean) => void; skipInitialRefresh?: boolean }) {
 let source: EventSource | null = null, retry: ReturnType<typeof setTimeout> | null = null;
 let fallback: ReturnType<typeof setInterval> | null = null, delay = 1000, disposed = false;
 let network = navigator.onLine;
 let first = true;
 const opened = () => { callbacks.online(true); if (!first || !callbacks.skipInitialRefresh) void callbacks.refresh(); first = false; };
 function cancelRetry() { if (retry) clearTimeout(retry); retry = null; }
 function connect() {
  cancelRetry(); source?.close(); source = null;
  if (disposed || !network) return;
  if (typeof EventSource === 'undefined') {
   // WebViews antiguos: reloj local idéntico, sin transporte operativo alternativo.
   if (!fallback) fallback = setInterval(() => { if (network && !document.hidden) void callbacks.refresh(); }, 10000);
   opened(); return;
  }
  const stream = new EventSource('/api/inventory-signals'); source = stream;
  stream.addEventListener('invalidate', (event) => {
   const message = event as MessageEvent;
   if (source === stream && !disposed && message.data === '{"v":1}' && message.lastEventId === '') void callbacks.refresh();
  });
  stream.onopen = () => { if (source !== stream || disposed) return; delay = 1000; opened(); };
  stream.onerror = () => {
   if (source !== stream || disposed) return;
   callbacks.online(false); stream.close(); source = null;
   if (network) { retry = setTimeout(connect, delay); delay = Math.min(delay * 2, 10000); }
  };
 }
 const offline = () => { network = false; cancelRetry(); source?.close(); source = null; callbacks.online(false); };
 const online = () => { network = true; connect(); };
 const visibility = () => callbacks.visible(!document.hidden);
 const hide = () => { cancelRetry(); source?.close(); source = null; callbacks.online(false); };
 const show = () => { if (!disposed) { network = navigator.onLine; connect(); visibility(); } };
 callbacks.visible(!document.hidden); callbacks.online(network);
 window.addEventListener('offline', offline); window.addEventListener('online', online);
 window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show);
 document.addEventListener('visibilitychange', visibility); connect();
 return () => {
  disposed = true; cancelRetry(); source?.close(); source = null;
  if (fallback) clearInterval(fallback);
  window.removeEventListener('offline', offline); window.removeEventListener('online', online);
  window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show);
  document.removeEventListener('visibilitychange', visibility);
 };
}
