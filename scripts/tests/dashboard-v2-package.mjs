// Integridad del paquete sellado: solo lecturas y copias locales para rechazos.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const folder=path.resolve('deploy/dashboard-v2-20261112'),pkg=JSON.parse(fs.readFileSync(path.join(folder,'package.json'),'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex'),digest=p=>hash(fs.readFileSync(p));
const approved=digest(path.join(folder,'package.json')),checks=[];
const call=(directory,expected=approved)=>spawnSync(process.execPath,['scripts/prepare-dashboard-v2-publication.mjs','--verify','--package-dir',directory,...(expected?['--expected-package-sha256',expected]:[])],{windowsHide:true,encoding:'utf8'});
const previous=Object.fromEntries(['package.json','SHA256SUMS',...Object.keys(pkg.files)].map(p=>[p,{hash:digest(path.join(folder,p)),mtime:fs.statSync(path.join(folder,p)).mtimeMs}]));
for(let repeat=0;repeat<2;repeat++){const result=call(folder);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).packageSha256,approved);}
for(const [p,value]of Object.entries(previous)){assert.equal(digest(path.join(folder,p)),value.hash);assert.equal(fs.statSync(path.join(folder,p)).mtimeMs,value.mtime);}
checks.push('TWO_READONLY_VERIFICATIONS_IDENTICAL_NO_REGENERATION_OR_OVERWRITE');
const temp=fs.mkdtempSync(path.resolve('scripts/inventory-auth-lab/runtime/dashboard-v2-publication/negative-package-'));
fs.copyFileSync(path.join(folder,'package.json'),path.join(temp,'package.json'));fs.copyFileSync(path.join(folder,'SHA256SUMS'),path.join(temp,'SHA256SUMS'));
const bytes=fs.readFileSync(path.join(folder,'source.tar'));bytes[0]^=1;fs.writeFileSync(path.join(temp,'source.tar'),bytes);
let rejected=call(temp);assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/PACKAGE_DRIFT:source\.tar/);checks.push('REJECTS_SINGLE_BYTE_TAR_CORRUPTION');
const foreign={...pkg,services:['backend','frontend']};fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify(foreign));
rejected=call(temp);assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/APPROVED_PACKAGE_DIGEST_DRIFT/);checks.push('REJECTS_CHANGED_MANIFEST_AGAINST_EXTERNAL_DIGEST');
rejected=call(temp,null);assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/AssertionError/);checks.push('REJECTS_BACKEND_SERVICE_SCOPE');
for(const [expected,pattern]of [['0'.repeat(64),/PACKAGE_NOT_APPROVED/],[approved,/WRONG_DEPLOYMENT_DIRECTORY/]]){
 const result=spawnSync('python',[path.join(folder,'publish.py'),'preflight','--expected-package-sha256',expected],{encoding:'utf8',windowsHide:true});
 assert.notEqual(result.status,0);assert.match(result.stderr,pattern);
}
checks.push('REMOTE_CONTROLLER_REJECTS_UNAPPROVED_HASH_AND_WRONG_DIRECTORY_BEFORE_DOCKER');
const python=String.raw`import tarfile,json,sys,pathlib,hashlib
source,artifacts,snapshot,plan=map(pathlib.Path,sys.argv[1:5]);expected=set(json.loads(snapshot.read_text())['files'])|{'release-source.json'}
baseline=json.loads(plan.read_text())['beforeSiteHashes']
with tarfile.open(source) as t:
 entries=list(t);files=[m for m in entries if m.isfile()]
 assert len({m.name for m in entries})==len(entries),'DUPLICATE_SOURCE_ENTRY'
 assert {m.name for m in files}==expected,'SOURCE_ENTRY_SCOPE_DRIFT'
 assert all(m.isfile() or m.isdir() for m in entries),'NON_REGULAR_SOURCE_ENTRY'
 assert all(m.uid==m.gid==0 for m in entries),'NON_CANONICAL_OWNER'
 assert len({m.mtime for m in entries})==1,'NON_CANONICAL_MTIME'
 assert all(not({'atime','ctime'}&set(m.pax_headers)) for m in entries),'VOLATILE_METADATA'
 assert not any(m.name.startswith(('server/','supabase/','prototypes/','docs/','scripts/tests/')) for m in files),'FORBIDDEN_SOURCE_PATH'
 metadata={'sourceFiles':len(files),'owners':[0,0],'mtime':files[0].mtime,'modes':sorted({oct(m.mode) for m in entries}),'volatileMetadata':False}
with tarfile.open(artifacts) as t:
 entries=list(t)
 assert all(m.isfile() and not m.name.startswith('/') and '..' not in m.name.split('/') for m in entries),'UNSAFE_SITE_ENTRY'
 assert all(m.name in ['index.html','release-manifest.json','.vite/manifest.json'] or m.name.startswith('assets/') or m.name in baseline and hashlib.sha256(t.extractfile(m).read()).hexdigest()==baseline[m.name] for m in entries),'NON_FRONTEND_SITE_ENTRY'
 metadata['frontendFiles']=len(entries)
print(json.dumps(metadata))`;
const tar=JSON.parse(execFileSync('python',['-c',python,path.join(folder,'source.tar'),path.join(folder,'frontend-artifacts.tar'),path.join(folder,'release-source.json'),path.join(folder,'deployment-plan.json')],{windowsHide:true,encoding:'utf8'}));
assert.equal(tar.sourceFiles,319);checks.push('CANONICAL_319_SOURCE_FILES_AND_FRONTEND_ONLY_ARTIFACTS');
const reportPath=path.join(folder,'package-guard-tests.json'),report=JSON.stringify({status:'PASS',packageSha256:approved,checks,tar,productionWrites:0},null,2)+'\n';
if(fs.existsSync(reportPath))assert.equal(fs.readFileSync(reportPath,'utf8'),report,'SEALED_TEST_REPORT_DRIFT');else fs.writeFileSync(reportPath,report,{flag:'wx'});
console.log(JSON.stringify({status:'PASS',checks:checks.length,packageSha256:approved,...tar}));
