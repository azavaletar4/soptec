import { classifyClientSection, type ClientLifecycle } from './clientLifecycle';

// Prospectos operativos = fichas en Clientes / Pendientes de instalación.
// No equivale al CRM comercial ni a contrataciones canceladas nunca instaladas.
export function countPendingInstallationClients(rows: (ClientLifecycle & { id: string })[]) {
  return new Set(rows.filter(row => classifyClientSection(row) === 'pending_install').map(row => row.id)).size;
}
