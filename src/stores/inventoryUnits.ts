import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { InventoryUnit, InventoryUnitEvent, InventoryUnitStatus } from '@/types/domain';

const UNIT_SELECT = '*, product:inventory_products(id, name, category), clients(id, first_name, last_name, document_number)';
const EVENT_SELECT =
  '*, author:profiles!inventory_unit_events_created_by_fkey(id, full_name, email), clients(id, first_name, last_name)';

export const useInventoryUnitsStore = defineStore('inventoryUnits', () => {
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchUnitsByProduct(productId: string) {
    const { data, error: err } = await supabase
      .from('inventory_units')
      .select(UNIT_SELECT)
      .eq('product_id', productId)
      .order('created_at', { ascending: false });
    if (err) throw err;
    return (data ?? []) as unknown as InventoryUnit[];
  }

  async function fetchUnitsByInstallation(installationId: string) {
    const { data, error: err } = await supabase
      .from('inventory_units')
      .select(UNIT_SELECT)
      .eq('installation_id', installationId)
      .order('created_at', { ascending: false });
    if (err) throw err;
    return (data ?? []) as unknown as InventoryUnit[];
  }

  async function fetchUnitsByClient(clientId: string) {
    const { data, error: err } = await supabase
      .from('inventory_units')
      .select(UNIT_SELECT)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });
    if (err) throw err;
    return (data ?? []) as unknown as InventoryUnit[];
  }

  /** Unidades por estado (o lista de estados) — usado por el modulo de Devoluciones. */
  async function fetchUnitsByStatus(status: InventoryUnitStatus | InventoryUnitStatus[]) {
    let query = supabase.from('inventory_units').select(UNIT_SELECT);
    query = Array.isArray(status) ? query.in('status', status) : query.eq('status', status);
    const { data, error: err } = await query.order('updated_at', { ascending: false });
    if (err) throw err;
    return (data ?? []) as unknown as InventoryUnit[];
  }

  async function fetchEvents(unitId: string) {
    const { data, error: err } = await supabase
      .from('inventory_unit_events')
      .select(EVENT_SELECT)
      .eq('unit_id', unitId)
      .order('created_at', { ascending: false });
    if (err) throw err;
    return (data ?? []) as unknown as InventoryUnitEvent[];
  }

  /** Registra el equipo (ONU, router, antena) e inserta el evento inicial de ingreso a bodega. */
  async function createUnit(payload: { productId: string; serialNumber?: string; macAddress?: string; notes?: string }) {
    loading.value = true;
    error.value = null;
    try {
      const { data, error: err } = await supabase
        .from('inventory_units')
        .insert({
          product_id: payload.productId,
          serial_number: payload.serialNumber || null,
          mac_address: payload.macAddress || null,
          notes: payload.notes || null,
        })
        .select(UNIT_SELECT)
        .single();
      if (err) throw err;
      const unit = data as unknown as InventoryUnit;

      const { error: eventErr } = await supabase.from('inventory_unit_events').insert({
        unit_id: unit.id,
        to_status: 'in_stock',
        reason: 'Ingreso a bodega',
      });
      if (eventErr) throw eventErr;

      return unit;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function registerEvent(params: {
    unitId: string;
    toStatus: InventoryUnitStatus;
    clientId?: string;
    installationId?: string;
    reason?: string;
  }) {
    const { data, error: err } = await supabase
      .from('inventory_unit_events')
      .insert({
        unit_id: params.unitId,
        to_status: params.toStatus,
        client_id: params.clientId || null,
        installation_id: params.installationId || null,
        reason: params.reason || null,
      })
      .select(EVENT_SELECT)
      .single();
    if (err) throw err;
    return data as unknown as InventoryUnitEvent;
  }

  /** Asocia una unidad al perfil de un cliente, tipicamente al momento de la instalacion. */
  function assignUnit(unitId: string, clientId: string, installationId?: string, reason?: string) {
    return registerEvent({ unitId, toStatus: 'assigned', clientId, installationId, reason: reason || 'Asignacion a cliente' });
  }

  /** Devolucion de un cliente: el equipo vuelve a bodega en buen estado, dañado o para reparar. */
  function returnUnit(unitId: string, condition: 'in_stock' | 'damaged' | 'in_repair', reason?: string) {
    return registerEvent({ unitId, toStatus: condition, reason: reason || 'Devolucion de cliente' });
  }

  /** El equipo salio de reparacion y queda listo para volver a asignarse. */
  function markRepaired(unitId: string, reason?: string) {
    return registerEvent({ unitId, toStatus: 'in_stock', reason: reason || 'Reparacion completada' });
  }

  /** Baja definitiva: el equipo ya no se reasigna. */
  function retireUnit(unitId: string, reason?: string) {
    return registerEvent({ unitId, toStatus: 'retired', reason: reason || 'Baja de equipo' });
  }

  return {
    loading,
    error,
    fetchUnitsByProduct,
    fetchUnitsByInstallation,
    fetchUnitsByClient,
    fetchUnitsByStatus,
    fetchEvents,
    createUnit,
    registerEvent,
    assignUnit,
    returnUnit,
    markRepaired,
    retireUnit,
  };
});
