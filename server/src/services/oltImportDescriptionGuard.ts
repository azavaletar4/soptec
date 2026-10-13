/**
 * Fase 3 comercial OLT (2026-10-13, incidentes Violeta/Clara/Mayco) —
 * "Importar ONTs desde la OLT" trae serial/tipo/VLAN/perfiles/señal/estado
 * directo de la OLT en cada corrida (es su fuente de verdad) — pero
 * "description" es el ÚNICO de esos campos que también se edita a mano
 * desde el panel ("Editar información"). Sin esta guardia, cada import
 * volvía a pisar ese nombre con el texto crudo de la OLT.
 *
 * Riesgo encontrado en la primera versión (solo miraba la posición, nunca
 * el serial): si una ONT vinculada se REEMPLAZA físicamente (otro equipo
 * en el mismo frame/slot/port/ont_id — cable reconectado, ONT nueva tras
 * una falla, etc.), la fila seguía protegida por posición aunque el serial
 * real ya fuera otro — dejaba el `client_id`/`description` del cliente
 * VIEJO pegados a un equipo que ya no es suyo. Esta version compara
 * también el serial: solo protege `description` cuando la posición Y el
 * serial siguen siendo los mismos que ya estaban vinculados. Si cambia el
 * serial en una posición ya vinculada, esa fila NO se toca en absoluto
 * (ni description, ni los campos tecnicos) — se reporta como conflicto
 * para revisión administrativa, nunca se resuelve sola.
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

/** Lo que ya sabemos de una posición vinculada a un cliente, antes de este import. */
export interface LinkedPosition {
  frame: number;
  slot: number;
  port: number;
  ontId: number;
  serial: string;
  clientId: string;
}

export interface ImportConflict {
  position: string;
  previousSerial: string;
  previousClientId: string;
  scannedSerial: string;
  reason: string;
}

/**
 * Clasifica cada candidato del escaneo en 3 grupos:
 *  - `fullRefresh`: posición sin vincular (Situación A) — se actualiza todo,
 *    incluida `description`, igual que siempre.
 *  - `keepDescription`: posición vinculada Y mismo serial — es la MISMA
 *    ONT de siempre, se actualiza todo salvo `description` (dato
 *    administrado desde el panel).
 *  - `conflicts`: posición vinculada pero con OTRO serial — la identidad
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
  const linkedByPosition = new Map(
    linkedPositions.map((p) => [positionKey(p.frame, p.slot, p.port, p.ontId), p]),
  );

  const fullRefresh: T[] = [];
  const keepDescription: T[] = [];
  const conflicts: ImportConflict[] = [];

  for (const c of candidates) {
    const key = positionKey(c.frame, c.slot, c.port, c.ontId);
    const existing = linkedByPosition.get(key);
    if (!existing) {
      fullRefresh.push(c);
      continue;
    }
    if (existing.serial.toUpperCase() === c.serial.toUpperCase()) {
      keepDescription.push(c);
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
