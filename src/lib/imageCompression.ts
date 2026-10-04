/**
 * Comprime una foto en el navegador ANTES de subirla a Supabase Storage.
 * Las fotos de camara de celular pesan 3-8 MB; redimensionadas a 1280px de
 * lado mayor y re-codificadas en JPEG quedan legibles para evidencia tecnica
 * en ~100-200 KB, lo que reduce mucho el consumo del plan de Storage.
 *
 * API nativa (createImageBitmap + canvas), sin dependencia nueva: los
 * navegadores de los celulares de los tecnicos (Chrome/WebView Android via
 * la app Flutter) ya la soportan.
 */
const MAX_DIMENSION = 1280;
const TARGET_BYTES = 150 * 1024;
const DEFAULT_QUALITY = 0.8;
const MIN_QUALITY = 0.5;
const MAX_QUALITY_ATTEMPTS = 3;

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export interface CompressImageOptions {
  maxDimension?: number;
  targetBytes?: number;
  mimeType?: 'image/jpeg' | 'image/webp';
}

/**
 * Devuelve un File comprimido, o el original si no es una imagen, si el
 * navegador no soporta la API necesaria, o si la version comprimida salio
 * mas pesada que la original (fotos que ya venian livianas). Nunca lanza —
 * un fallo de compresion no debe bloquear la subida real.
 */
export async function compressImage(file: File, options: CompressImageOptions = {}): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file;
  if (typeof createImageBitmap !== 'function') return file;

  const maxDimension = options.maxDimension ?? MAX_DIMENSION;
  const targetBytes = options.targetBytes ?? TARGET_BYTES;
  const mimeType = options.mimeType ?? 'image/jpeg';

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    let quality = DEFAULT_QUALITY;
    let blob = await canvasToBlob(canvas, mimeType, quality);
    let attempts = 0;
    while (blob.size > targetBytes && quality > MIN_QUALITY && attempts < MAX_QUALITY_ATTEMPTS) {
      quality -= 0.1;
      blob = await canvasToBlob(canvas, mimeType, quality);
      attempts += 1;
    }

    if (blob.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^./]+$/, '') || 'foto';
    const ext = EXTENSION_BY_MIME[mimeType] ?? 'jpg';
    return new File([blob], `${baseName}.${ext}`, { type: mimeType, lastModified: Date.now() });
  } catch {
    return file;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No se pudo comprimir la imagen'))), type, quality);
  });
}
