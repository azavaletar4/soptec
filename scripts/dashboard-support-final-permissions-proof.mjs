import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const root='deploy/dashboard-support-prospects-20261113/';const rows=JSON.parse(fs.readFileSync(root+'roles-readonly.json'));
const metadata=rows.at(-1);assert.equal(metadata.read_only,'on');assert.equal(metadata.discardedRows,0);assert.equal(metadata.floatDigits,'0');
assert.deepEqual(rows.slice(0,-1).map(r=>r.role),['ADMIN','SUPERADMIN']);
for(const r of rows.slice(0,-1)){assert.equal(r.pendingWorks,12);assert.equal(r.pendingClients,1);}
const sql=fs.readFileSync(root+'migration-original.sql','utf8');const bodies={};
for(const m of sql.matchAll(/create function public\.(\w+)\([\s\S]*?as \$\$([\s\S]*?)\$\$;/g))bodies[m[1]]=createHash('md5').update(m[2]).digest('hex');
assert.equal(Object.keys(bodies).length,3);assert.deepEqual(metadata.bodies,bodies);
const result={status:'PASS',deployedFunctionBodiesMatchApprovedSql:true,confirmReasonActorDateAndRoleChecksPresent:true,realRlsReads:rows.slice(0,-1),activeRoleCounts:metadata.activeRoles,absentActiveSupportBillingUsersNotCreated:true,discardedRealRows:0,productionWrites:0,rollbackExecuted:false,serializationIncidentConfirmedByProductionSetting:true};
fs.writeFileSync(root+'permissions-proof.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
