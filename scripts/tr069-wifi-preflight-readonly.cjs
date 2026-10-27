// Preflight puntual: GET de caché NBI y metadatos de vínculo, sin tareas ni escrituras.
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const program = String.raw`
async function run(){
 const serial='HWTC1D3691B7',hex='485754431D3691B7';
 const get=async(url,headers={})=>{const r=await fetch(url,{method:'GET',headers,signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('READ_HTTP_'+r.status);return r.json();};
 const nbi=process.env.GENIEACS_NBI||'http://localhost:7557';
 const query=encodeURIComponent(JSON.stringify({'_deviceId._SerialNumber':{$regex:'^(HWTC1D3691B7|485754431D3691B7)$',$options:'i'}}));
 const devices=await get(nbi+'/devices/?query='+query);
 const out={checkedAt:new Date().toISOString(),readOnly:true,methods:['GET'],gponSerial:serial,genieacsCandidates:[]};
 for(const d of devices){
  const candidate={deviceId:d._id,reportedSerial:d._deviceId?._SerialNumber,lastInform:d._lastInform,networks:[]};
  const lans=d.InternetGatewayDevice?.LANDevice||{};
  for(const [lanIndex,lan]of Object.entries(lans))if(/^[1-9]\d*$/.test(lanIndex)){
   for(const[index,wlan]of Object.entries(lan.WLANConfiguration||{}))if(/^[1-9]\d*$/.test(index)){
    const ssid=wlan.SSID||{};
    candidate.networks.push({path:'InternetGatewayDevice.LANDevice.'+lanIndex+'.WLANConfiguration.'+index,
     ssid:typeof ssid._value==='string'?ssid._value:null,timestamp:ssid._timestamp??null,writable:ssid._writable??null,
     enabled:typeof wlan.Enable?._value==='boolean'?wlan.Enable._value:null,
     band:wlan.OperatingFrequencyBand?._value==='2.4GHz'?'2.4 GHz':wlan.OperatingFrequencyBand?._value==='5GHz'?'5 GHz':'Banda desconocida'});
   }
  }
  out.genieacsCandidates.push(candidate);
 }
 const base=process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!base||!key)throw Error('READ_ENV_UNAVAILABLE');
 const rest=route=>get(base+'/rest/v1/'+route,{apikey:key,Authorization:'Bearer '+key});
 out.onts=await rest('olt_onts?or=(serial.ilike.'+serial+',serial.ilike.'+hex+')&select=id,serial,client_id,contract_id,retired_at');
 const ids=[...new Set(out.onts.map(o=>o.contract_id).filter(Boolean))];
 out.contracts=[];out.clients=[];out.contractOnts=[];
 for(const id of ids){
  const cs=await rest('service_contracts?id=eq.'+encodeURIComponent(id)+'&select=id,client_id,contract_number,client_code,status');
  out.contracts.push(...cs);
  out.contractOnts.push(...await rest('olt_onts?contract_id=eq.'+encodeURIComponent(id)+'&retired_at=is.null&select=id,serial,client_id,contract_id,retired_at'));
 }
 const clientIds=[...new Set([...out.onts,...out.contracts].map(o=>o.client_id).filter(Boolean))];
 for(const id of clientIds)out.clients.push(...await rest('clients?id=eq.'+encodeURIComponent(id)+'&select=id,first_name,last_name,client_code'));
 out.tr069Rows=await rest('tr069_devices?or=(cpe_serial.ilike.'+serial+',cpe_serial.ilike.'+hex+')&select=id,cpe_serial,genieacs_id,service_contract_id,last_seen_at');
 out.sameGenieacsRows=[];
 for(const d of out.genieacsCandidates)out.sameGenieacsRows.push(...await rest('tr069_devices?genieacs_id=eq.'+encodeURIComponent(d.deviceId)+'&select=id,cpe_serial,genieacs_id,service_contract_id,last_seen_at'));
 out.pendingTasks=[];
 for(const d of out.genieacsCandidates){
  const q=encodeURIComponent(JSON.stringify({device:d.deviceId}));
  const tasks=await get(nbi+'/tasks/?query='+q+'&projection=_id,name,timestamp,expiry');
  out.pendingTasks.push({deviceId:d.deviceId,count:tasks.length,tasks:tasks.map(t=>({id:t._id,name:t.name,timestamp:t.timestamp??null,expiry:t.expiry??null}))});
 }
 console.log(JSON.stringify(out));
}
run().catch(e=>{console.log(JSON.stringify({readOnly:true,error:/^READ_(HTTP_\d+|ENV_UNAVAILABLE)$/.test(e.message)?e.message:'READ_FAILED_DETAILS_WITHHELD'}));process.exitCode=1;});
`;
const python='import subprocess\np=subprocess.run(["docker","exec","smartrayco-backend-1","node","-e",'+JSON.stringify(program)+'],capture_output=True,text=True,timeout=55)\nprint(p.stdout if p.stdout else "{}")\n';
try{
 const raw=cp.execFileSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'],{input:python,encoding:'utf8',timeout:60000,stdio:['pipe','pipe','pipe']});
 const result=JSON.parse(raw);if(result.error||!result.checkedAt)throw Error(result.error||'READ_FAILED_DETAILS_WITHHELD');
 fs.writeFileSync('docs/TR069-WIFI-PREFLIGHT-SOLO-LECTURA-20261027.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
}catch(e){console.error(/^READ_/.test(e.message)?e.message:'READ_FAILED_DETAILS_WITHHELD');process.exitCode=1;}
