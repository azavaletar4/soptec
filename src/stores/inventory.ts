import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type {
  InventoryAlbumSummary,
  InventoryCategory,
  InventoryMovement,
  InventoryMovementType,
  InventoryProduct,
} from '@/types/domain';

const MOVEMENT_SELECT = '*, author:profiles!inventory_movements_created_by_fkey(id, full_name, email)';
const MOVEMENT_WITH_PRODUCT_SELECT = `${MOVEMENT_SELECT}, product:inventory_products(id, name, unit)`;
const PRODUCT_SELECT = '*, inventory_categories(id, slug, name, icon, color)';

export const useInventoryStore = defineStore('inventory', () => {
  const products = ref<InventoryProduct[]>([]);
  const categories = ref<InventoryCategory[]>([]);
  const albums = ref<InventoryAlbumSummary[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  /** `categoryId` filtra la vista de un álbum puntual (Fase 44); sin filtro trae todo el catálogo activo. */
  async function fetchProducts(opts?: { categoryId?: string }) {
    loading.value = true;
    error.value = null;
    let query = supabase.from('inventory_products').select(PRODUCT_SELECT).eq('is_active', true);
    if (opts?.categoryId) query = query.eq('category_id', opts.categoryId);
    const { data, error: err } = await query.order('name');
    loading.value = false;
    if (err) {
      error.value = err.message;
      throw err;
    }
    products.value = (data ?? []) as unknown as InventoryProduct[];
  }

  /** Taxonomía de álbumes (Fase 44) — catálogo casi estático, se carga una vez por sesión. */
  async function fetchCategories() {
    const { data, error: err } = await supabase
      .from('inventory_categories')
      .select('*')
      .eq('is_active', true)
      .order('sort_order');
    if (err) throw err;
    categories.value = (data ?? []) as InventoryCategory[];
  }

  /** Contadores/valor total por álbum (RPC inventory_get_albums, Fase 44) — agregado en SQL, no trae todo el inventario al navegador. */
  async function fetchAlbums() {
    loading.value = true;
    error.value = null;
    const { data, error: err } = await supabase.rpc('inventory_get_albums');
    loading.value = false;
    if (err) {
      error.value = err.message;
      throw err;
    }
    albums.value = (data ?? []) as InventoryAlbumSummary[];
  }

  /** Mueve un producto (o toda una linea serializada) a otro álbum — solo cambia category_id, no toca inventory_units ni clientes. */
  function updateProductCategory(productId: string, categoryId: string) {
    return updateProduct(productId, { category_id: categoryId });
  }

  async function createProduct(payload: Partial<InventoryProduct>) {
    const { data, error: err } = await supabase.from('inventory_products').insert(payload).select(PRODUCT_SELECT).single();
    if (err) throw err;
    products.value.push(data as unknown as InventoryProduct);
    products.value.sort((a, b) => a.name.localeCompare(b.name));
    return data as unknown as InventoryProduct;
  }

  async function updateProduct(id: string, payload: Partial<InventoryProduct>) {
    const { data, error: err } = await supabase
      .from('inventory_products')
      .update(payload)
      .eq('id', id)
      .select(PRODUCT_SELECT)
      .single();
    if (err) throw err;
    const idx = products.value.findIndex((p) => p.id === id);
    if (idx !== -1) products.value[idx] = data as unknown as InventoryProduct;
    return data as unknown as InventoryProduct;
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
    reversesMovementId?: string;
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
        reverses_movement_id: params.reversesMovementId || null,
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

  /**
   * Revierte un movimiento del Kardex (Fase 58): el Kardex es insert-only
   * (ver Fase 11) — en vez de borrar la fila, que dejaria mal el
   * balance_after de todo lo posterior, inserta el movimiento opuesto y lo
   * enlaza via reverses_movement_id. Restringir esto a SUPERADMIN es
   * decision de UI (ver InventarioProductoView.vue): el insert en si ya lo
   * permite la policy existente para todo el staff.
   */
  function revertMovement(movement: InventoryMovement) {
    return registerMovement({
      productId: movement.product_id,
      type: movement.movement_type === 'ingreso' ? 'egreso' : 'ingreso',
      quantity: movement.quantity,
      reason: `Reversión del movimiento del ${new Date(movement.created_at).toLocaleString('es-PE')}${movement.reason ? ` ("${movement.reason}")` : ''}`,
      reversesMovementId: movement.id,
      // Sin esto la reversion quedaba huerfana del ticket/instalacion
      // original (ticket_id/installation_id en null): el stock SI se
      // corregia, pero una vista filtrada por ticket (CampoTrabajoDetailView,
      // Fase 100) nunca veia la fila de reversion, asi que el item "quitado"
      // seguia apareciendo como vigente en esa lista.
      ticketId: movement.ticket_id ?? undefined,
      installationId: movement.installation_id ?? undefined,
    });
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
    categories,
    albums,
    fetchProducts,
    fetchCategories,
    fetchAlbums,
    updateProductCategory,
    createProduct,
    updateProduct,
    deactivateProduct,
    fetchMovements,
    registerMovement,
    revertMovement,
    fetchMovementsByTicket,
    fetchMovementsByInstallation,
    registerUsage,
  };
});
