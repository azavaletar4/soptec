import { Hono } from 'hono';
import { requireRole } from '../middleware/auth';
import { hostsOnDemand, HostsDemandError } from '../services/tr069HostsOnDemand';

/** Montado detrás de requireAuth; GET de caché conserva sus permisos actuales. */
export function createHostsOnDemandRoutes(service = hostsOnDemand) {
  const routes = new Hono();
  routes.post('/:serial/read', requireRole('ADMIN', 'SUPERADMIN'), async c => {
    try {
      const text = await c.req.text();
      if (text && (JSON.stringify(JSON.parse(text)) !== '{}')) return c.json({ error: 'La lectura no admite parámetros de configuración.' }, 400);
      const result = await service.read(process.env.GENIEACS_NBI || 'http://localhost:7557', c.req.param('serial') ?? '');
      return c.json(result, ['pending', 'uncertain'].includes(result.state) ? 202 : 200);
    } catch (error) {
      return c.json({ error: error instanceof HostsDemandError ? error.message : 'No se pudo iniciar o comprobar la lectura. Se conserva la lista anterior; no se reintentará automáticamente.' }, 409);
    }
  });
  return routes;
}

export const hostsOnDemandRoutes = createHostsOnDemandRoutes();
