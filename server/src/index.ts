import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { healthRoutes } from './routes/health';
import { oltRoutes } from './routes/olt';
import { mikrotikRoutes } from './routes/mikrotik';
import { dashboardRoutes } from './routes/dashboard';
import { genieacsRoutes } from './routes/genieacs';
import { tr069SyncRoutes } from './routes/tr069sync';
import { genieacsSyncRoutes } from './routes/genieacsSync';
import { usersRoutes } from './routes/users';
import { xuiRoutes } from './routes/xui';
import { debtHoldRoutes } from './routes/debtHold';
import { invoicesRoutes } from './routes/invoices';
import { startTr069Scheduler } from './services/tr069Scheduler';
import { startDebtHoldScheduler } from './services/debtHoldScheduler';

const app = new Hono();

app.use(
  '/api/*',
  cors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  }),
);

app.route('/api/health', healthRoutes);
app.route('/api/olt-devices', oltRoutes);
app.route('/api/mikrotik-devices', mikrotikRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/genieacs', genieacsRoutes);
app.route('/api/tr069-sync', tr069SyncRoutes);
app.route('/api/genieacs-sync', genieacsSyncRoutes);
app.route('/api/users', usersRoutes);
app.route('/api/xui', xuiRoutes);
app.route('/api/debt-hold', debtHoldRoutes);
app.route('/api/invoices', invoicesRoutes);

// En produccion (Fase 14: PM2 + Cloudflare Tunnel) un solo proceso sirve
// API + frontend compilado — no hace falta un servidor separado (Vite dev
// server es solo para desarrollo). El fallback a index.html permite el
// modo history del router de Vue.
if (process.env.NODE_ENV === 'production') {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', serveStatic({ path: './dist/index.html' }));
}

const port = process.env.PORT ? Number(process.env.PORT) : 3001;

serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`SmartRayco API (Hono) escuchando en http://localhost:${info.port}`);
});

startTr069Scheduler();
startDebtHoldScheduler();
