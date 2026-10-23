import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { isRetiredClient, isCurrentSubscriber, countClientLifecycles, type ClientLifecycle } from '../../src/lib/clientLifecycle';

// Se ejecuta después del preflight READ ONLY; no abre conexiones ni escribe datos.
const input='scripts/inventory-auth-lab/runtime/clientes-cloud-private.json';
const evidence=JSON.parse(fs.readFileSync(input,'utf8'));
const snapshot=evidence.find((r: any)=>r.kind==='snapshot');
const catalog=evidence.find((r: any)=>r.kind==='rls_catalog');
const rows=snapshot.rows as ClientLifecycle[];
test('SQL READ ONLY y clasificador frontend coinciden fila por fila en el total real',()=>{
  assert.ok(evidence.every((r:any)=>r.read_only==='on'));
  assert.equal(rows.length,snapshot.counts.registered);
  assert.equal(rows.filter(isCurrentSubscriber).length,snapshot.counts.subscribers);
  assert.equal(rows.filter(isRetiredClient).length,snapshot.counts.retired);
  assert.equal(rows.filter(c=>c.service_contracts.length>=2).length,snapshot.counts.multipleServices);
  for(const c of rows){
    if(c.service_contracts.some(s=>s.status==='active'))assert.equal(isRetiredClient(c),false);
    if(isRetiredClient(c))assert.equal(isCurrentSubscriber(c),false);
    if(!c.service_contracts.length)assert.equal(isCurrentSubscriber(c),false);
  }
});
test('RLS real: staff existente ve conteos completos, técnico sin Prospectos, anónimo sin fichas',()=>{
  assert.equal(catalog.tables.length,5);
  assert.ok(catalog.tables.every((t:any)=>t.rls));
  for(const role of ['ADMIN','SUPERADMIN']){
    const actor=evidence.find((r:any)=>r.kind==='rls_actor'&&r.role===role);assert.ok(actor);
    assert.equal(actor.clients,rows.length);assert.equal(actor.prospects,Object.values(snapshot.commercialProspects).reduce((a:any,b:any)=>a+b,0));
    assert.equal(actor.followups,snapshot.followups);
  }
  const tech=evidence.find((r:any)=>r.kind==='rls_actor'&&r.role==='TECNICO_RED');
  assert.equal(tech.prospects,0);assert.equal(tech.followups,0);
  const anon=evidence.find((r:any)=>r.kind==='rls_anon');
  assert.equal(anon.clients,0);assert.equal(anon.prospects,0);assert.equal(anon.followups,0);
});
test('evidencia pública contiene sólo conteos y metadatos, sin filas ni identidades',()=>{
  const summary={at:snapshot.at,readOnly:true,counts:snapshot.counts,dashboard:countClientLifecycles(rows),
    commercialProspects:snapshot.commercialProspects,followups:snapshot.followups,
    rlsTables:catalog.tables,rlsActors:evidence.filter((r:any)=>r.kind==='rls_actor'||r.kind==='rls_anon'),
    rolesWithoutActiveActor:['SOPORTE','FACTURACION'].filter(r=>!catalog.availableActors[r]),
    policiesSha256:crypto.createHash('sha256').update(JSON.stringify(catalog.policies)).digest('hex'),
    caveat:'clients_staff_only desplegada es ALL para staff, incluyendo TECNICO_RED; no se modifica. SOPORTE/FACTURACION se validan por catálogo y UI, sin actor activo para ensayo real.',
    classification:'PASS',deployment:'NOT_DEPLOYED'};
  assert.ok(!JSON.stringify(summary).includes('document_number'));
  fs.writeFileSync('docs/CLIENTES-PREFLIGHT.json',JSON.stringify(summary,null,2)+'\n');
});
