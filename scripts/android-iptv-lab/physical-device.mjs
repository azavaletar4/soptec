// Acciones Android acotadas al paquete LAB; Campo normal solo aporta metadatos APK.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
export const runtime=path.resolve('scripts/inventory-auth-lab/runtime/android-iptv-1794411550984');
export const phone=path.join(runtime,'phone'),packageId='com.smartrayco.iptvlab';
const config=JSON.parse(fs.readFileSync(path.join(runtime,'prepared.json'),'utf8'));
const adb=args=>{try{return execFileSync('D:/Android/platform-tools/adb.exe',args,{encoding:'utf8',windowsHide:true,timeout:120000}).trim()}catch(e){if(e.status===1&&!e.stdout?.trim()&&!e.stderr?.trim()&&(args.includes('path')||args.includes('pidof')))return '';throw Error('ADB_ACTION_FAILED: '+args.filter((_,i)=>i!==1).join(' ')+'; '+String(e.stderr??'').replaceAll(args[1]??'', '[device]'));}};
export function device(){const rows=adb(['devices','-l']).split(/\r?\n/).slice(1).filter(Boolean).map(x=>x.trim().split(/\s+/));const list=rows.filter(x=>x[1]==='device'&&!x[0].startsWith('emulator-'));if(list.length!==1)throw Error('REQUIERE_UN_SOLO_ANDROID_AUTORIZADO');const serial=list[0][0];return {run:(...args)=>adb(['-s',serial,...args]),serialHash:createHash('sha256').update(serial).digest('hex')};}
export function productionMetadata(){const d=device(),dump=d.run('shell','dumpsys','package','com.smartrayco.app'),apk=d.run('shell','pm','path','com.smartrayco.app').split(/\r?\n/).find(x=>x.endsWith('/base.apk'))?.replace(/^package:/,'');return {package:'com.smartrayco.app',metadata:dump.split(/\r?\n/).map(x=>x.trim()).filter(x=>/^(versionCode=|versionName=|firstInstallTime=|lastUpdateTime=)/.test(x)),apkSha256:apk?d.run('shell','sha256sum',apk).split(/\s+/)[0]:null,applicationDataRead:false};}
export async function install(){
 const d=device();if(d.run('shell','pm','path',packageId))throw Error('LAB_YA_EXISTE_NO_REINSTALAR_SIN_REVISAR_DATOS');
 if(createHash('sha256').update(fs.readFileSync(config.apk)).digest('hex')!==config.apkSha256)throw Error('APK_HASH_DRIFT');
 const before=productionMetadata();fs.writeFileSync(path.join(phone,'production-before.json'),JSON.stringify(before,null,2)+'\n');
 const res=await fetch('http://127.0.0.1:4176/lab/state');if(!res.ok)throw Error('LAB_SERVER_NOT_READY');
 const mappings=d.run('reverse','--list');if(mappings.split(/\r?\n/).some(x=>x.includes('tcp:4176')&&!x.endsWith('tcp:4176 tcp:4176')))throw Error('USB_REVERSE_COLLISION');
 d.run('reverse','tcp:4176','tcp:4176');const result=d.run('install',config.apk);if(!result.includes('Success'))throw Error(result);
 d.run('shell','am','start','-n',packageId+'/com.smartrayco.app.MainActivity');return {installed:true,packageId,apkSha256:config.apkSha256,serialHash:d.serialHash};
}
export function restart(){const d=device();d.run('shell','am','force-stop',packageId);d.run('shell','am','start','-n',packageId+'/com.smartrayco.app.MainActivity');}
export async function connect({allowUnready=false}={}){
 const d=device();let endpoint,forwardPort;
 const deadline=Date.now()+20000;
 for(let n=0;n<80&&Date.now()<deadline;n++){
  const pid=d.run('shell','pidof',packageId).split(/\s+/)[0];if(!/^\d+$/.test(pid)){await new Promise(r=>setTimeout(r,250));continue;}
  try{const port=d.run('forward','tcp:0','localabstract:webview_devtools_remote_'+pid);const list=await(await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(2000)})).json();const target=list.find(x=>x.url?.startsWith('http://127.0.0.1:4176/scripts/android-iptv-lab/'));if(target){endpoint=target.webSocketDebuggerUrl;forwardPort=port;break}d.run('forward','--remove','tcp:'+port);}catch{}
  await new Promise(r=>setTimeout(r,250));
 }
 if(!endpoint)throw Error('LAB_DEVTOOLS_TARGET_NOT_FOUND');
 const ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CDP_OPEN_TIMEOUT')),5000);ws.onopen=()=>{clearTimeout(timer);resolve()};ws.onerror=e=>{clearTimeout(timer);reject(e)}});let seq=0;const pending=new Map(),exceptions=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails)};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP_TIMEOUT:'+method))},20000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r)},reject:e=>{clearTimeout(timer);reject(e)}});ws.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const until=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100))}throw Error('WAIT_TIMEOUT:'+expression)};
 await send('Runtime.enable');await send('Page.enable');if(!allowUnready)await until('window.ready===true');
 return {send,evaluate,until,exceptions,close:()=>{ws.close();if(forwardPort){try{d.run('forward','--remove','tcp:'+forwardPort)}catch{}}}};
}
