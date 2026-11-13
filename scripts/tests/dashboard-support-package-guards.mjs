// Solo archivos locales. No SSH, SQL, Docker ni despliegues.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve('deploy/dashboard-support-prospects-20261113');
const expected='2e085a576d5c7a4914bd6584d328b65da51ea4bb93497aedbdd41edf2f552410';
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
assert.equal(hash(path.join(root,'package.json')),expected);
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
const verify=(args=[])=>execFileSync(process.execPath,['scripts/prepare-dashboard-support-release.mjs','--verify','--expected-package-sha256',expected,...args],{windowsHide:true,encoding:'utf8',stdio:['pipe','pipe','pipe']});
const checks=[];
const before=Object.fromEntries(['package.json','SHA256SUMS',...Object.keys(pkg.files)].map(n=>[n,hash(path.join(root,n))]));
verify();verify();checks.push('TWO_READONLY_VERIFICATIONS_WITHOUT_REGENERATION');
assert.throws(()=>execFileSync(process.execPath,['scripts/prepare-dashboard-support-release.mjs','--verify'],{stdio:'pipe'}),/Command failed/);checks.push('EXTERNAL_DIGEST_REQUIRED');
assert.throws(()=>execFileSync(process.execPath,['scripts/prepare-dashboard-support-release.mjs','--verify','--expected-package-sha256','0'.repeat(64)],{stdio:'pipe'}),/Command failed/);checks.push('WRONG_EXTERNAL_DIGEST_REJECTED');
const scratch=fs.mkdtempSync('scripts/inventory-auth-lab/runtime/dashboard-support-prospects-release/negative-package-');
for(const name of Object.keys(before)){
 const target=path.join(scratch,name);
 if(['package.json','apply.sql'].includes(name))fs.copyFileSync(path.join(root,name),target,fs.constants.COPYFILE_EXCL);
 else fs.linkSync(path.join(root,name),target);
}
fs.appendFileSync(path.join(scratch,'apply.sql'),'\n-- LOCAL TAMPER TEST\n');
assert.throws(()=>verify(['--package-dir',path.resolve(scratch)]),/Command failed/);checks.push('SQL_BYTE_CHANGE_REJECTED');
const altered={...pkg,backendSources:['server/src/index.ts']};fs.writeFileSync(path.join(scratch,'package.json'),JSON.stringify(altered));
assert.throws(()=>verify(['--package-dir',path.resolve(scratch)]),/Command failed/);checks.push('MANIFEST_AND_BACKEND_SCOPE_CHANGE_REJECTED');
assert.deepEqual(Object.fromEntries(Object.keys(before).map(n=>[n,hash(path.join(root,n))])),before);checks.push('ORIGINAL_PACKAGE_BYTES_UNCHANGED');
const report={status:'PASS',packageSha256:expected,productionWrites:0,sqlExecuted:false,checks};
fs.writeFileSync(root+'/package-guard-tests.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
