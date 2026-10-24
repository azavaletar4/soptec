import { supabaseAdmin } from '../lib/supabaseAdmin';
import { mikrotikRequest, type MikrotikTarget } from '../mikrotik/client';
import { isPppoeAdminRole } from '../mikrotik/deviceRole';

// Reconciliacion MikroTik -> Panel (Fase 31). RouterOS no tiene forma de
// avisar solo cuando algo cambia (no hay webhooks nativos de PPP secret) —
// la unica forma real de detectar un cambio hecho directo en Winbox/WebFig
// es sondear /ppp/secret periodicamente y comparar contra la BD.
//
// Fase 173: la reconciliacion esta SIEMPRE acotada a UN router administrador
// PPPoE a la vez (nunca "todos los routers" en una sola llamada) — tanto la
// corrida manual (boton "Reconciliar ahora" en el detalle de ESE router)
// como la corrida automatica (el scheduler la llama una vez por cada router
// pppoe_admin, ver mikrotikReconcileScheduler.ts) usan esta misma funcion.
// Nunca procesa un router de borde (dedicado o balanceador) — un balanceador
// real puede tener decenas de interfaces PPPoE-WAN hacia el PROVEEDOR
// (ver captura Winbox, Fase 173) que NO son abonados de SmartRayco; si se
// llegaran a leer como secretos PPPoE se contarian como "contratos" por
// error. El guard de device_role aplica ANTES de pedirle nada al router.
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
//
// La asociacion contrato <-> router <-> usuario PPPoE nunca es ambigua en
// este diseño: cada contrato se compara EXCLUSIVAMENTE contra los secretos
// del router que su propio `mikrotik_device_id` señala (nunca "cualquier
// router administrador", ver `.eq('mikrotik_device_id', device.id)` abajo)
// — si dos routers administradores tuvieran por coincidencia un secreto con
// el mismo nombre de usuario, un contrato vinculado al router A jamas se
// compara contra los secretos del router B.

interface MikrotikDeviceRow {
  id: string;
  name: string;
  host: string;
  port: number;
  use_tls: boolean;
  username: string;
  password: string;
  device_role: string;
  is_active: boolean;
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
  deviceId: string;
  deviceName: string;
  contractsChecked: number;
  profilesUpdated: number;
  mismatches: ReconcileMismatch[];
  error: string | null;
}

// Fase 173: un reporte por router (nunca uno global compartido) — "Varios
// routers administradores: resultados aislados por dispositivo".
const lastReportByDevice = new Map<string, ReconcileReport>();

export function getLastReconcileReport(deviceId: string): ReconcileReport | null {
  return lastReportByDevice.get(deviceId) ?? null;
}

/**
 * Reconcilia UN SOLO router (nunca "todos"). Rechaza explicitamente
 * cualquier router que no sea `device_role='pppoe_admin'` — defensa en
 * profundidad, independiente de que la ruta HTTP ya valide lo mismo antes
 * de llamar aqui (nunca confiar solo en la restriccion visual/de ruta).
 */
