// Verificación focalizada: código real del contenedor + GET de caché; nunca tareas.
const cp=require('node:child_process'),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const mode=process.argv[2];if(!['before','after'].includes(mode))throw Error('INVALID_MODE');
const commit=mode==='after'?'d6ce2c2':'5d48a10';
const expectedHash=crypto.createHash('sha256').update(cp.execFileSync('git',['show',commit+':server/src/services/tr069Hosts.ts'])).digest('hex');
const program=String.raw`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {readHostsInventory} from './server/src/services/tr069Hosts.ts';
const mode=process.argv[1],expectedHash=process.argv[2];
assert.equal(crypto.createHash('sha256').update(fs.readFileSync('server/src/services/tr069Hosts.ts')).digest('hex'),expectedHash,'Código Hosts distinto del commit declarado');
const base=process.env.GENIEACS_NBI||'http://localhost:7557';
const native=globalThis.fetch;let requests=0;
globalThis.fetch=async(url,init)=>{assert.equal(init?.method,'GET');assert.equal(new URL(url).pathname,'/devices/');requests++;return native(url,init);};
const q=encodeURIComponent(JSON.stringify({'_deviceId._SerialNumber':{$in:['HWTC1D3691B7','485754431D3691B7']}}));
const response=await fetch(base+'/devices/?query='+q+'&projection=_id,_deviceId._SerialNumber,InternetGatewayDevice.LANDevice.1.Hosts.Host',{method:'GET'});
assert.ok(response.ok);const rows=await response.json();assert.equal(rows.length,1,'La identidad debe ser única');
assert.equal(rows[0]._id,'00259E-HG8145X6%2D13-485754431D3691B7');assert.equal(rows[0]._deviceId._SerialNumber,'485754431D3691B7');
const rawHosts=Object.entries(rows[0].InternetGatewayDevice?.LANDevice?.[1]?.Hosts?.Host||{}).filter(([k])=>/^[1-9]\d*$/.test(k)).map(([,h])=>({hostName:h.HostName?._value??null,ipAddress:h.IPAddress?._value??null,macAddress:h.MACAddress?._value??null}));
assert.equal(rawHosts.length,5,'Se esperaban los cinco Hosts registrados');
const canonical=await readHostsInventory(base,'HWTC1D3691B7');
if(mode==='after'){
 const hex=await readHostsInventory(base,'485754431D3691B7');
 for(const inv of [canonical,hex]){
  assert.equal(inv.found,true);assert.equal(inv.deviceId,rows[0]._id);assert.equal(inv.hosts.length,5);
  assert.deepEqual(inv.hosts.map(({hostName,ipAddress,macAddress})=>({hostName,ipAddress,macAddress})),rawHosts,'Hosts distintos a la caché de esta ONT');
 }
 const missing=await readHostsInventory(base,'HWTC00000000');assert.equal(missing.found,false);assert.deepEqual(missing.hosts,[]);
}else assert.equal(canonical.found,false,'El baseline anterior debe reproducir el defecto');
console.log(JSON.stringify({readOnly:true,mode,uniqueCandidates:rows.length,deviceId:rows[0]._id,rawHosts,inventory:canonical,requests,methods:['GET'],tasksSent:0,codeSha256:expectedHash}));
`;
const python='import subprocess,json\ndef run(a):return subprocess.check_output(a,text=True).strip()\nout={"services":{}}\nfor s in ["frontend","backend","caddy","mongo","genieacs"]:\n d=json.loads(run(["docker","inspect","smartrayco-"+s+"-1"]))[0]\n out["services"][s]={"image":d["Image"],"tag":d["Config"]["Image"],"started":d["State"]["StartedAt"],"running":d["State"]["Running"]}\nout["frontendCommit"]=json.loads(run(["docker","exec","smartrayco-frontend-1","cat","/usr/share/nginx/html/release-manifest.json"]))["commit"]\nout["hosts"]=json.loads(run(["docker","exec","smartrayco-backend-1","node","--import","tsx","--input-type=module","-e",'+JSON.stringify(program)+','+JSON.stringify(mode)+','+JSON.stringify(expectedHash)+']))\nprint(json.dumps(out))\n';
const result=cp.spawnSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'],{input:python,encoding:'utf8',timeout:60000,windowsHide:true});
try{
 if(result.status!==0)throw Error('READ_FAILED');const data=JSON.parse(result.stdout);
 const folder='scripts/inventory-auth-lab/runtime/consolidation-release';fs.mkdirSync(folder,{recursive:true});
 fs.writeFileSync(path.join(folder,'hosts-'+mode+'.json'),JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify(data));
}catch{console.error('HOSTS_VERIFICATION_FAILED_DETAILS_WITHHELD');process.exitCode=1;}
