import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth';
import { getProxmoxSummary, getNodeRrdData, runVmAction, isValidVmAction, type VmType } from '../services/proxmoxService';

export const proxmoxRoutes = new Hono();

// Solo ADMIN/SUPERADMIN (pedido explicito) — a diferencia de OLT/MikroTik,
// esto no es algo que un tecnico de campo o soporte necesite tocar.
const MANAGE = ['SUPERADMIN', 'ADMIN'] as const;
proxmoxRoutes.use('*', requireAuth, requireRole(...MANAGE));

proxmoxRoutes.get('/summary', async (c) => {
  try {
    const summary = await getProxmoxSummary();
    return c.json(summary);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al consultar Proxmox' }, 502);
  }
});

proxmoxRoutes.get('/rrddata', async (c) => {
  const timeframe = c.req.query('timeframe') === 'day' ? 'day' : 'hour';
  try {
    const data = await getNodeRrdData(timeframe);
    return c.json(data);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al consultar el historico de Proxmox' }, 502);
  }
});

proxmoxRoutes.post('/vms/:type/:vmid/:action', async (c) => {
  const type = c.req.param('type');
  const vmid = Number(c.req.param('vmid'));
  const action = c.req.param('action');

  if (type !== 'qemu' && type !== 'lxc') return c.json({ error: 'type debe ser "qemu" o "lxc"' }, 400);
  if (!Number.isInteger(vmid) || vmid <= 0) return c.json({ error: 'vmid invalido' }, 400);
  if (!isValidVmAction(action)) return c.json({ error: 'accion invalida (start, shutdown o reboot)' }, 400);

  try {
    await runVmAction(type as VmType, vmid, action);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al enviar la accion a Proxmox' }, 502);
  }
});
