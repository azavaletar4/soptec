// Sólo HTTPS GET: todos los archivos publicados, rutas SPA y salud/autorización API.
import fs from 'node:fs';import path from 'node:path';import cp from 'node:child_process';
import crypto from 'node:crypto';import assert from 'node:assert/strict';import { promisify } from 'node:util';
const exec=promisify(cp.execFile);const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const before=process.argv.includes('--before');const site='https://panel.rayconetworks.com';
const artifact=JSON.parse(fs.readFileSync('docs/CLIENTES-ARTEFACTO.json','utf8'));
const backup=JSON.parse(fs.readFileSync('docs/CLIENTES-RESPALDO.json','utf8'));
const previous=JSON.parse(fs.readFileSync(path.join(backup.pcBackup,'manifest.json'),'utf8'));
async function get(url){const {stdout}=await exec('curl.exe',['--fail','--silent','--show-error','--max-time','25',url],{encoding:'buffer',maxBuffer:5*1024*1024,windowsHide:true});return stdout;}
const routes=['/','/clientes','/clientes/prospectos','/soporte/instalaciones','/campo/mi-custodia','/inventario/custodia','/facturacion'];
const indexHash=before?previous.assets['index.html']:hash(fs.readFileSync(path.join(artifact.source,'dist/index.html')));
for(const route of routes)assert.equal(hash(await get(site+route)),indexHash,'HTTPS_INDEX_MISMATCH: '+route);
const health=JSON.parse((await get(site+'/api/health')).toString());assert.equal(health.status,'ok');
const {stdout:status}=await exec('curl.exe',['--silent','--show-error','--max-time','20','--output','NUL','--write-out','%{http_code}',site+'/api/soporte/ranking-tecnicos?periodo=month'],{encoding:'utf8',windowsHide:true});
assert.equal(status.trim(),'401','PROTECTED_API_ACCESS_CHANGED');
const checked=[];
if(!before){
 assert.equal(hash(fs.readFileSync(artifact.frontendArchive.file)),artifact.frontendArchive.sha256);
 const names=cp.execFileSync('tar',['-tzf',artifact.frontendArchive.file],{encoding:'utf8'}).trim().split(/\r?\n/).filter(n=>!n.endsWith('/'));
 for(let i=0;i<names.length;i+=4){
   await Promise.all(names.slice(i,i+4).map(async entry=>{const name=entry.replace(/^\.\//,'');const local=fs.readFileSync(path.join(artifact.source,'dist',name));assert.equal(hash(await get(site+'/'+name)),hash(local),'HTTPS_ASSET_MISMATCH: '+name);checked.push({file:name,sha256:hash(local)});}));
   if(i%20===0)console.log('HTTPS assets verified:',checked.length);
 }
 const view=checked.find(f=>/^assets\/ClientesView-.*\.js$/.test(f.file));assert.ok(view);
 const code=fs.readFileSync(path.join(artifact.source,'dist',view.file),'utf8');
 for(const label of ['Prospectos','Nuevo cliente','Clientes vigentes','Clientes retirados','abonados vigentes','Reincorporar'])assert.ok(code.includes(label),'MISSING_LABEL: '+label);
}
const report={status:'PASS',phase:before?'before':'after',https:true,routes,indexSha256:indexHash,apiHealth:health.status,protectedApiAnonymousStatus:401,
 assetsVerified:checked.length,assets:checked,referenceRevision:'2f25873',artifactSha256:artifact.frontendArchive.sha256,operationalWrites:0,
 authenticatedRealUser:'PENDING_OPERATOR',conversionPersistence:'NOT_TESTED_NO_REAL_WRITES'};
fs.writeFileSync(before?'scripts/inventory-auth-lab/runtime/clientes-deploy-https-before.json':'docs/CLIENTES-DESPLIEGUE-HTTPS.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,assets:undefined}));
