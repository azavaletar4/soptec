/**
 * Deteccion de solo lectura (Fase 165, etapa 1 — advertencia, sin bloqueo):
 * un tecnico puede liquidar materiales (campo_inventory_operation 'kit'/
 * 'consume', routine_inventory_operation 'consume') sin que el sistema
 * verifique su saldo en technician_material_custody — esa tabla NUNCA se
 * consulta en el camino de consumo (ver ESTADO_DESARROLLO.md, caso real
 * Jadir Zavaleta / 18/10/2026). Este modulo NO corrige nada: simula, con
 * los mismos datos que ya existen (eventos de custodia + Kardex de
 * inventory_movements), cual hubiera sido el saldo de cada tecnico al
 * momento de cada consumo, y señala los casos donde ese saldo no alcanzaba.
 *
 * Un hallazgo aqui NO prueba perdida fisica de material — solo que el
 * sistema nunca registro una entrega formal suficiente antes de ese
 * consumo. Puede deberse a que la entrega nunca se formalizo en el panel
 * (lo mas probable hoy, ver incidente real) o a un orden de registro
 * distinto al fisico.
 */

export type MaterialCustodyJobType = 'installation' | 'ticket' | 'routine';

export interface MaterialCustodyEventInput {
  technicianId: string;
  productId: string;
  eventType: 'delivery' | 'return';
  quantity: number;
  createdAt: string;
}

export interface MaterialConsumptionMovementInput {
  id: string;
  /** inventory_movements.created_by — null (p.ej. edicion administrativa directa) se ignora, nunca se le atribuye a un tecnico. */
  technicianId: string | null;
  productId: string;
  movementType: 'ingreso' | 'egreso';
  quantity: number;
  createdAt: string;
  jobType: MaterialCustodyJobType | null;
  jobId: string | null;
  /** Si es un 'ingreso' que revierte un 'egreso' anterior (correct/reverse) — repone el saldo simulado de ese tecnico. */
  reversesMovementId: string | null;
}

export interface MaterialCustodyShortfall {
  movementId: string;
  technicianId: string;
  productId: string;
  quantity: number;
  /** Saldo simulado disponible justo ANTES de este consumo (nunca negativo). */
  availableBefore: number;
  /** Cuanto excedio el consumo al saldo disponible (quantity - availableBefore). */
  shortfall: number;
  jobType: MaterialCustodyJobType;
  jobId: string;
  consumedAt: string;
}

/**
 * Fecha/hora (ISO, UTC) en que esta deteccion pasa a ejecutarse en vivo —
 * un valor unico, fijado en el momento real de activacion, el mismo para
 * todos los administradores (nunca el reloj del navegador de quien mira
 * la pantalla). Se inyecta en tiempo de build via VITE_MATERIAL_CUSTODY_LIVE_SINCE
 * (mismo mecanismo ya usado para VITE_SUPABASE_URL — ver deploy/Dockerfile.frontend
 * y docker-compose.onprem.yml) — queda horneada en el bundle, no se lee en
 * cada carga de pagina. Sin configurar (deploy actual), vale null y TODO
 * hallazgo es "historico" por definicion (la deteccion todavia no corria).
 *
 * `import.meta.env` no existe al correr las pruebas con tsx/node (no es un
 * build de Vite) — el encadenado opcional evita que eso rompa los tests.
 */
function readLiveSinceFromBuildEnv(): string | null {
  const raw = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_MATERIAL_CUSTODY_LIVE_SINCE;
  if (!raw || !raw.trim()) return null;
  return Number.isNaN(Date.parse(raw)) ? null : raw.trim();
}

export const MATERIAL_CUSTODY_DETECTION_LIVE_SINCE: string | null = readLiveSinceFromBuildEnv();

export function classifyShortfallRecency(consumedAt: string, liveSince: string | null = MATERIAL_CUSTODY_DETECTION_LIVE_SINCE): 'historico' | 'nuevo' {
  if (liveSince === null) return 'historico';
  return consumedAt >= liveSince ? 'nuevo' : 'historico';
}

/**
 * Simula, por (tecnico, producto), el saldo de custodia que hubiera
 * existido con los mismos eventos que ya estan registrados — entregas
 * (+), devoluciones (-), consumos con contexto de orden (-) y sus
 * reversiones/correcciones (+) — y devuelve un hallazgo por cada consumo
 * cuyo saldo simulado en ese momento no alcanzaba. El saldo nunca baja de
 * 0 (igual que la restriccion real de technician_material_custody): un
 * consumo sin saldo deja el saldo simulado en 0, no negativo, para que el
 * siguiente hallazgo no acumule un deficit inflado artificialmente.
 */
export function detectMaterialCustodyShortfalls(
  custodyEvents: MaterialCustodyEventInput[],
  movements: MaterialConsumptionMovementInput[],
): MaterialCustodyShortfall[] {
  interface Timeline {
    at: string;
    kind: 'delivery' | 'return' | 'consume' | 'restore';
    quantity: number;
    movement?: MaterialConsumptionMovementInput;
  }

  const byKey = new Map<string, Timeline[]>();
  const key = (technicianId: string, productId: string) => `${technicianId}::${productId}`;

  for (const e of custodyEvents) {
    const k = key(e.technicianId, e.productId);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push({ at: e.createdAt, kind: e.eventType, quantity: e.quantity });
  }

  for (const m of movements) {
    if (!m.technicianId || !m.jobType || !m.jobId) continue; // sin tecnico u orden atribuible -> fuera de alcance de esta simulacion
    if (m.movementType === 'egreso') {
      const k = key(m.technicianId, m.productId);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push({ at: m.createdAt, kind: 'consume', quantity: m.quantity, movement: m });
    } else if (m.movementType === 'ingreso' && m.reversesMovementId) {
      const k = key(m.technicianId, m.productId);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push({ at: m.createdAt, kind: 'restore', quantity: m.quantity, movement: m });
    }
  }

  const shortfalls: MaterialCustodyShortfall[] = [];
  for (const [k, events] of byKey) {
    const [technicianId, productId] = k.split('::');
    events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    let balance = 0;
    for (const ev of events) {
      if (ev.kind === 'delivery' || ev.kind === 'restore') {
        balance += ev.quantity;
      } else if (ev.kind === 'return') {
        balance = Math.max(0, balance - ev.quantity);
      } else if (ev.kind === 'consume') {
        const availableBefore = balance;
        const movement = ev.movement!;
        if (ev.quantity > availableBefore) {
          shortfalls.push({
            movementId: movement.id,
            technicianId,
            productId,
            quantity: ev.quantity,
            availableBefore,
            shortfall: ev.quantity - availableBefore,
            jobType: movement.jobType!,
            jobId: movement.jobId!,
            consumedAt: movement.createdAt,
          });
        }
        balance = Math.max(0, balance - ev.quantity);
      }
    }
  }

  shortfalls.sort((a, b) => (a.consumedAt < b.consumedAt ? 1 : a.consumedAt > b.consumedAt ? -1 : 0));
  return shortfalls;
}
