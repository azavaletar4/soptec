import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const file = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const client = '30000000-0000-0000-0000-000000000001';
const otherClient = '30000000-0000-0000-0000-000000000002';
const ontProduct = '50000000-0000-0000-0000-000000000001'; // seed de closedOrdersSchema.sql, categoria 'onu'
const tvboxProduct = '50000000-0000-0000-0000-000000000003';

// Fase 73, texto literal tal como esta HOY en produccion (confirmado via
// pg_get_functiondef) -- es el punto de partida que el candidato Fase 167
// reemplaza; la guarda MD5 del candidato exige exactamente este cuerpo.
const FASE73_FUNCTION = `
create or replace function public.validate_installation_completion()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  svc_type public.contract_service_type := 'internet_combo';
  unit_count integer;
  contract_zone_id uuid;
  nap_count integer;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    if new.contract_id is null then
      raise exception 'Esta instalación no tiene un contrato vinculado; vincula uno antes de completarla (se necesita para mapear la Zona y la Caja NAP)';
    end if;

    select service_type, zone_id into svc_type, contract_zone_id
    from public.service_contracts where id = new.contract_id;

    if coalesce(svc_type, 'internet_combo') = 'internet_combo' then
      select count(*) into unit_count from public.inventory_units where installation_id = new.id;
      if unit_count = 0 then
        raise exception 'Para instalaciones de internet/combo debes asignar al menos un equipo por Serie/MAC';
      end if;
    end if;

    if contract_zone_id is null then
      raise exception 'Debes asignar la Zona del servicio antes de completar la instalación';
    end if;

    select count(*) into nap_count
    from public.fo_nap_puertos
    where contract_id = new.contract_id and estado = 'ocupado';
    if nap_count = 0 then
      raise exception 'Debes asignar la Caja NAP del servicio antes de completar la instalación';
    end if;
  end if;

  return new;
end;
$$;`;

