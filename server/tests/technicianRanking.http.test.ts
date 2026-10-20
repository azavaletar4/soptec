import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createTechnicianRankingHandler } from '../src/services/technicianRanking';
import type { AuthUser } from '../src/middleware/auth';

const row={technician_id:'tech-a',technician_name:'Técnico visible',installations_count:1,averias_count:2,reconexiones_count:0,rutinas_count:0,reincidencias_count:0,total_points:20,ranking:1};
function setup(role: AuthUser['role'] | null) {
  const calls: {name:string;args:Record<string,unknown>}[]=[];
  const app=new Hono();
  app.use('*',async(c,next)=>{if(role)c.set('user',{id:'session-user',role});await next();});
  app.get('/ranking',createTechnicianRankingHandler(async(name,args)=>{
    calls.push({name,args});
    const exposed={...row,client_id:'PRIVATE',salary:9000,email:'PRIVATE@example.invalid',contract_id:'PRIVATE'};
    return {error:null,data:name==='get_technician_ranking'?[exposed]:{period:args.p_period,start:'2026-10-19T05:00:00Z',end:'2026-10-26T05:00:00Z',timezone:'America/Lima',asOf:'2026-10-20T16:00:00Z',ranking:[exposed],private:'PRIVATE'}};
  }));
  return {app,calls};
}
test('HTTP: técnico, ADMIN y SUPERADMIN acceden a diario/semanal/mensual y mensual compatible',async()=>{
  for(const role of ['TECNICO_RED','ADMIN','SUPERADMIN','SOPORTE'] as const){
    const {app,calls}=setup(role);
    for(const period of ['day','week','month']){
      const r=await app.request(`/ranking?periodo=${period}&fecha=2026-10-20`);
      assert.equal(r.status,200);
      const body=await r.json() as any;
      assert.deepEqual(body.ranking,[row]);
      assert.doesNotMatch(JSON.stringify(body),/PRIVATE|salary|contract|client_id|email/);
    }
    const legacy=await app.request('/ranking?mes=10&anio=2026');
    assert.equal(legacy.status,200);
    assert.deepEqual(await legacy.json(),{mes:10,anio:2026,ranking:[row]});
    assert.equal(calls[0]!.name,'get_technician_period_ranking');
    assert.equal(calls.at(-1)!.name,'get_technician_ranking');
  }
});
test('HTTP: anónimo/cliente denegados antes de consultar con service_role',async()=>{
  for(const role of [null,'CLIENTE','FACTURACION'] as const){
    const {app,calls}=setup(role);
    assert.equal((await app.request('/ranking?periodo=month')).status,role===null?401:403);
    assert.equal(calls.length,0);
  }
});
test('HTTP: parámetros inválidos no invocan SQL y campos extra no alteran proyección',async()=>{
  const {app,calls}=setup('TECNICO_RED');
  for(const q of ['periodo=bad','periodo=day&fecha=2026-02-30','periodo=week&fecha=1999-01-01','mes=0','anio=3000','periodo=day&fecha=bad']){
    assert.equal((await app.request('/ranking?'+q)).status,400);
  }
  assert.equal(calls.length,0);
  assert.equal((await app.request('/ranking?periodo=week&fecha=2026-10-20&technician_id=other&select=salary')).status,200);
  assert.deepEqual(calls[0]!.args,{p_period:'week',p_date:'2026-10-20'});
});
