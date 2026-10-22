/**
 * Identity guard for explicit metadata import. All existing positions, including
 * unlinked historical rows, must be supplied. A different serial at an occupied
 * position or an existing serial at a new position is a reviewable conflict;
 * neither a replacement nor a move is automatically reconciled here.
 * Linked descriptions remain owned by the application. Telemetry is handled
 * separately by oltTelemetry, never by this metadata classifier.
 */
export function positionKey(frame: number, slot: number, port: number, ontId: number): string {
  return `${frame}/${slot}/${port}:${ontId}`;
}

export interface ImportCandidate {
  frame: number;
  slot: number;
  port: number;
  ontId: number;
  serial: string;
}

/** Inventario previo de posiciones; incluye filas sin cliente para conservar su historia. */
export interface LinkedPosition {
  frame: number;
  slot: number;
  port: number;
  ontId: number;
  serial: string;
  clientId: string | null;
  retiredAt?: string | null;
}

export interface ImportConflict {
  position: string;
  previousSerial: string;
  previousClientId: string | null;
  scannedSerial: string;
  reason: string;
}

/**
 * Clasifica cada candidato del escaneo en 3 grupos:
 *  - `fullRefresh`: posición nueva o sin vincular con mismo serial — refresca metadatos,
 *    incluida `description`, igual que siempre.
 *  - `keepDescription`: posición vinculada Y mismo serial — es la MISMA
 *    ONT de siempre, refresca metadatos salvo `description` (dato
 *    administrado desde el panel).
 *  - `conflicts`: posición existente con OTRO serial o serial trasladado — la identidad
 *    física cambió; NO se toca client_id/contract_id/description/historial
 *    ni ningún campo técnico de esa fila. Se reporta aparte, con los datos
 *    necesarios para que un administrador lo revise manualmente.
 *
 * Comparación de serial case-insensitive (mismo criterio ya usado en
 * oltProvisioningStore.ts/upsertOnt para detectar conflictos de posición).
 */
export function classifyImportCandidates<T extends ImportCandidate>(
  candidates: readonly T[],
  linkedPositions: readonly LinkedPosition[],
): { fullRefresh: T[]; keepDescription: T[]; conflicts: ImportConflict[] } {
  linkedPositions = linkedPositions.filter(p => !p.retiredAt);
  const linkedByPosition = new Map(
    linkedPositions.map((p) => [positionKey(p.frame, p.slot, p.port, p.ontId), p]),
  );
  const existingBySerial = new Map(linkedPositions.map(p => [p.serial.toUpperCase(), p]));

  const fullRefresh: T[] = [];
  const keepDescription: T[] = [];
  const conflicts: ImportConflict[] = [];

  for (const c of candidates) {
    const key = positionKey(c.frame, c.slot, c.port, c.ontId);
    const existing = linkedByPosition.get(key);
    if (!existing) {
      const previous = existingBySerial.get(c.serial.toUpperCase());
      if (previous) {
        conflicts.push({ position: key, previousSerial: previous.serial, previousClientId: previous.clientId, scannedSerial: c.serial, reason: 'Serial trasladado; conservar registro y vínculos hasta revisión manual.' });
        continue;
      }
      fullRefresh.push(c);
      continue;
    }
    if (existing.serial.toUpperCase() === c.serial.toUpperCase()) {
      (existing.clientId ? keepDescription : fullRefresh).push(c);
      continue;
    }
    conflicts.push({
      position: key,
      previousSerial: existing.serial,
      previousClientId: existing.clientId,
      scannedSerial: c.serial,
      reason:
        `Posición ${key} ya está vinculada (serial registrado ${existing.serial}) pero la OLT ahora reporta ` +
        `el serial ${c.serial} — posible ONT reemplazada o trasladada. No se modificó nada; requiere revisión manual.`,
    });
  }

  return { fullRefresh, keepDescription, conflicts };
}
