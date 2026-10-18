import type { SupabaseClient } from '@supabase/supabase-js';
import { assertAdministrativeInventoryAccess } from './inventoryAccess';

export type ReconciliationClass = 'installed' | 'custody' | 'possible' | 'unknown';
export const RECONCILIATION_LABELS: Record<ReconciliationClass, string> = {
  installed: 'Instalación confirmada', custody: 'Custodia confirmada',
  possible: 'Posible coincidencia que requiere revisión', unknown: 'Ubicación sin verificar',
};
export interface ReconciliationUnit {
  id: string; product_id: string; serial_number: string | null; mac_address: string | null; status: string;
  client_id: string | null; contract_id: string | null; installation_id: string | null; ticket_id: string | null; custody_technician_id: string | null;
  product: { name: string; is_serialized: boolean; inventory_categories: { slug: string; name: string } | null } | null;
  clients: { id: string; first_name: string; last_name: string } | null;
  contract: { id: string; client_id: string; contract_number: string | null } | null;
  technician: { id: string; full_name: string | null; email: string | null } | null;
}
export interface ReconciliationInstallation { id: string; client_id: string; contract_id: string | null; status: string }
export interface ReconciliationTicket { id: string; client_id: string; contract_id: string | null; status: string }
export interface ReconciliationClosure { id: string; job_id: string; client_id: string | null; ont_serial: string | null; created_at: string }
/**
 * Candidato conservador de error de digitación: una serie registrada en un
 * cierre de Alta/Avería verificado (orden completada/resuelta, mismo
 * cliente) que NO coincide exacto con ninguna unidad de Inventario, pero
 * difiere en exactamente 1 carácter de la serie de ESTA unidad. Nunca
 * prueba que sea el mismo equipo — solo señala la diferencia encontrada
 * para que administración lo verifique manualmente.
 */
export interface SerialTypoCandidate {
  source: 'installation' | 'ticket'; sourceSerial: string; unitSerial: string;
  clientId: string; contractId: string | null; jobId: string;
  /** true si 2+ unidades distintas empatan a distancia 1 de la misma serie del cierre — no se elige una al azar. */
  ambiguous: boolean;
}
export interface ReconciliationRow {
  unit: ReconciliationUnit; classification: ReconciliationClass; reasons: string[];
  category: string; installation: ReconciliationInstallation | null; serialMatches: number;
  /** Cierres de Averia (job_type='ticket') con la misma serie; evidencia documental de reemplazo/verificacion en sitio, nunca una instalacion confirmada por si sola. */
  ticketSerialMatches: number;
  /** inventory_units.ticket_id — vinculo directo verificado por FK (stage/return de Fase 164), no una coincidencia por serie. Solo vigente mientras el equipo siga assigned/pending_approval (el trigger lo limpia al retirarlo). */
  ticket: ReconciliationTicket | null;
  /** Ver SerialTypoCandidate — null si no hay ningún cierre verificado a distancia 1 de la serie de esta unidad. */
  typoCandidate: SerialTypoCandidate | null;
}
export const normalizeSerial = (value: string | null) => (value ?? '').trim().toUpperCase();
export function normalizeMac(value: string | null) {
  const normalized = (value ?? '').replace(/[:.\-\s]/g, '').toUpperCase();
  return /^[0-9A-F]{12}$/.test(normalized) ? normalized : '';
}
export function equipmentCategory(unit: ReconciliationUnit) {
  return unit.product?.inventory_categories?.slug ?? 'sin-categoria';
}
const MIN_SERIAL_LENGTH_FOR_TYPO_CHECK = 6;
/** true si `a` y `b` difieren en exactamente 1 carácter (sustitución, o una inserción/eliminación) — distancia de edición acotada a 1, determinista y barata; nunca una similitud "aproximada" sin límite. */
function isOneCharApart(a: string, b: string): boolean {
  if (a === b) return false;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    let diff = 0;
    for (let i = 0; i < la; i++) if (a[i] !== b[i]) { diff++; if (diff > 1) return false; }
    return diff === 1;
  }
  const [short, long] = la < lb ? [a, b] : [b, a];
  let i = 0, j = 0, skipped = false;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) { i++; j++; continue; }
    if (skipped) return false;
    skipped = true; j++;
  }
  return true;
}

