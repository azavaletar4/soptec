// Sondeo puntual de señal en caché: solo GET NBI, nunca tareas/CWMP ni credenciales.
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const program=String.raw`
import assert from 'node:assert/strict';
const root='InternetGatewayDevice.LANDevice.1.';
const nbi=process.env.GENIEACS_NBI||'http://localhost:7557';
const query=encodeURIComponent(JSON.stringify({'_deviceId._SerialNumber':{$in:['HWTC1D3691B7','485754431D3691B7']}}));
const projection=['_id','_deviceId._SerialNumber','_lastInform',root+'Hosts.Host',root+'WLANConfiguration.1.AssociatedDevice',root+'WLANConfiguration.5.AssociatedDevice'].join(',');
const r=await fetch(nbi+'/devices/?query='+query+'&projection='+encodeURIComponent(projection),{method:'GET',signal:AbortSignal.timeout(15000)});
assert.ok(r.ok);const rows=await r.json();assert.equal(rows.length,1);const d=rows[0];
assert.equal(d._id,'00259E-HG8145X6%2D13-485754431D3691B7');
assert.equal(d._deviceId._SerialNumber,'485754431D3691B7');
const leaves=[];let associations=0;
function walk(node,p){
 if(!node||typeof node!=='object')return;
 const name=p.split('.').at(-1);
 if(/AssociatedDevice\.[1-9]\d*$/.test(p))associations++;
 if(/^(MACAddress|AssociatedDeviceMACAddress|InterfaceType|Layer2Interface|Active|X_HW_RSSI|X_HW_RSSIUnit|RSSI|RSSIUnit|SignalStrength|SignalStrengthUnit|SNR|Noise)$/.test(name)){
  leaves.push({path:p,valuePresent:Object.hasOwn(node,'_value'),...(Object.hasOwn(node,'_value')?{value:node._value}:{}),timestamp:node._timestamp??null,type:node._type??null});
 }
 for(const[k,v]of Object.entries(node))if(!k.startsWith('_'))walk(v,p+'.'+k);
}
walk(d.InternetGatewayDevice?.LANDevice?.[1],root.slice(0,-1));
console.log(JSON.stringify({checkedAt:new Date().toISOString(),deviceId:d._id,serial:d._deviceId._SerialNumber,lastInform:d._lastInform,readOnly:true,methods:['GET'],tasksSent:0,associations,leaves}));
`;
const python='import subprocess\np=subprocess.run(["docker","exec","smartrayco-backend-1","node","--input-type=module","-e",'+JSON.stringify(program)+'],capture_output=True,text=True,timeout=25)\nprint(p.stdout if p.returncode==0 else "READ_FAILED")\n';
const r=cp.spawnSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'],{input:python,encoding:'utf8',timeout:45000,windowsHide:true});
try{
 if(r.status!==0)throw Error('READ_FAILED');const result=JSON.parse(r.stdout);
 fs.writeFileSync('docs/TR069-HOSTS-SIGNAL-CACHE-20261028.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch{console.error('SIGNAL_CACHE_READ_FAILED');process.exitCode=1;}
