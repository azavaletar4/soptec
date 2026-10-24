// Fase 174b — helpers puros de presentación para las alertas de
// caida/recuperacion de enlaces WAN del balanceador (sesiones PPPoE y
// puertos fisicos SFP). Sin red/Supabase aquí a propósito.

export type WanLinkKind = 'pppoe_connection' | 'physical_port';
export type WanLinkAlertStatus = 'active' | 'resolved';

/**
 * Requisito 3 (mensajes claros, priorizados por tipo de enlace+evento):
 * "Se perdió la conexión del proveedor" / "Conexión recuperada" para
 * sesiones PPPoE, "Puerto SFP sin enlace" / "Puerto SFP recuperado" para
 * puertos físicos. "Conexión deshabilitada administrativamente" no es un
 * evento de ESTA lista -- es el estado informativo ya mostrado en la tabla
 * de conexiones (ver connectionStatusLabel en MikrotikDetailView.vue).
 */
export function wanLinkAlertLabel(linkKind: WanLinkKind, status: WanLinkAlertStatus): string {
  if (linkKind === 'pppoe_connection') {
    return status === 'active' ? 'Se perdió la conexión del proveedor' : 'Conexión recuperada';
  }
  return status === 'active' ? 'Puerto SFP sin enlace' : 'Puerto SFP recuperado';
}

export function wanLinkAlertBadgeClass(status: WanLinkAlertStatus): string {
  return status === 'active' ? 'bg-red-500/15 text-red-600' : 'bg-emerald-500/15 text-emerald-600';
}

/**
 * Duración de la interrupción (requisito: "cuando se pueda calcular") --
 * entre `startIso` y `endIso` (alerta ya resuelta) o `nowMs` (todavía
 * activa, "lleva..."). Nunca inventa el instante físico exacto: ambos
 * extremos vienen de cuando SmartRayco detectó el cambio, no de una
 * estimación.
 */
export function formatWanLinkAlertDuration(startIso: string, endIso: string | null, nowMs: number): string {
  const startMs = new Date(startIso).getTime();
  const endMs = endIso ? new Date(endIso).getTime() : nowMs;
  const totalMinutes = Math.max(0, Math.floor((endMs - startMs) / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} día${days === 1 ? '' : 's'}`);
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes} min`);
  return parts.join(', ');
}
