import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { scheduleLabel, schedulePatch, routineSchedulePatch, routineTurno } from '../../src/lib/workOrderSchedule.ts';

test('PostgreSQL aislado: persistencia de programación de los tres tipos', { timeout: 60000 }, async t => {
  const container=`smartrayco-schedule-test-${process.pid}-${Date.now()}`;
  const docker=(args: string[],input?: string)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
  const query=(sql: string)=>docker(['exec','-i',container,'psql','-h','127.0.0.1','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres'],sql).trim();
  const file=(p: string)=>readFileSync(new URL(p,import.meta.url),'utf8');
  const literal=(value: unknown)=>value===null?'null':`'${String(value).replaceAll("'","''")}'`;
  try {
    docker(['run','--rm','-d','--name',container,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
    let ready=false;
    for(let i=0;i<50;i++){try{docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
    assert.ok(ready);
    query(file('./singleActiveJobSchema.sql'));
    // Reutiliza las declaraciones de columnas reales; no ejecuta migraciones remotas.
    const migration=file('../../supabase/migrations/20261005020000_fase101_rutinas_mantenimiento.sql');
    const installation=file('../../supabase/migrations/20260911010000_fase9_instalaciones.sql');
    const routineColumns=migration.match(/^\s+scheduled_(?:date|start_at|end_at)\s+[^,\n]+/gm)!;
    assert.equal(routineColumns.length,3);
    for(const column of routineColumns)query(`alter table routines add column ${column.trim()};`);
    const legacyColumns=installation.match(/^\s+scheduled_(?:date|time)\s+[^,\n]+/gm)!;
    assert.equal(legacyColumns.length,2);
    for(const column of legacyColumns)query(`alter table installations add column ${column.trim()};`);
    query(migration.match(/^alter table public\.(?:tickets|installations) add column if not exists scheduled_(?:start|end)_at timestamptz;/gm)!.join('\n'));
    query(`alter table tickets add column rescheduled_to timestamptz;`);
    for(const [kind,table] of [['ticket','tickets'],['installation','installations'],['routine','routines']] as const) {
      for(const assigned of [true,false])await t.test(`${kind}: crear, leer, editar y releer ${assigned?'asignada':'sin asignar'}`,()=>{
        const id=query(`insert into ${table}(assigned_to) values (${assigned?"'00000000-0000-0000-0000-000000000001'":'null'}) returning id;`);
        const update=(patch: object)=>query(`update ${table} set ${Object.entries(patch).map(([k,v])=>`${k}=${literal(v)}`).join(',')} where id='${id}';`);
        const read=()=>JSON.parse(query(`set timezone='Asia/Tokyo'; select row_to_json(t) from ${table} t where id='${id}';`));
        const before=read();
        update(schedulePatch(kind,'2026-11-18','10:00',kind==='installation'?'':'12:00'));
        assert.equal(scheduleLabel(kind,read()),'18/11/2026 · 10:00'+(kind==='installation'?'':'–12:00'));
        if(kind==='routine') {
          const row=read();update(routineSchedulePatch(row,'2026-11-18',routineTurno(row)));
          assert.equal(scheduleLabel(kind,read()),'18/11/2026 · 10:00–12:00');
        }
        update(schedulePatch(kind,'2026-11-19','14:00',kind==='installation'?'':'16:00'));
        const edited=read();
        assert.equal(scheduleLabel(kind,edited),'19/11/2026 · 14:00'+(kind==='installation'?'':'–16:00'));
        assert.equal(edited.assigned_to,before.assigned_to);
        assert.equal(edited.status,before.status);
        if(kind==='installation') {assert.equal(edited.scheduled_date,'2026-11-19');assert.equal(edited.scheduled_time,'14:00:00');assert.equal(edited.scheduled_end_at,null);}
      });
      await t.test(`${kind}: histórica sin horario ni asignación permanece vacía`,()=>{
        const row=JSON.parse(query(`insert into ${table} default values returning row_to_json(${table});`));
        assert.equal(scheduleLabel(kind,row),'Sin programación');
      });
    }
    await t.test('Alta histórica con fecha/time sin timestamps y rutina nocturna',()=>{
      const old=JSON.parse(query(`insert into installations(scheduled_date,scheduled_time) values('2026-11-18','15:45') returning row_to_json(installations);`));
      assert.equal(scheduleLabel('installation',old),'18/11/2026 · 15:45');
      const night=JSON.parse(query(`insert into routines(scheduled_date,scheduled_start_at,scheduled_end_at) values('2026-11-18','2026-11-19T04:30:00Z','2026-11-19T06:00:00Z') returning row_to_json(routines);`));
      assert.equal(scheduleLabel('routine',night),'18/11/2026 · 23:30–19/11/2026 01:00');
    });
  } finally {try{docker(['rm','-f',container]);}catch{/* no container if startup failed */}}
});
