import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { InventoryCustodySummaryRow, MyInventoryCustody, TechnicianMaterialReturnRequest } from '@/types/domain';
import {
  detectMaterialCustodyShortfalls,
  linkMaterialCorrections,
  type MaterialCorrectionReceipt,
  type MaterialCustodyEventInput,
  type MaterialCustodyJobType,
  type MaterialCustodyShortfall,
  type MaterialConsumptionMovementInput,
} from '@/lib/materialCustodyShortfall';
import { isJobOpenForRetry, parseRejectionItems } from '@/lib/materialRejectionPresentation';

export interface RejectedMaterialOperation {
  operation_id: string; job_type: 'installation' | 'ticket' | 'routine'; job_id: string;
  actor_id: string; action: string; payload: Record<string, unknown>; message: string; created_at: string;
  actor: { full_name: string | null; email: string | null } | null;
}

/** Fase 169: el mismo rechazo, pero con lo que un administrador necesita
 * para decidir sin tener que abrir la orden aparte -- cliente, si la
 * orden sigue abierta (antes de ofrecer "Reintentar"), y el material
 * real (nombre/unidad) con la custodia VIGENTE del técnico (no la de
 * cuando se registró el rechazo, que puede haber cambiado desde). */
export interface DetailedRejectedMaterialOperation extends RejectedMaterialOperation {
  jobStatus: string | null;
  jobOpen: boolean;
  jobLabel: string;
  jobPath: string | null;
  items: Array<{ productId: string; productName: string; unit: string; quantityRequested: number; availableNow: number }>;
}

/**
 * Fase 164: entrega/devolucion/conciliacion de equipos y materiales en
 * custodia de tecnicos. Toda la logica real vive en RPCs (misma arquitectura
 * que Etapa 3/Fase 162) — este store solo envuelve las llamadas.
 */
