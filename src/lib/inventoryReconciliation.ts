import type { SupabaseClient } from '@supabase/supabase-js';
import { assertAdministrativeInventoryAccess } from './inventoryAccess';

export type ReconciliationClass = 'installed' | 'custody' | 'possible' | 'unknown';
export const RECONCILIATION_LABELS: Record<ReconciliationClass, string> = {
  installed: 'Instalación confirmada', custody: 'Custodia confirmada',
  possible: 'Posible coincidencia que requiere revisión', unknown: 'Ubicación sin verificar',
};
export interface ReconciliationUnit {
  id: string; product_id: string; serial_number: string | null; mac_address: string | null; status: string;
  client_id: string | null; contract_id: string | null; installation_id: string | null; custody_technician_id: string | null;
  product: { name: string; is_serialized: boolean; inventory_categories: { slug: string; name: string } | null } | null;
  clients: { id: string; first_name: string; last_name: string } | null;
  contract: { id: string; client_id: string; contract_number: string | null } | null;
  technician: { id: string; full_name: string | null; email: string | null } | null;
}
export interface ReconciliationInstallation { id: string; client_id: string; contract_id: string | null; status: string }
export interface ReconciliationClosure { id: string; job_id: string; client_id: string | null; ont_serial: string | null; created_at: string }
export interface ReconciliationRow {
  unit: ReconciliationUnit; classification: ReconciliationClass; reasons: string[];
  category: string; installation: ReconciliationInstallation | null; serialMatches: number;
}
export const normalizeSerial = (value: string | null) => (value ?? '').trim().toUpperCase();
export function normalizeMac(value: string | null) {
  const normalized = (value ?? '').replace(/[:.\-\s]/g, '').toUpperCase();
  return /^[0-9A-F]{12}$/.test(normalized) ? normalized : '';
}
export function equipmentCategory(unit: ReconciliationUnit) {
  return unit.product?.inventory_categories?.slug ?? 'sin-categoria';
}

/** Evidencia documental; nunca escribe ni convierte un cierre histórico en ubicación vigente. */
export function reconcileInventory(units: ReconciliationUnit[], installations: ReconciliationInstallation[], closures: ReconciliationClosure[]): ReconciliationRow[] {
  const serials = new Map<string, number>(), macs = new Map<string, number>();
  for (const unit of units) {
    const serial = normalizeSerial(unit.serial_number), mac = normalizeMac(unit.mac_address);
    if (serial) serials.set(serial, (serials.get(serial) ?? 0) + 1);
    if (mac) macs.set(mac, (macs.get(mac) ?? 0) + 1);
  }
  const orders = new Map(installations.map(item => [item.id, item]));
  const closureSerials = new Map<string, ReconciliationClosure[]>();
  for (const closure of closures) {
    const order = orders.get(closure.job_id);
    const serial = normalizeSerial(closure.ont_serial);
    if (!serial || order?.status !== 'completed' || order.client_id !== closure.client_id) continue;
    closureSerials.set(serial, [...(closureSerials.get(serial) ?? []), closure]);
  }
  return units.map(unit => {
    const reasons: string[] = [];
    const serial = normalizeSerial(unit.serial_number), mac = normalizeMac(unit.mac_address);
    const duplicate = !!((serial && (serials.get(serial) ?? 0) > 1) || (mac && (macs.get(mac) ?? 0) > 1));
    const installation = unit.installation_id ? orders.get(unit.installation_id) ?? null : null;
    const clientVerified = !!unit.client_id && unit.clients?.id === unit.client_id;
    const contractVerified = !unit.contract_id || (unit.contract?.id === unit.contract_id && unit.contract.client_id === unit.client_id);
    const orderVerified = !unit.installation_id || (!!installation && installation.client_id === unit.client_id && (!installation.contract_id || installation.contract_id === unit.contract_id));
    // ont_serial identifica ONT; no es un campo genérico para TV Box/MAC.
    const serialMatches = equipmentCategory(unit) === 'onu' ? closureSerials.get(serial)?.length ?? 0 : 0;
    let classification: ReconciliationClass = 'unknown';
    if (duplicate) reasons.push('Serie o MAC repetida en más de una unidad; identidad ambigua.');
    if (unit.status === 'assigned' && clientVerified && contractVerified && orderVerified && !unit.custody_technician_id && !duplicate) {
      classification = 'installed'; reasons.push('Asignación vigente a cliente en Inventario con vínculos coherentes. Confirmación documental, no verificación física.');
    } else if (['with_technician', 'pending_return'].includes(unit.status) && unit.custody_technician_id && unit.technician?.id === unit.custody_technician_id && !unit.client_id && !unit.contract_id && !duplicate) {
      classification = 'custody'; reasons.push('Custodia vigente con técnico vinculado explícitamente.');
    } else {
      if (duplicate || serialMatches || unit.client_id || unit.contract_id || unit.installation_id || unit.custody_technician_id || unit.status === 'assigned') classification = 'possible';
      if (serialMatches) reasons.push(`Serie exacta en ${serialMatches} cierre(s) de instalación finalizada. Evidencia histórica, no ubicación actual.`);
      if (unit.client_id || unit.contract_id || unit.installation_id || unit.custody_technician_id) reasons.push('Revisar coherencia de estado y vínculos registrados; no confirma instalación ni custodia actual.');
      if (!reasons.length) reasons.push('Sin evidencia suficiente de ubicación actual.');
    }
    return { unit, classification, reasons, category: equipmentCategory(unit), installation, serialMatches };
  });
}

