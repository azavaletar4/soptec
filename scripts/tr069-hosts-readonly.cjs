// Diagnóstico puntual Hosts: exclusivamente GET de la caché NBI, sin tareas.
const cp = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const program = String.raw`
async function run() {
 const nbi=process.env.GENIEACS_NBI||'http://localhost:7557';
 const query=encodeURIComponent(JSON.stringify({'_deviceId._SerialNumber':{$in:['HWTC1D3691B7','485754431D3691B7']}}));
 const fields=['_lastInform','InternetGatewayDevice.LANDevice.1.Hosts.Host','InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice','InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.OperatingFrequencyBand','InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.AssociatedDevice','InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.OperatingFrequencyBand'];
 async function get(projection) {
  const r=await fetch(nbi+'/devices/?query='+query+'&projection='+encodeURIComponent(projection.join(',')),{method:'GET',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('READ_HTTP_'+r.status);
  return r.json();
 }
 const before=await get(fields);
 const after=await get(['_id','_deviceId._SerialNumber',...fields]);
 console.log(JSON.stringify({checkedAt:new Date().toISOString(),readOnly:true,methods:['GET'],tasksSent:0,before:before.map(d=>({deviceId:d._id,serialPresent:typeof d._deviceId?._SerialNumber==='string'})),after}));
}
run().catch(()=>{console.error('READ_FAILED');process.exitCode=1;});
`;
const python='import subprocess\np=subprocess.run(["docker","exec","smartrayco-backend-1","node","-e",'+JSON.stringify(program)+'],capture_output=True,text=True,timeout=50)\nprint(p.stdout if p.returncode == 0 else "READ_FAILED")\n';
try {
 const raw=cp.execFileSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'],{input:python,encoding:'utf8',timeout:60000,stdio:['pipe','pipe','pipe']});
 const result=JSON.parse(raw);
 fs.writeFileSync('docs/TR069-HOSTS-CACHE-20261028.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
} catch { console.error('READ_FAILED');process.exitCode=1; }
