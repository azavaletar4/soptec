const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=process.cwd(), manifest=JSON.parse(fs.readFileSync('docs/INVENTARIO-ACTIVACION-MANIFIESTO.json','utf8'));
const dest=path.join(root,'scripts/inventory-auth-lab/runtime/selected-release-'+Date.now());
fs.mkdirSync(dest);
const archive=dest+'.base.tar';
const baseline=['src','server','supabase','deploy','package.json','package-lock.json','index.html','vite.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json','tsconfig.server.json','docker-compose.yml','docker-compose.onprem.yml'];
cp.execFileSync('git',['archive','--format=tar','--output='+archive,manifest.base,...baseline]);
cp.execFileSync('tar',['-xf',archive,'-C',dest]);
for(const e of manifest.files){const b=fs.readFileSync(e.file);if(crypto.createHash('sha256').update(b).digest('hex')!==e.sha256)throw Error('MANIFEST_DRIFT');const f=path.join(dest,e.file);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,b);}
fs.copyFileSync('.dockerignore',path.join(dest,'.dockerignore'));
fs.copyFileSync('docs/INVENTARIO-ACTIVACION-MANIFIESTO.json',path.join(dest,'INVENTARIO-ACTIVACION-MANIFIESTO.json'));
const output=dest+'.tar.gz';cp.execFileSync('tar',['-czf',output,'-C',dest,'.']);
const result={base:manifest.base,sourceHead:manifest.reviewedHead,directory:dest,archive:output,sha256:crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex'),filesOverlaid:manifest.files.length,configurationIncluded:false,applied:false};
fs.writeFileSync('scripts/inventory-auth-lab/runtime/selected-release.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
