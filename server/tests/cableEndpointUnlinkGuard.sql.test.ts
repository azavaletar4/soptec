import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Caso real (21/11/2026): "RAMAL DE 6H" con destino_infra_id apuntando a
// una caja NAP de prueba ("borrirar"/"boirrar") que el propietario confirmo
// que nunca debio quedar vinculada. Estas pruebas cubren las dos piezas que
// faltaban (ver migracion 20261121190726_fo_cable_endpoint_unlink_guard.sql):
// 1) desvincular manualmente un extremo YA conectado exige SUPERADMIN y
//    queda auditado; 2) eliminar una NAP/MUFA del mapa ya no deja cables
//    colgando con una referencia a un elemento retirado.
const sqlFile = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const superadmin = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
const napTest = '30000000-0000-0000-0000-000000000001'; // "boirrar"
const napOther = '30000000-0000-0000-0000-000000000002';
const cableHalf = '40000000-0000-0000-0000-000000000001'; // origen libre, destino -> napTest (RAMAL DE 6H real)
const cableBoth = '40000000-0000-0000-0000-000000000002'; // origen -> napOther, destino -> napTest
const cableUnrelated = '40000000-0000-0000-0000-000000000003'; // sin conexion con napTest

test('PostgreSQL isolated: desvincular un extremo exige SUPERADMIN y se audita; eliminar una NAP ya no deja cables colgando', { timeout: 60000 }, async (t) => {
  const container = `smartrayco-mapa-superadmin-test-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) => execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const psqlArgs = ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'];
  const query = (sql: string) => docker(psqlArgs, sql).trim();
  const asUser = (sql: string, user: string) => `set role authenticated; set request.jwt.claim.sub='${user}'; ${sql}`;

  // El historial (fo_cable_endpoint_unlink_log) solo existe DESPUES de
  // aplicar la migracion de esta sesion -- se trunca aparte (resetLog), no
  // aqui, para que la prueba "ANTES de la migracion" pueda correr sin el.
  const resetFixtures = () => query(`
    truncate public.fo_cables, public.infra_elementos restart identity cascade;
    insert into public.infra_elementos(id, name, tipo) values
      ('${napTest}', 'borrirar', 'caja_nap'), ('${napOther}', 'NAP 8 - BAR1', 'caja_nap');
    insert into public.fo_cables(id, codigo, hilos_total, metraje, origen_infra_id, destino_infra_id) values
      ('${cableHalf}', 'RAMAL DE 6H', 6, 380, null, '${napTest}'),
      ('${cableBoth}', 'RAMAL DE 12H', 12, 150, '${napOther}', '${napTest}'),
      ('${cableUnrelated}', 'TRONCAL AJENO', 24, 500, null, null);
  `);
  const resetLog = () => query('truncate public.fo_cable_endpoint_unlink_log;');
  const cableRow = (id: string) => JSON.parse(query(`select to_jsonb(c) from public.fo_cables c where id='${id}';`));
  const logRows = () => JSON.parse(query("select coalesce(jsonb_agg(to_jsonb(l) order by unlinked_at),'[]') from public.fo_cable_endpoint_unlink_log l;") || '[]');

  try {
    docker(['run', '--rm', '-d', '--name', container, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    assert.ok(ready, 'isolated Postgres must start');

    query(sqlFile('./cableEndpointUnlinkGuardSchema.sql'));
    // current_user_role() tal como esta REALMENTE desplegada (mismo patron que napAssignment.sql.test.ts).
    const roleSql = sqlFile('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql')
      .match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)![0];
    query(roleSql);
    query(`insert into auth.users(id) values ('${superadmin}'),('${admin}');
      insert into public.profiles values ('${superadmin}','SUPERADMIN',true),('${admin}','ADMIN',true);
      alter table public.fo_cables enable row level security;
      create policy fo_cables_staff_only on public.fo_cables for all to authenticated
        using (public.current_user_role() = any (array['SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION']::public.user_role[]))
        with check (public.current_user_role() = any (array['SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION']::public.user_role[]));`);

    await t.test('ANTES de la migracion: eliminar una NAP deja el cable con una referencia colgante (reproduce el bug real)', () => {
      resetFixtures();
      const preview = JSON.parse(query(asUser(`select public.preview_map_removal('infra','${napTest}');`, superadmin)));
      assert.equal(preview.conexiones, 2, 'debe contar los 2 cables que aun apuntan a la NAP, igual que el resumen real');
      query(asUser(`select public.remove_from_network_map('infra','${napTest}','${preview.token}');`, superadmin));
      assert.equal(cableRow(cableHalf).destino_infra_id, napTest, 'bug real: el cable queda apuntando a una NAP ya retirada del mapa');
    });

    query(sqlFile('../../supabase/migrations/20261121190726_fo_cable_endpoint_unlink_guard.sql'));

    await t.test('un rol que no es SUPERADMIN no puede desvincular un extremo ya conectado', () => {
      resetFixtures(); resetLog();
      const before = cableRow(cableHalf);
      assert.throws(
        () => query(asUser(`update public.fo_cables set destino_olt_id=null, destino_infra_id=null where id='${cableHalf}';`, admin)),
        /Solo SUPERADMIN puede desvincular/,
      );
      assert.deepEqual(cableRow(cableHalf), before, 'el cable no debe cambiar si el rechazo fue correcto');
      assert.deepEqual(logRows(), [], 'un intento rechazado nunca debe quedar en el historial');
    });

    await t.test('SUPERADMIN SI puede desvincular un extremo conectado, y queda auditado', () => {
      resetFixtures(); resetLog();
      query(asUser(`update public.fo_cables set destino_olt_id=null, destino_infra_id=null where id='${cableHalf}';`, superadmin));
      assert.equal(cableRow(cableHalf).destino_infra_id, null);
      const rows = logRows();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].cable_id, cableHalf);
      assert.equal(rows[0].extremo, 'destino');
      assert.equal(rows[0].previous_infra_id, napTest);
      assert.equal(rows[0].unlinked_by, superadmin, 'debe quedar registrado QUIEN lo hizo');
    });

    await t.test('editar otros campos del cable (codigo, notas, capacidad) nunca pasa por el guardia de SUPERADMIN', () => {
      resetFixtures(); resetLog();
      query(asUser(`update public.fo_cables set notes='revisado', hilos_total=12 where id='${cableHalf}';`, admin));
      assert.equal(cableRow(cableHalf).notes, 'revisado');
      assert.deepEqual(logRows(), [], 'un cambio que no desvincula nada nunca debe generar auditoria');
    });

    await t.test('reasignar de un elemento real a OTRO elemento real (ninguno nulo) no es una desvinculacion', () => {
      resetFixtures(); resetLog();
      query(asUser(`update public.fo_cables set destino_infra_id='${napOther}' where id='${cableHalf}';`, admin));
      assert.equal(cableRow(cableHalf).destino_infra_id, napOther, 'un ADMIN puede reasignar sin pasar por el guardia de SUPERADMIN');
      assert.deepEqual(logRows(), [], 'reasignar a otro elemento real no es "desvincular": no se audita aqui');
    });

    await t.test('DESPUES de la migracion: eliminar una NAP limpia los cables que la referenciaban, sin tocar otros cables ni conexiones ajenas', () => {
      resetFixtures(); resetLog();
      const preview = JSON.parse(query(asUser(`select public.preview_map_removal('infra','${napTest}');`, superadmin)));
      query(asUser(`select public.remove_from_network_map('infra','${napTest}','${preview.token}');`, superadmin));
      assert.equal(cableRow(cableHalf).destino_infra_id, null, 'ya no debe quedar apuntando a la NAP retirada');
      const both = cableRow(cableBoth);
      assert.equal(both.destino_infra_id, null, 'este cable tambien la referenciaba: tambien se limpia');
      assert.equal(both.origen_infra_id, napOther, 'la conexion con OTRA NAP (ajena a la eliminada) se conserva intacta');
      assert.deepEqual(cableRow(cableUnrelated), cableRow(cableUnrelated), 'cable sin relacion con la NAP eliminada: sin cambios');
      const rows = logRows().filter((r: { extremo: string }) => r.extremo === 'destino');
      assert.equal(rows.length, 2, 'ambos cables desvinculados automaticamente quedan en el historial, con quien ejecuto la baja');
      assert.ok(rows.every((r: { unlinked_by: string }) => r.unlinked_by === superadmin));
    });

    await t.test('eliminar una NAP sin cables que la referencien no toca ningun cable', () => {
      resetFixtures(); resetLog();
      // Preparacion del escenario (ya desvinculados de antemano): pasa por
      // el mismo guardia nuevo, asi que corre como SUPERADMIN igual que
      // cualquier desvinculacion real.
      query(asUser(`update public.fo_cables set destino_olt_id=null, destino_infra_id=null where id in ('${cableHalf}','${cableBoth}');`, superadmin));
      resetLog();
      const before = [cableRow(cableHalf), cableRow(cableBoth), cableRow(cableUnrelated)];
      const preview = JSON.parse(query(asUser(`select public.preview_map_removal('infra','${napTest}');`, superadmin)));
      assert.equal(preview.conexiones, 0);
      query(asUser(`select public.remove_from_network_map('infra','${napTest}','${preview.token}');`, superadmin));
      assert.deepEqual([cableRow(cableHalf), cableRow(cableBoth), cableRow(cableUnrelated)], before);
    });

    console.log(JSON.stringify({ status: 'PASS', fixtures: 'synthetic-only', productionWrites: 0 }));
  } finally {
    try { docker(['rm', '-f', container]); } catch { /* best effort cleanup */ }
  }
});
