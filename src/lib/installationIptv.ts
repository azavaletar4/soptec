import type { Installation, ServiceContract } from '@/types/domain';

export type IptvInstallationMode = 'smart_tv_app' | 'customer_device' | 'rayco_tv_box';
export const IPTV_INSTALLATION_OPTIONS: { value: IptvInstallationMode; label: string }[] = [
  { value: 'smart_tv_app', label: 'Aplicación en Smart TV' },
  { value: 'customer_device', label: 'Dispositivo propio del cliente' },
  { value: 'rayco_tv_box', label: 'TV Box entregado por Rayco' },
];
export function iptvModeLabel(mode: unknown): string {
  return IPTV_INSTALLATION_OPTIONS.find(o => o.value === mode)?.label ?? 'Sin registrar';
}
export function requiresIptvMode(
  installation: Pick<Installation, 'contract_id' | 'client_id' | 'iptv_policy_version'> | null | undefined,
  contract: Pick<ServiceContract, 'id' | 'client_id' | 'service_type' | 'xui_line_id'> | null | undefined,
): boolean {
  return installation?.iptv_policy_version === 1 && !!contract &&
    installation.contract_id === contract.id && installation.client_id === contract.client_id &&
    contract.service_type === 'internet_combo' && contract.xui_line_id != null;
}

/** Consulta la MISMA función de validación que usa el trigger. Sin escrituras. */
export async function prepareInstallationIptv(
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>,
  installation: Pick<Installation, 'id' | 'client_id' | 'contract_id' | 'iptv_policy_version' | 'iptv_installation_mode' | 'status'>,
  clientId: string | null, contractId: string | null, mode: unknown,
): Promise<{ patch: { iptv_installation_mode?: IptvInstallationMode | null }; alreadyCompleted: boolean }> {
  if (installation.client_id !== clientId || installation.contract_id !== contractId) {
    throw new Error('El cliente o contrato de la orden cambió. Recarga antes de cerrar.');
  }
  if (installation.status === 'completed' && installation.iptv_policy_version === 1 &&
      (installation.iptv_installation_mode ?? null) === (mode || null)) {
    return { patch: {}, alreadyCompleted: true }; // Respuesta perdida: solo lectura.
  }
  if (installation.status === 'completed' || installation.status === 'cancelled') {
    throw new Error('La orden ya está cerrada; no se modificará su modalidad IPTV.');
  }
  // Frontend compatible antes de migrar: SELECT * no exige las columnas nuevas.
  if (installation.iptv_policy_version == null) return { patch: {}, alreadyCompleted: false };
  if (installation.iptv_policy_version !== 1) throw new Error('Versión de instalación no reconocida. Recarga la aplicación.');
  const selected = mode == null || mode === '' ? null : mode;
  if (selected !== null && !IPTV_INSTALLATION_OPTIONS.some(o => o.value === selected)) {
    throw new Error('Selecciona una modalidad IPTV válida.');
  }
  const { data, error } = await rpc('installation_iptv_preflight', {
    p_installation_id: installation.id, p_contract_id: contractId, p_mode: selected,
  });
  if (error) throw error;
  const result = data as Record<string, unknown> | null;
  if (!result || result.installationId !== installation.id || result.contractId !== contractId ||
      result.clientId !== clientId || result.mode !== selected || result.valid !== true) {
    throw new Error('No se pudo verificar la modalidad IPTV de esta orden. Recarga antes de cerrar.');
  }
  return { patch: { iptv_installation_mode: selected as IptvInstallationMode | null }, alreadyCompleted: false };
}
