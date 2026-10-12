import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const sqlFile = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const nap = '30000000-0000-0000-0000-000000000003'; // 3 ports, see napSchema.sql
const clientA = '10000000-0000-0000-0000-000000000001', clientB = '10000000-0000-0000-0000-000000000002';
const contractA = '20000000-0000-0000-0000-000000000001', contractB = '20000000-0000-0000-0000-000000000002';

test('PostgreSQL isolated: eliminar cliente/contrato libera solo SU puerto NAP, nunca otros', { timeout: 60000 }, async t => {
  const container = `smartrayco-fase156-test-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) => execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const psqlArgs = ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'];
  const query = (sql: string) => docker(psqlArgs, sql).trim();

  const reset = () => query(`
    truncate public.fo_nap_puertos, public.service_contracts, public.clients restart identity cascade;
    insert into public.clients values ('${clientA}'), ('${clientB}');
    insert into public.service_contracts values ('${contractA}','${clientA}'), ('${contractB}','${clientB}');
  `);

  try {
    docker(['run', '--rm', '-d', '--name', container, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(ready, 'isolated Postgres must start');

    query(sqlFile('./napSchema.sql'));
    // napSchema.sql no declara ON DELETE CASCADE/SET NULL (no los necesitaba
    // para napAssignment.sql.test.ts) — se alinean aqui con las reglas
    // REALES de produccion (confirmadas en Fase 155 via information_schema)
    // para que esta prueba sea representativa.
    query(`
      alter table public.service_contracts drop constraint service_contracts_client_id_fkey,
        add constraint service_contracts_client_id_fkey foreign key (client_id) references public.clients(id) on delete cascade;
      alter table public.fo_nap_puertos drop constraint fo_nap_puertos_client_id_fkey,
        add constraint fo_nap_puertos_client_id_fkey foreign key (client_id) references public.clients(id) on delete set null;
      alter table public.fo_nap_puertos drop constraint fo_nap_puertos_contract_id_fkey,
        add constraint fo_nap_puertos_contract_id_fkey foreign key (contract_id) references public.service_contracts(id) on delete set null;
      alter table public.fo_nap_puertos add column notes text;
    `);
    query(sqlFile('../../supabase/migrations/20261012190000_fase156_prevenir_puertos_nap_fantasma.sql'));

    await t.test('eliminar UN contrato libera solo su puerto; el de otro contrato/cliente queda intacto', () => {
      reset();
      query(`insert into public.fo_nap_puertos(infra_elemento_id, puerto_numero, estado, client_id, contract_id) values
        ('${nap}', 1, 'ocupado', '${clientA}', '${contractA}'),
        ('${nap}', 2, 'ocupado', '${clientB}', '${contractB}');`);
      query(`delete from public.service_contracts where id = '${contractA}';`);
      assert.equal(query(`select estado, client_id, contract_id from public.fo_nap_puertos where puerto_numero = 1;`), 'libre||');
      assert.equal(query(`select estado, client_id from public.fo_nap_puertos where puerto_numero = 2;`), `ocupado|${clientB}`);
      assert.match(query(`select notes from public.fo_nap_puertos where puerto_numero = 1;`), /Fase 156.*contrato/);
    });

    await t.test('eliminar un cliente cascadea a sus contratos y libera cada puerto propio, sin tocar el de otro cliente', () => {
      reset();
      query(`insert into public.fo_nap_puertos(infra_elemento_id, puerto_numero, estado, client_id, contract_id) values
        ('${nap}', 1, 'ocupado', '${clientA}', '${contractA}'),
        ('${nap}', 2, 'ocupado', '${clientB}', '${contractB}');`);
      query(`delete from public.clients where id = '${clientA}';`);
      assert.equal(query(`select estado, client_id, contract_id from public.fo_nap_puertos where puerto_numero = 1;`), 'libre||');
      assert.equal(query(`select estado, client_id from public.fo_nap_puertos where puerto_numero = 2;`), `ocupado|${clientB}`);
      assert.equal(query(`select count(*) from public.service_contracts where id = '${contractA}';`), '0');
    });

    await t.test('puerto ligado solo al cliente (sin contract_id, caso ambiguo multi-servicio) tambien se libera al borrar el cliente', () => {
      reset();
      query(`insert into public.fo_nap_puertos(infra_elemento_id, puerto_numero, estado, client_id, contract_id) values
        ('${nap}', 1, 'ocupado', '${clientA}', null);`);
      query(`delete from public.clients where id = '${clientA}';`);
      assert.equal(query(`select estado, client_id from public.fo_nap_puertos where puerto_numero = 1;`), 'libre|');
      assert.match(query(`select notes from public.fo_nap_puertos where puerto_numero = 1;`), /Fase 156.*cliente/);
    });

    await t.test('un cliente con 2 servicios: borrar SOLO uno conserva el puerto del otro (requisito explicito)', () => {
      reset();
      query(`insert into public.service_contracts values ('20000000-0000-0000-0000-000000000009', '${clientA}');`);
      query(`insert into public.fo_nap_puertos(infra_elemento_id, puerto_numero, estado, client_id, contract_id) values
        ('${nap}', 1, 'ocupado', '${clientA}', '${contractA}'),
        ('${nap}', 2, 'ocupado', '${clientA}', '20000000-0000-0000-0000-000000000009');`);
      query(`delete from public.service_contracts where id = '${contractA}';`);
      assert.equal(query(`select estado from public.fo_nap_puertos where puerto_numero = 1;`), 'libre');
      assert.equal(query(`select estado, contract_id from public.fo_nap_puertos where puerto_numero = 2;`), 'ocupado|20000000-0000-0000-0000-000000000009');
    });

    await t.test('un puerto reservado/dañado con el mismo contract_id NO se toca (solo ocupado cuenta)', () => {
      reset();
      query(`insert into public.fo_nap_puertos(infra_elemento_id, puerto_numero, estado, client_id, contract_id) values
        ('${nap}', 1, 'reservado', '${clientA}', '${contractA}');`);
      query(`delete from public.service_contracts where id = '${contractA}';`);
      // La FK ON DELETE SET NULL si actua (no es parte de este trigger) — pero el estado se conserva.
      assert.equal(query(`select estado from public.fo_nap_puertos where puerto_numero = 1;`), 'reservado');
    });

    await t.test('una nota manual existente se conserva, no se sobreescribe', () => {
      reset();
      query(`insert into public.fo_nap_puertos(infra_elemento_id, puerto_numero, estado, client_id, contract_id, notes) values
        ('${nap}', 1, 'ocupado', '${clientA}', '${contractA}', 'ONT serie ABC123 visible en campo');`);
      query(`delete from public.service_contracts where id = '${contractA}';`);
      const notes = query(`select notes from public.fo_nap_puertos where puerto_numero = 1;`);
      assert.match(notes, /ONT serie ABC123 visible en campo/);
      assert.match(notes, /Fase 156/);
    });

    await t.test('restriccion 3: un puerto fantasma YA existente (estilo Fase 155, client_id/contract_id ya null) no se toca con ningun DELETE', () => {
      reset();
      query(`insert into public.fo_nap_puertos(infra_elemento_id, puerto_numero, estado, client_id, contract_id) values
        ('${nap}', 1, 'ocupado', null, null),
        ('${nap}', 2, 'ocupado', '${clientA}', '${contractA}');`);
      const before = query(`select estado, client_id, contract_id, puerto_numero from public.fo_nap_puertos where puerto_numero = 1;`);
      query(`delete from public.service_contracts where id = '${contractA}';`);
      query(`delete from public.clients where id = '${clientB}';`);
      assert.equal(query(`select estado, client_id, contract_id, puerto_numero from public.fo_nap_puertos where puerto_numero = 1;`), before);
    });

    await t.test('eliminacion fallida (otra restriccion aborta el DELETE) no deja el puerto liberado a medias', () => {
      reset();
      query(`insert into public.fo_nap_puertos(infra_elemento_id, puerto_numero, estado, client_id, contract_id) values
        ('${nap}', 1, 'ocupado', '${clientA}', '${contractA}');`);
      // Simula otra restriccion ajena (ej. una factura con ON DELETE NO
      // ACTION) que aborta el DELETE DESPUES de que nuestro trigger ya
      // corrio. Nombrado para disparar alfabeticamente despues de
      // "trg_service_contracts_free_nap_puerto", igual que lo haria
      // cualquier trigger de sistema de otra FK restrictiva.
      query(`create function public.zz_force_contract_delete_fail() returns trigger language plpgsql as $$
          begin raise exception 'forced: factura u otra referencia impide borrar este contrato'; end $$;
        create trigger zz_force_contract_delete_fail before delete on public.service_contracts
          for each row execute function public.zz_force_contract_delete_fail();`);
      const before = query(`select estado, client_id, contract_id from public.fo_nap_puertos where puerto_numero = 1;`);
      assert.throws(() => query(`delete from public.service_contracts where id = '${contractA}';`), /forced: factura/);
      assert.equal(query(`select estado, client_id, contract_id from public.fo_nap_puertos where puerto_numero = 1;`), before);
      assert.equal(query(`select count(*) from public.service_contracts where id = '${contractA}';`), '1');
      query('drop trigger zz_force_contract_delete_fail on public.service_contracts; drop function public.zz_force_contract_delete_fail();');
    });

    await t.test('ROLLBACK explicito de la transaccion deshace tambien la liberacion del puerto', () => {
      reset();
      query(`insert into public.fo_nap_puertos(infra_elemento_id, puerto_numero, estado, client_id, contract_id) values
        ('${nap}', 1, 'ocupado', '${clientA}', '${contractA}');`);
      const before = query(`select estado, client_id, contract_id from public.fo_nap_puertos where puerto_numero = 1;`);
      query(`begin; delete from public.service_contracts where id = '${contractA}'; rollback;`);
      assert.equal(query(`select estado, client_id, contract_id from public.fo_nap_puertos where puerto_numero = 1;`), before);
      assert.equal(query(`select count(*) from public.service_contracts where id = '${contractA}';`), '1');
    });
  } finally {
    try { docker(['stop', container]); } catch { /* Already removed after a startup failure. */ }
  }
});
