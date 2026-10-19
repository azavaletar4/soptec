import fs from 'node:fs';import path from 'node:path';import{spawnSync}from'node:child_process';import{createHash}from'node:crypto';
export const root=path.resolve(import.meta.dirname,'..');
export const pointer=path.join(root,'scripts/inventory-auth-lab/runtime/custody-integral-lab-location.json');
export const backup='C:/Users/USER/AppData/Local/SmartRaycoBackups/custodia_etapa2_integral_20261019_182951_05783296';
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function save(file,data){fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});}
export function config(){const p=JSON.parse(fs.readFileSync(pointer));const c=JSON.parse(fs.readFileSync(path.join(p.directory,'config.json')));if(!c.project.startsWith('smartrayco-custody-integral-')||c.gateway!=='http://127.0.0.1:54421'||path.dirname(p.directory)!==path.join(process.env.LOCALAPPDATA,'SmartRaycoLabs'))throw Error('LAB_IDENTITY');return c;}
export function docker(args,input='',timeout=600000){const p=spawnSync('docker',args,{input,encoding:'utf8',timeout,windowsHide:true,maxBuffer:40*1024*1024});if(p.status!==0){const e=Error('LOCAL_DOCKER_OPERATION_FAILED');e.privateError=p.stderr||p.error?.code||'';throw e;}return p.stdout.trim();}
export function sql(query,c=config()){return docker(['exec','-i',c.project+'-db','psql','-X','-q','-At','-h','/tmp','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],query);}
export function compose(c,args){return docker(['compose','--project-name',c.project,'-f',path.join(c.directory,'compose.json'),...args]);}
export async function wait(check,attempts=80){for(let i=0;i<attempts;i++){try{const r=await check();if(r)return r;}catch{}await new Promise(r=>setTimeout(r,500));}throw Error('LOCAL_READINESS_TIMEOUT');}
export function localFetch(input,init){const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(u.hostname!=='127.0.0.1'||!['54421','54422','54423'].includes(u.port))throw Error('EXTERNAL_FETCH_BLOCKED');return fetch(input,{...init,redirect:'error',signal:AbortSignal.timeout(30000)});}
