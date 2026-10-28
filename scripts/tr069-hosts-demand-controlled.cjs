// Ensayo único de e2c7bf7 en /tmp del backend; nunca reemplaza código de /app.
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),crypto=require('node:crypto');
const action=process.argv[2];if(!['preflight','run','inspect','cleanup'].includes(action))throw Error('INVALID_ACTION');
const evidenceFile='docs/TR069-HOSTS-DEMAND-CONTROLLED-20261028.json';
if(action==='run'&&fs.existsSync(evidenceFile)&&JSON.parse(fs.readFileSync(evidenceFile,'utf8')).some(e=>e.test?.trace?.some(t=>t.method==='POST')))throw Error('ALREADY_ATTEMPTED_NO_RETRY');
const commit=cp.execFileSync('git',['rev-parse','e2c7bf7'],{encoding:'utf8'}).trim();
const root='/tmp/smartrayco-hosts-e2c7bf7-controlled-20261028';
const sources={};
for(const name of ['server/src/services/tr069HostsOnDemand.ts','server/src/services/tr069Hosts.ts','server/src/services/tr069HostsSignal.ts','src/lib/gponSerial.ts','src/lib/tr069Hosts.ts'])sources[name]=cp.execFileSync('git',['show',commit+':'+name],{encoding:'utf8'});
const hashes=Object.fromEntries(Object.entries(sources).map(([p,text])=>[p,crypto.createHash('sha256').update(text).digest('hex')]));
const program=String.raw`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const action=process.argv[1],root=process.argv[2],hashes=JSON.parse(process.argv[3]);
const id='00259E-HG8145X6%2D13-485754431D3691B7',serial='HWTC1D3691B7';
const nbi=process.env.GENIEACS_NBI||'http://localhost:7557';
const trace=[];const native=globalThis.fetch;
async function request(url,init){
 const u=new URL(url),method=init?.method??'GET';
 assert.equal(u.origin,new URL(nbi).origin);
 const event={at:new Date().toISOString(),method,path:u.pathname+u.search};
 if(method==='POST'){
  assert.equal(action,'run');assert.equal(u.pathname,'/devices/'+encodeURIComponent(id)+'/tasks');
  const body=JSON.parse(init.body);assert.equal(body.name,'getParameterValues');assert.ok(body.parameterNames.length<=512);
  assert.ok(body.parameterNames.every(p=>p.startsWith('InternetGatewayDevice.LANDevice.1.')&&!/SSID|Password|Passphrase|PreSharedKey|WANDevice/.test(p)&&!p.endsWith('.')));
  // Un solo POST autorizado, persistido antes de enviarlo. Nunca se borra para reintentar.
  fs.writeFileSync(root+'/post-attempt.json',JSON.stringify({at:event.at,body}),{flag:'wx',mode:0o600});event.body=body;
 }else if(method==='DELETE'){
  const sent=JSON.parse(fs.readFileSync(root+'/send-result.json','utf8'));
  assert.ok(sent.taskId);assert.equal(u.pathname,'/tasks/'+encodeURIComponent(sent.taskId));
  assert.ok(action==='cleanup'||action==='run');
 }else assert.equal(method,'GET');
 trace.push(event);
 const r=await native(url,init);event.httpStatus=r.status;
 if(method==='POST'){
  const body=await r.clone().json();fs.writeFileSync(root+'/send-result.json',JSON.stringify({taskId:body._id??null,httpStatus:r.status}));
 }
 return r;
}
async function get(collection,query,projection){
 const r=await request(nbi+'/'+collection+'/?query='+encodeURIComponent(JSON.stringify(query))+'&projection='+encodeURIComponent(projection),{method:'GET',signal:AbortSignal.timeout(10000)});
 assert.ok(r.ok,'GET_HTTP_'+r.status);return r.json();
}
async function inspect(){
 const rows=await get('devices',{'_deviceId._SerialNumber':{$in:[serial,'485754431D3691B7']}},'_id,_deviceId._SerialNumber,_lastInform,InternetGatewayDevice.LANDevice.1.Hosts.Host');
 assert.equal(rows.length,1,'IDENTITY_NOT_UNIQUE');assert.equal(rows[0]._id,id);assert.equal(rows[0]._deviceId._SerialNumber,'485754431D3691B7');
 const tasks=await get('tasks',{device:id},'_id,name,device,timestamp,expiry,parameterNames');
 const faults=await get('faults',{_id:{$regex:'^'+id+':'}},'_id,code,timestamp,retries,detail.name,detail.message,detail.faultCode,detail.faultString');
 return {checkedAt:new Date().toISOString(),device:rows[0],tasks,faults};
}
let result;
try{
 for(const[p,h]of Object.entries(hashes))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(root+'/'+p)).digest('hex'),h,'SOURCE_HASH_MISMATCH');
 const before=await inspect();
 if(action==='preflight'||action==='run'){
  const age=Date.now()-Date.parse(before.device._lastInform);assert.ok(age>=0&&age<=600000,'INFORM_NOT_RECENT');
  assert.equal(before.tasks.length,0,'PENDING_TASKS');assert.equal(before.faults.length,0,'FAULTS_PRESENT');
  assert.ok(!fs.existsSync(root+'/post-attempt.json'),'ALREADY_ATTEMPTED_NO_RETRY');
 }
 if(action==='run'){
  const {createHostsOnDemand}=await import(root+'/server/src/services/tr069HostsOnDemand.ts');
  const service=createHostsOnDemand({request,enabled:()=>true,directory:root+'/journal'});
  result=await service.read(nbi,serial);fs.writeFileSync(root+'/service-result.json',JSON.stringify(result));
 }
 if(action==='cleanup'){
  const sent=JSON.parse(fs.readFileSync(root+'/send-result.json','utf8'));
  const own=before.tasks.find(t=>t._id===sent.taskId);
  if(own){
   const attempt=JSON.parse(fs.readFileSync(root+'/post-attempt.json','utf8'));
   assert.equal(own.name,'getParameterValues');assert.equal(own.device,id);assert.deepEqual(own.parameterNames,attempt.body.parameterNames);
   const r=await request(nbi+'/tasks/'+encodeURIComponent(sent.taskId),{method:'DELETE',signal:AbortSignal.timeout(10000)});assert.ok(r.ok);
  }
 }
 const after=action==='preflight'?before:await inspect();
 const output={action,sourceCommit:'e2c7bf7',sourceHashes:hashes,baseline:before,result,after,trace,taskCreated:trace.filter(t=>t.method==='POST').length,productionGateEnabled:process.env.TR069_HOSTS_ON_DEMAND_ENABLED==='true',configurationWrites:0,reboots:0};
 console.log(JSON.stringify(output));
}catch(e){console.log(JSON.stringify({action,ok:false,error:e.message,result,trace,doNotRetry:true}));process.exitCode=1;}
`;
const install=String.raw`const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert');const d=JSON.parse(fs.readFileSync(0,'utf8'));fs.mkdirSync(d.root,{recursive:true,mode:0o700});for(const[p,text]of Object.entries({...d.sources,'package.json':'{"type":"module"}'})){const file=path.join(d.root,p);assert.ok(file.startsWith(d.root+'/'));fs.mkdirSync(path.dirname(file),{recursive:true});if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),text);else fs.writeFileSync(file,text,{mode:0o600});}`;
const python='import subprocess,json\ndef run(a):return subprocess.check_output(a,text=True).strip()\nout={"services":{}}\nfor s in ["frontend","backend","caddy","mongo","genieacs"]:\n d=json.loads(run(["docker","inspect","smartrayco-"+s+"-1"]))[0]\n out["services"][s]={"id":d["Id"],"image":d["Image"],"tag":d["Config"]["Image"],"started":d["State"]["StartedAt"],"running":d["State"]["Running"]}\nout["manifestCommit"]=json.loads(run(["docker","exec","smartrayco-frontend-1","cat","/usr/share/nginx/html/release-manifest.json"]))["commit"]\nout["health"]=json.loads(run(["curl","--fail","--silent","--max-time","10","--resolve","panel.rayconetworks.com:443:127.0.0.1","https://panel.rayconetworks.com/api/health"]))\n'+
(action==='preflight'?'p=subprocess.run(["docker","exec","-i","smartrayco-backend-1","node","-e",'+JSON.stringify(install)+'],input='+JSON.stringify(JSON.stringify({root,sources}))+',capture_output=True,text=True,timeout=20)\nassert p.returncode==0,"SOURCE_STAGE_FAILED"\n':'')+
'p=subprocess.run(["docker","exec","smartrayco-backend-1","node","--import","tsx","--input-type=module","-e",'+JSON.stringify(program)+','+JSON.stringify(action)+','+JSON.stringify(root)+','+JSON.stringify(JSON.stringify(hashes))+'],capture_output=True,text=True,timeout=90)\nout["test"]=json.loads(p.stdout) if p.stdout else {"ok":False,"error":"PRIVATE_EXEC_LOG"}\nprint(json.dumps(out))\n';
const r=cp.spawnSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'],{input:python,encoding:'utf8',timeout:110000,windowsHide:true});
try{
 if(r.status!==0)throw Error('CONTROLLED_TEST_FAILED_NO_RETRY');const data=JSON.parse(r.stdout);
 const file='docs/TR069-HOSTS-DEMAND-CONTROLLED-20261028.json';const history=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];
 history.push(data);fs.writeFileSync(file,JSON.stringify(history,null,2)+'\n');
 const t=data.test,dev=t.after?.device;
 console.log(JSON.stringify({...data,test:{...t,baseline:t.baseline?{lastInform:t.baseline.device?._lastInform,tasks:t.baseline.tasks,faults:t.baseline.faults}:undefined,after:dev?{lastInform:dev._lastInform,tasks:t.after.tasks,faults:t.after.faults}:t.after}}));
 if(t.ok===false)process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}
