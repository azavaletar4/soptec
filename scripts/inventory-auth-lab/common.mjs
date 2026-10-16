import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
export const root=fileURLToPath(new URL('../../',import.meta.url));
export const here=fileURLToPath(new URL('./',import.meta.url));
export const runtime=here+'runtime/';
export const project='smartrayco-inventory-auth-lab';
export const gateway='http://127.0.0.1:54381';
export const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
export function config(){const c=JSON.parse(readFileSync(runtime+'config.json','utf8'));if(c.gateway!==gateway||c.project!==project)throw Error('Configuración no autorizada');return c;}
export function sql(statement){return docker(['exec','-i',project+'-db','psql','-U','postgres','-d','inventory_lab','-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],statement).trim();}
export const wait=async(check)=>{for(let n=0;n<80;n++){try{if(await check())return;}catch{}await new Promise(r=>setTimeout(r,250));}throw Error('Servicio local no disponible');};
