// Lectura activa autorizada 28/10: dos lotes acotados, sin credenciales ni reintento.
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const action=process.argv[2];if(!['preflight','send','status','send-interfaces','status-interfaces','cancel-interfaces'].includes(action))throw Error('INVALID_ACTION');
const program=String.raw`
import assert from 'node:assert/strict';
import fs from 'node:fs';
const action=process.argv[1],id='00259E-HG8145X6%2D13-485754431D3691B7';
const interfaces=action.endsWith('-interfaces'),sending=action==='send'||action==='send-interfaces';
const journal='/tmp/smartrayco-hosts-active-read-20261028-step'+(interfaces?'2':'1')+'.json';
const base=process.env.GENIEACS_NBI||'http://localhost:7557';
const root='InternetGatewayDevice.LANDevice.1.';
const parameters=interfaces?[...[1,5].flatMap(i=>['X_HW_RFBand','Channel','Standard','TotalAssociations','AssociatedDevice.'].map(p=>root+'WLANConfiguration.'+i+'.'+p)),root+'LANEthernetInterfaceConfig.']:[1,2,3,4,5].flatMap(i=>['Active','InterfaceType','Layer2Interface'].map(p=>root+'Hosts.Host.'+i+'.'+p));
assert.equal(parameters.length,interfaces?11:15);
assert.ok(parameters.every(p=>interfaces?/^InternetGatewayDevice\.LANDevice\.1\.(WLANConfiguration\.[15]\.(X_HW_RFBand|Channel|Standard|TotalAssociations|AssociatedDevice\.)|LANEthernetInterfaceConfig\.)$/.test(p):/^InternetGatewayDevice\.LANDevice\.1\.Hosts\.Host\.[1-5]\.(Active|InterfaceType|Layer2Interface)$/.test(p)));
async function get(collection,query,projection){
 const r=await fetch(base+'/'+collection+'/?query='+encodeURIComponent(JSON.stringify(query))+(projection?'&projection='+encodeURIComponent(projection):''),{method:'GET',signal:AbortSignal.timeout(15000)});
 assert.ok(r.ok,'GET_HTTP_'+r.status);return r.json();
}
async function inspect(){
 const projection=['_id','_deviceId._SerialNumber','_lastInform','InternetGatewayDevice.DeviceInfo.UpTime',root+'Hosts.Host',root+'LANEthernetInterfaceConfig',...[1,5].flatMap(i=>['AssociatedDevice','X_HW_RFBand','Channel','Standard','TotalAssociations'].map(p=>root+'WLANConfiguration.'+i+'.'+p))].join(',');
 const rows=await get('devices',{'_deviceId._SerialNumber':{$in:['HWTC1D3691B7','485754431D3691B7']}},projection);
 assert.equal(rows.length,1,'IDENTITY_NOT_UNIQUE');const d=rows[0];assert.equal(d._id,id);assert.equal(d._deviceId._SerialNumber,'485754431D3691B7');
 const tasks=await get('tasks',{device:id},'_id,name,timestamp,expiry,parameterNames,objectName');
 const faults=await get('faults',{_id:{$regex:'^'+id+':'}},'_id,code,timestamp,retries,detail.faultCode,detail.faultString,detail.name,detail.message');
 return {checkedAt:new Date().toISOString(),device:d,tasks,faults};
}
try{
 const state=await inspect();
 let record=fs.existsSync(journal)?JSON.parse(fs.readFileSync(journal,'utf8')):null;
 if(action==='cancel-interfaces'){
  assert.equal(record?.taskId,'6ae27187220eb9ba9f4c3580');assert.equal(record.deviceId,id);
  const task=state.tasks.find(t=>t._id===record.taskId);assert.ok(task,'EXACT_TASK_NOT_PENDING');assert.equal(task.name,'getParameterValues');assert.deepEqual(task.parameterNames,parameters);
  assert.ok(state.faults.some(f=>f._id===id+':task_'+record.taskId),'EXACT_FAULT_NOT_FOUND');
  const r=await fetch(base+'/tasks/'+encodeURIComponent(record.taskId),{method:'DELETE',signal:AbortSignal.timeout(15000)});
  assert.ok(r.ok,'CANCEL_HTTP_'+r.status);
  const remaining=await get('tasks',{device:id},'_id,name');assert.equal(remaining.length,0,'PENDING_TASKS_AFTER_CANCEL');
  record={...record,state:'cancelledAfterFault',cancelledAt:new Date().toISOString(),cancelHttpStatus:r.status};fs.writeFileSync(journal,JSON.stringify(record));
  state.cancellation={taskId:record.taskId,httpStatus:r.status,tasksRemaining:remaining.length,faultEvidenceCapturedBeforeDelete:true};
 }
 if(action==='preflight'||sending){
  const age=Date.now()-Date.parse(state.device._lastInform);assert.ok(Number.isFinite(age)&&age>=0&&age<=10*60_000,'INFORM_NOT_RECENT');
  assert.equal(state.tasks.length,0,'TASKS_PENDING');
 }
 if(sending){
  assert.equal(state.faults.length,0,'FAULTS_PRESENT_STOP');
  if(interfaces){
   const first=JSON.parse(fs.readFileSync('/tmp/smartrayco-hosts-active-read-20261028-step1.json','utf8'));
   assert.equal(first.state,'accepted');assert.ok(Date.parse(state.device._lastInform)>Date.parse(first.at),'FIRST_TASK_NEEDS_LATER_INFORM');
   for(const i of [1,2,3,4,5])assert.ok(Date.parse(state.device.InternetGatewayDevice.LANDevice[1].Hosts.Host[i].Active._timestamp)>Date.parse(first.at),'FIRST_TASK_VALUES_NOT_VERIFIED');
  }
  assert.equal(record,null,'ALREADY_ATTEMPTED_DO_NOT_REPEAT');
  const attempt={at:new Date().toISOString(),deviceId:id,name:'getParameterValues',parameterNames:parameters,baselineInform:state.device._lastInform,baselineFaults:state.faults,state:'sending'};
  const fd=fs.openSync(journal,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(attempt));fs.fsyncSync(fd);fs.closeSync(fd);
  // Sin connection_request: espera el siguiente Inform periódico, sin forzar sesión.
  try{
   const r=await fetch(base+'/devices/'+encodeURIComponent(id)+'/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'getParameterValues',parameterNames:parameters}),signal:AbortSignal.timeout(20000)});
   const body=await r.json();assert.ok([200,202].includes(r.status),'TASK_HTTP_'+r.status);assert.equal(typeof body._id,'string','MISSING_TASK_ID');
   record={...attempt,state:'accepted',httpStatus:r.status,taskId:body._id};fs.writeFileSync(journal,JSON.stringify(record));
  }catch(e){record={...attempt,state:'uncertain',error:e.message};fs.writeFileSync(journal,JSON.stringify(record));}
 }
 console.log(JSON.stringify({action,readParameters:parameters,record,...state,configurationWrites:0,reboots:0,connectionRequests:0}));
}catch(e){console.log(JSON.stringify({action,ok:false,error:e.message,doNotRetry:true}));process.exitCode=1;}
`;
const python='import subprocess\np=subprocess.run(["docker","exec","smartrayco-backend-1","node","--input-type=module","-e",'+JSON.stringify(program)+','+JSON.stringify(action)+'],capture_output=True,text=True,timeout=55)\nprint(p.stdout if p.stdout else "READ_FAILED")\n';
const r=cp.spawnSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'],{input:python,encoding:'utf8',timeout:65000,windowsHide:true});
try{
 if(r.status!==0)throw Error('SSH_FAILED_NO_RETRY');const result=JSON.parse(r.stdout);
 const file='docs/TR069-HOSTS-ACTIVE-READ-20261028.json';const history=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];
 history.push(result);fs.writeFileSync(file,JSON.stringify(history,null,2)+'\n');
 const lan=result.device?.InternetGatewayDevice?.LANDevice?.[1];
 console.log(JSON.stringify({...result,device:result.device?{id:result.device._id,lastInform:result.device._lastInform,hosts:Object.entries(lan?.Hosts?.Host||{}).filter(([k])=>/^[1-9]\d*$/.test(k)).map(([index,h])=>({index,name:h.HostName?._value,mac:h.MACAddress?._value,active:h.Active,interfaceType:h.InterfaceType,layer2:h.Layer2Interface})),wlans:lan?.WLANConfiguration,ethernet:lan?.LANEthernetInterfaceConfig}:undefined}));
 if(result.ok===false||result.record?.state==='uncertain')process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}
