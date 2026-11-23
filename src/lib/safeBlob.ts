/**
 * Copia un File/Blob a una version PURAMENTE EN MEMORIA, sin ninguna
 * referencia a su origen (URI de contenido de la camara/galeria de Android,
 * handle de archivo del sistema, etc.).
 *
 * Por que hace falta: un File que viene de `<input type="file" capture>`
 * (foto tomada con la camara nativa en Android) puede seguir "respaldado"
 * por un URI de contenido temporal del sistema. Si ese File se guarda
 * directo en IndexedDB (cola offline de cierres, borrador local) y Android
 * ya liberó ese archivo temporal, la escritura falla con el error nativo
 * "Failed to write blobs (InvalidBlob)" — un problema conocido de
 * IndexedDB/WebView en Android, no de Supabase ni de la logica de negocio.
 * Materializar los bytes ANTES de escribir a IndexedDB elimina esa
 * dependencia del origen: de ahi en adelante el archivo vive enteramente en
 * memoria, igual que cualquier Blob que ya se leyo de vuelta desde IndexedDB.
 *
 * Nunca atrapa el error de lectura — si el origen ya no esta disponible
 * (el caso mas raro: se liberó en los milisegundos entre la captura y este
 * llamado), quien llama debe decidir que mostrar; no hay nada seguro que
 * devolver en su lugar.
 */
export async function toSafeFile(file: File): Promise<File> {
  const buffer = await file.arrayBuffer();
  return new File([buffer], file.name, { type: file.type, lastModified: file.lastModified });
}

export async function toSafeBlob(blob: Blob): Promise<Blob> {
  const buffer = await blob.arrayBuffer();
  return new Blob([buffer], { type: blob.type });
}
