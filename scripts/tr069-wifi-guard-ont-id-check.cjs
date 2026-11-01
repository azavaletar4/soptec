// Diagnostics only: solo lectura contra Supabase de produccion via el contenedor backend real,
// mismo patron que scripts/tr069-release-build-diagnostic.cjs. No escribe nada.
const cp=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const py=String.raw`import subprocess,json,pathlib
s=pathlib.Path('/opt/smartrayco-staging/frontend-consolidado-tr069-f55e482-5f8aac2f54')
d=json.loads(subprocess.check_output(['docker','inspect','smartrayco-backend-1'],text=True))[0]
net=next(iter(d['NetworkSettings']['Networks']))
program="import {supabaseAdmin} from './server/src/lib/supabaseAdmin.ts';import {normalizeGponSerial} from './src/lib/gponSerial.ts';const CONTRACT_ID='bf6b0f88-3c55-4c9b-aca2-5dfa739e738c';const {data:onts,error}=await supabaseAdmin.from('olt_onts').select('id,serial,contract_id,client_id,retired_at').eq('contract_id',CONTRACT_ID).is('retired_at',null);const {data:contract,error:ce}=await supabaseAdmin.from('service_contracts').select('id,contract_number,client_id,status').eq('id',CONTRACT_ID).maybeSingle();const {data:rows,error:te}=await supabaseAdmin.from('tr069_devices').select('genieacs_id,cpe_serial,service_contract_id').eq('genieacs_id','485754431D3691B7');console.log(JSON.stringify({ontsErrorCode:error?.code??null,ontsCount:onts?.length??null,ontRows:onts?.map(r=>({id:r.id,serialMatches:normalizeGponSerial(r.serial)==='HWTC1D3691B7',hasClientId:!!r.client_id,retiredAt:r.retired_at}))??null,contractErrorCode:ce?.code??null,contractOk:contract?(contract.contract_number==='CTR-2026-00214'&&contract.status==='active'):null,clientMatches:(contract&&onts&&onts[0])?(contract.client_id===onts[0].client_id):null,tr069ErrorCode:te?.code??null,tr069Count:rows?.length??null,tr069AssocOk:rows&&rows[0]?(normalizeGponSerial(rows[0].cpe_serial)==='HWTC1D3691B7'&&(rows[0].service_contract_id===null||rows[0].service_contract_id===CONTRACT_ID)):null}));"
p=subprocess.run(['docker','run','--rm','--network',net,'--env-file',str(s/'backend-env-private'),'smartrayco-backend-wifitrial:f55e48292b57','node','--import','tsx','--input-type=module','-e',program],capture_output=True,text=True)
print(json.dumps({'code':p.returncode,'stdout':p.stdout.strip(),'stderr':p.stderr[-800:]}))
`;
const r=cp.spawnSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=15','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'],{input:py,encoding:'utf8',timeout:60000,windowsHide:true});
if(r.status!==0){console.error('SSH_FAILED',r.stderr);process.exitCode=1;}else{
  console.log(r.stdout);
  fs.writeFileSync('docs/TR069-WIFI-GUARD-ONT-ID-CHECK-20261101.json', r.stdout.trim()+'\n');
}
