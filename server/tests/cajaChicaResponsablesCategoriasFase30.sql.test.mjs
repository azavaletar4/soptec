// Fase 30 LOCAL. Postgres real aislado (Docker). Responsables visibles en
// Caja Chica: ausencia de fila = visible por defecto (personal nuevo nunca
// se asume "de prueba"); apagar un interruptor nunca toca rol/cuenta del
// perfil en otro módulo. Categorías: tipo ingreso/egreso agregado sin perder
// ninguna fila ni relación existente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFinanceLab, read } from './financeLab.mjs';

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

test('Fase 30: caja_chica_responsables_visibles + categorías por tipo', { timeout: 120000 }, async t => {
  const lab = await createFinanceLab({});
  const q = lab.q;
  let failed = false;
  const sub = (name, fn) => t.test(name, async () => { try { await fn(); } catch (e) { failed = true; throw e; } });
  try {
    // Esquema mínimo real de caja_chica_categorias (sin depender de
    // storage.buckets/vehiculos, ajenos a esta migración) — columnas y
    // filas confirmadas por lectura directa de producción el 27/11/2026.
    q(`create table public.caja_chica_categorias(id uuid primary key default gen_random_uuid(),nombre text not null unique,permite_vehiculo boolean not null default false,created_at timestamptz not null default now());
       alter table public.caja_chica_categorias enable row level security;
       create policy caja_chica_categorias_admin_only on public.caja_chica_categorias for all to authenticated using(current_user_role() in ('SUPERADMIN','ADMIN')) with check(current_user_role() in ('SUPERADMIN','ADMIN'));
       insert into public.caja_chica_categorias(nombre,permite_vehiculo) values
        ('Cobros de clientes',false),('Combustible / Flota',true),('Delivery',false),('Instalacion',false),('Insumos',false),('Otros',false),('Retiros del propietario',false),('Servicios (agua/luz/internet)',false);`);

    q(read('../../supabase/migrations/20261202090000_caja_chica_responsables_categorias_fase30.sql'));

    q(`alter table profiles add column email text;
       insert into profiles(id,role,active,full_name,email) values
       ('${id(1)}','SUPERADMIN',true,'alex raico','alex.raico@smartrayco.test'),
       ('${id(2)}','ADMIN',true,'Alhely Lozano','alhely.lozano@smartrayco.test'),
       ('${id(3)}','TECNICO_RED',true,'Jadir Zavaleta','jadir.zavaleta@smartrayco.test'),
       ('${id(4)}','CLIENTE',true,'Cliente Cualquiera','cliente@smartrayco.test'),
       ('${id(5)}','TECNICO_RED',false,'Tecnico Inactivo','tecnico.inactivo@smartrayco.test');`);

    const asActor = (sql, actor = id(1)) => q(`begin;set local role authenticated;set local request.jwt.claim.sub='${actor}';${sql};commit;`);

    await sub('categorías: tipo por defecto egreso; "Cobros de clientes" queda ingreso; ninguna fila se pierde', () => {
      const rows = JSON.parse(q(`select coalesce(jsonb_agg(jsonb_build_object('nombre',nombre,'tipo',tipo) order by nombre),'[]') from caja_chica_categorias`));
      assert.equal(rows.length, 8);
      const porNombre = Object.fromEntries(rows.map(r => [r.nombre, r.tipo]));
      assert.equal(porNombre['Cobros de clientes'], 'ingreso');
      assert.equal(porNombre['Retiros del propietario'], 'egreso');
      assert.equal(porNombre['Combustible / Flota'], 'egreso');
      assert.equal(porNombre['Instalacion'], 'egreso');
    });

    await sub('categorías: tipo inválido rechazado por el CHECK', () => {
      assert.throws(() => q(`insert into caja_chica_categorias(nombre,tipo) values('Prueba invalida','otro')`), /violates check constraint/);
    });

    await sub('responsables: sin ninguna fila, todo el personal no-CLIENTE activo aparece visible por defecto', () => {
      const rows = JSON.parse(asActor(`select caja_responsables_config()`));
      const porId = Object.fromEntries(rows.map(r => [r.profileId, r]));
      assert.equal(porId[id(1)].visible, true);
      assert.equal(porId[id(2)].visible, true);
      assert.equal(porId[id(3)].visible, true);
      assert.equal(porId[id(3)].role, 'TECNICO_RED');
      assert.equal(porId[id(4)], undefined, 'CLIENTE nunca debe aparecer en el selector de responsables');
      assert.equal(porId[id(5)], undefined, 'perfil inactivo nunca debe aparecer');
    });

    await sub('responsables: ocultar a alguien lo marca visible=false, auditado, sin tocar su perfil', () => {
      const opId = '11111111-1111-1111-1111-111111111111';
      const res = JSON.parse(asActor(`select caja_set_responsable_visible('${opId}','${id(3)}',false,'Cuenta de prueba, oculta por decisión del propietario')`));
      assert.equal(res.visible, false);
      const rows = JSON.parse(asActor(`select caja_responsables_config()`));
      const target = rows.find(r => r.profileId === id(3));
      assert.equal(target.visible, false);
      // El perfil en sí (rol, activo) no cambió.
      const profileRow = JSON.parse(q(`select to_jsonb(p) from profiles p where id='${id(3)}'`));
      assert.equal(profileRow.role, 'TECNICO_RED');
      assert.equal(profileRow.active, true);
      const audit = JSON.parse(q(`select coalesce(jsonb_agg(to_jsonb(a)),'[]') from admin_audit_log a where tabla='caja_chica_responsables_visibles' and accion='set_visible'`));
      assert.equal(audit.length, 1);
      assert.equal(audit[0].motivo, 'Cuenta de prueba, oculta por decisión del propietario');
    });

    await sub('responsables: reintentar la misma operación (mismo operation_id/payload) es idempotente, sin duplicar auditoría', () => {
      const opId = '22222222-2222-2222-2222-222222222222';
      const first = JSON.parse(asActor(`select caja_set_responsable_visible('${opId}','${id(2)}',false,'Prueba de idempotencia real')`));
      const second = JSON.parse(asActor(`select caja_set_responsable_visible('${opId}','${id(2)}',false,'Prueba de idempotencia real')`));
      assert.deepEqual(first, second);
      const audit = JSON.parse(q(`select jsonb_build_object('c',count(*)::int) from admin_audit_log where tabla='caja_chica_responsables_visibles' and accion='set_visible' and entidad_id='${opId}'`));
      assert.equal(audit.c, 1);
    });

    await sub('responsables: mismo operation_id con un payload distinto se rechaza (clave no reutilizable)', () => {
      const opId = '33333333-3333-3333-3333-333333333333';
      asActor(`select caja_set_responsable_visible('${opId}','${id(1)}',false,'Primer motivo real')`);
      assert.throws(() => asActor(`select caja_set_responsable_visible('${opId}','${id(1)}',true,'Motivo distinto')`), /Clave usada por otro cambio/);
    });

    await sub('responsables: reactivar a alguien antes oculto lo vuelve visible, auditado', () => {
      const opId = '44444444-4444-4444-4444-444444444444';
      asActor(`select caja_set_responsable_visible('${opId}','${id(3)}',false,'Ocultar primero')`);
      const opId2 = '55555555-5555-5555-5555-555555555555';
      const res = JSON.parse(asActor(`select caja_set_responsable_visible('${opId2}','${id(3)}',true,'Se reincorpora, vuelve a estar visible')`));
      assert.equal(res.visible, true);
      const rows = JSON.parse(asActor(`select caja_responsables_config()`));
      assert.equal(rows.find(r => r.profileId === id(3)).visible, true);
    });

    await sub('responsables: nunca se puede marcar a un CLIENTE como responsable', () => {
      const opId = '66666666-6666-6666-6666-666666666666';
      assert.throws(() => asActor(`select caja_set_responsable_visible('${opId}','${id(4)}',false,'Intento inválido')`), /Responsable no encontrado o inactivo/);
    });

    await sub('responsables: motivo demasiado corto se rechaza (misma regla que el resto de Caja Chica)', () => {
      const opId = '77777777-7777-7777-7777-777777777777';
      assert.throws(() => asActor(`select caja_set_responsable_visible('${opId}','${id(2)}',false,'no')`), /Operación, responsable, visibilidad y motivo requeridos/);
    });

    await sub('operador no-admin (TECNICO_RED) bloqueado en lectura y escritura', () => {
      assert.throws(() => asActor(`select caja_responsables_config()`, id(3)), /Operador financiero activo requerido/);
      assert.throws(() => asActor(`select caja_set_responsable_visible('88888888-8888-8888-8888-888888888888','${id(1)}',false,'Intento no autorizado')`, id(3)), /Operador financiero activo requerido/);
    });

    assert.equal(failed, false, 'No publicar PASS si falló un subcaso');
  } finally { lab.close(); }
});
