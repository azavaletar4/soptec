// Solo Docker local y navegador sintético. Nunca arranca backend/schedulers.
import { execFileSync } from 'node:child_process';
const source='scripts/inventory-auth-lab/runtime/pppoe-publication/source';
const commit=execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const image='smartrayco-pppoe-frontend:'+commit.slice(0,12);
const docker=args=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trim();
let cid;
try{
  // Nginx no puede alcanzar el backend real: backend resuelve al propio localhost.
  // Chrome bloquea Supabase y reemplaza todas las peticiones API por fixtures.
  cid=docker(['run','-d','--network','bridge','--add-host','backend:127.0.0.1','-p','127.0.0.1:5194:80',image]);
  if(!/^[a-f0-9]{64}$/.test(cid))throw Error('INVALID_LOCAL_CONTAINER_ID');
  let ready=false;
  for(let i=0;i<50;i++){
    try{const response=await fetch('http://127.0.0.1:5194/');if(response.ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!ready)throw Error('LOCAL_STATIC_FRONTEND_NOT_READY');
  const result=execFileSync(process.execPath,['scripts/tests/dashboard-pppoe-browser.mjs','--static'],{encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
  console.log(result.trim());
}finally{
  if(cid)docker(['rm','-f',cid]);
}
