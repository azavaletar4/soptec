import type { ClientStatus, ContractStatus, InstallationStatus } from '../types/domain';

export interface ClientLifecycle {
  status: ClientStatus;
  service_contracts: { status: ContractStatus }[];
  installations: { status: InstallationStatus }[];
}

export const CLIENT_LIFECYCLE_SELECT = 'service_contracts(status), installations(status)';

export const OPEN_INSTALLATION_STATUSES = new Set<string>(['pending', 'scheduled', 'in_progress']);

// Cuatro secciones reales para el listado de Clientes (distinto del CRM de
// Prospectos comerciales, tabla `prospects` — ese sigue intacto y separado):
//   - current: tiene un contrato vigente (activo o suspendido) y no hay
//     ninguna Alta todavía abierta para esa ficha.
//   - pending_install: hay una Alta abierta (pending/scheduled/in_progress)
//     para esta ficha — con contrato vigente o sin él (Alta independiente,
//     ver CLAUDE.md "Migración OLT"). Prioridad siempre sobre las demás: una
//     Alta en curso nunca se confunde con "nunca instalado" ni "retirado".
//   - unfulfilled: todos los contratos quedaron cancelados y NUNCA hubo una
//     instalación completada para esta ficha — contratación que no llegó a
//     concretarse (ver contract_cancel_unfulfilled,
//     docs/CLIENTES-CONTRATACION-NO-INSTALADA.md). Nunca es un abonado ni un
//     ex-abonado real.
//   - retired: todos los contratos cancelados y hubo una instalación
//     completada alguna vez (ex-abonado real), o no hay evidencia de
//     instalación en absoluto y la propia ficha ya dice 'retired'.
//
// Importante, verificado contra datos reales de producción antes de escribir
// esto (2026-11-02): de 742 contratos vigentes, solo 65 (8.8%) tienen una
// instalación con estado 'completed' vinculada — 674 son clientes reales sin
// ningún registro de instalación (el seguimiento de Altas es posterior a
// gran parte de la migración). Por eso la señal de "Pendientes de
// instalación" es la EXISTENCIA de una Alta abierta, nunca la AUSENCIA de
// una completada — lo segundo habría reclasificado mal al 90% de los
// abonados reales. Mismo motivo por el que, con contratos todos cancelados y
// CERO instalaciones registradas (sin evidencia alguna, ni completada ni
// cancelada), se respeta el estado crudo de la ficha en vez de asumir
// "nunca instalado": los 2 casos reales confirmados de este patrón en
// producción ya están en 'retired'.
export type ClientSection = 'current' | 'pending_install' | 'unfulfilled' | 'retired';

export function classifyClientSection(client: ClientLifecycle): ClientSection {
  if (client.installations.some((i) => OPEN_INSTALLATION_STATUSES.has(i.status))) return 'pending_install';
  const vigente = client.service_contracts.some((c) => c.status === 'active' || c.status === 'suspended');
  if (vigente) return 'current';
  if (!client.service_contracts.length) return client.status === 'retired' ? 'retired' : 'current';
  // De aquí en más, todos los contratos de esta ficha están cancelados.
  if (client.installations.some((i) => i.status === 'completed')) return 'retired';
  if (client.installations.length) return 'unfulfilled'; // evidencia directa: hubo un intento, nunca se completó
  return client.status === 'prospect' ? 'unfulfilled' : 'retired'; // sin evidencia alguna: se respeta la ficha
}

export function isRetiredClient(client: ClientLifecycle): boolean {
  return classifyClientSection(client) === 'retired';
}

export function clientLifecycleStatus(client: ClientLifecycle): ClientStatus {
  const section = classifyClientSection(client);
  if (section === 'retired') return 'retired';
  if (section === 'unfulfilled') return 'prospect';
  if (client.service_contracts.some((c) => c.status === 'active')) return 'active';
  if (client.service_contracts.some((c) => c.status === 'suspended')) return 'suspended';
  if (section === 'pending_install') return 'prospect'; // Alta independiente, sin contrato vigente
  return client.status; // ficha sin ningún contrato: se respeta el estado crudo
}

export function countClientLifecycles(clients: ClientLifecycle[]) {
  const counts = { active: 0, suspended: 0, prospect: 0, retired: 0 };
  for (const client of clients) counts[clientLifecycleStatus(client)]++;
  return counts;
}

// Columna "Servicios" de ClientesView.vue: separa, por contrato, lo vigente
// (activo o suspendido — mismo criterio que `vigente` en classifyClientSection)
// de lo histórico (cancelado). Es un conteo por contrato, independiente de la
// sección/categoría de la ficha (current/pending_install/unfulfilled/retired).
export function countServicesByVigencia(contracts: { status: ContractStatus }[]): { vigentes: number; historicos: number } {
  const vigentes = contracts.filter((c) => c.status === 'active' || c.status === 'suspended').length;
  return { vigentes, historicos: contracts.length - vigentes };
}

// "0 vigentes · 1 histórico" / "2 vigentes" / "1 vigente · 1 histórico" — el
// histórico solo se omite cuando no hay ninguno; el vigente siempre se
// muestra, incluso en 0, para que nunca se confunda con "sin datos".
export function formatServiceCounts(vigentes: number, historicos: number): string {
  const vigenteLabel = `${vigentes} vigente${vigentes === 1 ? '' : 's'}`;
  if (historicos === 0) return vigenteLabel;
  return `${vigenteLabel} · ${historicos} histórico${historicos === 1 ? '' : 's'}`;
}

// Avanza por filas recibidas: también funciona si PostgREST aplica un límite
// menor al solicitado. Un error nunca devuelve un total parcial como válido.
export async function readAllClientPages<T>(
  read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown; count?: number | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error, count } = await read(rows.length, rows.length + 499);
    if (error) throw error;
    if (!data?.length) return rows;
    rows.push(...data);
    if (count != null && rows.length >= count) return rows;
  }
}
