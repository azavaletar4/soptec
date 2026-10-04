/**
 * Compresion MASIVA de fotos YA EXISTENTES en Supabase Storage (sharp):
 * recorre los buckets de fotos de evidencia tecnica y re-comprime en el
 * propio Storage cualquier JPG/PNG que pese mas de 200 KB — mismo criterio
 * de compresion que ya aplica el navegador a las fotos NUEVAS (Fase 92,
 * src/lib/imageCompression.ts), pero aqui para el historico ya subido.
 *
 * ALCANCE — solo los 3 buckets de fotos de evidencia (no 'instalaciones'/
 * 'tickets' genericos: esos no son buckets reales en este proyecto, ver
 * src/stores/*.ts):
 *   - client-photos   (fotos de instalacion: fachada, caja NAP, etc.)
 *   - infra-photos    (fotos de elementos de red/equipos)
 *   - work-evidence   (fotos de cierre de la App de Campo + firma PNG)
 * NO toca caja-chica-comprobantes ni vehiculo-soat: aceptan PDF y son
 * documentos donde importa mas la fidelidad que el peso (mismo criterio
 * que se uso para la compresion en el navegador).
 *
 * MISMO storage_path (no renombra ni cambia extension) para no romper
 * ninguna referencia guardada en las tablas (client_photos, infra_elementos,
 * work_order_photos) — solo cambian los BYTES + el Content-Type real a
 * image/jpeg (via upload({ upsert: true, contentType })), aunque el archivo
 * se siga llamando "foo.png". Los navegadores renderizan por Content-Type,
 * no por extension, asi que no rompe nada.
 *
 * IRREVERSIBLE: Supabase Storage no versiona — una vez sobre-escrito, el
 * archivo original de mayor calidad se pierde para siempre. Por eso:
 *
 * Uso (desde la raiz del repo, para que dotenv encuentre el .env):
 *
 *   npx tsx server/scripts/compress-storage-photos.ts
 *     DRY-RUN (default, NO escribe nada) — lista que se comprimiria y el
 *     ahorro estimado.
 *
 *   npx tsx server/scripts/compress-storage-photos.ts --apply
 *     Aplica de verdad: descarga, comprime y re-sube (upsert) cada archivo
 *     candidato.
 *
 *   npx tsx server/scripts/compress-storage-photos.ts --bucket client-photos
 *     Limita la corrida a un solo bucket (por defecto corre los 3 de arriba).
 *
 *   npx tsx server/scripts/compress-storage-photos.ts --only <substring>
 *     Limita a archivos cuyo storage_path contenga ese texto — para probar
 *     con uno o dos archivos antes de correr --apply contra todo.
 *
 * Requiere SUPABASE_SERVICE_ROLE_KEY en el .env (ya existe, ver
 * server/src/lib/supabaseAdmin.ts) — hace falta para listar/descargar/subir
 * saltandose RLS en buckets privados.
 */
import 'dotenv/config';
import sharp from 'sharp';
import { supabaseAdmin } from '../src/lib/supabaseAdmin';

const DEFAULT_BUCKETS = ['client-photos', 'infra-photos', 'work-evidence'];
const SIZE_THRESHOLD_BYTES = 200 * 1024;
const RESIZE_MAX_WIDTH = 1280;
const JPEG_QUALITY = 75;
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png']);

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const bucketArgIdx = args.indexOf('--bucket');
const onlyArgIdx = args.indexOf('--only');
const buckets = bucketArgIdx !== -1 ? [args[bucketArgIdx + 1]] : DEFAULT_BUCKETS;
const only = onlyArgIdx !== -1 ? args[onlyArgIdx + 1] : null;

interface StorageFile {
  path: string;
  sizeBytes: number;
  mimetype: string | null;
}

/** Supabase Storage `.list()` no es recursivo — una "carpeta" aparece como entrada con id=null. */
async function listAllFiles(bucket: string, prefix = ''): Promise<StorageFile[]> {
  const files: StorageFile[] = [];
  let offset = 0;
  const limit = 100;
  for (;;) {
    const { data, error } = await supabaseAdmin.storage.from(bucket).list(prefix, {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`list(${bucket}/${prefix}): ${error.message}`);
    if (!data || data.length === 0) break;

    for (const entry of data) {
      const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        // Carpeta: recursion.
        files.push(...(await listAllFiles(bucket, entryPath)));
      } else {
        files.push({
          path: entryPath,
          sizeBytes: entry.metadata?.size ?? 0,
          mimetype: entry.metadata?.mimetype ?? null,
        });
      }
    }

    if (data.length < limit) break;
    offset += limit;
  }
  return files;
}

