// Solo caché NBI: nunca tareas ni acceso directo a ONT/OLT/MikroTik.
// El árbol LAN se inspecciona en memoria; jamás se exportan claves WiFi/SSID.
const cp=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const program=String.raw`
import assert from 'node:assert/strict';
const base=process.env.GENIEACS_NBI||'http://localhost:7557';
const query=encodeURIComponent(JSON.stringify({'_deviceId._SerialNumber':{$in:['HWTC1D3691B7','485754431D3691B7']}}));
const projection=encodeURIComponent('_id,_deviceId._SerialNumber,_lastInform,InternetGatewayDevice.LANDevice,InternetGatewayDevice.DeviceInfo.UpTime,Device.Hosts,Device.WiFi,Device.Ethernet,Device.DeviceInfo.UpTime');
const r=await fetch(base+'/devices/?query='+query+'&projection='+projection,{method:'GET',signal:AbortSignal.timeout(20000)});
assert.ok(r.ok);const rows=await r.json();assert.equal(rows.length,1,'Identidad no única');
const d=rows[0];assert.equal(d._id,'00259E-HG8145X6%2D13-485754431D3691B7');
const safe=new Set(['HostName','IPAddress','MACAddress','InterfaceType','Layer2Interface','Active','LeaseTimeRemaining','AddressSource','UpTime','LastChange','Status','Enable','Channel','AutoChannelEnable','OperatingFrequencyBand','Standard','RadioEnabled','TotalAssociations','AssociatedDeviceMACAddress','AssociatedDeviceIPAddress','AssociatedDeviceAuthenticationState','AuthenticationState','LastDataDownlinkRate','LastDataUplinkRate','SignalStrength','X_HW_AssociatedDeviceMACAddress','X_HW_RSSI','X_HW_NegotiatedRate','X_HW_Active','X_HW_Online','X_HW_OnlineTime','X_HW_UpTime','X_HW_InterfaceType','X_HW_Layer2Interface','Name','LowerLayers']);
const paths=[];
function walk(node,p){
 if(!node||typeof node!=='object')return;
 const name=p.split('.').at(-1);
 const entry={path:p,object:node._object??null,timestamp:node._timestamp??null,valuePresent:Object.hasOwn(node,'_value')};
 if(safe.has(name)&&Object.hasOwn(node,'_value'))entry.value=node._value;
 if(node._type)entry.type=node._type;
 paths.push(entry);
 for(const[k,v]of Object.entries(node))if(!k.startsWith('_')&&v&&typeof v==='object')walk(v,p+'.'+k);
}
for(const root of ['InternetGatewayDevice','Device'])if(d[root])walk(d[root],root);
console.log(JSON.stringify({checkedAt:new Date().toISOString(),deviceId:d._id,serial:d._deviceId._SerialNumber,lastInform:d._lastInform,readOnly:true,methods:['GET'],tasksSent:0,paths}));
`;
const python='import subprocess\np=subprocess.run(["docker","exec","smartrayco-backend-1","node","--input-type=module","-e",'+JSON.stringify(program)+'],capture_output=True,text=True,timeout=30)\nprint(p.stdout if p.returncode==0 else "READ_FAILED")\n';
const r=cp.spawnSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'],{input:python,encoding:'utf8',timeout:45000,windowsHide:true});
try{
 if(r.status!==0)throw Error('READ_FAILED');const result=JSON.parse(r.stdout);
 fs.writeFileSync('docs/TR069-HOSTS-INTERFACES-CACHE-20261028.json',JSON.stringify(result,null,2)+'\n');
 const relevant=result.paths.filter(p=>/Hosts|AssociatedDevice|Ethernet|UpTime|OperatingFrequencyBand|Channel|Standard|RadioEnabled|TotalAssociations|Status|LastChange/.test(p.path));
 console.log(JSON.stringify({...result,paths:relevant}));
}catch{console.error('READ_FAILED_DETAILS_WITHHELD');process.exitCode=1;}
