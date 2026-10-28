// Solo empaqueta/promueve software; nunca llama endpoints de tareas GenieACS.
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const action=process.argv[2],root=process.cwd();
if(!['prepare','build','deploy','verify','rollback'].includes(action))throw Error('INVALID_ACTION');
const snapshot=JSON.parse(fs.readFileSync('release-source.json','utf8'));
const stage='/opt/smartrayco-staging/frontend-consolidado-tr069-'+snapshot.commit.slice(0,7)+'-20261027';
const ssh=['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201'];
const backNames=['server/src/routes/genieacs.ts','server/src/routes/genieacsSync.ts','server/src/routes/tr069WifiPreparation.ts','server/src/middleware/tr069PreparationOnly.ts','server/src/services/tr069WifiPreparation.ts','server/src/services/tr069WifiTrial.ts','src/lib/gponSerial.ts','src/lib/tr069WifiPlan.ts','src/lib/tr069WifiTrial.ts'];
// Alcance exacto del diff de frontend de esta release (fabc136 vs 288f2d8):
// src/views/tr069/Tr069View.vue + src/lib/tr069WifiTrial.ts (se compila junto,
// mismo chunk). Verificado con `git diff --stat 288f2d8 fabc136 -- src/` y una
// comparacion de builds reales: es el UNICO chunk con contenido distinto una
// vez neutralizado el renombrado en cascada de Vite. Si una release futura
// reutiliza este script con un alcance de frontend distinto, este arreglo
// debe actualizarse (no es generico todavia).
const frontAllow=['assets/Tr069View.js'];
if(action==='prepare'){
 const rt=path.resolve('../frontend-consolidation-artifacts');fs.mkdirSync(rt,{recursive:true});
 const archive=path.join(rt,'source.tar');
 cp.execFileSync('git',['archive',snapshot.commit,'--format=tar','--output='+archive,'src','index.html','vite.config.ts','package.json','package-lock.json','scripts/frontend-release-build.mjs','deploy/Dockerfile.frontend','deploy/frontend-release-policy.json']);
 cp.execFileSync('tar.exe',['-rf',archive,'release-source.json']);
 const input={stage,commit:snapshot.commit,back:Object.fromEntries(backNames.map(f=>[f,fs.readFileSync(f,'utf8')]))};
 const file=path.join(rt,'input.json');fs.writeFileSync(file,JSON.stringify(input));
 cp.execFileSync('ssh',[...ssh,'python3 -'],{input:'import pathlib\np=pathlib.Path('+JSON.stringify(stage)+');assert not p.exists();p.mkdir(mode=0o700)\n',stdio:['pipe','pipe','pipe']});
 for(const[local,name]of[[archive,'source.tar'],[file,'input.json']])cp.execFileSync('scp',['-q','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),local,'root@192.168.55.201:'+stage+'/'+name],{stdio:['ignore','pipe','pipe']});
}
const py=fs.readFileSync('scripts/frontend-consolidation-release.py','utf8');
const source='ACTION='+JSON.stringify(action)+'\nSTAGE='+JSON.stringify(stage)+'\nFRONT_ALLOW='+JSON.stringify(frontAllow)+'\ntry:\n'+py.split('\n').map(l=>' '+l).join('\n')+'\nexcept Exception as e:\n print(json.dumps({"ok":False,"type":type(e).__name__,"reason":str(e) if isinstance(e,AssertionError) else "Private log in staging"}));sys.exit(1)\n';
const result=cp.spawnSync('ssh',[...ssh,'python3 -'],{input:source,encoding:'utf8',timeout:900000,windowsHide:true,maxBuffer:4*1024*1024});
try{const data=JSON.parse(result.stdout);fs.writeFileSync(path.resolve('../frontend-consolidation-'+action+'.json'),JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify(data));}catch{console.error('RELEASE_FAILED_DETAILS_WITHHELD');}
if(result.status!==0)process.exitCode=1;
