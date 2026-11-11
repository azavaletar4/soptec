/** Hash de la intención, incluyendo bytes de fotos/Blobs. No incluye metadatos
 * locales ni recibos; el mismo trabajo en IndexedDB produce el mismo hash. */
export async function closurePayloadHash(input: Record<string, unknown>): Promise<string> {
  const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  const digest = async (data: BufferSource) => hex(await crypto.subtle.digest('SHA-256', data));
  const photos = async (value: unknown, equipment: boolean) => Promise.all(((value ?? []) as Record<string, unknown>[]).map(async entry => {
    const blob = (entry.file ?? entry.blob) as Blob;
    return { category: equipment ? entry.equipmentType : entry.category, name: entry.fileName ?? (blob as File).name,
      type: blob.type, hash: await digest(await blob.arrayBuffer()) };
  }));
  const payload: Record<string, unknown> = {};
  for (const key of ['jobType','jobId','clientId','contractId','targetStatus','latitude','longitude','ontSerial','closureNotes',
    'motivoAveria','motivoAveriaDetalle','justificacionCierre','potenciaDbm','napElementoId','zoneId','installationAddress','clientCode','iptvInstallationMode']) {
    payload[key] = input[key] ?? null;
  }
  payload.ontReplaced = input.ontReplaced ?? false;
  payload.clientPhotoCategories = input.clientPhotoCategories ?? [];
  payload.pendingApprovalCategories = input.pendingApprovalCategories ?? [];
  payload.photos = await photos(input.photos, false);
  payload.equipmentPhotos = await photos(input.equipmentPhotos, true);
  payload.signature = input.signatureBlob ? await digest(await (input.signatureBlob as Blob).arrayBuffer()) : null;
  return digest(new TextEncoder().encode(JSON.stringify(payload)));
}

export async function withClosureLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    throw new Error('Actualiza Android System WebView o el navegador para sincronizar de forma segura. Los trabajos guardados se conservan.');
  }
  return navigator.locks.request('smartrayco-campo:' + key, work);
}
