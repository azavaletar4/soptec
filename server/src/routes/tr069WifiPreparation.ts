import { Hono } from 'hono';
import { requireRole } from '../middleware/auth';
import { tr069PreparationOnly } from '../middleware/tr069PreparationOnly';
import { prepareWifiSsid, readWifiInventory } from '../services/tr069WifiPreparation';

// Se monta detrás de requireAuth del router padre; requireRole se prueba realmente.
export const wifiPreparationRoutes = new Hono();
const nbi = () => process.env.GENIEACS_NBI || 'http://localhost:7557';

wifiPreparationRoutes.get('/:serial', async c => {
  try { return c.json(await readWifiInventory(nbi(), c.req.param('serial'))); }
  catch { return c.json({ error: 'No se pudo identificar de forma única el equipo o consultar WiFi' }, 409); }
});

wifiPreparationRoutes.post('/:serial/prepare', requireRole('ADMIN', 'SUPERADMIN'), async c => {
  try { return c.json(await prepareWifiSsid(nbi(), c.req.param('serial') ?? '', await c.req.json())); }
  catch (error) {
    // Los errores del servicio son fijos; nunca incluir body, secretos ni respuesta NBI.
    return c.json({ error: error instanceof SyntaxError ? 'Solicitud JSON inválida' :
      error instanceof Error && !/fetch|network/i.test(error.message) ? error.message : 'No se pudo preparar el cambio' }, 409);
  }
});

wifiPreparationRoutes.post('/:serial', tr069PreparationOnly);
