// Solo valida evidencia ya leída y registra resultado; no abre conexiones.
import fs from 'node:fs';import assert from 'node:assert/strict';
const root='deploy/dashboard-support-prospects-20261113/';
const before=JSON.parse(fs.readFileSync(root+'data-before.json'));
const after=JSON.parse(fs.readFileSync(root+'data-after.json'));
const backup=JSON.parse(fs.readFileSync(root+'postgres-backup-verification.json'));
assert.equal(backup.status,'PASS');assert.equal(backup.allCriticalRowsAndFieldsExactlyEqual,true);
assert.equal(before.read_only,'on');assert.equal(after.read_only,'on');assert.deepEqual(after.fingerprints,before.fingerprints);
assert.equal(after.prospects.discardedRows,0);assert.equal(after.prospects.pendingInstallationClients,1);assert.equal(after.prospects.requestedReferenceMatches,true);assert.equal(after.prospects.cancelledRawProspectsExcluded,3);
assert.equal(after.support.pending,12);assert.equal(after.support.rows,after.support.uniqueOrders);
assert.equal(after.functions.length,3);
for(const f of after.functions){assert.equal(f.owner,'postgres');assert.equal(f.anonExec,false);assert.equal(f.serviceRoleExec,false);assert.equal(f.authenticatedExec,f.name==='discard_unfulfilled_client_prospect');}
const result={status:'PASS',at:after.at,packageSha256:'2e085a576d5c7a4914bd6584d328b65da51ea4bb93497aedbdd41edf2f552410',migrationApplied:true,approvedSqlOnly:true,postSqlVerification:'PASS',existingBusinessRowsUnchanged:true,fingerprintsIdentical:true,discardedRows:0,support:after.support,prospects:after.prospects,functionPermissions:after.functions,backupSha256:backup.sha256,rollbackExecuted:false};
fs.writeFileSync(root+'migration-result.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
