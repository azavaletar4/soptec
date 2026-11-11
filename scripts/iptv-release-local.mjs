// Paquete exclusivamente local; reutiliza build y publicador existentes.
// No SSH, push, despliegue, SQL ni limpieza de trabajo de otros agentes.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadEnv } from 'vite';

const root=fs.realpathSync.native(process.cwd()),args=process.argv.slice(2);
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const run=(bin,argv,cwd=root,env=process.env)=>execFileSync(bin,argv,{cwd,env,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
const git=(...argv)=>run('git',argv).trim();
const commit=git('rev-parse','HEAD'),base=option('--baseline','40e43c155b51d9fa847caf665c81b32ecd59c64a');
if(!/^[a-f0-9]{40}$/.test(base))throw Error('INVALID_BASELINE');
const python=option('--python',null);if(!python)throw Error('LOCAL_PYTHON_REQUIRED');
const paths=['src','index.html','vite.config.ts','package.json','package-lock.json','scripts/frontend-release-build.mjs','deploy/Dockerfile.frontend','deploy/frontend-release-policy.json'];
const rt=path.join(root,'scripts/inventory-auth-lab/runtime','iptv-'+commit.slice(0,12)+'-'+Date.now());
fs.mkdirSync(rt,{recursive:true});
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const preserved=Object.fromEntries(['release-source.json','deploy/consolidation-release-scope.json'].filter(f=>fs.existsSync(f)).map(f=>[f,hash(f)]));
const snapshot=path.join(rt,'release-source.json');
// El exportador exige fuentes canónicas limpias. Solo cambia la salida local.
run(process.execPath,['scripts/frontend-release-build.mjs','--export-snapshot','--snapshot-output',snapshot]);
const env={...process.env,...loadEnv('production',root,'VITE_'),VITE_MATERIAL_CUSTODY_LIVE_SINCE:'',NODE_ENV:'production',VITE_USER_NODE_ENV:'production'};
const baseline=path.join(rt,'baseline');fs.mkdirSync(baseline);
const archive=path.join(rt,'baseline.tar');run('git',['archive',base,'--format=tar','--output='+archive,...paths]);
run('tar.exe',['-xf','baseline.tar','-C',baseline],rt);
fs.symlinkSync(path.join(root,'node_modules'),path.join(baseline,'node_modules'),'junction');
const baselineFiles=Object.fromEntries(git('ls-tree','-r','--name-only',base,'--',...paths).split('\n').filter(Boolean).sort().map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(baseline,f),'utf8').replaceAll('\r\n','\n')).digest('hex')]));
const baselineSnapshot={commit:base,tree:git('rev-parse',base+'^{tree}'),consolidatedBase:JSON.parse(fs.readFileSync(path.join(baseline,'deploy/frontend-release-policy.json'),'utf8')).minimumConsolidatedCommit,files:baselineFiles};
fs.writeFileSync(path.join(baseline,'release-source.json'),JSON.stringify(baselineSnapshot));
fs.writeFileSync(path.join(rt,'baseline-build.log'),run(process.execPath,['scripts/frontend-release-build.mjs','--snapshot','release-source.json'],baseline,env));
// Compilar exactamente el archivo Git, sin docs/tests/archivos locales que
// Tailwind podría escanear. Mismo contexto de fuentes que el build remoto.
const sourceArchive=path.join(rt,'candidate.tar');run('git',['archive',commit,'--format=tar','--output='+sourceArchive,...paths]);
const canonical=path.join(rt,'canonical','dist'),repro=path.join(rt,'repro','dist');
for(const name of ['canonical','repro']){
 const folder=path.join(rt,name);fs.mkdirSync(folder);
 run('tar.exe',['-xf','candidate.tar','-C',folder],rt);
 fs.symlinkSync(path.join(root,'node_modules'),path.join(folder,'node_modules'),'junction');
 fs.copyFileSync(snapshot,path.join(folder,'release-source.json'));
 const buildArgs=['scripts/frontend-release-build.mjs','--snapshot','release-source.json'];
 if(name==='repro')buildArgs.push('--compare',canonical);
 fs.writeFileSync(path.join(rt,name+'-build.log'),run(process.execPath,buildArgs,folder,env));
}
const scope=path.join(rt,'scope.json');
const proof=JSON.parse(run(python,['scripts/iptv-release-scope.py',path.join(baseline,'dist'),canonical,scope]));
const packaged=JSON.parse(run(process.execPath,['scripts/frontend-consolidation-release.cjs','package','--scope',scope,'--snapshot',snapshot,
  '--migration','supabase/migrations/20261111140000_installation_iptv_mode.sql','--sql-rollback','scripts/rollback-installation-iptv-mode.sql']));
for(const[f,digest]of Object.entries(preserved))if(hash(f)!==digest)throw Error('PREVIOUS_RELEASE_INPUT_CHANGED:'+f);
const report={...proof,canonical,repro,snapshot,scope,package:packaged.package,
  migrationSha256:hash('supabase/migrations/20261111140000_installation_iptv_mode.sql'),
  rollbackSha256:hash('scripts/rollback-installation-iptv-mode.sql'),
  releaseManifestSha256:hash(path.join(canonical,'release-manifest.json')),
  reproducible:true,previousReleaseInputsPreserved:true,productionWrites:0,remoteActions:0};
fs.writeFileSync(path.join(rt,'verified.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,report:path.join(rt,'verified.json')}));
