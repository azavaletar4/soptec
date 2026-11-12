// Verificacion LOCAL de los resultados de lecturas remotas y del log protegido.
// No abre conexiones ni ejecuta SQL.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const runtime=resolve(root,'scripts/inventory-auth-lab/runtime');
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const manifest=json(resolve(root,'deploy/ranking-counters-20261112/manifest.json'));
const logName=readdirSync(runtime).filter(name=>/^ranking-counters-apply-result-\d{8}T\d{9}Z\.json$/.test(name)).sort().at(-1);
assert.ok(logName,'Existe log de aplicacion');
const log=json(resolve(runtime,logName));
assert.equal(log.code,0);
assert.equal(log.applySha256,manifest.files['apply.sql'].sha256);
assert.match(log.stderr,/PASS: contadores esperados; puntos\/Altas\/posiciones\/permisos\/dependencias conservados/);
assert.equal(createHash('sha256').update(readFileSync(log.backupPath)).digest('hex'),manifest.files['backup.sql'].sha256);
const before=json(resolve(runtime,logName.replace('apply-result-','preflight-before-')));
const after=json(resolve(runtime,'ranking-counters-activation-private.json'));
const check=json(resolve(runtime,'ranking-counters-postcheck-private.json'));
const counters=json(resolve(runtime,'ranking-counters-private.json'));
for(const rows of [before,after,check,counters])assert.ok(rows.every(row=>row.read_only==='on'));
const target=rows=>rows[0].functions.find(fn=>fn.name==='technician_ranking_between');
assert.equal(target(before).definition_md5,manifest.definitionMd5Before);
assert.equal(target(after).definition_md5,manifest.definitionMd5Candidate);
const metadata=({definition,definition_md5,body_md5,...rest})=>rest;
assert.deepEqual(metadata(target(after)),metadata(target(before)),'Firma/OID/owner/ACL/atributos intactos');
assert.deepEqual(after[0].dependencies,before[0].dependencies,'Dependencias intactas');
assert.deepEqual(after[0].body_callers,before[0].body_callers,'Mismos consumidores');
for(const fn of before[0].functions.filter(fn=>fn.name!=='technician_ranking_between')) {
  assert.deepEqual(after[0].functions.find(row=>row.signature===fn.signature),fn,'Otra funcion cambio');
}
assert.equal(check[0].definition_matches_candidate,true);
assert.equal(check[0].definition_matches_backup,false);
assert.equal(check[0].helpers_unchanged,true);
const sort=rows=>[...rows].sort((a,b)=>a.technician_id.localeCompare(b.technician_id));
const stable=rows=>sort(rows).map(({averias_count,rutinas_count,...rest})=>rest);
const previous=before[2].ranking.ranking;
const current=after[2].ranking.ranking;
assert.deepEqual(stable(current),stable(previous),'Puntos/Altas/penalizaciones/posiciones intactos');
assert.deepEqual(sort(check[1].month.ranking),sort(current));
assert.deepEqual(sort(check[1].legacy_month),sort(current),'Endpoint mensual antiguo coincide');
assert.deepEqual(sort(counters[2].ranking.ranking),sort(current));
const ticket=counters[0].ticket.find(row=>row.ticket_number==='TCK-2026-00104');
assert.ok(ticket);assert.equal(ticket.status,'resolved');assert.equal(ticket.points,2);assert.equal(ticket.category,'other');
const entries=counters[0].contributions;
const caseRows=entries.filter(row=>row.job_id===ticket.id&&row.kind==='work'&&row.job_type==='ticket');
assert.equal(caseRows.length,1);assert.equal(caseRows[0].points,2);
const jadir=current.find(row=>row.technician_id===caseRows[0].technician_id);
assert.equal(jadir.technician_name,'Jadir Zavaleta');
const cutoff=Date.parse('2026-11-01T05:00:00Z');
const isAveria=row=>row.kind==='work'&&row.job_type==='ticket'&&(
  ['no_service','slow_speed','equipment'].includes(row.category)||row.category==='other'&&Date.parse(row.occurred_at)>=cutoff);
const uniqueCount=rows=>new Set(rows.map(row=>row.job_id)).size;
const seen=new Set();
for(const row of entries.filter(row=>row.kind==='work')) {
  const key=JSON.stringify([row.technician_id,row.job_type,row.job_id]);
  assert.ok(!seen.has(key),'Aporte de trabajo duplicado');seen.add(key);
}
for(const row of current) {
  const own=entries.filter(entry=>entry.technician_id===row.technician_id);
  assert.equal(row.averias_count,uniqueCount(own.filter(isAveria)));
  assert.equal(row.rutinas_count,uniqueCount(own.filter(entry=>entry.kind==='work'&&entry.job_type==='routine')));
}
const jadirJobs=entries.filter(row=>row.technician_id===jadir.technician_id&&isAveria(row));
assert.ok(jadirJobs.some(row=>row.job_id===ticket.id));
assert.equal(uniqueCount(jadirJobs)-uniqueCount(jadirJobs.filter(row=>row.job_id!==ticket.id)),1);
for(const period of ['day','week']) {
  const result=check[1][period];
  const eligible=entries.filter(row=>Date.parse(row.occurred_at)>=Date.parse(result.start)&&Date.parse(row.occurred_at)<Date.parse(result.end));
  for(const row of result.ranking) {
    const own=eligible.filter(entry=>entry.technician_id===row.technician_id);
    assert.equal(row.averias_count,uniqueCount(own.filter(isAveria)));
    assert.equal(row.rutinas_count,uniqueCount(own.filter(entry=>entry.kind==='work'&&entry.job_type==='routine')));
  }
}
const evidence={
  status:'APLICADO_Y_VERIFICADO',appliedAt:log.at,verifiedAt:after[0].as_of,
  preparationCommit:'37cf0ec5d97c42d98835b5fa09aa3f928de8032d',
  function:manifest.signature,definitionMd5Before:manifest.definitionMd5Before,definitionMd5After:manifest.definitionMd5Candidate,
  applySha256:log.applySha256,backupSha256:manifest.files['backup.sql'].sha256,
  metadataPreserved:true,dependenciesPreserved:true,otherFunctionsUnchanged:true,
  pointsPenaltiesInstallationsAndRanksUnchanged:true,duplicateWorkContributions:0,
  countersMatchDistinctJobs:true,dayWeekMonthAndLegacyVerified:true,
  ticket:{reference:ticket.ticket_number,technician:jadir.technician_name,category:ticket.category,
    status:ticket.status,points:caseRows[0].points,workContributions:caseRows.length,countedAsAveria:true},
  ranking:current.map(row=>({technician:row.technician_name,
    averiasBefore:previous.find(old=>old.technician_id===row.technician_id).averias_count,
    averiasAfter:row.averias_count,routines:row.rutinas_count,installations:row.installations_count,
    points:row.total_points,rank:row.ranking})),
  backup:'deploy/ranking-counters-20261112/backup.sql',rollback:'deploy/ranking-counters-20261112/rollback.sql',
  rollbackExecuted:false,frontendBackendDeployed:false,businessDataModified:false,
};
writeFileSync(resolve(root,'docs/RANKING-CONTADORES-APLICADO-20261112.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
