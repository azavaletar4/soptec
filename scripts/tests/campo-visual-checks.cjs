const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const result={productionAccess:false,checks:[]};
function check(name,args){
 const r=cp.spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true});
 if(r.status!==0){process.stderr.write((r.stdout||'')+(r.stderr||''));throw Error(name+' failed');}
 result.checks.push({name,result:'PASS'});
 if(name==='build')result.buildLargeChunkWarning=(r.stderr||'').includes('chunks are larger');
}
const vue=path.join(path.dirname(require.resolve('vue-tsc/package.json')),'bin/vue-tsc.js');
const vite=path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js');
check('TypeScript',[vue,'-b']);
check('6 focused unit tests',['--import','tsx','--test','src/lib/__tests__/custodyPresentation.test.ts','src/lib/__tests__/fieldProgress.test.ts']);
check('build',[vite,'build']);
const protectedPaths=['server','supabase','mobile_app','src/stores','src/router','src/lib/fieldProgress.ts','src/composables/usePersonalRead.ts','src/views/campo/CampoTrabajoDetailView.vue','src/views/campo/CampoMiCustodiaView.vue','src/views/soporte','src/assets/logo-icon.png'];
const changed=cp.execFileSync('git',['diff','377bee4','--name-only','--',...protectedPaths],{encoding:'utf8'}).trim();
assert.equal(changed,'','operational/permission/logo files must remain unchanged');
result.protectedFilesUnchanged=true;
fs.writeFileSync('docs/CAMPO-VISUAL-CHECKS.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
