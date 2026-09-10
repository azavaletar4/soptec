import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { healthRoutes } from './routes/health';
import { oltRoutes } from './routes/olt';

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
// Las rutas de dominio que siguen (mikrotik, tr069...) se agregan aqui,
// una por fase: app.route('/api/mikrotik', mikrotikRoutes)

const port = process.env.PORT ? Number(process.env.PORT) : 3001;

serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`SmartRayco API (Hono) escuchando en http://localhost:${info.port}`);
});
