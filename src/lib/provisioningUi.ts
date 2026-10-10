/** Works on the panel's HTTP LAN origin as well as HTTPS. */
export function createProvisioningKey(cryptoApi: Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>> = globalThis.crypto): string {
  if (typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface ProvisioningUiResult {
  operation: { status: string; contract_id?: string | null; requested?: Record<string, unknown> };
  outcome: { kind: string };
  ont: unknown | null;
  persistenceWarning?: string;
  mikrotikError?: string;
  wanError?: string;
}
export function classifyProvisioningResult(result: ProvisioningUiResult): { complete: boolean; oltOk: boolean; warnings: string[] } {
  const oltOk = ['registered', 'already_registered'].includes(result.outcome.kind);
  const warnings = [result.persistenceWarning, result.mikrotikError, result.wanError].filter((s): s is string => !!s);
  if (oltOk && (result.operation.contract_id || result.operation.requested?.mikrotik) && !result.operation.requested?.wan) {
    warnings.push('WAN en modo manual: SmartRayco no envio credenciales a la ONU. Configura o verifica la WAN desde la web de la ONT; el registro no confirma navegacion.');
  }
  const complete = oltOk && !!result.ont && result.operation.status === 'completed' && !result.persistenceWarning;
  if (oltOk && !complete && !warnings.length) warnings.push('Quedan etapas pendientes; verifica la operacion antes de reintentar.');
  return { complete, oltOk, warnings };
}

/** An omitted WAN is an explicit choice, never an implicit missing password. */
export function validateProvisioningWan(deferred: boolean, password: string): string | null {
  if (!deferred && !password.trim()) return 'Ingresa la contraseña PPPoE para configurar la WAN de la ONU, o selecciona configurar WAN después.';
  return null;
}

/** A live scan always wins. Cached pending rows predate a confirmed new registration. */
export function filterStalePendingOnus<T extends { serial: string; frame: number; slot: number | null; port: number | null }>(
  items: T[],
  registrations: { serial: string; frame: number; slot: number; port: number; created_at: string; contract_id?: string | null }[],
  checkedAt: string | null,
  live: boolean,
): T[] {
  const cutoff = Date.parse(checkedAt ?? '');
  if (live || !Number.isFinite(cutoff)) return items;
  return items.filter(item => !registrations.some(ont =>
    !!ont.contract_id && Date.parse(ont.created_at) > cutoff &&
    ont.serial.trim().toUpperCase() === item.serial.trim().toUpperCase() &&
    ont.frame === item.frame && ont.slot === item.slot && ont.port === item.port,
  ));
}
