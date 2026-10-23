import type { ClientStatus, ContractStatus, InstallationStatus } from '../types/domain';

export interface ClientLifecycle {
  status: ClientStatus;
  service_contracts: { status: ContractStatus }[];
  installations: { status: InstallationStatus }[];
}

export const CLIENT_LIFECYCLE_SELECT = 'service_contracts(status), installations(status)';

export const OPEN_INSTALLATION_STATUSES = new Set<string>(['pending', 'scheduled', 'in_progress']);

// Una suspensión conserva la relación comercial. Una Alta abierta también,
// aunque la ficha o un contrato anterior sigan marcados como baja.
export function isRetiredClient(client: ClientLifecycle): boolean {
  if (client.installations.some((i) => OPEN_INSTALLATION_STATUSES.has(i.status))) return false;
  if (client.service_contracts.some((c) => c.status !== 'cancelled')) return false;
  return client.service_contracts.length > 0 || client.status === 'retired';
}

// Una ficha comercial sin servicio sigue siendo consultable, pero no es
// un abonado. El estado de la ficha por sí solo no acredita un servicio.
export function isCurrentSubscriber(client: ClientLifecycle): boolean {
  return !isRetiredClient(client) && client.service_contracts.length > 0;
}

export function clientLifecycleStatus(client: ClientLifecycle): ClientStatus {
  if (isRetiredClient(client)) return 'retired';
  if (client.service_contracts.some((c) => c.status === 'active')) return 'active';
  if (client.service_contracts.some((c) => c.status === 'suspended')) return 'suspended';
  if (client.installations.some((i) => OPEN_INSTALLATION_STATUSES.has(i.status))) return 'prospect';
  return client.status;
}

export function countClientLifecycles(clients: ClientLifecycle[]) {
  const counts = { active: 0, suspended: 0, prospect: 0, retired: 0 };
  for (const client of clients) counts[clientLifecycleStatus(client)]++;
  return counts;
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
