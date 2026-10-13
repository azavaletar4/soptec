/**
 * Fase 3 comercial OLT (2026-10-13, incidentes Violeta/Clara/Mayco) —
 * "Importar ONTs desde la OLT" trae serial/tipo/VLAN/perfiles/señal/estado
 * directo de la OLT en cada corrida (es su fuente de verdad) — pero
 * "description" es el ÚNICO de esos campos que también se edita a mano
 * desde el panel ("Editar información"). Sin esta guardia, cada import
 * volvía a pisar ese nombre con el texto crudo de la OLT.
 *
 * Regla: una vez que la ONT ya está vinculada a un cliente (`client_id` no
 * nulo), su `description` es un dato administrado por esta app — el
 * import deja de tocarlo. Una ONT sin vincular todavía sigue tomando el
 * nombre de la OLT en cada import, como siempre (Situación A de la
 * migración, ver CLAUDE.md — la mayoría de las ~400 ONT pendientes están
 * en este caso, y necesitan seguir reflejando lo que diga la OLT hasta que
 * alguien las vincule).
 */

export function positionKey(frame: number, slot: number, port: number, ontId: number): string {
  return `${frame}/${slot}/${port}:${ontId}`;
}

export interface ImportCandidate {
  frame: number;
  slot: number;
  port: number;
  ontId: number;
}

/**
 * Separa candidatos de import en dos grupos: los que YA están vinculados a
 * un cliente (no reciben `description` nueva) y los que no (siguen
 * tomándolo de la OLT). Puramente posicional — nunca decide por serial ni
 * por nombre, para no depender de datos que pueden cambiar entre corridas.
 */
export function splitByLinkStatus<T extends ImportCandidate>(
  candidates: readonly T[],
  linkedPositions: ReadonlySet<string>,
): { linked: T[]; unlinked: T[] } {
  const linked: T[] = [];
  const unlinked: T[] = [];
  for (const c of candidates) {
    (linkedPositions.has(positionKey(c.frame, c.slot, c.port, c.ontId)) ? linked : unlinked).push(c);
  }
  return { linked, unlinked };
}
