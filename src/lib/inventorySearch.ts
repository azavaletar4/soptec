import type { SupabaseClient } from '@supabase/supabase-js';
import type { InventoryProduct, InventoryUnit, InventoryUnitStatus } from '../types/domain';

export const SEARCH_PAGE_SIZE = 25;
export interface InventorySearchScope { categoryId?: string; statuses?: InventoryUnitStatus[] }
export type SearchUnit = InventoryUnit & {
  product: InventoryProduct;
  contract: { id: string; client_id: string; client_code: string | null; contract_number: string | null; installation_address: string | null } | null;
};

// Separar el escape de valores PostgREST del escape de comodines LIKE.
const quoted = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const contains = (value: string) => quoted(`%${value.replace(/[\\%_*]/g, '\\$&')}%`);

export function identifierFilter(term: string) {
  const filters = [`serial_number.ilike.${contains(term)}`, `mac_address.ilike.${contains(term)}`];
  const hex = term.replace(/[:.\-\s]/g, '');
  if (/^[a-f\d]+$/i.test(hex)) {
    // Ignorar solo separadores MAC, nunca dígitos hexadecimales intermedios.
    filters.push(`mac_address.imatch.${quoted(hex.split('').join('[-:.[:space:]]*'))}`);
  }
  return filters.join(',');
}

/** Solo lectura con sesión/RLS: dos consultas acotadas sin descargar el catálogo. */
export async function searchInventory(db: SupabaseClient, term: string, page: number, scope: InventorySearchScope = {}, signal?: AbortSignal) {
  const q = term.trim().slice(0, 200);
  if (!q) return { products: [] as InventoryProduct[], units: [] as SearchUnit[], more: false };
  const start = Math.max(0, page) * SEARCH_PAGE_SIZE;
  let products = db.from('inventory_products')
    .select('*, inventory_categories(id, slug, name, icon, color)')
    .eq('is_active', true).or(`name.ilike.${contains(q)},category.ilike.${contains(q)}`);
  if (scope.categoryId) products = products.eq('category_id', scope.categoryId);
  let units = db.from('inventory_units').select(
    'id, product_id, serial_number, mac_address, status, client_id, contract_id, notes, product:inventory_products!inner(*, inventory_categories(id, slug, name, icon, color)), matched_product:inventory_products!left(id), clients(id, first_name, last_name), contract:service_contracts!inventory_units_contract_id_fkey(id, client_id, client_code, contract_number, installation_address)',
  ).eq('product.is_active', true).ilike('matched_product.name', `%${q.replace(/[\\%_*]/g, '\\$&')}%`)
    .or(`${identifierFilter(q)},matched_product.not.is.null`);
  if (scope.categoryId) units = units.eq('product.category_id', scope.categoryId);
  if (scope.statuses) units = units.in('status', scope.statuses);
  products = products.order('name').order('id').range(start, start + SEARCH_PAGE_SIZE);
  units = units.order('id').range(start, start + SEARCH_PAGE_SIZE);
  if (signal) { products = products.abortSignal(signal); units = units.abortSignal(signal); }
  const [p, u] = await Promise.all([
    scope.statuses ? Promise.resolve({ data: [], error: null }) : products,
    units,
  ]);
  if (p.error) throw p.error;
  if (u.error) throw u.error;
  return {
    products: (p.data ?? []).slice(0, SEARCH_PAGE_SIZE) as unknown as InventoryProduct[],
    units: (u.data ?? []).slice(0, SEARCH_PAGE_SIZE) as unknown as SearchUnit[],
    more: (p.data?.length ?? 0) > SEARCH_PAGE_SIZE || (u.data?.length ?? 0) > SEARCH_PAGE_SIZE,
  };
}
