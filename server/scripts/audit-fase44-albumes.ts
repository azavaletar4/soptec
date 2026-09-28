/**
 * Auditoria de solo lectura para la Fase 44 (Albumes de Inventario).
 *
 * Revisa el resultado del backfill heuristico de category_id (por palabras
 * clave en nombre/categoria) y prueba el RPC inventory_get_albums.
 *
 * GARANTIA DE SOLO LECTURA: este archivo solo hace .select/.rpc de lectura
 * contra Supabase. No debe contener jamas un .insert/.update/.delete/.upsert.
 *
 * Uso (desde la raiz del repo, para que dotenv encuentre el .env):
 *
 *   npx tsx server/scripts/audit-fase44-albumes.ts
 */
import 'dotenv/config';
import { supabaseAdmin } from '../src/lib/supabaseAdmin';

async function main() {
  const { data: categories, error: catErr } = await supabaseAdmin
    .from('inventory_categories')
    .select('id, slug, name')
    .order('sort_order');
  if (catErr) throw catErr;
  console.log(`Categorias (${categories?.length ?? 0}):`, categories?.map((c) => c.slug).join(', '));

  const { data: products, error: prodErr } = await supabaseAdmin
    .from('inventory_products')
    .select('id, name, category, category_id, is_active')
    .eq('is_active', true)
    .order('name');
  if (prodErr) throw prodErr;

  const bySlug = new Map<string, { id: string; name: string; category: string | null }[]>();
  const catById = new Map((categories ?? []).map((c) => [c.id, c.slug]));
  for (const p of products ?? []) {
    const slug = p.category_id ? catById.get(p.category_id) ?? '¿desconocida?' : 'SIN category_id';
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug)!.push({ id: p.id, name: p.name, category: p.category });
  }

  console.log(`\nProductos activos: ${products?.length ?? 0}\n`);
  for (const [slug, items] of bySlug) {
    console.log(`--- ${slug} (${items.length}) ---`);
    for (const it of items) console.log(`  ${it.name}  (category texto legado: ${it.category ?? '—'})`);
  }

  console.log('\n--- inventory_get_albums() ---');
  const { data: albums, error: albumsErr } = await supabaseAdmin.rpc('inventory_get_albums');
  if (albumsErr) throw albumsErr;
  console.table(albums);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error en auditoria Fase 44:', err);
    process.exit(1);
  });
