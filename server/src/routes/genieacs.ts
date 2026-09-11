import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth';

// Adaptado de REPLICA-TR069-GENIEACS.md seccion 8: proxy reverso al NBI de
// GenieACS. La sesion JWT de Supabase (requireAuth) actua como guardian;
// GenieACS no requiere auth propia en la red interna del ISP.
const NBI = process.env.GENIEACS_NBI || 'http://localhost:7557';

export const genieacsRoutes = new Hono();

const STAFF_READ = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'] as const;

genieacsRoutes.use('*', requireAuth, requireRole(...STAFF_READ));

genieacsRoutes.all('*', async (c) => {
  const rawUrl = new URL(c.req.url);
  const prefix = '/api/genieacs';
  const subPath = rawUrl.pathname.startsWith(prefix) ? rawUrl.pathname.slice(prefix.length) || '/' : rawUrl.pathname;

  let body: Buffer | undefined;
  if (c.req.method === 'POST' || c.req.method === 'PUT') {
    body = Buffer.from(await c.req.arrayBuffer());
  }

  try {
    const fwdHeaders: Record<string, string> = {};
    for (const [k, v] of c.req.raw.headers.entries()) {
      if (!['host', 'connection', 'transfer-encoding', 'te', 'trailers', 'upgrade', 'authorization'].includes(k.toLowerCase())) {
        fwdHeaders[k] = v;
      }
    }
    if (body?.length && !fwdHeaders['content-type']) fwdHeaders['content-type'] = 'application/json';

    const upstream = await fetch(`${NBI}${subPath}${rawUrl.search}`, {
      method: c.req.method,
      headers: fwdHeaders,
      body: body?.length ? body : undefined,
      signal: AbortSignal.timeout(60_000),
    });

    const text = await upstream.text();
    const contentType = upstream.headers.get('content-type') ?? 'application/json';
    return new Response(text, { status: upstream.status, headers: { 'Content-Type': contentType } });
  } catch (e) {
    return c.json({ error: `GenieACS NBI no disponible: ${e instanceof Error ? e.message : 'Error de conexion'}` }, 502);
  }
});
