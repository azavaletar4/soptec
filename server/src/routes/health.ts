import { Hono } from 'hono';

export const healthRoutes = new Hono();

healthRoutes.get('/', (c) =>
  c.json({
    status: 'ok',
    service: 'smartrayco-api',
    timestamp: new Date().toISOString(),
  }),
);
