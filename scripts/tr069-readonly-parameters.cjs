const cp = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const remote = String.raw`
const run=async()=>{
 const query=encodeURIComponent(JSON.stringify({'_deviceId._SerialNumber':'485754431D3691B7'}));
 const res=await fetch((process.env.GENIEACS_NBI||'http://localhost:7557')+'/devices/?query='+query,{signal:AbortSignal.timeout(20000)});
 if(!res.ok)throw Error('NBI_HTTP_'+res.status);
 const rows=await res.json(); if(rows.length!==1)throw Error('EXPECTED_ONE_DEVICE');
 const d=rows[0], leaves=[], objects=[];
 function walk(obj,p='') { if(!obj||typeof obj!=='object')return;
  if('_value' in obj){
   const relevant=/WLANConfiguration|WiFi\.|WANPPPConnection|WANIPConnection|DeviceInfo\.|ManagementServer\.(PeriodicInform|ConnectionRequestURL)|PPP\.|IP\.Interface/.test(p);
   if(!relevant)return;
   const secret=/password|passphrase|presharedkey|wepkey|secret|credential|username/i.test(p);
   const allowed=/(^|\.)(SSID|Enable|Status|ConnectionStatus|Username|ConnectionType|Name|ServiceList|X_HW_SERVICELIST|X_HW_VLAN|VLANID|ExternalIPAddress|AddressingType|Standard|OperatingFrequencyBand|PossibleChannels|Channel|AutoChannelEnable|RadioEnabled|BeaconType|WPAEncryptionModes|WPAAuthenticationMode|IEEE11iEncryptionModes|IEEE11iAuthenticationMode|ModeEnabled|ModelName|Manufacturer|ProductClass|HardwareVersion|SoftwareVersion|PeriodicInformInterval|LastConnectionError|Uptime|LowerLayers|X_HW_Band|X_HW_Standard)$/.test(p);
   leaves.push({path:p,value:secret?'[REDACTED]':allowed?obj._value:'[VALUE_WITHHELD]',hasCachedValue:obj._value!==null&&obj._value!==undefined,type:obj._type??null,writable:obj._writable??null,timestamp:obj._timestamp??null});return;
  }
  if(p && /WLANConfiguration|WANPPPConnection|WANIPConnection|WiFi|PPP/.test(p))objects.push({path:p,object:obj._object??null,writable:obj._writable??null,type:obj._type??null});
  for(const [k,v]of Object.entries(obj))if(!k.startsWith('_'))walk(v,p?p+'.'+k:k);
 }
 walk(d);
 const out={checkedAt:new Date().toISOString(),readOnly:true,source:'GenieACS NBI GET /devices, cache only; no tasks or refresh',deviceId:d._id,lastInform:d._lastInform,roots:['InternetGatewayDevice','Device'].filter(k=>d[k]),cachedObjects:objects,parameters:leaves};
 console.log(JSON.stringify(out));
};run().catch(()=>{console.error('READ_ONLY_QUERY_FAILED_DETAILS_WITHHELD');process.exitCode=1;});
`;
const py='import subprocess\np=subprocess.run(["docker","exec","smartrayco-backend-1","node","-e",'+JSON.stringify(remote)+'],capture_output=True,text=True,timeout=55)\nprint(p.stdout if p.returncode==0 else "READ_ONLY_QUERY_FAILED_DETAILS_WITHHELD")\n';
try {
 const result=cp.execFileSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'],{input:py,encoding:'utf8',timeout:60000,stdio:['pipe','pipe','pipe']});
 const data=JSON.parse(result);
 fs.writeFileSync('docs/TR069-HUAWEI-PARAMETROS-SOLO-LECTURA-20261027.json',JSON.stringify(data,null,2)+'\n');
 console.log(JSON.stringify({checkedAt:data.checkedAt,lastInform:data.lastInform,roots:data.roots,metadataNodes:data.cachedObjects.length,valuedParameters:data.parameters.length,pppNodes:data.cachedObjects.filter(p=>/WANPPPConnection/.test(p.path)).length}));
}catch {console.error('READ_ONLY_QUERY_FAILED_DETAILS_WITHHELD');process.exitCode=1;}
