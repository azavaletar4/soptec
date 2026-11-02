// Filtros desplegables, orden tipo Excel y persistencia de la URL para la
// tabla de ClientesView.vue — logica pura, sin tocar clientLifecycle.ts
// (las 4 secciones reales y el Dashboard siguen exactamente igual).
import type { ClientStatus, ContractPriority } from '../types/domain';
import type { ClientSection } from './clientLifecycle';

export type ClientStatusFilter = 'all' | ClientStatus;
export type ServiceFilter = 'all' | 'vigente' | 'historico' | 'multi';
export type SortColumn = 'name' | 'status' | 'priority' | 'services';
export type SortDirection = 'asc' | 'desc';

export const CLIENT_SECTIONS: ClientSection[] = ['current', 'pending_install', 'unfulfilled', 'retired'];
export const CLIENT_STATUS_FILTERS: ClientStatusFilter[] = ['all', 'active', 'suspended', 'prospect', 'retired'];
export const SERVICE_FILTERS: ServiceFilter[] = ['all', 'vigente', 'historico', 'multi'];
export const SORT_COLUMNS: SortColumn[] = ['name', 'status', 'priority', 'services'];

const PRIORITY_RANK: Record<ContractPriority, number> = { low: 1, medium: 2, high: 3 };

// Un cliente puede tener varios contratos con distinta prioridad -- se
// ordena por la mas alta (la que de verdad amerita atencion primero). Sin
// ningun contrato, rango 0 (por debajo de "baja").
export function clientPriorityRank(priorities: ContractPriority[]): number {
  return priorities.reduce((max, p) => Math.max(max, PRIORITY_RANK[p] ?? 0), 0);
}

export function matchesStatusFilter(status: ClientStatus, filter: ClientStatusFilter): boolean {
  return filter === 'all' || status === filter;
}

export function matchesServiceFilter(
  counts: { vigentes: number; historicos: number; total: number },
  filter: ServiceFilter,
): boolean {
  switch (filter) {
    case 'all': return true;
    case 'vigente': return counts.vigentes > 0;
    case 'historico': return counts.historicos > 0;
    case 'multi': return counts.total >= 2;
  }
}

export interface SortableClientRow {
  id: string;
  name: string;
  statusLabel: string;
  priorityRank: number;
  serviceCount: number;
}

function compareClientRows(a: SortableClientRow, b: SortableClientRow, column: SortColumn): number {
  switch (column) {
    case 'name': return a.name.localeCompare(b.name, 'es');
    case 'status': return a.statusLabel.localeCompare(b.statusLabel, 'es');
    case 'priority': return a.priorityRank - b.priorityRank;
    case 'services': return a.serviceCount - b.serviceCount;
  }
}

// Orden estable: dos filas iguales por la columna elegida conservan su
// orden relativo original -- sin esto, la lista "saltaria" visualmente
// entre clics del mismo encabezado aunque nada cambio de verdad.
export function sortClientRows<T extends SortableClientRow>(rows: T[], column: SortColumn | null, direction: SortDirection): T[] {
  if (!column) return rows;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const cmp = compareClientRows(a.row, b.row, column);
      if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
      return a.index - b.index;
    })
    .map((w) => w.row);
}

export interface ClientsListQueryState {
  section: ClientSection;
  q: string;
  status: ClientStatusFilter;
  service: ServiceFilter;
  sort: SortColumn | null;
  dir: SortDirection;
}

export const DEFAULT_CLIENTS_LIST_QUERY: ClientsListQueryState = {
  section: 'current', q: '', status: 'all', service: 'all', sort: null, dir: 'asc',
};

function firstString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return '';
}

// Nunca confia en el query string tal cual (puede venir editado a mano o de
// un enlace viejo) -- cualquier valor fuera de las listas reales vuelve al
// valor por defecto en vez de romper el filtro o el select.
export function parseClientsListQuery(query: Record<string, unknown>): ClientsListQueryState {
  const section = firstString(query.section);
  const status = firstString(query.status);
  const service = firstString(query.service);
  const sort = firstString(query.sort);
  return {
    section: (CLIENT_SECTIONS as string[]).includes(section) ? (section as ClientSection) : DEFAULT_CLIENTS_LIST_QUERY.section,
    q: firstString(query.q),
    status: (CLIENT_STATUS_FILTERS as string[]).includes(status) ? (status as ClientStatusFilter) : 'all',
    service: (SERVICE_FILTERS as string[]).includes(service) ? (service as ServiceFilter) : 'all',
    sort: (SORT_COLUMNS as string[]).includes(sort) ? (sort as SortColumn) : null,
    dir: firstString(query.dir) === 'desc' ? 'desc' : 'asc',
  };
}

// Solo lleva a la URL lo que no es el valor por defecto -- limpia sin
// ningun filtro activo, en vez de "?section=current&q=&status=all&...".
export function buildClientsListQuery(state: ClientsListQueryState): Record<string, string> {
  const out: Record<string, string> = {};
  if (state.section !== DEFAULT_CLIENTS_LIST_QUERY.section) out.section = state.section;
  if (state.q.trim()) out.q = state.q.trim();
  if (state.status !== 'all') out.status = state.status;
  if (state.service !== 'all') out.service = state.service;
  if (state.sort) { out.sort = state.sort; out.dir = state.dir; }
  return out;
}