export async function reconcileMikrotikDevice(deviceId: string): Promise<ReconcileReport> {
  const { data: device, error: devErr } = await supabaseAdmin
    .from('mikrotik_devices')
    .select('id, name, host, port, use_tls, username, password, device_role, is_active')
    .eq('id', deviceId)
    .single();
  if (devErr || !device) throw new Error('Router no encontrado');
  const row = device as MikrotikDeviceRow;
  if (!isPppoeAdminRole(row.device_role)) {
    throw new Error(`"${row.name}" esta clasificado como router de borde — la reconciliacion PPPoE solo aplica al administrador`);
  }

  const now = new Date();
  const mismatches: ReconcileMismatch[] = [];
  let contractsChecked = 0;
  let profilesUpdated = 0;
  let runError: string | null = null;

  const target: MikrotikTarget = { host: row.host, port: row.port, useTls: row.use_tls, username: row.username, password: row.password };

  let secrets: MikrotikSecret[] = [];
  try {
    secrets = await mikrotikRequest<MikrotikSecret[]>(target, '/ppp/secret');
  } catch (e) {
    runError = e instanceof Error ? e.message : 'Error al consultar el router';
  }

  if (!runError) {
    const secretByUsername = new Map(secrets.map((s) => [s.name, s]));

    // Solo los contratos que ESTE router (por su propio mikrotik_device_id)
    // dice administrar — nunca "cualquier contrato con pppoe_username".
    const { data: contracts, error: ctErr } = await supabaseAdmin
      .from('service_contracts')
      .select('id, contract_number, status, pppoe_username, mikrotik_profile')
      .eq('mikrotik_device_id', row.id)
      .not('pppoe_username', 'is', null);
    if (ctErr) {
      runError = ctErr.message;
    } else {
      for (const contract of (contracts ?? []) as ContractRow[]) {
        contractsChecked++;
        const secret = secretByUsername.get(contract.pppoe_username);

        if (!secret) {
          mismatches.push({
            contractId: contract.id,
            contractNumber: contract.contract_number,
            deviceName: row.name,
            pppoeUsername: contract.pppoe_username,
            kind: 'secreto_no_encontrado',
            detail: `El usuario PPPoE "${contract.pppoe_username}" ya no existe en ${row.name} (¿se borro desde Winbox?).`,
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
            mismatches.push({
              contractId: contract.id,
              contractNumber: contract.contract_number,
              deviceName: row.name,
              pppoeUsername: contract.pppoe_username,
              kind: 'estado_inconsistente',
              detail: `No se pudo actualizar el perfil: ${updErr.message}`,
            });
          } else {
            profilesUpdated++;
            mismatches.push({
              contractId: contract.id,
              contractNumber: contract.contract_number,
              deviceName: row.name,
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
            deviceName: row.name,
            pppoeUsername: contract.pppoe_username,
            kind: 'estado_inconsistente',
            detail: `Contrato "${contract.status}", pero el secreto esta ${isEnabled ? 'HABILITADO' : 'DESHABILITADO'} en ${row.name} — revisar a mano.`,
          });
        }
      }
    }
  }

  const report: ReconcileReport = {
    ranAt: now.toISOString(),
    deviceId: row.id,
    deviceName: row.name,
    contractsChecked,
    profilesUpdated,
    mismatches,
    error: runError,
  };
  lastReportByDevice.set(row.id, report);
  return report;
}

/** IDs de todos los routers administradores PPPoE activos — usado solo por el scheduler automatico. */
export async function listPppoeAdminDeviceIds(): Promise<string[]> {
  const { data, error } = await supabaseAdmin.from('mikrotik_devices').select('id').eq('is_active', true).eq('device_role', 'pppoe_admin');
  if (error) throw new Error(error.message);
  return (data ?? []).map((d) => d.id as string);
}

// ---- Fase 173, requisito 8: deteccion de contratos mal asociados ----
// Un contrato con pppoe_username + mikrotik_device_id apuntando a un router
// que NO es administrador PPPoE (dedicado o balanceador) nunca se evalua en
// reconcileMikrotikDevice (ningun router de borde entra a ese loop) — por
// lo tanto esa inconsistencia quedaria invisible para siempre si nadie la
// reporta. Esto es SOLO LECTURA + informe (nunca modifica el contrato).

export interface ContractLinkedToNonAdminRouter {
  contractId: string;
  contractNumber: string;
  pppoeUsername: string;
  deviceId: string;
  deviceName: string;
  deviceRole: string;
}

/** Pura: separa los que estan mal asociados — reutilizable en pruebas sin tocar la BD. */
export function filterContractsLinkedToNonAdminRouter(
  rows: ContractLinkedToNonAdminRouter[],
): ContractLinkedToNonAdminRouter[] {
  return rows.filter((r) => r.deviceRole !== 'pppoe_admin');
}

interface ContractWithDeviceRoleRow {
  id: string;
  contract_number: string;
  pppoe_username: string;
  mikrotik_device_id: string;
  mikrotik_devices: { name: string; device_role: string } | { name: string; device_role: string }[] | null;
}

export async function findContractsLinkedToNonAdminRouter(): Promise<ContractLinkedToNonAdminRouter[]> {
  const { data, error } = await supabaseAdmin
    .from('service_contracts')
    .select('id, contract_number, pppoe_username, mikrotik_device_id, mikrotik_devices(name, device_role)')
    .not('pppoe_username', 'is', null)
    .not('mikrotik_device_id', 'is', null);
  if (error) throw new Error(error.message);

  const rows: ContractLinkedToNonAdminRouter[] = ((data ?? []) as unknown as ContractWithDeviceRoleRow[]).map((c) => {
    const device = Array.isArray(c.mikrotik_devices) ? c.mikrotik_devices[0] : c.mikrotik_devices;
    return {
      contractId: c.id,
      contractNumber: c.contract_number,
      pppoeUsername: c.pppoe_username,
      deviceId: c.mikrotik_device_id,
      deviceName: device?.name ?? '—',
      deviceRole: device?.device_role ?? 'pppoe_admin',
    };
  });
  return filterContractsLinkedToNonAdminRouter(rows);
}