export const useTechnicianCustodyStore = defineStore('technicianCustody', () => {
  const loading = ref(false);
  const error = ref<string | null>(null);

  // ---- ADMIN/SUPERADMIN ----
  async function fetchCustodySummary(): Promise<InventoryCustodySummaryRow[]> {
    const { data, error: err } = await supabase.rpc('inventory_custody_summary');
    if (err) throw err;
    return (data ?? []) as unknown as InventoryCustodySummaryRow[];
  }

  /** Saldo de materiales en custodia de TODOS los tecnicos (una sola consulta) — para agrupar por tecnico en la UI sin pedirlo producto por producto. */
  async function fetchAllMaterialCustody() {
    const { data, error: err } = await supabase
      .from('technician_material_custody')
      .select('*, product:inventory_products(id, name, unit), technician:profiles!technician_material_custody_technician_id_fkey(id, full_name, email)')
      .gt('quantity', 0);
    if (err) throw err;
    return (data ?? []) as unknown as Array<{ technician_id: string; product_id: string; quantity: number; updated_at: string; product: { id: string; name: string; unit: string } | null; technician: { id: string; full_name: string | null; email: string | null } | null }>;
  }

  /**
   * Fase 165 (etapa 1 — advertencia, sin bloqueo): consumos de material
   * registrados (campo_inventory_operation 'kit'/'consume',
   * routine_inventory_operation 'consume') sin saldo suficiente en
   * technician_material_custody al momento de consumirlos — ver
   * src/lib/materialCustodyShortfall.ts. Solo lectura: no toca
   * inventory_movements, technician_material_custody ni ninguna orden.
   * Resuelve nombres de tecnico/producto y una referencia breve de la
   * orden para mostrarlos en "Custodia de técnicos → Conciliación".
   */
  async function fetchMaterialCustodyShortfalls(): Promise<Array<MaterialCustodyShortfall & {
    technicianName: string;
    productName: string;
    unit: string;
    jobLabel: string;
    /** Ruta real a la orden (Alta/Avería/Rutina) solo cuando esa orden todavia existe — null -> la vista conserva el texto plano, nunca un enlace roto. */
    jobPath: string | null;
  }>> {
    const [eventsRes, movementsRes, receiptsRes] = await Promise.all([
      // * conserva compatibilidad antes de que exista source_movement_id.
      supabase.from('technician_material_custody_events').select('*'),
      supabase
        .from('inventory_movements')
        .select('id, product_id, movement_type, quantity, reason, created_by, created_at, reverses_movement_id, installation_id, ticket_id, routine_id, operation_id, product:inventory_products!inner(id, name, unit, is_serialized)')
        .eq('product.is_serialized', false)
        .in('movement_type', ['egreso', 'ingreso']),
      supabase.from('campo_inventory_operations').select('action, payload, result').eq('action', 'correct'),
    ]);
    if (eventsRes.error) throw eventsRes.error;
    if (movementsRes.error) throw movementsRes.error;
    if (receiptsRes.error) throw receiptsRes.error;

    const custodyEvents: MaterialCustodyEventInput[] = (eventsRes.data ?? []).map((e) => ({
      technicianId: e.technician_id,
      productId: e.product_id,
      eventType: e.event_type as MaterialCustodyEventInput['eventType'],
      sourceMovementId: (e as unknown as { source_movement_id?: string }).source_movement_id,
      quantity: Number(e.quantity),
      createdAt: e.created_at,
    }));

    type MovementRow = {
      id: string; product_id: string; movement_type: 'ingreso' | 'egreso'; quantity: number; reason: string | null;
      created_by: string | null; created_at: string; reverses_movement_id: string | null;
      installation_id: string | null; ticket_id: string | null; routine_id: string | null;
      operation_id: string | null;
      product: { id: string; name: string; unit: string; is_serialized: boolean } | null;
    };
    const movementRows = (movementsRes.data ?? []) as unknown as MovementRow[];
    // Solo autores realmente tecnicos, sin atribuir un faltante a un admin sin vinculo verificable.
    const authorIds = [...new Set(movementRows.map(m => m.created_by).filter((id): id is string => !!id))];
    const { data: authors, error: authorError } = authorIds.length
      ? await supabase.from('profiles').select('id, role').in('id', authorIds)
      : { data: [], error: null };
    if (authorError) throw authorError;
    const technicianAuthors = new Set((authors ?? []).filter(a => a.role === 'TECNICO_RED').map(a => a.id));
    const movements: MaterialConsumptionMovementInput[] = linkMaterialCorrections(movementRows.map((m) => ({
      id: m.id,
      technicianId: m.created_by && technicianAuthors.has(m.created_by) ? m.created_by : null,
      productId: m.product_id,
      movementType: m.movement_type,
      quantity: Number(m.quantity),
      createdAt: m.created_at,
      jobType: m.installation_id ? 'installation' : m.ticket_id ? 'ticket' : m.routine_id ? 'routine' : null,
      jobId: m.installation_id ?? m.ticket_id ?? m.routine_id ?? null,
      reversesMovementId: m.reverses_movement_id,
      operationId: m.operation_id,
      reason: m.reason,
    })), (receiptsRes.data ?? []) as unknown as MaterialCorrectionReceipt[]);

    const shortfalls = detectMaterialCustodyShortfalls(custodyEvents, movements);
    if (!shortfalls.length) return [];

    const productById = new Map(movementRows.map((m) => [m.product_id, m.product]));
    const technicianIds = Array.from(new Set(shortfalls.map((s) => s.technicianId)));
    const { data: technicianRows, error: techErr } = await supabase
      .from('profiles').select('id, full_name, email').in('id', technicianIds);
    if (techErr) throw techErr;
    const technicianById = new Map((technicianRows ?? []).map((t) => [t.id, t.full_name || t.email || t.id]));

    const jobIdsByType: Record<MaterialCustodyJobType, string[]> = {
      installation: Array.from(new Set(shortfalls.filter((s) => s.jobType === 'installation').map((s) => s.jobId))),
      ticket: Array.from(new Set(shortfalls.filter((s) => s.jobType === 'ticket').map((s) => s.jobId))),
      routine: Array.from(new Set(shortfalls.filter((s) => s.jobType === 'routine').map((s) => s.jobId))),
    };
    const jobLabelById = new Map<string, string>();
    const [installRows, ticketRows, routineRows] = await Promise.all([
      jobIdsByType.installation.length
        ? supabase.from('installations').select('id, client:clients(first_name, last_name)').in('id', jobIdsByType.installation)
        : Promise.resolve({ data: [], error: null }),
      jobIdsByType.ticket.length
        ? supabase.from('tickets').select('id, client:clients(first_name, last_name)').in('id', jobIdsByType.ticket)
        : Promise.resolve({ data: [], error: null }),
      jobIdsByType.routine.length
        ? supabase.from('routines').select('id, client:clients(first_name, last_name)').in('id', jobIdsByType.routine)
        : Promise.resolve({ data: [], error: null }),
    ]);
    type JobRow = { id: string; client: { first_name: string; last_name: string } | null };
    const label = (row: JobRow, prefix: string) => `${prefix} — ${row.client ? `${row.client.first_name} ${row.client.last_name}` : 'cliente no disponible'}`;
    // Ruta real de cada tipo de orden (verificada en src/router/index.ts) — solo
    // se ofrece el enlace para una orden que la consulta de arriba SI encontro
    // (existe de verdad), nunca a partir de jobId/jobType solos; si el id ya
    // no existe (orden eliminada), jobPathById.get(...) queda sin entrada y la
    // vista conserva el texto plano en vez de un enlace roto.
    const JOB_PATH_PREFIX: Record<MaterialCustodyJobType, string> = {
      installation: '/soporte/instalaciones/',
      ticket: '/soporte/',
      routine: '/soporte/rutinas/',
    };
    const jobPathById = new Map<string, string>();
    for (const row of (installRows.data ?? []) as unknown as JobRow[]) { jobLabelById.set(row.id, label(row, 'Alta')); jobPathById.set(row.id, JOB_PATH_PREFIX.installation + row.id); }
    for (const row of (ticketRows.data ?? []) as unknown as JobRow[]) { jobLabelById.set(row.id, label(row, 'Avería')); jobPathById.set(row.id, JOB_PATH_PREFIX.ticket + row.id); }
    for (const row of (routineRows.data ?? []) as unknown as JobRow[]) { jobLabelById.set(row.id, label(row, 'Rutina')); jobPathById.set(row.id, JOB_PATH_PREFIX.routine + row.id); }

    return shortfalls.map((s) => ({
      ...s,
      technicianName: technicianById.get(s.technicianId) ?? s.technicianId,
      productName: productById.get(s.productId)?.name ?? s.productId,
      unit: productById.get(s.productId)?.unit ?? '',
      jobLabel: jobLabelById.get(s.jobId) ?? `${s.jobType} ${s.jobId}`,
      jobPath: jobPathById.get(s.jobId) ?? null,
    }));
  }

  async function deliverUnitToTechnician(unitId: string, technicianId: string, reason?: string) {
    const { error: err } = await supabase.rpc('deliver_unit_to_technician', { p_unit_id: unitId, p_technician_id: technicianId, p_reason: reason ?? null });
    if (err) throw err;
  }

  async function fetchTechnicianHistory(technicianId: string) {
    const [units, materials] = await Promise.all([
      supabase.from('inventory_unit_events')
        .select('*, author:profiles!inventory_unit_events_created_by_fkey(id, full_name, email), equipment:inventory_units(id, product_id, serial_number, mac_address)')
        .eq('assigned_to', technicianId)
        .or('to_status.in.(with_technician,pending_return),from_status.in.(with_technician,pending_return)')
        .order('created_at', { ascending: false }).limit(100),
      supabase.from('technician_material_custody_events')
        .select('*, author:profiles!technician_material_custody_events_created_by_fkey(id, full_name, email), product:inventory_products(id, name, unit)')
        .eq('technician_id', technicianId).order('created_at', { ascending: false }).limit(100),
    ]);
    if (units.error) throw units.error;
    if (materials.error) throw materials.error;
    return { units: (units.data ?? []) as unknown as Array<import('@/types/domain').InventoryUnitEvent & { equipment: { id: string; product_id: string; serial_number: string | null; mac_address: string | null } | null }>, materials: (materials.data ?? []) as unknown as Array<{ id: string; event_type: string; quantity: number; created_at: string; reason: string | null; author: { full_name: string | null; email: string | null } | null; product: { name: string; unit: string } | null }> };
  }

  async function receiveUnitReturn(unitId: string, condition: 'in_stock' | 'damaged' | 'in_repair', reason?: string) {
    const { error: err } = await supabase.rpc('receive_unit_return', { p_unit_id: unitId, p_condition: condition, p_reason: reason ?? null });
    if (err) throw err;
  }

  /**
   * Fase 165, etapa 2 (cierre): p_operation_id distingue un reintento real de
   * la MISMA entrega (red inestable, doble envío accidental) de una segunda
   * entrega legítima — el llamador debe reutilizar el mismo id solo mientras
   * reintenta exactamente la misma intención (ver handleDeliverMaterial en
   * InventarioCustodiaView.vue). El RPC también valida contra el stock de
   * almacén de forma transaccional (antes no lo hacía).
   */
  async function deliverMaterialToTechnician(operationId: string, technicianId: string, productId: string, quantity: number, reason?: string) {
    const { error: err } = await supabase.rpc('deliver_material_to_technician', { p_operation_id: operationId, p_technician_id: technicianId, p_product_id: productId, p_quantity: quantity, p_reason: reason ?? null });
    if (err) throw err;
  }

  async function fetchPendingMaterialReturnRequests(): Promise<TechnicianMaterialReturnRequest[]> {
    const { data, error: err } = await supabase
      .from('technician_material_return_requests')
      .select('*, product:inventory_products(id, name, unit), technician:profiles!technician_material_return_requests_technician_id_fkey(id, full_name, email)')
      .eq('status', 'pending')
      .order('requested_at', { ascending: true });
    if (err) throw err;
    return (data ?? []) as unknown as TechnicianMaterialReturnRequest[];
  }

  async function confirmMaterialReturn(requestId: string, approved: boolean, note?: string) {
    const { error: err } = await supabase.rpc('confirm_material_return', { p_request_id: requestId, p_approved: approved, p_note: note ?? null });
    if (err) throw err;
  }

  // ---- TECNICO (App de Campo) ----
  async function fetchMyCustody(): Promise<MyInventoryCustody> {
    const { data, error: err } = await supabase.rpc('my_inventory_custody');
    if (err) throw err;
    return data as unknown as MyInventoryCustody;
  }

  async function requestUnitReturn(unitId: string, reason: string) {
    const { error: err } = await supabase.rpc('request_unit_return', { p_unit_id: unitId, p_reason: reason });
    if (err) throw err;
  }

  async function requestMaterialReturn(productId: string, quantity: number, reason: string) {
    const { error: err } = await supabase.rpc('request_material_return', { p_product_id: productId, p_quantity: quantity, p_reason: reason });
    if (err) throw err;
  }

  async function fetchRejectedMaterialOperations(): Promise<RejectedMaterialOperation[]> {
    const { data, error: err } = await supabase.from('material_inventory_rejections')
      .select('*, actor:profiles!material_inventory_rejections_actor_id_fkey(full_name,email)').eq('status', 'pending').order('created_at');
    if (err && ['42P01', 'PGRST205'].includes(err.code)) return []; // antes de activar el candidato
    if (err) throw err;
    return (data ?? []) as unknown as RejectedMaterialOperation[];
  }
  async function cancelRejectedMaterialOperation(operationId: string, reason: string) {
    const { error: err } = await supabase.rpc('cancel_rejected_material_operation', { p_operation_id: operationId, p_reason: reason });
    if (err) throw err;
  }
  /** Fase 169: reintenta EXACTAMENTE el mismo intento (mismo producto/
   * cantidad -- nunca editable por el administrador) debitando la
   * custodia del técnico original. Solo ADMIN/SUPERADMIN (verificado en
   * el servidor, RPC retry_rejected_material_operation). */
  async function retryRejectedMaterialOperation(operationId: string) {
    const { data, error: err } = await supabase.rpc('retry_rejected_material_operation', { p_operation_id: operationId });
    if (err) throw err;
    return data as { operationId: string; ids: string[]; at: string };
  }

  /** Mismo rechazo que fetchRejectedMaterialOperations(), enriquecido para
   * la pantalla de Custodia: cliente/estado de la orden y la custodia
   * VIGENTE del técnico por cada material del intento (Fase 169). */
  async function fetchRejectedMaterialOperationsDetailed(): Promise<DetailedRejectedMaterialOperation[]> {
    const base = await fetchRejectedMaterialOperations();
    if (!base.length) return [];

    type JobRow = { id: string; status: string; client: { first_name: string; last_name: string } | null };
    const idsByType = {
      installation: Array.from(new Set(base.filter((r) => r.job_type === 'installation').map((r) => r.job_id))),
      ticket: Array.from(new Set(base.filter((r) => r.job_type === 'ticket').map((r) => r.job_id))),
      routine: Array.from(new Set(base.filter((r) => r.job_type === 'routine').map((r) => r.job_id))),
    };
    const JOB_PATH_PREFIX: Record<'installation' | 'ticket' | 'routine', string> = {
      installation: '/soporte/instalaciones/', ticket: '/soporte/', routine: '/soporte/rutinas/',
    };
    const JOB_LABEL_PREFIX: Record<'installation' | 'ticket' | 'routine', string> = {
      installation: 'Alta', ticket: 'Avería', routine: 'Rutina',
    };
    const [installRes, ticketRes, routineRes] = await Promise.all([
      idsByType.installation.length ? supabase.from('installations').select('id, status, client:clients(first_name,last_name)').in('id', idsByType.installation) : Promise.resolve({ data: [] as JobRow[], error: null }),
      idsByType.ticket.length ? supabase.from('tickets').select('id, status, client:clients(first_name,last_name)').in('id', idsByType.ticket) : Promise.resolve({ data: [] as JobRow[], error: null }),
      idsByType.routine.length ? supabase.from('routines').select('id, status, client:clients(first_name,last_name)').in('id', idsByType.routine) : Promise.resolve({ data: [] as JobRow[], error: null }),
    ]);
    if (installRes.error) throw installRes.error;
    if (ticketRes.error) throw ticketRes.error;
    if (routineRes.error) throw routineRes.error;
    const jobById = new Map<string, { status: string; label: string; path: string }>();
    for (const [type, res] of [['installation', installRes], ['ticket', ticketRes], ['routine', routineRes]] as const) {
      for (const row of (res.data ?? []) as unknown as JobRow[]) {
        const clientName = row.client ? `${row.client.first_name} ${row.client.last_name}` : 'cliente no disponible';
        jobById.set(row.id, { status: row.status, label: `${JOB_LABEL_PREFIX[type]} — ${clientName}`, path: JOB_PATH_PREFIX[type] + row.id });
      }
    }

    const itemsByOperation = new Map(base.map((r) => [r.operation_id, parseRejectionItems(r.action, r.payload)]));
    const productIds = Array.from(new Set(Array.from(itemsByOperation.values()).flat().map((it) => it.productId)));
    const actorIds = Array.from(new Set(base.map((r) => r.actor_id)));
    const [productsRes, custodyRes] = await Promise.all([
      productIds.length ? supabase.from('inventory_products').select('id, name, unit').in('id', productIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string; unit: string }>, error: null }),
      productIds.length && actorIds.length
        ? supabase.from('technician_material_custody').select('technician_id, product_id, quantity').in('technician_id', actorIds).in('product_id', productIds)
        : Promise.resolve({ data: [] as Array<{ technician_id: string; product_id: string; quantity: number }>, error: null }),
    ]);
    if (productsRes.error) throw productsRes.error;
    if (custodyRes.error) throw custodyRes.error;
    const productById = new Map((productsRes.data ?? []).map((p) => [p.id, p]));
    const custodyByPair = new Map((custodyRes.data ?? []).map((c) => [`${c.technician_id}::${c.product_id}`, Number(c.quantity)]));

    return base.map((r) => {
      const job = jobById.get(r.job_id);
      return {
        ...r,
        jobStatus: job?.status ?? null,
        jobOpen: isJobOpenForRetry(r.job_type, job?.status ?? null),
        jobLabel: job?.label ?? `${r.job_type} ${r.job_id}`,
        jobPath: job ? job.path : null,
        items: (itemsByOperation.get(r.operation_id) ?? []).map((it) => ({
          productId: it.productId,
          productName: productById.get(it.productId)?.name ?? it.productId,
          unit: productById.get(it.productId)?.unit ?? '',
          quantityRequested: it.quantity,
          availableNow: custodyByPair.get(`${r.actor_id}::${it.productId}`) ?? 0,
        })),
      };
    });
  }

  return {
    loading,
    error,
    fetchCustodySummary,
    fetchAllMaterialCustody,
    fetchMaterialCustodyShortfalls,
    fetchTechnicianHistory,
    deliverUnitToTechnician,
    receiveUnitReturn,
    deliverMaterialToTechnician,
    fetchPendingMaterialReturnRequests,
    confirmMaterialReturn,
    fetchMyCustody,
    requestUnitReturn,
    requestMaterialReturn,
    fetchRejectedMaterialOperations,
    fetchRejectedMaterialOperationsDetailed,
    cancelRejectedMaterialOperation,
    retryRejectedMaterialOperation,
  };
});
