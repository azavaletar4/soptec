import { supabaseAdmin } from '../lib/supabaseAdmin';
import { runTelnetCommands } from '../telnet/client';
import { changeOntProfileCommands, type ZteInterfaceRef } from '../ssh/zteCommands';
import { mikrotikRequest, type MikrotikTarget } from '../mikrotik/client';

// Corte y reactivacion por deuda — ver comentario completo en la migracion
// Fase 25 (supabase/migrations/20260922030000_fase25_corte_por_deuda.sql).
//
// Diseno clave: service_contracts.plan_id (el plan CONTRATADO) nunca se
// toca durante el corte — solo se cambia lo que esta REALMENTE aplicado en
// la OLT (olt_onts.tcont_profile/traffic_profile/plan_id) y en MikroTik
// (service_contracts.mikrotik_profile) al plan marcado como
// "corte por deuda" (plans.is_debt_suspension_plan). Reactivar es solo
// volver a aplicar el plan_id original — no hace falta guardar "el plan de
// antes" en ningun lado nuevo.
//
// LIMITACION CONOCIDA: olt_onts se vincula por client_id, no por contract_id
// (no existe ese FK en el esquema actual). Si un cliente tiene mas de un
// contrato/ONT, el corte se aplica a TODAS las ONTs de ese cliente — para
// el caso comun (1 cliente = 1 ONT = 1 contrato) esto es correcto.

const GRACE_DAYS = Number(process.env.DEBT_HOLD_GRACE_DAYS ?? 7);

export interface DebtSuspensionPlan {
  id: string;
  name: string;
  mikrotik_profile: string | null;
  olt_tcont_profile: string | null;
  olt_traffic_profile: string | null;
}

async function getDebtSuspensionPlan(): Promise<DebtSuspensionPlan> {
  const { data, error } = await supabaseAdmin
    .from('plans')
    .select('id, name, mikrotik_profile, olt_tcont_profile, olt_traffic_profile')
    .eq('is_debt_suspension_plan', true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('No hay ningun plan marcado como "corte por deuda" (ver seccion Planes)');
  if (!data.olt_tcont_profile || !data.olt_traffic_profile) {
    throw new Error(`El plan "${data.name}" no tiene perfiles OLT (tcont/traffic) configurados`);
  }
  return data;
}

async function logEvent(contractId: string, eventType: 'flagged' | 'applied' | 'reactivated' | 'error', detail: string | null, invoiceId?: string | null) {
  await supabaseAdmin.from('debt_hold_events').insert({
    contract_id: contractId,
    event_type: eventType,
    invoice_id: invoiceId ?? null,
    detail,
  });
}

// ---- 1) Escaneo periodico: marca (no aplica nada) ----

export interface FlagResult {
  scanned: number;
  flagged: number;
  errors: number;
}

/**
 * Marca debt_hold_status='pending' en los contratos activos que tengan una
 * factura pendiente vencida hace >= DEBT_HOLD_GRACE_DAYS dias y que todavia
 * no esten marcados/aplicados. Idempotente: correrlo varias veces al dia no
 * duplica nada (solo actua sobre contratos en debt_hold_status='none').
 */
export async function flagOverdueContracts(): Promise<FlagResult> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - GRACE_DAYS);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const { data: overdueInvoices, error } = await supabaseAdmin
    .from('invoices')
    .select('id, contract_id, due_date')
    .eq('status', 'pending')
    .lte('due_date', cutoffIso)
    .order('due_date', { ascending: true });
  if (error) throw new Error(error.message);

  // La factura mas vieja por contrato (si tiene varias vencidas, se guarda esa).
  const oldestByContract = new Map<string, { id: string; due_date: string }>();
  for (const inv of overdueInvoices ?? []) {
    if (!oldestByContract.has(inv.contract_id)) oldestByContract.set(inv.contract_id, inv);
  }
  if (!oldestByContract.size) return { scanned: 0, flagged: 0, errors: 0 };

  const { data: contracts, error: contractsErr } = await supabaseAdmin
    .from('service_contracts')
    .select('id, status, debt_hold_status')
    .in('id', [...oldestByContract.keys()])
    .eq('status', 'active')
    .eq('debt_hold_status', 'none');
  if (contractsErr) throw new Error(contractsErr.message);

  let flagged = 0;
  let errors = 0;
  for (const contract of contracts ?? []) {
    const invoice = oldestByContract.get(contract.id)!;
    const { error: updateErr } = await supabaseAdmin
      .from('service_contracts')
      .update({ debt_hold_status: 'pending', debt_hold_flagged_at: new Date().toISOString(), debt_hold_invoice_id: invoice.id })
      .eq('id', contract.id)
      .eq('debt_hold_status', 'none'); // guarda contra doble-marcado si corrio en paralelo
    if (updateErr) {
      errors += 1;
      continue;
    }
    await logEvent(contract.id, 'flagged', `Factura vencida desde ${invoice.due_date}`, invoice.id);
    flagged += 1;
  }

  return { scanned: oldestByContract.size, flagged, errors };
}

