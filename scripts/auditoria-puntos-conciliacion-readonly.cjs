// Diagnostico de solo lectura: contrasta ordenes liquidadas (oficiales, desde
// 2026-11-01 00:00 America/Lima, creadas Y completadas en ese periodo) contra
// confirmaciones de puntos vigentes. Mismo patron SSH ya usado; no escribe nada.
const cp=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const program=`
import {supabaseAdmin} from './server/src/lib/supabaseAdmin.ts';
const CUTOFF='2026-11-01T05:00:00.000Z'; // 00:00 America/Lima
const out={cutoffUtc:CUTOFF};
async function check(jobType, table, doneExpr) {
 const {data, error} = await supabaseAdmin.rpc('exec_readonly_point_check', {p_job_type: jobType});
 return {data, error};
}
// Sin RPC generico: tres consultas directas, una por tipo, via vistas simples.
const {data:tix,error:te}=await supabaseAdmin.from('tickets').select('id,created_at,resolved_at,closed_at,status').in('status',['resolved','closed']).gte('created_at',CUTOFF);
out.ticketsError=te?.code??null;
const {data:inst,error:ie}=await supabaseAdmin.from('installations').select('id,created_at,completed_at,status').eq('status','completed').gte('created_at',CUTOFF);
out.installationsError=ie?.code??null;
const {data:rut,error:re}=await supabaseAdmin.from('routines').select('id,created_at,completed_at,status').eq('status','completed').gte('created_at',CUTOFF);
out.routinesError=re?.code??null;
const candidates=[];
for (const t of tix??[]) { const done=t.resolved_at??t.closed_at; if (done && done>=CUTOFF) candidates.push({jobType:'ticket', jobId:t.id, done}); }
for (const i of inst??[]) { if (i.completed_at && i.completed_at>=CUTOFF) candidates.push({jobType:'installation', jobId:i.id, done:i.completed_at}); }
for (const r of rut??[]) { if (r.completed_at && r.completed_at>=CUTOFF) candidates.push({jobType:'routine', jobId:r.id, done:r.completed_at}); }
out.officialEligibleCount=candidates.length;
let withConfirmation=0, withoutConfirmation=0; const missing=[];
for (const c of candidates) {
 const {data:conf,error:ce}=await supabaseAdmin.from('work_order_point_confirmations').select('id,points,invalidated_at').eq('job_type',c.jobType).eq('job_id',c.jobId).is('invalidated_at',null).maybeSingle();
 if (ce) { out.confirmationQueryError=ce.code; continue; }
 if (conf) withConfirmation++; else { withoutConfirmation++; missing.push({jobType:c.jobType, jobIdPrefix:c.jobId.slice(0,8), done:c.done}); }
}
out.withConfirmation=withConfirmation; out.withoutConfirmation=withoutConfirmation; out.missingSample=missing.slice(0,10);
console.log(JSON.stringify(out));
`;
const r=cp.spawnSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=15','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'],{input:String.raw`import subprocess,json,pathlib
d=json.loads(subprocess.check_output(['docker','inspect','smartrayco-backend-1'],text=True))[0]
net=next(iter(d['NetworkSettings']['Networks']))
envfile='/opt/smartrayco-staging/frontend-consolidado-tr069-27fa249-6cc2b1f09b/backend-env-private'
p=subprocess.run(['docker','run','--rm','--network',net,'--env-file',envfile,'smartrayco-backend-wifitrial:27fa249b4ddb','node','--import','tsx','--input-type=module','-e',${JSON.stringify(program)}],capture_output=True,text=True)
print(json.dumps({'code':p.returncode,'stdout':p.stdout.strip(),'stderr':p.stderr[-1500:]}))
`,encoding:'utf8',timeout:60000,windowsHide:true});
if(r.status!==0){console.error('SSH_FAILED',r.stderr);process.exitCode=1;}else{
 console.log(r.stdout);
 fs.writeFileSync('docs/AUDITORIA-PUNTOS-CONCILIACION-READONLY-20261101.json', r.stdout.trim()+'\n');
}
