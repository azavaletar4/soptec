import type { SupabaseClient } from '@supabase/supabase-js';
import type { FieldInventoryContext, FieldInventoryView, FieldJobType } from '../../../src/types/fieldInventory';

export class FieldInventoryError extends Error {
  constructor(public status: 400 | 403 | 409 | 500, message: string) { super(message); }
}
const denied = () => new FieldInventoryError(403, 'No tienes acceso vigente al inventario de esta orden.');
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const views: FieldInventoryView[] = ['products', 'materials', 'assigned', 'pending', 'available', 'unit-context'];
const UNIT = 'id,product_id,serial_number,mac_address,status,client_id,contract_id,installation_id,ticket_id,product:inventory_products!inner(id,name,unit,is_active)';
const PAGE = 100;
async function data<T>(request: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const result = await request;
  if (result.error) throw new FieldInventoryError(500, 'No se pudo consultar el inventario de la orden. Intenta nuevamente.');
  return result.data as NonNullable<T>;
}

/** Lecturas con JWT del solicitante; no service_role, SQL nuevo ni escrituras. */
export async function readFieldInventory(db: SupabaseClient, actorId: string, input: {
  jobType: string; jobId: string; view: string; page?: string; productId?: string; unitId?: string; action?: string;
}) {
  const { jobId, view, productId, unitId, action } = input;
  const jobType = input.jobType as FieldJobType;
  const page = Number(input.page ?? '0');
  if (!['installation', 'ticket'].includes(jobType) || !uuid.test(jobId) || !views.includes(view as FieldInventoryView) ||
    !Number.isSafeInteger(page) || page < 0 || page > 10000 || (productId && !uuid.test(productId)) || (unitId && !uuid.test(unitId))) {
    throw new FieldInventoryError(400, 'La consulta de inventario no es válida.');
  }
  const table = jobType === 'installation' ? 'installations' : 'tickets';
  async function authorize(): Promise<FieldInventoryContext> {
    // Releer sin cache: requireAuth puede tener un perfil cacheado durante 60 s.
    const profile: any = await data(db.from('profiles').select('role,active').eq('id', actorId).maybeSingle());
    if (!profile?.active || !['ADMIN', 'SUPERADMIN', 'TECNICO_RED'].includes(profile.role)) throw denied();
    const job: any = await data(db.from(table).select('id,status,client_id,contract_id').eq('id', jobId).maybeSingle());
    if (!job) throw denied();
    if (profile.role === 'TECNICO_RED') {
      const states = jobType === 'installation' ? ['pending', 'scheduled', 'in_progress'] : ['open', 'in_progress', 'rescheduled'];
      const historicalRead = ['materials', 'assigned', 'pending'].includes(view) &&
        (jobType === 'installation' ? job.status === 'completed' : ['resolved', 'closed'].includes(job.status));
      if (!states.includes(job.status) && !historicalRead) throw denied();
      const assignment: any = await data(db.from('job_assignees').select('technician_id,role').eq('job_type', jobType).eq('job_id', jobId).eq('technician_id', actorId).maybeSingle());
      if (!assignment || !['leader', 'support'].includes(assignment.role)) throw denied();
    }
    if (job.contract_id) {
      const contract: any = await data(db.from('service_contracts').select('id,client_id').eq('id', job.contract_id).maybeSingle());
      if (!contract || contract.client_id !== job.client_id) throw denied();
    }
    return { jobType, jobId, actorId, clientId: job.client_id, contractId: job.contract_id };
  }
  const context = await authorize();
  const jobColumn = jobType === 'installation' ? 'installation_id' : 'ticket_id';
  const start = page * PAGE;
  let rows: any[] = [];
  let warning: string | undefined;
  if (view === 'products') {
    rows = await data(db.from('inventory_products').select('id,name,unit,is_active,is_serialized,current_stock,inventory_categories(slug)').eq('is_active', true).order('id').range(start, start + PAGE));
  } else if (view === 'materials') {
    rows = await data(db.from('inventory_movements').select('id,product_id,movement_type,quantity,reason,ticket_id,installation_id,created_at,reverses_movement_id,product:inventory_products(id,name,unit)').eq(jobColumn, jobId).order('created_at').order('id').range(start, start + PAGE));
  } else if (view === 'available') {
    if (!productId) throw new FieldInventoryError(400, 'Selecciona un producto.');
    const product: any = await data(db.from('inventory_products').select('id,is_active,is_serialized').eq('id', productId).maybeSingle());
    if (!product?.is_active || !product.is_serialized) throw new FieldInventoryError(400, 'El producto no admite equipos disponibles.');
    rows = await data(db.from('inventory_units').select(UNIT).eq('product_id', productId).eq('status', 'in_stock').is('client_id', null).is('contract_id', null).is('installation_id', null).is('ticket_id', null).order('id').range(start, start + PAGE));
  } else if (view === 'unit-context') {
    if (!unitId || !['unassign', 'unlink'].includes(action ?? '') || (action === 'unassign') !== (jobType === 'installation')) throw new FieldInventoryError(400, 'La operación no corresponde a esta orden.');
    rows = await data(db.from('inventory_units').select(UNIT).eq('id', unitId).eq(jobColumn, jobId).eq('status', action === 'unassign' ? 'assigned' : 'pending_approval').limit(1));
    rows = rows.filter(u => u.client_id === context.clientId && (!u.contract_id || u.contract_id === context.contractId));
    if (!rows.length) throw denied();
  } else {
    let query = db.from('inventory_units').select(UNIT);
    if (view === 'pending' || jobType === 'installation') {
      query = query.eq(jobColumn, jobId);
      if (view === 'pending') query = query.eq('status', 'pending_approval');
      if (context.clientId) query = query.eq('client_id', context.clientId);
      else query = query.is('client_id', null);
      if (context.contractId) query = query.or(`contract_id.is.null,contract_id.eq.${context.contractId}`);
      else query = query.is('contract_id', null);
    } else if (context.contractId && context.clientId) {
      query = query.eq('contract_id', context.contractId).eq('client_id', context.clientId).eq('status', 'assigned');
    } else {
      // Sin contrato no se amplía a todos los servicios del cliente. Solo vínculo explícito a la orden.
      query = query.eq(jobColumn, jobId).eq('status', 'assigned').is('contract_id', null);
      if (context.clientId) query = query.eq('client_id', context.clientId);
      else query = query.is('client_id', null);
      warning = 'Esta orden no tiene contrato vinculado. Solo se muestran equipos vinculados directamente a ella; solicita revisión de los equipos históricos.';
    }
    rows = await data(query.order('id').range(start, start + PAGE));
  }
  // Proyección explícita, incluso si una dependencia devuelve columnas adicionales.
  if (view === 'products') rows = rows.map(p => ({
    id: p.id, name: p.name, unit: p.unit, is_active: p.is_active, is_serialized: p.is_serialized,
    current_stock: p.current_stock, inventory_categories: p.inventory_categories ? { slug: p.inventory_categories.slug } : null,
  }));
  else if (view === 'materials') rows = rows.map(m => ({
    id: m.id, product_id: m.product_id, movement_type: m.movement_type, quantity: m.quantity,
    reason: m.reason, ticket_id: m.ticket_id, installation_id: m.installation_id, created_at: m.created_at,
    reverses_movement_id: m.reverses_movement_id,
    product: m.product ? { id: m.product.id, name: m.product.name, unit: m.product.unit } : null,
  }));
  else rows = rows.map(({ product, ...u }) => ({
    id: u.id, product_id: u.product_id, serial_number: u.serial_number, mac_address: u.mac_address,
    status: u.status, client_id: u.client_id, contract_id: u.contract_id,
    installation_id: u.installation_id, ticket_id: u.ticket_id,
    product: product ? { id: product.id, name: product.name, unit: product.unit } : null,
  }));
  const current = await authorize();
  if (JSON.stringify(current) !== JSON.stringify(context)) throw denied();
  return { context, items: rows.slice(0, PAGE), next: rows.length > PAGE ? page + 1 : null, ...(warning ? { warning } : {}) };
}
