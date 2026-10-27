import { Hono } from 'hono';
import { requireRole } from '../middleware/auth';
import { tr069PreparationOnly } from '../middleware/tr069PreparationOnly';
import { prepareWifiSsid, readWifiInventory } from '../services/tr069WifiPreparation';
import { wifiTrial } from '../services/tr069WifiTrial';

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

wifiPreparationRoutes.use('/:serial/trial/*', requireRole('ADMIN', 'SUPERADMIN'));
wifiPreparationRoutes.get('/:serial/trial/status', async c => {
  try { return c.json(await wifiTrial.status(nbi(), c.req.param('serial') ?? '')); }
  catch { return c.json({ error: 'No se pudo consultar el estado seguro de la prueba' }, 409); }
});
for (const action of ['change', 'restore', 'verify'] as const) {
  wifiPreparationRoutes.post(`/:serial/trial/${action}`, async c => {
    try {
      const serial = c.req.param('serial') ?? '';
      const result = action === 'verify' ? await wifiTrial.verify(nbi(), serial) :
        await wifiTrial[action](nbi(), serial, await c.req.json(), c.get('user').id);
      return c.json(result);
    } catch (e) {
      // Nunca enviar cuerpos NBI, credenciales ni errores de filesystem al navegador.
      const message = e instanceof Error && !('code' in e) && !(e instanceof SyntaxError) && !/fetch|network|JSON/i.test(e.message)
        ? e.message : 'Operación no confirmada. Consulta el estado antes de repetir.';
      return c.json({ error: message }, 409);
    }
  });
}