/** Evidencia documental; nunca escribe ni convierte un cierre histórico en ubicación vigente. */
export function reconcileInventory(
  units: ReconciliationUnit[],
  installations: ReconciliationInstallation[],
  closures: ReconciliationClosure[],
  tickets: ReconciliationTicket[] = [],
  ticketClosures: ReconciliationClosure[] = [],
): ReconciliationRow[] {
  const serials = new Map<string, number>(), macs = new Map<string, number>();
  for (const unit of units) {
    const serial = normalizeSerial(unit.serial_number), mac = normalizeMac(unit.mac_address);
    if (serial) serials.set(serial, (serials.get(serial) ?? 0) + 1);
    if (mac) macs.set(mac, (macs.get(mac) ?? 0) + 1);
  }
  const orders = new Map(installations.map(item => [item.id, item]));
  const closureSerials = new Map<string, ReconciliationClosure[]>();
  for (const closure of closures) {
    const order = orders.get(closure.job_id);
    const serial = normalizeSerial(closure.ont_serial);
    if (!serial || order?.status !== 'completed' || order.client_id !== closure.client_id) continue;
    closureSerials.set(serial, [...(closureSerials.get(serial) ?? []), closure]);
  }
  // Averia (ticket) resuelta/cerrada con la misma serie: puede ser un reemplazo o una
  // verificacion en sitio durante la visita — nunca una instalacion por si sola (regla 6).
  const ticketsById = new Map(tickets.map(item => [item.id, item]));
  const ticketClosureSerials = new Map<string, ReconciliationClosure[]>();
  for (const closure of ticketClosures) {
    const ticket = ticketsById.get(closure.job_id);
    const serial = normalizeSerial(closure.ont_serial);
    if (!serial || !ticket || !['resolved', 'closed'].includes(ticket.status) || ticket.client_id !== closure.client_id) continue;
    ticketClosureSerials.set(serial, [...(ticketClosureSerials.get(serial) ?? []), closure]);
  }
  // Detección conservadora de posibles errores de digitación: solo para ONT
  // (nunca mezclar categorías — una serie de TV Box nunca se compara contra
  // una serie de ONT), solo cierres ya verificados (orden completada/resuelta,
  // mismo cliente) cuya serie NO tiene ninguna coincidencia exacta en
  // Inventario, y solo contra unidades a distancia de edición exactamente 1.
  // Nunca se elige un candidato al azar entre varios empatados — se marca
  // ambiguo y se explica, nunca se prueba que sea el mismo equipo.
  const onuUnits = units.filter(u => equipmentCategory(u) === 'onu');
  const onuSerials = new Set(onuUnits.map(u => normalizeSerial(u.serial_number)).filter(s => s.length >= MIN_SERIAL_LENGTH_FOR_TYPO_CHECK));
  const verifiedSources: { serial: string; source: 'installation' | 'ticket'; clientId: string; contractId: string | null; jobId: string }[] = [];
  for (const closure of closures) {
    const order = orders.get(closure.job_id);
    const serial = normalizeSerial(closure.ont_serial);
    if (serial.length < MIN_SERIAL_LENGTH_FOR_TYPO_CHECK || order?.status !== 'completed' || order.client_id !== closure.client_id || onuSerials.has(serial)) continue;
    verifiedSources.push({ serial, source: 'installation', clientId: closure.client_id!, contractId: order.contract_id, jobId: closure.job_id });
  }
  for (const closure of ticketClosures) {
    const ticket = ticketsById.get(closure.job_id);
    const serial = normalizeSerial(closure.ont_serial);
    if (serial.length < MIN_SERIAL_LENGTH_FOR_TYPO_CHECK || !ticket || !['resolved', 'closed'].includes(ticket.status) || ticket.client_id !== closure.client_id || onuSerials.has(serial)) continue;
    verifiedSources.push({ serial, source: 'ticket', clientId: closure.client_id!, contractId: ticket.contract_id, jobId: closure.job_id });
  }
  const typoCandidatesByUnit = new Map<string, SerialTypoCandidate>();
  for (const src of verifiedSources) {
    const matchedUnits = onuUnits.filter(u => {
      const s = normalizeSerial(u.serial_number);
      return s.length >= MIN_SERIAL_LENGTH_FOR_TYPO_CHECK && isOneCharApart(src.serial, s);
    });
    if (!matchedUnits.length) continue;
    const ambiguous = matchedUnits.length > 1;
    for (const u of matchedUnits) {
      // Si la unidad ya tiene un candidato de OTRO cierre, tambien queda ambigua: no se puede
      // asumir cual de los dos cierres (si alguno) explica realmente esta unidad.
      const existing = typoCandidatesByUnit.get(u.id);
      typoCandidatesByUnit.set(u.id, {
        source: src.source, sourceSerial: src.serial, unitSerial: normalizeSerial(u.serial_number),
        clientId: src.clientId, contractId: src.contractId, jobId: src.jobId,
        ambiguous: ambiguous || !!existing,
      });
    }
  }
  return units.map(unit => {
    const reasons: string[] = [];
    const serial = normalizeSerial(unit.serial_number), mac = normalizeMac(unit.mac_address);
    const duplicate = !!((serial && (serials.get(serial) ?? 0) > 1) || (mac && (macs.get(mac) ?? 0) > 1));
    const installation = unit.installation_id ? orders.get(unit.installation_id) ?? null : null;
    // inventory_units.ticket_id: vinculo directo de Fase 164 (stage/return), no una coincidencia
    // por serie — pero igual puede no corresponder al mismo cliente si hay un dato inconsistente
    // (ver reglas 8 y 4 de esta ampliación); clientMatches abajo exige coherencia antes de
    // tratarlo como evidencia, nunca como instalación confirmada por sí solo.
    const ticket = unit.ticket_id ? ticketsById.get(unit.ticket_id) ?? null : null;
    const ticketVerified = !!ticket && ticket.client_id === unit.client_id && (!ticket.contract_id || !unit.contract_id || ticket.contract_id === unit.contract_id);
    const clientVerified = !!unit.client_id && unit.clients?.id === unit.client_id;
    const contractVerified = !unit.contract_id || (unit.contract?.id === unit.contract_id && unit.contract.client_id === unit.client_id);
    // Si la unidad no tiene contract_id propio todavía (nunca se sincronizó desde
    // la Alta), el contrato de la orden es la fuente confiable — nunca se trata
    // como contradicción solo por estar ausente. Si la unidad SÍ declara un
    // contract_id distinto al de la orden, eso sigue siendo una contradicción real.
    const orderVerified = !unit.installation_id || (!!installation && installation.client_id === unit.client_id && (!installation.contract_id || !unit.contract_id || installation.contract_id === unit.contract_id));
    // Un contract_id sin client_id, instalación ni avería vigente casi siempre es
    // un remanente de un movimiento anterior ya revertido (ver regla: nunca usar
    // un movimiento anulado por una devolución posterior como evidencia vigente)
    // — no es un indicio de que el equipo esté instalado en otro lugar.
    const orphanContract = !!unit.contract_id && !unit.client_id && !unit.installation_id && !unit.ticket_id;
    // ont_serial identifica ONT; no es un campo genérico para TV Box/MAC.
    const isOnt = equipmentCategory(unit) === 'onu';
    const serialMatches = isOnt ? closureSerials.get(serial)?.length ?? 0 : 0;
    const ticketSerialMatches = isOnt ? ticketClosureSerials.get(serial)?.length ?? 0 : 0;
    const typoCandidate = typoCandidatesByUnit.get(unit.id) ?? null;
    let classification: ReconciliationClass = 'unknown';
    if (duplicate) reasons.push('Serie o MAC repetida en más de una unidad; identidad ambigua.');
    if (unit.status === 'assigned' && clientVerified && contractVerified && orderVerified && !unit.custody_technician_id && !duplicate) {
      classification = 'installed'; reasons.push('Asignación vigente a cliente en Inventario con vínculos coherentes. Confirmación documental, no verificación física.');
    } else if (['with_technician', 'pending_return'].includes(unit.status) && unit.custody_technician_id && unit.technician?.id === unit.custody_technician_id && !unit.client_id && !unit.contract_id && !duplicate) {
      classification = 'custody'; reasons.push('Custodia vigente con técnico vinculado explícitamente.');
    } else {
      if (duplicate || serialMatches || ticketSerialMatches || unit.client_id || unit.installation_id || unit.ticket_id || unit.custody_technician_id || unit.status === 'assigned' || orphanContract || typoCandidate) classification = 'possible';
      if (serialMatches) reasons.push(`Serie exacta en ${serialMatches} cierre(s) de instalación finalizada. Evidencia histórica, no ubicación actual.`);
      if (ticketSerialMatches) reasons.push(`Serie exacta en ${ticketSerialMatches} cierre(s) de avería resuelta o cerrada. Puede ser un reemplazo de equipo o una verificación en sitio; no confirma por sí sola que esta unidad quedó instalada — revisar manualmente.`);
      if (unit.ticket_id && !ticketVerified) reasons.push('El equipo señala una Avería cuyo cliente o contrato registrado no coincide; vínculo documental sin confirmar — revisar manualmente.');
      else if (unit.ticket_id && unit.status === 'pending_approval') reasons.push('Equipo entrante de una Avería, pendiente de aprobación administrativa; no es instalación confirmada todavía.');
      if (orphanContract) reasons.push(`Tiene el contrato ${unit.contract?.contract_number || unit.contract_id} registrado pero ningún cliente vinculado — probablemente un dato remanente de un movimiento anterior ya revertido (ver estado registrado e historial del equipo); no indica que esté instalado. Revisar y limpiar el vínculo.`);
      if (typoCandidate) {
        const origen = typoCandidate.source === 'installation' ? 'una Alta finalizada' : 'una Avería resuelta/cerrada';
        reasons.push(typoCandidate.ambiguous
          ? `Esta unidad tiene la serie ${typoCandidate.unitSerial}; ${origen} registró la serie ${typoCandidate.sourceSerial} (cliente/contrato ${typoCandidate.contractId ?? 'sin contrato'}), que difiere en 1 carácter — pero hay más de una unidad igual de cercana, no se puede determinar cuál sin revisión manual. No es evidencia de que sea el mismo equipo.`
          : `Esta unidad tiene la serie ${typoCandidate.unitSerial}; ${origen} registró la serie ${typoCandidate.sourceSerial} (cliente vinculado al cierre, contrato ${typoCandidate.contractId ?? 'sin contrato'}), que difiere en exactamente 1 carácter — posible error de digitación en cualquiera de los dos registros. No confirma que sea el mismo equipo; verificar manualmente antes de corregir cualquier dato.`);
      }
      if (!orphanContract && (unit.client_id || unit.contract_id || unit.installation_id || unit.custody_technician_id)) reasons.push('Revisar coherencia de estado y vínculos registrados; no confirma instalación ni custodia actual.');
      if (!reasons.length) reasons.push('Sin evidencia suficiente de ubicación actual.');
    }
    return { unit, classification, reasons, category: equipmentCategory(unit), installation, serialMatches, ticketSerialMatches, ticket, typoCandidate };
  });
}

