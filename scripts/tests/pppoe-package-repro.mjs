// Solo pruebas locales: TAR real, metadatos alterados y rechazos de integridad.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const base='deploy/pppoe-20261112';
const prep=JSON.parse(fs.readFileSync(base+'/preparation.json','utf8'));
const snapshot='scripts/inventory-auth-lab/runtime/pppoe-publication/release-source.json';
const root=fs.mkdtempSync(path.resolve('scripts/inventory-auth-lab/runtime/pppoe-publication/tar-repro-'));
const fixture=path.join(root,'snapshot');fs.mkdirSync(fixture);
const copy=path.join(fixture,'release-source.json');fs.copyFileSync(snapshot,copy);
const hash=data=>createHash('sha256').update(data).digest('hex');
const run=(bin,args,options={})=>execFileSync(bin,args,{encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024,...options});
const sourcePaths=['src','index.html','vite.config.ts','package.json','package-lock.json','scripts/frontend-release-build.mjs','deploy/Dockerfile.frontend','deploy/frontend-release-policy.json'];
const inspectCode=String.raw`import tarfile,json,hashlib,sys,collections
def inspect(file):
 with tarfile.open(file) as t:
  entries=list(t); files={m.name:hashlib.sha256(t.extractfile(m).read()).hexdigest() for m in entries if m.isfile()}
  assert len(files)==sum(m.isfile() for m in entries),'DUPLICATE_FILE'
  metadata={m.name:{'mtime':m.mtime,'uid':m.uid,'gid':m.gid,'uname':m.uname,'gname':m.gname,'mode':oct(m.mode),'type':m.type.decode(),'pax':m.pax_headers} for m in entries}
  assert all(m.isfile() or m.isdir() for m in entries),'UNEXPECTED_TYPE'
  raw=open(file,'rb').read();formats=set();types=collections.Counter();at=0
  while at+512<=len(raw) and any(raw[at:at+512]):
   h=raw[at:at+512];formats.add((h[257:263].decode(),h[263:265].decode()));types[h[156:157].decode()]+=1
   size=int(h[124:136].strip(b'\x00 ') or b'0',8);at+=512+((size+511)//512)*512
  return {'files':files,'metadata':metadata,'order':[m.name for m in entries],'formats':sorted(formats),'headerTypes':dict(types)}
a,b=map(inspect,sys.argv[1:3])
assert a['files']==b['files'],'FILE_CONTENT_CHANGED'
changes=collections.Counter();examples={}
for name in sorted(set(a['metadata'])|set(b['metadata'])):
 x,y=a['metadata'].get(name),b['metadata'].get(name)
 if x is None or y is None:changes['entry_presence']+=1;continue
 for key in x:
  if x[key]!=y[key]:
   changes[key]+=1
   if key not in examples:examples[key]={'entry':name,'before':x[key],'after':y[key]}
summary={'fileCount':len(b['files']),'contentsEqual':True,'orderEqual':a['order']==b['order'],'formatsBefore':a['formats'],'formatsAfter':b['formats'],'headerTypesBefore':a['headerTypes'],'headerTypesAfter':b['headerTypes'],'metadataChanges':dict(changes),'examples':examples,'canonical':{
 'mtimes':sorted(set(m['mtime'] for m in b['metadata'].values())),
 'owners':sorted(set((m['uid'],m['gid'],m['uname'],m['gname']) for m in b['metadata'].values())),
 'modesByType':{typ:sorted(set(m['mode'] for m in b['metadata'].values() if m['type']==typ)) for typ in set(m['type'] for m in b['metadata'].values())},
 'paxKeys':sorted(set(k for m in b['metadata'].values() for k in m['pax'])),
 'orderSha256':hashlib.sha256(json.dumps(b['order'],separators=(',',':')).encode()).hexdigest()}}
print(json.dumps(summary))`;
const inspect=(a,b)=>JSON.parse(run('python',['-c',inspectCode,a,b]));
const legacy=[];
for(let attempt=0;attempt<2;attempt++){
 fs.utimesSync(copy,new Date(`200${attempt+1}-01-01T00:00:00Z`),new Date('2000-01-01T00:00:00Z'));
 const file=path.join(root,'legacy-'+attempt+'.tar');
 run('git',['archive',prep.sourceCommit,'--format=tar','--output='+file,...sourcePaths]);
 run('tar.exe',['-rf',path.basename(file),'-C',fixture,'release-source.json'],{cwd:root});
 legacy.push(file);
}
assert.notEqual(hash(fs.readFileSync(legacy[0])),hash(fs.readFileSync(legacy[1])));
const legacyDifference=inspect(...legacy);
assert.equal(legacyDifference.fileCount,317);assert.equal(legacyDifference.orderEqual,true);
assert.ok(legacyDifference.metadataChanges.pax>0);
const checks=['LEGACY_METADATA_FAILURE_REPRODUCED_WITH_IDENTICAL_317_FILES'];
const packages=[];
const call=(action,localRoot,extra=[])=>{
 const args=['scripts/frontend-consolidation-release.cjs',action,'--scope',base+'/scope.json','--snapshot',copy,'--local-root',localRoot,...extra];
 return JSON.parse(run(process.execPath,args));
};
for(let attempt=0;attempt<2;attempt++){
 fs.chmodSync(copy,0o644);
 fs.utimesSync(copy,new Date(`201${attempt+1}-01-01T00:00:00Z`),new Date(`202${attempt+1}-01-01T00:00:00Z`));
 fs.chmodSync(copy,attempt?0o444:0o644);
 const localRoot=path.join(root,'new-'+attempt);
 const result=call('package',localRoot);
 const manifest=fs.readFileSync(result.package);
 const pkg=JSON.parse(manifest);
 const folder=path.dirname(result.package);
 const before=Object.fromEntries(['package.json',...Object.keys(pkg.files)].map(name=>[name,{hash:hash(fs.readFileSync(path.join(folder,name))),mtime:fs.statSync(path.join(folder,name)).mtimeMs}]));
 const prepared=call('prepare',localRoot,['--local']);assert.equal(prepared.prepared,true);
 // Repetir package tampoco debe tocar los bytes o fechas de un artefacto validado.
 call('package',localRoot);
 for(const [name,old]of Object.entries(before)){
  assert.equal(hash(fs.readFileSync(path.join(folder,name))),old.hash);
  assert.equal(fs.statSync(path.join(folder,name)).mtimeMs,old.mtime);
 }
 packages.push({folder,manifestHash:hash(manifest),files:pkg.files,localRoot});
}
fs.chmodSync(copy,0o644);
assert.deepEqual(packages[0].files,packages[1].files);
assert.equal(packages[0].manifestHash,packages[1].manifestHash);
const normalized=inspect(path.join(packages[0].folder,'source.tar'),path.join(packages[1].folder,'source.tar'));
assert.deepEqual(normalized.metadataChanges,{});assert.equal(normalized.orderEqual,true);
assert.ok(!normalized.canonical.paxKeys.includes('atime'));assert.ok(!normalized.canonical.paxKeys.includes('ctime'));
assert.equal(normalized.canonical.mtimes.length,1);
const previousArchive=path.join(path.dirname(prep.package),'source.tar');
const previousComparison=inspect(previousArchive,path.join(packages[0].folder,'source.tar'));
assert.equal(previousComparison.fileCount,317);
checks.push('TWO_PACKAGES_AND_LOCAL_PREPARES_IDENTICAL','MTIME_ATIME_PERMISSIONS_INDEPENDENT','NO_ATIME_CTIME_IN_CANONICAL_TAR','NO_VALIDATED_FILE_REWRITTEN','317_FILES_MATCH_STOPPED_ARCHIVE');
function rejected(rootPath,pattern){
 const result=spawnSync(process.execPath,['scripts/frontend-consolidation-release.cjs','prepare','--local','--local-root',rootPath,'--scope',base+'/scope.json','--snapshot',copy],{encoding:'utf8',windowsHide:true});
 assert.notEqual(result.status,0);assert.match(result.stderr,pattern);
}
for(const name of ['source.tar','input.json']){
 const file=path.join(packages[0].folder,name),original=fs.readFileSync(file),changed=Buffer.from(original);
 changed[0]^=1;fs.writeFileSync(file,changed);
 try{rejected(packages[0].localRoot,new RegExp('PACKAGE_DRIFT:'+name.replaceAll('.','\\.')));assert.deepEqual(fs.readFileSync(file),changed);}
 finally{fs.writeFileSync(file,original);}
 checks.push('REJECTS_TAMPERED_'+name);
}
const originalSnapshot=fs.readFileSync(copy);
fs.appendFileSync(copy,'\n');
try{rejected(packages[0].localRoot,/PACKAGE_REGENERATION_DRIFT:source\.tar/);}
finally{fs.writeFileSync(copy,originalSnapshot);}
checks.push('REJECTS_CHANGED_SNAPSHOT');
const manifestPath=path.join(packages[0].folder,'package.json'),manifestBytes=fs.readFileSync(manifestPath);
const modified=JSON.parse(manifestBytes);modified.toolHash='0'.repeat(64);fs.writeFileSync(manifestPath,JSON.stringify(modified));
try{rejected(packages[0].localRoot,/PACKAGE_CONTRACT_DRIFT/);}
finally{fs.writeFileSync(manifestPath,manifestBytes);}
checks.push('REJECTS_CHANGED_PACKAGE_CONTRACT');
rejected(path.join(root,'missing'),/VALIDATED_PACKAGE_REQUIRED/);checks.push('REJECTS_PREPARE_WITHOUT_PACKAGE');
const report={status:'PASS',localOnly:true,sourceCommit:prep.sourceCommit,originalValidatedTarAvailable:false,
 originalValidatedTarSha256:JSON.parse(fs.readFileSync(prep.package)).files['source.tar'],
 stoppedTarSha256:hash(fs.readFileSync(previousArchive)),legacyHashes:legacy.map(file=>hash(fs.readFileSync(file))),legacyDifference,
 packages:packages.map(({folder,manifestHash,files})=>({folder,manifestHash,files})),normalized,previousComparison,checks,
 sshCalls:0,productionWrites:0,supabaseWrites:0,mikrotikRequests:0};
fs.writeFileSync(base+'/tar-reproducibility.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:'PASS',checks:checks.length,sourceTarSha256:packages[0].files['source.tar'],packageManifestSha256:packages[0].manifestHash,report:base+'/tar-reproducibility.json',productionWrites:0}));
