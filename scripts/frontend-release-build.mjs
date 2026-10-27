// Compilación canónica: commit limpio o snapshot verificado, lockfile y entorno público identificados.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { build, loadEnv } from 'vite';
const cwd=process.cwd(),args=process.argv.slice(2),hash=x=>createHash('sha256').update(x).digest('hex');
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const out=option('--out','dist');
if(!/^dist(?:-[a-z0-9-]+)?$/.test(out)||path.dirname(path.resolve(out))!==cwd)throw Error('OUTSIDE_RELEASE_OUTPUT');
const git=(...a)=>execFileSync('git',a,{encoding:'utf8',cwd}).trim();
const sourcePaths=['src','index.html','vite.config.ts','package.json','package-lock.json','scripts/frontend-release-build.mjs','deploy/Dockerfile.frontend','deploy/frontend-release-policy.json'];
const policy=JSON.parse(fs.readFileSync('deploy/frontend-release-policy.json','utf8'));
const digestFile=f=>hash(fs.readFileSync(f,'utf8').replaceAll('\r\n','\n'));
let source;
if(args.includes('--snapshot')){
 source=JSON.parse(fs.readFileSync(option('--snapshot'),'utf8'));
 if(!/^[a-f0-9]{40}$/.test(source.commit)||!source.files||source.consolidatedBase!==policy.minimumConsolidatedCommit||process.env.SOURCE_COMMIT&&source.commit!==process.env.SOURCE_COMMIT)throw Error('SOURCE_COMMIT_MISMATCH');
 for(const[f,h]of Object.entries(source.files))if(path.isAbsolute(f)||f.split('/').includes('..')||digestFile(f)!==h)throw Error('SOURCE_FILE_MISMATCH: '+f);
}else{
 const dirty=git('status','--porcelain','--untracked-files=all','--',...sourcePaths);
 if(dirty)throw Error('RELEASE_REQUIRES_CLEAN_TRACKED_SOURCES');
 git('merge-base','--is-ancestor',policy.minimumConsolidatedCommit,'HEAD');
 source={commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),consolidatedBase:policy.minimumConsolidatedCommit,files:{}};
 for(const f of git('ls-files','--',...sourcePaths).split('\n').filter(Boolean).sort())source.files[f]=digestFile(f);
}
if(source.files['package-lock.json']!==digestFile('package-lock.json'))throw Error('LOCKFILE_MISMATCH');
for(const file of policy.requiredSources)if(!source.files[file])throw Error('PRODUCTIVE_COMPONENT_MISSING: '+file);
if(args.includes('--export-snapshot')){fs.writeFileSync('release-source.json',JSON.stringify(source,null,2)+'\n');console.log(JSON.stringify({commit:source.commit,sourceFiles:Object.keys(source.files).length,snapshot:'release-source.json'}));process.exit(0);}
const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));
const require=createRequire(import.meta.url);
for(const n of ['vite','vue','pinia','vue-router','@vitejs/plugin-vue','@tailwindcss/vite']){
 const installedPath=require.resolve.paths(n).map(p=>path.join(p,n,'package.json')).find(p=>fs.existsSync(p));
 const installed=JSON.parse(fs.readFileSync(installedPath,'utf8')).version;
 if(installed!==lock.packages['node_modules/'+n]?.version)throw Error('INSTALLED_DEPENDENCY_MISMATCH: '+n);
}
await build({root:cwd,build:{outDir:out,emptyOutDir:true,manifest:true}});
const env={...loadEnv('production',cwd,'VITE_'),...Object.fromEntries(Object.entries(process.env).filter(([k])=>k.startsWith('VITE_')))};
const config=Object.fromEntries(['VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY','VITE_MATERIAL_CUSTODY_LIVE_SINCE'].map(k=>[k,hash(env[k]??'')]));
if(!env.VITE_SUPABASE_URL||!env.VITE_SUPABASE_ANON_KEY)throw Error('RELEASE_PUBLIC_CONFIGURATION_MISSING');
const files={};
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else files[path.relative(out,f).replaceAll('\\','/')]=hash(fs.readFileSync(f));}}
walk(out);
const manifest={version:1,commit:source.commit,tree:source.tree,sourceFiles:source.files,lockSha256:source.files['package-lock.json'],configurationHashes:config,artifacts:files};
fs.writeFileSync(path.join(out,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
if(args.includes('--compare')){
 const other=JSON.parse(fs.readFileSync(path.join(option('--compare'),'release-manifest.json'),'utf8'));
 if(JSON.stringify(manifest)!==JSON.stringify(other))throw Error('NON_REPRODUCIBLE_RELEASE');
}
console.log(JSON.stringify({commit:source.commit,files:Object.keys(files).length,manifest:out+'/release-manifest.json',comparison:args.includes('--compare')?'IDENTICAL':null}));