/** Lee todas las páginas visibles por RLS; un error o límite impide presentar un reporte incompleto. */
async function readPages<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; count: number | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  let expected: number | null = null;
  for (let from = 0; from < 20000;) {
    const result = await query(from, from + 499);
    if (result.error) throw Error(result.error.message);
    if (result.count === null) throw Error('No se pudo verificar el total de registros de una fuente.');
    if (result.count > 20000) break;
    if (expected !== null && result.count !== expected) throw Error('Los registros cambiaron durante la lectura. Actualiza el reporte.');
    expected = result.count;
    rows.push(...(result.data ?? []) as T[]);
    if (rows.length === expected) return rows;
    if (!result.data?.length || rows.length > expected) throw Error('La fuente devolvió un resultado incompleto. Actualiza el reporte.');
    from += result.data.length;
  }
  throw Error('El reporte supera 20 000 registros por fuente. Requiere una consulta paginada en servidor revisada antes de ampliarlo.');
}
export async function readInventoryReconciliation(db: SupabaseClient, role: string | null, signal: AbortSignal) {
  assertAdministrativeInventoryAccess(role);
  const [units, installations, closures, tickets, ticketClosures] = await Promise.all([
    readPages<ReconciliationUnit>((from, to) => db.from('inventory_units').select('id, product_id, serial_number, mac_address, status, client_id, contract_id, installation_id, ticket_id, custody_technician_id, product:inventory_products!inner(name, is_serialized, inventory_categories(slug, name)), clients(id, first_name, last_name), contract:service_contracts!inventory_units_contract_id_fkey(id, client_id, contract_number), technician:profiles!inventory_units_custody_technician_id_fkey(id, full_name, email)', { count: 'exact' }).eq('product.is_serialized', true).order('id').range(from, to).abortSignal(signal)),
    readPages<ReconciliationInstallation>((from, to) => db.from('installations').select('id, client_id, contract_id, status', { count: 'exact' }).order('id').range(from, to).abortSignal(signal)),
    readPages<ReconciliationClosure>((from, to) => db.from('work_order_closures').select('id, job_id, client_id, ont_serial, created_at', { count: 'exact' }).eq('job_type', 'installation').not('ont_serial', 'is', null).order('id').range(from, to).abortSignal(signal)),
    readPages<ReconciliationTicket>((from, to) => db.from('tickets').select('id, client_id, contract_id, status', { count: 'exact' }).order('id').range(from, to).abortSignal(signal)),
    readPages<ReconciliationClosure>((from, to) => db.from('work_order_closures').select('id, job_id, client_id, ont_serial, created_at', { count: 'exact' }).eq('job_type', 'ticket').not('ont_serial', 'is', null).order('id').range(from, to).abortSignal(signal)),
  ]);
  return {
    rows: reconcileInventory(units, installations, closures, tickets, ticketClosures),
    counts: { units: units.length, installations: installations.length, closures: closures.length, tickets: tickets.length, ticketClosures: ticketClosures.length },
  };
}