function isCompressibleImage(file: StorageFile): boolean {
  const ext = file.path.split('.').pop()?.toLowerCase() ?? '';
  if (file.mimetype) return file.mimetype === 'image/jpeg' || file.mimetype === 'image/png';
  return IMAGE_EXTENSIONS.has(ext);
}

function formatKB(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

async function compressOne(bucket: string, file: StorageFile): Promise<{ savedBytes: number } | null> {
  const { data: blob, error: downloadError } = await supabaseAdmin.storage.from(bucket).download(file.path);
  if (downloadError || !blob) {
    console.error(`  ✗ ${bucket}/${file.path} — error al descargar: ${downloadError?.message}`);
    return null;
  }
  const original = Buffer.from(await blob.arrayBuffer());

  let compressed: Buffer;
  try {
    compressed = await sharp(original)
      .rotate() // respeta la orientacion EXIF antes de redimensionar
      .resize({ width: RESIZE_MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
  } catch (e) {
    console.error(`  ✗ ${bucket}/${file.path} — error al comprimir: ${(e as Error).message}`);
    return null;
  }

  if (compressed.length >= original.length) {
    console.log(`  = ${bucket}/${file.path} — ya estaba optimo (${formatKB(original.length)}), se deja igual`);
    return null;
  }

  if (apply) {
    const { error: uploadError } = await supabaseAdmin.storage
      .from(bucket)
      .upload(file.path, compressed, { upsert: true, contentType: 'image/jpeg' });
    if (uploadError) {
      console.error(`  ✗ ${bucket}/${file.path} — error al re-subir: ${uploadError.message}`);
      return null;
    }
  }

  const savedBytes = original.length - compressed.length;
  const savedPct = Math.round((savedBytes / original.length) * 100);
  console.log(
    `  ${apply ? '✓' : '→'} ${bucket}/${file.path} — ${formatKB(original.length)} → ${formatKB(compressed.length)} (-${savedPct}%)`,
  );
  return { savedBytes };
}

async function main() {
  console.log(`Modo: ${apply ? 'APLICAR (va a sobre-escribir archivos en Storage)' : 'DRY-RUN (no escribe nada)'}`);
  console.log(`Buckets: ${buckets.join(', ')}`);
  if (only) console.log(`Filtro --only: "${only}"`);
  console.log('');

  let totalScanned = 0;
  let totalCandidates = 0;
  let totalProcessed = 0;
  let totalSavedBytes = 0;

  for (const bucket of buckets) {
    console.log(`\n== Bucket: ${bucket} ==`);
    const files = await listAllFiles(bucket);
    totalScanned += files.length;

    const candidates = files.filter(
      (f) => isCompressibleImage(f) && f.sizeBytes > SIZE_THRESHOLD_BYTES && (!only || f.path.includes(only)),
    );
    console.log(`${files.length} archivo(s) listados, ${candidates.length} candidato(s) (> ${formatKB(SIZE_THRESHOLD_BYTES)}, JPG/PNG)`);
    totalCandidates += candidates.length;

    for (const file of candidates) {
      const result = await compressOne(bucket, file);
      if (result) {
        totalProcessed += 1;
        totalSavedBytes += result.savedBytes;
      }
    }
  }

  console.log('\n== Resumen ==');
  console.log(`Archivos escaneados: ${totalScanned}`);
  console.log(`Candidatos (> ${formatKB(SIZE_THRESHOLD_BYTES)}): ${totalCandidates}`);
  console.log(`${apply ? 'Comprimidos y re-subidos' : 'Se comprimirian'}: ${totalProcessed}`);
  console.log(`Ahorro ${apply ? '' : 'estimado '}total: ${formatKB(totalSavedBytes)} (${(totalSavedBytes / 1024 / 1024).toFixed(2)} MB)`);
  if (!apply) console.log('\nEsto fue un DRY-RUN — nada se escribio. Vuelve a correr con --apply para aplicar de verdad.');
}

main().catch((e) => {
  console.error('Error fatal:', e);
  process.exit(1);
});