// ---- 2) Aplicar el corte (confirmado por un humano) ----

export interface StepResult {
  ok: boolean;
  error?: string;
}

export interface ApplyResult {
  ok: boolean;
  mikrotik: StepResult;
  olt: StepResult;
}

async function findOnts(clientId: string) {
  const { data, error } = await supabaseAdmin
    .from('olt_onts')
    .select('id, olt_device_id, frame, slot, port, ont_id')
    .eq('client_id', clientId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function applyOltPlanToClientOnts(clientId: string, tcontProfile: string, trafficProfile: string, planId: string | null): Promise<StepResult> {
  const onts = await findOnts(clientId);
  if (!onts.length) return { ok: true }; // sin ONT vinculada: nada que cortar en la OLT, no es un error

  const deviceIds = [...new Set(onts.map((o) => o.olt_device_id))];
  const { data: devices, error: devErr } = await supabaseAdmin
    .from('olt_devices')
    .select('id, host, telnet_port, username, password')
    .in('id', deviceIds);
  if (devErr) return { ok: false, error: devErr.message };
  const deviceById = new Map((devices ?? []).map((d) => [d.id, d]));

  for (const ont of onts) {
    const device = deviceById.get(ont.olt_device_id);
    if (!device) return { ok: false, error: `OLT ${ont.olt_device_id} no encontrada` };
    const ref: ZteInterfaceRef = { shelf: ont.frame, slot: ont.slot, port: ont.port };
    try {
      await runTelnetCommands(
        { host: device.host, port: device.telnet_port, username: device.username, password: device.password },
        changeOntProfileCommands(ref, ont.ont_id, tcontProfile, trafficProfile),
      );
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Error al cambiar el plan en la OLT' };
    }
    const { error: updErr } = await supabaseAdmin
      .from('olt_onts')
      .update({ tcont_profile: tcontProfile, traffic_profile: trafficProfile, plan_id: planId })
      .eq('id', ont.id);
    if (updErr) return { ok: false, error: updErr.message };
  }
  return { ok: true };
}

async function applyMikrotikProfile(contract: { mikrotik_device_id: string | null; pppoe_username: string | null }, profile: string): Promise<StepResult> {
  if (!contract.mikrotik_device_id || !contract.pppoe_username) return { ok: true }; // sin PPPoE vinculado, nada que cortar ahi
  const { data: device, error: devErr } = await supabaseAdmin
    .from('mikrotik_devices')
    .select('host, port, use_tls, username, password')
    .eq('id', contract.mikrotik_device_id)
    .single();
  if (devErr || !device) return { ok: false, error: devErr?.message ?? 'Router no encontrado' };
  const target: MikrotikTarget = { host: device.host, port: device.port, useTls: device.use_tls, username: device.username, password: device.password };

  try {
    const secrets = await mikrotikRequest<Array<{ '.id': string; name: string }>>(target, '/ppp/secret');
    const secret = secrets.find((s) => s.name === contract.pppoe_username);
    if (!secret) return { ok: false, error: `Secreto PPPoE "${contract.pppoe_username}" no encontrado en el router` };
    await mikrotikRequest(target, `/ppp/secret/${secret['.id']}`, { method: 'PATCH', body: { profile } });

    // Forzar reconexion para que tome el profile nuevo ya (RouterOS no
    // renegocia una sesion PPPoE ya conectada) — mismo criterio que
    // syncMikrotikProfile en ClientDetailView.vue.
    const active = await mikrotikRequest<Array<{ '.id': string; name: string }>>(target, '/ppp/active');
    const session = active.find((a) => a.name === contract.pppoe_username);
    if (session) await mikrotikRequest(target, `/ppp/active/${session['.id']}`, { method: 'DELETE' });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error al aplicar el profile en MikroTik' };
  }
  return { ok: true };
}

/** Aplica el corte real: cambia el plan en la OLT y el profile en MikroTik al de "corte por deuda". */
export async function applyDebtHold(contractId: string): Promise<ApplyResult> {
  const { data: contract, error } = await supabaseAdmin
    .from('service_contracts')
    .select('id, client_id, status, debt_hold_status, mikrotik_device_id, pppoe_username, mikrotik_profile')
    .eq('id', contractId)
    .single();
  if (error || !contract) throw new Error('Contrato no encontrado');
  if (contract.debt_hold_status === 'suspended') throw new Error('Este contrato ya tiene el corte aplicado');

  const debtPlan = await getDebtSuspensionPlan();

  const olt = await applyOltPlanToClientOnts(contract.client_id, debtPlan.olt_tcont_profile!, debtPlan.olt_traffic_profile!, debtPlan.id);
  const mikrotik = debtPlan.mikrotik_profile
    ? await applyMikrotikProfile(contract, debtPlan.mikrotik_profile)
    : { ok: true };

  const ok = olt.ok && mikrotik.ok;
  const detail = [olt.ok ? null : `OLT: ${olt.error}`, mikrotik.ok ? null : `MikroTik: ${mikrotik.error}`].filter(Boolean).join(' · ');

  if (ok) {
    await supabaseAdmin
      .from('service_contracts')
      .update({
        debt_hold_status: 'suspended',
        debt_hold_applied_at: new Date().toISOString(),
        mikrotik_profile_before_hold: contract.mikrotik_profile,
        // Reflejar en la base lo que realmente quedo aplicado en el router
        // (si no, la ficha del cliente seguiria mostrando el perfil viejo).
        ...(mikrotik.ok && debtPlan.mikrotik_profile ? { mikrotik_profile: debtPlan.mikrotik_profile } : {}),
      })
      .eq('id', contractId);
    await logEvent(contractId, 'applied', `Plan de corte aplicado: ${debtPlan.name}`);
  } else {
    // No se deja a medias en un estado que diga "todo bien" — queda en
    // 'pending' (nunca pasa a 'suspended') y el error queda auditado para
    // reintentar. Lo que SI se haya aplicado (ej. OLT ok, MikroTik fallo)
    // queda aplicado — no se revierte automaticamente para no encadenar
    // mas llamadas que tambien puedan fallar; el reintento manual vuelve a
    // aplicar ambos pasos (son idempotentes).
    await logEvent(contractId, 'error', detail || 'Error desconocido al aplicar el corte');
  }

  return { ok, mikrotik, olt };
}

// ---- 3) Reactivar (pago o accion manual) ----

export async function reactivateContract(contractId: string): Promise<ApplyResult> {
  const { data: contract, error } = await supabaseAdmin
    .from('service_contracts')
    .select('id, client_id, plan_id, debt_hold_status, mikrotik_device_id, pppoe_username, mikrotik_profile_before_hold, plans(olt_tcont_profile, olt_traffic_profile)')
    .eq('id', contractId)
    .single();
  if (error || !contract) throw new Error('Contrato no encontrado');
  if (contract.debt_hold_status === 'none') throw new Error('Este contrato no esta en corte por deuda');

  const plan = contract.plans as unknown as { olt_tcont_profile: string | null; olt_traffic_profile: string | null } | null;
  if (!plan?.olt_tcont_profile || !plan?.olt_traffic_profile) {
    throw new Error('El plan contratado de este cliente no tiene perfiles OLT configurados — no se puede restaurar automaticamente');
  }

  const olt = await applyOltPlanToClientOnts(contract.client_id, plan.olt_tcont_profile, plan.olt_traffic_profile, contract.plan_id);
  const mikrotik = contract.mikrotik_profile_before_hold
    ? await applyMikrotikProfile(contract, contract.mikrotik_profile_before_hold)
    : { ok: true };

  const ok = olt.ok && mikrotik.ok;
  const detail = [olt.ok ? null : `OLT: ${olt.error}`, mikrotik.ok ? null : `MikroTik: ${mikrotik.error}`].filter(Boolean).join(' · ');

  if (ok) {
    await supabaseAdmin
      .from('service_contracts')
      .update({
        debt_hold_status: 'none',
        debt_hold_flagged_at: null,
        debt_hold_applied_at: null,
        debt_hold_invoice_id: null,
        mikrotik_profile_before_hold: null,
        // Reflejar en la base el perfil realmente restaurado en el router.
        ...(mikrotik.ok && contract.mikrotik_profile_before_hold ? { mikrotik_profile: contract.mikrotik_profile_before_hold } : {}),
      })
      .eq('id', contractId);
    await logEvent(contractId, 'reactivated', 'Plan contratado restaurado');
  } else {
    await logEvent(contractId, 'error', detail || 'Error desconocido al reactivar');
  }

  return { ok, mikrotik, olt };
}

/** true si el contrato tiene alguna factura pendiente ya vencida (para decidir si reactivar al pagar una). */
export async function hasOverdueInvoices(contractId: string, excludeInvoiceId?: string): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  let query = supabaseAdmin
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('contract_id', contractId)
    .eq('status', 'pending')
    .lt('due_date', today);
  if (excludeInvoiceId) query = query.neq('id', excludeInvoiceId);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}
