import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { healthRoutes } from './routes/health';
import { oltRoutes } from './routes/olt';
import { mikrotikRoutes } from './routes/mikrotik';
import { dashboardRoutes } from './routes/dashboard';
import { genieacsRoutes } from './routes/genieacs';
import { tr069SyncRoutes } from './routes/tr069sync';
import { genieacsSyncRoutes } from './routes/genieacsSync';

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

const port = process.env.PORT ? Number(process.env.PORT) : 3001;

serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`SmartRayco API (Hono) escuchando en http://localhost:${info.port}`);
});
