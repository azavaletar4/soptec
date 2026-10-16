// Creates a local release ref with an isolated index; leaves HEAD/workspace intact.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const descriptor='docs/INVENTARIO-PRODUCCION-CANDIDATO.json';
const candidate=JSON.parse(fs.readFileSync(descriptor,'utf8'));
if(candidate.sourceRevision) { console.log('LOCAL_RELEASE_ALREADY_RECORDED '+candidate.sourceRevision); process.exit(0); }
const env={...process.env,GIT_INDEX_FILE:path.resolve('scripts/inventory-auth-lab/runtime/release-index-'+Date.now())};
const git=(args,input)=>cp.execFileSync('git',args,{env,input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
git(['read-tree',candidate.deployedBase]);
const paths=[...candidate.files.map(f=>f.file),'.dockerignore','INVENTARIO-RELEASE.json'];
for(const file of paths){
 const bytes=fs.readFileSync(path.join(candidate.directory,file));
 const expected=candidate.files.find(f=>f.file===file)?.candidateSha256;
 if(expected&&crypto.createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('CANDIDATE_DRIFT');
 const oid=git(['hash-object','-w','--stdin','--no-filters'],bytes);
 git(['update-index','--add','--cacheinfo','100644',oid,file]);
}
const tree=git(['write-tree']);
const revision=git(['-c','commit.gpgsign=false','commit-tree',tree,'-p',candidate.deployedBase,'-m','Activa Inventario administrativo conservando la base operativa 592d282']);
const ref='refs/heads/release/inventario-655ea29-'+Date.now();
git(['update-ref',ref,revision,'0000000000000000000000000000000000000000']);
const changed=git(['diff-tree','--no-commit-id','--name-only','-r',revision]).split('\n');
if(changed.some(f=>!paths.includes(f)))throw Error('UNRELATED_RELEASE_PATH');
candidate.sourceRevision=revision;candidate.localRef=ref;
fs.writeFileSync(descriptor,JSON.stringify(candidate,null,2)+'\n');
console.log(JSON.stringify({sourceRevision:revision,ref,pathsChanged:changed.length,headUnchanged:git(['rev-parse','HEAD'])}));
