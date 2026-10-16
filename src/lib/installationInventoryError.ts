import { getErrorMessage } from './errors';
import type { InstallationStatus } from '../types/domain';

/**
 * El RPC niega materiales/equipos de una instalacion CANCELADA al tecnico a
 * proposito (ver inventory_order_read, errcode 42501 "Estado de orden no
 * autorizado") — no es un fallo que explicar, es lo mismo que "sin nada
 * registrado" en cualquier otra orden. Cualquier otro caso (retirado de la
 * cuadrilla, sesion vencida, etc.) conserva su mensaje real.
 */
export function presentInstallationInventoryError(status: InstallationStatus | undefined, error: unknown): string {
  if (status === 'cancelled') return '';
  return getErrorMessage(error, 'No se pudo cargar el inventario de esta instalación.');
}
