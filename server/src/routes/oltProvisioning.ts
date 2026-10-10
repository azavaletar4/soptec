import { Hono } from 'hono';
import { requireRole } from '../middleware/auth';
import {
  handleProvisionRequest, handleReconcileRequest,
  type ProvisionHandlerDeps, type ProvisionRequestBody,
} from '../services/oltProvisioningHandler';
import type { ProvisioningStore } from '../services/oltProvisioningStore';

export interface OltProvisioningRouteDeps {
  store: ProvisioningStore;
  buildDeps(deviceId: string, body: ProvisionRequestBody, rawBody: Record<string, unknown>): Promise<ProvisionHandlerDeps | null>;
}

export function toProvisionRequestBody(body: Record<string, unknown>): ProvisionRequestBody {
  const m = body.mikrotik as Record<string, unknown> | undefined;
  const w = body.wan as Record<string, unknown> | undefined;
  const p = body.pppoeReference as Record<string, unknown> | undefined;
  return {
    idempotencyKey: String(body.idempotencyKey ?? ''),
    shelf: typeof body.shelf === 'number' ? body.shelf : 1,
    slot: Number(body.slot), port: Number(body.port), serial: String(body.serial ?? ''),
    onuType: String(body.onuType ?? ''), description: typeof body.description === 'string' ? body.description : '',
    vlan: Number(body.vlan), tcontProfile: String(body.tcontProfile ?? ''), trafficProfile: String(body.trafficProfile ?? ''),
    onuId: typeof body.onuId === 'number' ? body.onuId : undefined,
    clientId: typeof body.clientId === 'string' ? body.clientId : null,
    contractId: typeof body.contractId === 'string' ? body.contractId : null,
    zoneId: typeof body.zoneId === 'string' && body.zoneId ? body.zoneId : null,
    napId: typeof body.napId === 'string' && body.napId ? body.napId : null,
    mikrotik: m ? { deviceId: String(m.deviceId ?? ''), secretMode: String(m.secretMode ?? ''), profile: String(m.profile ?? ''),
      newSecretName: m.secretMode === 'create' ? String(m.newSecretName ?? '').trim() : undefined,
      existingSecretId: m.secretMode === 'existing' ? String(m.existingSecretId ?? '') : undefined,
      existingSecretName: m.secretMode === 'existing' ? String(m.existingSecretName ?? '') : undefined } : undefined,
    pppoeReference: p ? { deviceId: String(p.deviceId ?? ''), username: String(p.username ?? ''), profile: String(p.profile ?? ''),
      secretId: typeof p.secretId === 'string' ? p.secretId : undefined } : undefined,
    wan: w ? { username: String(w.username ?? ''), vlanProfile: String(w.vlanProfile ?? '') } : undefined,
  };
}

/** Mounted below oltRoutes' requireAuth. Both write URLs share one pipeline. */
export function createOltProvisioningRoutes(deps: OltProvisioningRouteDeps) {
  const routes = new Hono();
  const provisionRole = requireRole('SUPERADMIN', 'ADMIN');
  const readRole = requireRole('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE');
  routes.post('/:id/onts', provisionRole, provision);
  routes.post('/:id/onts/provision', provisionRole, provision);

  async function provision(c: Parameters<typeof provisionRole>[0]) {
    const raw = await c.req.json().catch(() => null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return c.json({ error: 'Solicitud inválida' }, 400);
    const body = toProvisionRequestBody(raw);
    const handlerDeps = await deps.buildDeps(c.req.param('id')!, body, raw);
    if (!handlerDeps) return c.json({ error: 'OLT no encontrada' }, 404);
    return respond(c, await handleProvisionRequest(handlerDeps, body));
  }

  routes.get('/:id/onts/provisioning-operation', readRole, async c => {
    const key = c.req.query('key');
    if (!key) return c.json({ error: 'Falta la clave del intento' }, 400);
    const result = await deps.store.findOperationByKey(c.req.param('id')!, key);
    if (result.error) return c.json({ error: 'No se pudo recuperar el intento' }, 500);
    return c.json(result.data);
  });
  routes.get('/:id/onts/operations/:opId', readRole, async c => {
    const result = await deps.store.findOperationById(c.req.param('opId')!, c.req.param('id')!);
    if (result.error) return c.json({ error: 'No se pudo consultar la operación' }, 500);
    if (!result.data) return c.json({ error: 'Operacion no encontrada' }, 404);
    return c.json(result.data);
  });
  routes.post('/:id/onts/operations/:opId/reconcile', provisionRole, async c => {
    const existing = await deps.store.findOperationById(c.req.param('opId')!, c.req.param('id')!);
    if (existing.error) return c.json({ error: 'No se pudo consultar la operación' }, 500);
    if (!existing.data) return c.json({ error: 'Operacion no encontrada' }, 404);
    const retry = await c.req.json().catch(() => ({}));
    if (!retry || typeof retry !== 'object' || Array.isArray(retry)) return c.json({ error: 'Solicitud inválida' }, 400);
    const requested = existing.data.requested;
    const retryW = retry.wan as Record<string, unknown> | undefined;
    // A retry only contributes a fresh WAN password, never different destinations.
    const raw: Record<string, unknown> = {
      ...requested, idempotencyKey: existing.data.idempotency_key,
      shelf: existing.data.frame, slot: existing.data.slot, port: existing.data.port,
      serial: existing.data.serial, clientId: existing.data.client_id, contractId: existing.data.contract_id,
      wan: requested.wan ? { ...(requested.wan as Record<string, unknown>), password: retryW?.password } : undefined,
    };
    const handlerDeps = await deps.buildDeps(c.req.param('id')!, toProvisionRequestBody(raw), raw);
    if (!handlerDeps) return c.json({ error: 'OLT no encontrada' }, 404);
    return respond(c, await handleReconcileRequest(handlerDeps, existing.data.id));
  });
  return routes;
}

function respond(c: Parameters<ReturnType<typeof requireRole>>[0], result: Awaited<ReturnType<typeof handleProvisionRequest>>) {
  const { httpStatus, ...body } = result;
  return c.json(body, httpStatus as 200 | 207 | 400 | 404 | 409 | 500);
}
