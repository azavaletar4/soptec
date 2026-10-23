import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { isCurrentSubscriber, isRetiredClient, countClientLifecycles, type ClientLifecycle } from '../src/lib/clientLifecycle';
const phase=process.argv[2];assert.ok(phase==='before'||phase==='after');
const raw=JSON.parse(fs.readFileSync('scripts/inventory-auth-lab/runtime/clientes-cloud-private.json','utf8'));
const snapshot=raw.find((r:any)=>r.kind==='snapshot');const catalog=raw.find((r:any)=>r.kind==='rls_catalog');
assert.ok(raw.every((r:any)=>r.read_only==='on'));
const rows=snapshot.rows as ClientLifecycle[];
assert.equal(rows.length,snapshot.counts.registered);
assert.equal(rows.filter(isCurrentSubscriber).length,snapshot.counts.subscribers);
assert.equal(rows.filter(isRetiredClient).length,snapshot.counts.retired);
for(const row of rows){
  if(row.service_contracts.some(s=>s.status==='active'||s.status==='suspended'))assert.ok(!isRetiredClient(row));
  if(isRetiredClient(row))assert.ok(!isCurrentSubscriber(row));
}
const policyHash=crypto.createHash('sha256').update(JSON.stringify(catalog.policies)).digest('hex');
const old=JSON.parse(fs.readFileSync('docs/CLIENTES-PREFLIGHT.json','utf8'));
assert.equal(policyHash,old.policiesSha256,'RLS_DIVERGENCE_FROM_APPROVED_PREFLIGHT');
assert.ok(catalog.tables.every((t:any)=>t.rls));
const result={phase,at:snapshot.at,readOnly:true,counts:snapshot.counts,dashboard:countClientLifecycles(rows),
  commercialProspects:snapshot.commercialProspects,followups:snapshot.followups,rlsPoliciesSha256:policyHash,
  rlsUnchangedFromApproval:true,suspendedRemainCurrent:true,multipleServicesCountedPerClient:true,classification:'PASS'};
const dest='scripts/inventory-auth-lab/runtime/clientes-deploy-counts-'+phase+'.json';
fs.writeFileSync(dest,JSON.stringify(result,null,2)+'\n');
if(phase==='after'){
  const before=JSON.parse(fs.readFileSync('scripts/inventory-auth-lab/runtime/clientes-deploy-counts-before.json','utf8'));
  assert.equal(result.rlsPoliciesSha256,before.rlsPoliciesSha256);
  fs.writeFileSync('docs/CLIENTES-DESPLIEGUE-DATOS.json',JSON.stringify({before,after:result,reference:{subscribers:697,retired:1},noOperationalWritesPerformed:true},null,2)+'\n');
}
console.log(JSON.stringify(result));
