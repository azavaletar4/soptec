import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { InventoryCustodySummaryRow, MyInventoryCustody, TechnicianMaterialReturnRequest } from '@/types/domain';

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

  async function deliverUnitToTechnician(unitId: string, technicianId: string, reason?: string) {
    const { error: err } = await supabase.rpc('deliver_unit_to_technician', { p_unit_id: unitId, p_technician_id: technicianId, p_reason: reason ?? null });
    if (err) throw err;
  }

  async function receiveUnitReturn(unitId: string, condition: 'in_stock' | 'damaged' | 'in_repair', reason?: string) {
    const { error: err } = await supabase.rpc('receive_unit_return', { p_unit_id: unitId, p_condition: condition, p_reason: reason ?? null });
    if (err) throw err;
  }

  async function deliverMaterialToTechnician(technicianId: string, productId: string, quantity: number, reason?: string) {
    const { error: err } = await supabase.rpc('deliver_material_to_technician', { p_technician_id: technicianId, p_product_id: productId, p_quantity: quantity, p_reason: reason ?? null });
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

  return {
    loading,
    error,
    fetchCustodySummary,
    fetchAllMaterialCustody,
    deliverUnitToTechnician,
    receiveUnitReturn,
    deliverMaterialToTechnician,
    fetchPendingMaterialReturnRequests,
    confirmMaterialReturn,
    fetchMyCustody,
    requestUnitReturn,
    requestMaterialReturn,
  };
});
