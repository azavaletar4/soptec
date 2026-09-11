import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { InventoryMovement, InventoryMovementType, InventoryProduct } from '@/types/domain';

const MOVEMENT_SELECT = '*, author:profiles!inventory_movements_created_by_fkey(id, full_name, email)';
const MOVEMENT_WITH_PRODUCT_SELECT = `${MOVEMENT_SELECT}, product:inventory_products(id, name, unit)`;

export const useInventoryStore = defineStore('inventory', () => {
  const products = ref<InventoryProduct[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchProducts() {
    loading.value = true;
    error.value = null;
    const { data, error: err } = await supabase
      .from('inventory_products')
      .select('*')
      .eq('is_active', true)
      .order('name');
    loading.value = false;
    if (err) {
      error.value = err.message;
      throw err;
    }
    products.value = (data ?? []) as InventoryProduct[];
  }

  async function createProduct(payload: Partial<InventoryProduct>) {
    const { data, error: err } = await supabase.from('inventory_products').insert(payload).select().single();
    if (err) throw err;
    products.value.push(data as InventoryProduct);
    products.value.sort((a, b) => a.name.localeCompare(b.name));
    return data as InventoryProduct;
  }

  async function updateProduct(id: string, payload: Partial<InventoryProduct>) {
    const { data, error: err } = await supabase
      .from('inventory_products')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (err) throw err;
    const idx = products.value.findIndex((p) => p.id === id);
    if (idx !== -1) products.value[idx] = data as InventoryProduct;
    return data as InventoryProduct;
  }

  async function deactivateProduct(id: string) {
    await updateProduct(id, { is_active: false });
    products.value = products.value.filter((p) => p.id !== id);
  }

  async function fetchMovements(productId: string) {
    const { data, error: err } = await supabase
      .from('inventory_movements')
      .select(MOVEMENT_SELECT)
      .eq('product_id', productId)
      .order('created_at', { ascending: false });
    if (err) throw err;
    return (data ?? []) as unknown as InventoryMovement[];
  }

  async function registerMovement(params: {
    productId: string;
    type: InventoryMovementType;
    quantity: number;
    reason?: string;
    ticketId?: string;
    installationId?: string;
  }) {
    const { data, error: err } = await supabase
      .from('inventory_movements')
      .insert({
        product_id: params.productId,
        movement_type: params.type,
        quantity: params.quantity,
        reason: params.reason || null,
        ticket_id: params.ticketId || null,
        installation_id: params.installationId || null,
      })
      .select(MOVEMENT_SELECT)
      .single();
    if (err) throw err;

    // El trigger ya actualizo current_stock en la BD; reflejamos el nuevo
    // saldo localmente sin tener que re-consultar el producto completo.
    const movement = data as unknown as InventoryMovement;
    const idx = products.value.findIndex((p) => p.id === params.productId);
    if (idx !== -1) products.value[idx].current_stock = movement.balance_after;
    return movement;
  }

  /** Materiales usados en un ticket de soporte (Fase 11b). */
  async function fetchMovementsByTicket(ticketId: string) {
    const { data, error: err } = await supabase
      .from('inventory_movements')
      .select(MOVEMENT_WITH_PRODUCT_SELECT)
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false });
    if (err) throw err;
    return (data ?? []) as unknown as InventoryMovement[];
  }

  /** Materiales usados en una instalacion (Fase 11b). */
  async function fetchMovementsByInstallation(installationId: string) {
    const { data, error: err } = await supabase
      .from('inventory_movements')
      .select(MOVEMENT_WITH_PRODUCT_SELECT)
      .eq('installation_id', installationId)
      .order('created_at', { ascending: false });
    if (err) throw err;
    return (data ?? []) as unknown as InventoryMovement[];
  }

  /** Registra un egreso de material usado en un ticket o instalacion. */
  function registerUsage(params: {
    productId: string;
    quantity: number;
    ticketId?: string;
    installationId?: string;
    reason?: string;
  }) {
    return registerMovement({
      productId: params.productId,
      type: 'egreso',
      quantity: params.quantity,
      reason: params.reason,
      ticketId: params.ticketId,
      installationId: params.installationId,
    });
  }

  return {
    products,
    loading,
    error,
    fetchProducts,
    createProduct,
    updateProduct,
    deactivateProduct,
    fetchMovements,
    registerMovement,
    fetchMovementsByTicket,
    fetchMovementsByInstallation,
    registerUsage,
  };
});
