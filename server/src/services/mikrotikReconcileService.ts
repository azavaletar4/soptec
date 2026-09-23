import { supabaseAdmin } from '../lib/supabaseAdmin';
import { mikrotikRequest, type MikrotikTarget } from '../mikrotik/client';

// Reconciliacion MikroTik -> Panel (Fase 31). RouterOS no tiene forma de
// avisar solo cuando algo cambia (no hay webhooks nativos de PPP secret) —
// la unica forma real de detectar un cambio hecho directo en Winbox/WebFig
// es sondear /ppp/secret periodicamente y comparar contra la BD.
//
// Que se auto-sincroniza vs. que solo se reporta (decision de producto):
//   - mikrotik_profile (cache local, solo informativo): se actualiza solo,
//     es un campo no critico y ya viene de MikroTik en primer lugar.
//   - password: NUNCA se auto-sobrescribe ni se lee siquiera (el panel no
//     guarda la clave PPPoE en ningun lado — vive solo en MikroTik).
//   - estado habilitado/deshabilitado vs. contract.status: solo se REPORTA.
//     Cambiar el status de un contrato automaticamente por lo que se ve en
//     el router es demasiado riesgoso (dispara facturacion/OLT) — lo decide
//     una persona.

interface MikrotikDeviceRow {
  id: string;
  name: string;
  host: string;
  port: number;
  use_tls: boolean;
  username: string;
  password: string;
}

interface ContractRow {
  id: string;
  contract_number: string;
  status: string;
  pppoe_username: string;
  mikrotik_profile: string | null;
}

interface MikrotikSecret {
  '.id': string;
  name: string;
  profile?: string;
  disabled?: string;
}

export interface ReconcileMismatch {
  contractId: string;
  contractNumber: string;
  deviceName: string;
  pppoeUsername: string;
  kind: 'profile_actualizado' | 'secreto_no_encontrado' | 'estado_inconsistente';
  detail: string;
}

export interface ReconcileReport {
  ranAt: string;
  devicesChecked: number;
  contractsChecked: number;
  profilesUpdated: number;
  mismatches: ReconcileMismatch[];
  errors: { deviceName: string; message: string }[];
}

let lastReport: ReconcileReport | null = null;

export function getLastReconcileReport(): ReconcileReport | null {
  return lastReport;
}

export async function reconcileMikrotik(): Promise<ReconcileReport> {
  const { data: devices, error: devErr } = await supabaseAdmin
    .from('mikrotik_devices')
    .select('id, name, host, port, use_tls, username, password')
    .eq('is_active', true);
  if (devErr) throw new Error(devErr.message);

  const mismatches: ReconcileMismatch[] = [];
  const errors: { deviceName: string; message: string }[] = [];
  let contractsChecked = 0;
  let profilesUpdated = 0;

  for (const device of (devices ?? []) as MikrotikDeviceRow[]) {
    const target: MikrotikTarget = { host: device.host, port: device.port, useTls: device.use_tls, username: device.username, password: device.password };

    let secrets: MikrotikSecret[];
    try {
      secrets = await mikrotikRequest<MikrotikSecret[]>(target, '/ppp/secret');
    } catch (e) {
      errors.push({ deviceName: device.name, message: e instanceof Error ? e.message : 'Error al consultar el router' });
      continue;
    }
    const secretByUsername = new Map(secrets.map((s) => [s.name, s]));

    const { data: contracts, error: ctErr } = await supabaseAdmin
      .from('service_contracts')
      .select('id, contract_number, status, pppoe_username, mikrotik_profile')
      .eq('mikrotik_device_id', device.id)
      .not('pppoe_username', 'is', null);
    if (ctErr) {
      errors.push({ deviceName: device.name, message: ctErr.message });
      continue;
    }

    for (const contract of (contracts ?? []) as ContractRow[]) {
      contractsChecked++;
      const secret = secretByUsername.get(contract.pppoe_username);

      if (!secret) {
        mismatches.push({
          contractId: contract.id,
          contractNumber: contract.contract_number,
          deviceName: device.name,
          pppoeUsername: contract.pppoe_username,
          kind: 'secreto_no_encontrado',
          detail: `El usuario PPPoE "${contract.pppoe_username}" ya no existe en ${device.name} (¿se borro desde Winbox?).`,
        });
        continue;
      }

      if (secret.profile && secret.profile !== contract.mikrotik_profile) {
        const prev = contract.mikrotik_profile ?? '—';
        const { error: updErr } = await supabaseAdmin
          .from('service_contracts')
          .update({ mikrotik_profile: secret.profile })
          .eq('id', contract.id);
        if (updErr) {
          errors.push({ deviceName: device.name, message: `No se pudo actualizar el contrato ${contract.contract_number}: ${updErr.message}` });
        } else {
          profilesUpdated++;
          mismatches.push({
            contractId: contract.id,
            contractNumber: contract.contract_number,
            deviceName: device.name,
            pppoeUsername: contract.pppoe_username,
            kind: 'profile_actualizado',
            detail: `Perfil actualizado de "${prev}" a "${secret.profile}" (cambiado directo en MikroTik).`,
          });
        }
      }

      const shouldBeEnabled = contract.status === 'active';
      const isEnabled = secret.disabled !== 'true';
      if (shouldBeEnabled !== isEnabled) {
        mismatches.push({
          contractId: contract.id,
          contractNumber: contract.contract_number,
          deviceName: device.name,
          pppoeUsername: contract.pppoe_username,
          kind: 'estado_inconsistente',
          detail: `Contrato "${contract.status}", pero el secreto esta ${isEnabled ? 'HABILITADO' : 'DESHABILITADO'} en ${device.name} — revisar a mano.`,
        });
      }
    }
  }

  lastReport = {
    ranAt: new Date().toISOString(),
    devicesChecked: (devices ?? []).length,
    contractsChecked,
    profilesUpdated,
    mismatches,
    errors,
  };
  return lastReport;
}