test('Fase 167: ONT/TV Box obligatorios y verificados (categoria, estado, cliente/contrato) al cerrar una Alta — ruta real, sin saltarse por API', { timeout: 180000 }, async t => {
  const containerName = `smartrayco-f167-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) => execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const args = ['exec', '-i', containerName, 'psql', '-h', '127.0.0.1', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'];
  const sql = (s: string) => docker(args, s).trim();
  // El cierre real NUNCA pasa por un RPC de equipo dedicado: es un UPDATE
  // directo de installations.status (performClosureSubmit -> updateStatus,
  // el selector de Estado de ADMIN/SUPERADMIN, o cualquier llamada directa
  // vía PostgREST/API) -- se simula exactamente así, sin RPC alguno.
  const close = (id: string) => sql(`update installations set status='completed' where id='${id}';`);
  const status = (id: string) => sql(`select status from installations where id='${id}';`);

  let seq = 0;
  const uuid = (prefix: string) => `${prefix}${(++seq).toString().padStart(12, '0')}`;
  const newInstallation = (opts: { contractId: string; status?: string }) => {
    const id = uuid('60000000-0000-0000-0000-');
    sql(`insert into installations(id,status,client_id,contract_id) values('${id}','${opts.status ?? 'in_progress'}','${client}','${opts.contractId}');`);
    return id;
  };
  const newContract = (opts: { clientId?: string; zoneId?: string; nap?: boolean; xuiLineId?: number | null }) => {
    const id = uuid('31000000-0000-0000-0000-');
    const zoneId = opts.zoneId ?? uuid('90000000-0000-0000-0000-');
    sql(`insert into service_contracts(id,client_id,service_type,zone_id,xui_line_id) values('${id}','${opts.clientId ?? client}','internet_combo','${zoneId}',${opts.xuiLineId ?? 'null'});`);
    if (opts.nap !== false) sql(`insert into fo_nap_puertos(contract_id,estado) values('${id}','ocupado');`);
    return id;
  };
  const assignUnit = (opts: { productId: string; installationId: string; clientId?: string; contractId: string; statusVal?: string }) => {
    const id = uuid('70000000-0000-0000-0000-');
    sql(`insert into inventory_units(id,product_id,status,client_id,installation_id,contract_id) values('${id}','${opts.productId}','${opts.statusVal ?? 'assigned'}','${opts.clientId ?? client}','${opts.installationId}','${opts.contractId}');`);
    return id;
  };

  try {
    docker(['run', '--pull=never', '--rm', '-d', '--name', containerName, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false;
    for (let i = 0; i < 50; i++) { try { docker(['exec', containerName, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    assert.ok(ready);

    sql(file('./closedOrdersSchema.sql'));
    sql(`alter table installations add column client_id uuid references clients(id), add column contract_id uuid;
      insert into clients(id) values('${otherClient}');
      insert into inventory_categories(id,slug) values('40000000-0000-0000-0000-000000000003','tvbox');
      insert into inventory_products(id,name,is_serialized,category_id) values('${tvboxProduct}','TV Box generico',true,'40000000-0000-0000-0000-000000000003');
      create type public.contract_service_type as enum ('internet_combo','solo_iptv');
      create table service_contracts(id uuid primary key, client_id uuid references clients(id), service_type public.contract_service_type not null default 'internet_combo', zone_id uuid, xui_line_id integer);
      create table fo_nap_puertos(contract_id uuid, estado text);`);
    sql(FASE73_FUNCTION);
    sql(`create trigger trg_installations_validate_completion before update on installations for each row execute procedure validate_installation_completion();`);

    // ---- El candidato bajo prueba (exige MD5 exacto del cuerpo Fase 73 recien creado) ----
    sql(file('../../supabase/migrations/20261021200000_fase167_equipo_serializado_obligatorio_cierre.sql'));

    await t.test('Alta internet/combo SIN IPTV, con ONT valido y correcto: permite cerrar', () => {
      const contractId = newContract({ xuiLineId: null });
      const installId = newInstallation({ contractId });
      assignUnit({ productId: ontProduct, installationId: installId, contractId });
      close(installId);
      assert.equal(status(installId), 'completed');
    });

    await t.test('Alta internet/combo CON IPTV, ONT y TV Box validos: permite cerrar', () => {
      const contractId = newContract({ xuiLineId: 4321 });
      const installId = newInstallation({ contractId });
      assignUnit({ productId: ontProduct, installationId: installId, contractId });
      assignUnit({ productId: tvboxProduct, installationId: installId, contractId });
      close(installId);
      assert.equal(status(installId), 'completed');
    });

    await t.test('Alta SIN ONT asignada: bloquea', () => {
      const contractId = newContract({ xuiLineId: null });
      const installId = newInstallation({ contractId });
      assert.throws(() => close(installId), /debes asignar un ONT\/Módem/);
      assert.equal(status(installId), 'in_progress');
    });

    await t.test('Alta con IPTV incluida pero SIN TV Box asignado: bloquea (aunque el ONT este correcto)', () => {
      const contractId = newContract({ xuiLineId: 555 });
      const installId = newInstallation({ contractId });
      assignUnit({ productId: ontProduct, installationId: installId, contractId });
      assert.throws(() => close(installId), /incluye IPTV.*TV Box/);
      assert.equal(status(installId), 'in_progress');
    });

    await t.test('Alta internet/combo SIN IPTV (sin xui_line_id): el TV Box sigue sin ser obligatorio (sin cambios respecto a hoy)', () => {
      const contractId = newContract({ xuiLineId: null });
      const installId = newInstallation({ contractId });
      assignUnit({ productId: ontProduct, installationId: installId, contractId });
      close(installId); // sin TV Box, y de todos modos cierra
      assert.equal(status(installId), 'completed');
    });

    await t.test('Equipo asignado a OTRO contrato (misma categoria onu, pero contract_id distinto): no cuenta, bloquea', () => {
      const contractId = newContract({ xuiLineId: null });
      const otherContractId = newContract({ xuiLineId: null });
      const installId = newInstallation({ contractId });
      // El equipo quedo vinculado a installation_id de ESTA alta pero con el contract_id de OTRA -- dato inconsistente real.
      assignUnit({ productId: ontProduct, installationId: installId, contractId: otherContractId });
      assert.throws(() => close(installId), /debes asignar un ONT\/Módem/);
      assert.equal(status(installId), 'in_progress');
    });

    await t.test('Equipo asignado a OTRO cliente: no cuenta, bloquea', () => {
      const contractId = newContract({ xuiLineId: null });
      const installId = newInstallation({ contractId });
      assignUnit({ productId: ontProduct, installationId: installId, contractId, clientId: otherClient });
      assert.throws(() => close(installId), /debes asignar un ONT\/Módem/);
      assert.equal(status(installId), 'in_progress');
    });

    await t.test('Equipo pendiente de aprobacion (pending_approval), nunca assigned: no cuenta como equipo valido, bloquea', () => {
      const contractId = newContract({ xuiLineId: null });
      const installId = newInstallation({ contractId });
      assignUnit({ productId: ontProduct, installationId: installId, contractId, statusVal: 'pending_approval' });
      assert.throws(() => close(installId), /debes asignar un ONT\/Módem/);
      assert.equal(status(installId), 'in_progress');
    });

    await t.test('Contrato vinculado NO corresponde al cliente de la instalacion (discrepancia real): detiene el cierre, no adivina', () => {
      const contractId = newContract({ xuiLineId: null, clientId: otherClient }); // contrato es de OTRO cliente
      const installId = newInstallation({ contractId }); // la instalacion quedo con el cliente "correcto" (client), pero el contrato es de otherClient
      assignUnit({ productId: ontProduct, installationId: installId, contractId, clientId: otherClient });
      assert.throws(() => close(installId), /no corresponde al cliente/);
      assert.equal(status(installId), 'in_progress');
    });

    await t.test('Intento de cierre directo "por API" (UPDATE sin pasar por ningun RPC ni por App de Campo): la misma regla se aplica igual', () => {
      const contractId = newContract({ xuiLineId: null });
      const installId = newInstallation({ contractId, status: 'scheduled' }); // nunca paso por App de Campo
      assert.throws(() => sql(`update installations set status='completed' where id='${installId}';`), /debes asignar un ONT\/Módem/);
    });

    await t.test('solo_iptv sigue completamente exento (sin cambios) -- aunque el contrato tenga xui_line_id', () => {
      const contractId = uuid('31000000-0000-0000-0000-');
      const zoneId = uuid('90000000-0000-0000-0000-');
      sql(`insert into service_contracts(id,client_id,service_type,zone_id,xui_line_id) values('${contractId}','${client}','solo_iptv','${zoneId}',999);
        insert into fo_nap_puertos(contract_id,estado) values('${contractId}','ocupado');`);
      const installId = newInstallation({ contractId });
      close(installId); // sin ningun equipo asignado
      assert.equal(status(installId), 'completed');
    });

    await t.test('Zona/NAP obligatorias se mantienen exactamente igual (sin regresion de Fase 73)', () => {
      const zoneId = null;
      const contractId = uuid('31000000-0000-0000-0000-');
      sql(`insert into service_contracts(id,client_id,service_type,zone_id,xui_line_id) values('${contractId}','${client}','internet_combo',${zoneId ?? 'null'},null);`);
      const installId = newInstallation({ contractId });
      assignUnit({ productId: ontProduct, installationId: installId, contractId });
      assert.throws(() => close(installId), /asignar la Zona/);
    });

    await t.test('rollback propuesto restaura exactamente la version Fase 73 (equipo = cualquier fila, sin verificar categoria/estado/cliente/contrato)', () => {
      const contractId = newContract({ xuiLineId: null });
      const installId = newInstallation({ contractId });
      // Bajo Fase 167 esto bloquea (equipo de OTRO contrato no cuenta).
      const otherContractId = newContract({ xuiLineId: null });
      assignUnit({ productId: ontProduct, installationId: installId, contractId: otherContractId });
      assert.throws(() => close(installId));
      sql(file('../../scripts/rollback-fase167-equipo-serializado-obligatorio-cierre.sql'));
      // Bajo la version restaurada (Fase 73), "al menos 1 fila" alcanza sin verificar nada mas.
      close(installId);
      assert.equal(status(installId), 'completed');
    });
  } finally { try { docker(['rm', '-f', containerName]); } catch {} }
});
