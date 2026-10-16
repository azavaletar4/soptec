import type { SupabaseClient } from '@supabase/supabase-js';
import { assertAdministrativeInventoryAccess } from './inventoryAccess';
import { searchInventory, type InventorySearchScope } from './inventorySearch';

/** Guarda del cliente, adicional al router. La autorización de datos depende de RLS. */
export async function searchAdministrativeInventory(
  db: SupabaseClient, role: string | null | undefined, term: string, page: number,
  scope?: InventorySearchScope, signal?: AbortSignal,
) {
  assertAdministrativeInventoryAccess(role);
  return searchInventory(db, term, page, scope, signal);
}