/** Lee todas las páginas visibles por RLS; un error o límite impide presentar un reporte incompleto. */
async function readPages<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; count: number | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  let expected: number | null = null;
  for (let from = 0; from < 20000;) {
    const result = await query(from, from + 499);
    if (result.error) throw Error(result.error.message);
    if (result.count === null) throw Error('No se pudo verificar el total de registros de una fuente.');
    if (result.count > 20000) break;
    if (expected !== null && result.count !== expected) throw Error('Los registros cambiaron durante la lectura. Actualiza el reporte.');
    expected = result.count;
    rows.push(...(result.data ?? []) as T[]);
    if (rows.length === expected) return rows;
    if (!result.data?.length || rows.length > expected) throw Error('La fuente devolvió un resultado incompleto. Actualiza el reporte.');
    from += result.data.length;
  }
  throw Error('El reporte supera 20 000 registros por fuente. Requiere una consulta paginada en servidor revisada antes de ampliarlo.');
}
export async function readInventoryReconciliation(db: SupabaseClient, role: string | null, signal: AbortSignal) {
  assertAdministrativeInventoryAccess(role);
  const [units, installations, closures] = await Promise.all([
    readPages<ReconciliationUnit>((from, to) => db.from('inventory_units').select('id, product_id, serial_number, mac_address, status, client_id, contract_id, installation_id, custody_technician_id, product:inventory_products!inner(name, is_serialized, inventory_categories(slug, name)), clients(id, first_name, last_name), contract:service_contracts!inventory_units_contract_id_fkey(id, client_id, contract_number), technician:profiles!inventory_units_custody_technician_id_fkey(id, full_name, email)', { count: 'exact' }).eq('product.is_serialized', true).order('id').range(from, to).abortSignal(signal)),
    readPages<ReconciliationInstallation>((from, to) => db.from('installations').select('id, client_id, contract_id, status', { count: 'exact' }).order('id').range(from, to).abortSignal(signal)),
    readPages<ReconciliationClosure>((from, to) => db.from('work_order_closures').select('id, job_id, client_id, ont_serial, created_at', { count: 'exact' }).eq('job_type', 'installation').not('ont_serial', 'is', null).order('id').range(from, to).abortSignal(signal)),
  ]);
  return { rows: reconcileInventory(units, installations, closures), counts: { units: units.length, installations: installations.length, closures: closures.length } };
}
