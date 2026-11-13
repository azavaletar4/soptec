// Solo transforma la evidencia privada de lectura; no abre conexiones.
import fs from 'node:fs';
import {countClientLifecycles,clientLifecycleStatus,classifyClientSection} from '../src/lib/clientLifecycle.ts';
import {countPendingInstallationClients} from '../src/lib/dashboardClients.ts';
import {summarizeDashboardSupport} from '../src/lib/dashboardSupport.ts';
import {createHash} from 'node:crypto';
const data=JSON.parse(fs.readFileSync('scripts/inventory-auth-lab/runtime/dashboard-support-prospects-private.json','utf8'));
if(data.read_only!=='on')throw Error('READONLY_EVIDENCE_REQUIRED');
const active={ticket:['open','in_progress','rescheduled'],routine:['pending','scheduled','in_progress'],installation:['pending','scheduled','in_progress']};
const jobs=data.active_orders;
const counts=rows=>({pending:rows.filter(r=>r.status!=='in_progress').length,inProgress:rows.filter(r=>r.status==='in_progress').length,urgent:rows.filter(r=>r.priority==='urgent').length});
const summary={readOnly:true,at:data.at,support:{oldTicketsOnly:{open:data.support_states.filter(r=>r.kind==='ticket'&&r.status==='open').reduce((n,r)=>n+r.amount,0),inProgress:data.support_states.filter(r=>r.kind==='ticket'&&r.status==='in_progress').reduce((n,r)=>n+r.amount,0)},byStatus:data.support_states,byKind:Object.fromEntries(Object.keys(active).map(kind=>[kind,counts(jobs.filter(j=>j.kind===kind))])),unified:counts(jobs),uniqueOrders:new Set(jobs.map(j=>j.kind+':'+j.id)).size},prospects:data.commercial_prospects.map((p,i)=>({label:'P'+(i+1),idSuffix:p.id.slice(-8),estado:p.estado,converted:!!p.converted_client_id,receipt:!!p.receipt,contracts:p.contracts.map(c=>c.status),installations:p.installations.map(i=>i.status),followups:p.followups})),clientLifecycle:countClientLifecycles(data.client_lifecycle_inputs),clientProspects:data.client_lifecycle_inputs.filter(c=>clientLifecycleStatus(c)==='prospect').map((c,i)=>({label:'C'+(i+1),idSuffix:c.id.slice(-8),status:c.status,contracts:c.service_contracts.map(s=>s.status),installations:c.installations.map(s=>s.status)})),schema:{enum:data.prospect_enums,functions:data.functions.map(f=>({name:f.name,owner:f.owner,md5:f.md5})),prospectPolicies:data.tables.filter(t=>['prospects','prospect_followups'].includes(t.name)).map(t=>({name:t.name,policies:t.policies,triggers:t.triggers}))},productionMutations:0};
const pending=JSON.parse(fs.readFileSync('scripts/inventory-auth-lab/runtime/dashboard-pending-prospects-private.json','utf8'));
const backupFile='scripts/inventory-auth-lab/runtime/dashboard-prospect-discard-schema-private.json';
const backupBytes=fs.readFileSync(backupFile),backup=JSON.parse(backupBytes);
if(pending.read_only!=='on'||backup.read_only!=='on')throw Error('READONLY_EVIDENCE_REQUIRED');
if(backup.existing_proposal_functions.length||backup.tables.find(t=>t.name==='clients').columns.some(c=>c.name.startsWith('prospect_discard')))throw Error('SCHEMA_BASELINE_CHANGED');
const operational=summarizeDashboardSupport(jobs.map(j=>({...j,jobType:j.kind,title:'',clients:null})));
delete operational.recent;
// El CRM fue consultado para distinguir modelos; no publica sus fichas ni los datos personales.
delete summary.prospects;
summary.operationalProspects={count:countPendingInstallationClients(data.client_lifecycle_inputs),section:'pending_install',
 referenceMatches:pending.pending_installation_clients.length===1&&pending.pending_installation_clients[0].first_name==='Manuel'&&pending.pending_installation_clients[0].last_name==='Romero Collantes',
 allSections:Object.fromEntries(['current','pending_install','unfulfilled','retired'].map(section=>[section,data.client_lifecycle_inputs.filter(c=>classifyClientSection(c)===section).length])),
 discardedMigrationApplied:false,commercialCrmUnchanged:true};
summary.correctedSupportUsingLocalHelper=operational;
summary.schemaBackup={file:backupFile,sha256:createHash('sha256').update(backupBytes).digest('hex'),at:backup.at,
 tables:backup.tables.map(t=>({name:t.name,owner:t.owner,rls:t.rls,sha256:createHash('sha256').update(JSON.stringify(t)).digest('hex')})),proposalFunctionsExist:false};
fs.writeFileSync('docs/DASHBOARD-SOPORTE-PROSPECTOS-DIAGNOSTICO-20261112.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({readOnly:true,productionMutations:0,support:operational,prospects:summary.operationalProspects,schemaBackup:summary.schemaBackup},null,2));
for(const name of ['current_user_role','convert_prospect_with_installation']){const f=data.functions.find(f=>f.name===name);if(f)fs.writeFileSync('scripts/inventory-auth-lab/runtime/dashboard-'+name+'-original.sql',f.definition+';\n');}
