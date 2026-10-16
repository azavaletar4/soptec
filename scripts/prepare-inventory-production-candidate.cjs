// Local source packaging only; never connects to production or applies SQL.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const root = process.cwd(), runtime = 'scripts/inventory-auth-lab/runtime/';
const approved = JSON.parse(fs.readFileSync('docs/INVENTARIO-ACTIVACION-MANIFIESTO.json', 'utf8'));
const deployedBase = '592d282b9f51747b672a06aa1a099470f3539512';
const ancestor = cp.execFileSync('git', ['merge-base', approved.base, deployedBase], { encoding: 'utf8' }).trim();
const dir = path.join(root, runtime, 'production-candidate-' + Date.now());
fs.mkdirSync(dir);
const baseline = ['src','server','supabase','deploy','package.json','package-lock.json','index.html','vite.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json','tsconfig.server.json','docker-compose.yml','docker-compose.onprem.yml'];
cp.execFileSync('git', ['archive', '--format=tar', '--output=' + dir + '.base.tar', deployedBase, ...baseline]);
cp.execFileSync('tar', ['-xf', dir + '.base.tar', '-C', dir]);
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const files = [];
for (const e of approved.files) {
  const incoming = fs.readFileSync(e.file);
  if (hash(incoming) !== e.sha256) throw Error('VALIDATED_SOURCE_DRIFT');
  const target = path.join(dir, e.file);
  let output = incoming, preservedDeployedChanges = false;
  const old = cp.spawnSync('git', ['show', ancestor + ':' + e.file], { encoding: 'buffer' });
  const deployed = cp.spawnSync('git', ['show', deployedBase + ':' + e.file], { encoding: 'buffer' });
  if (old.status === 0 && deployed.status === 0 && !deployed.stdout.equals(old.stdout)) {
    const temp = path.join(root, runtime, 'merge-' + files.length);
    fs.writeFileSync(temp + '.current', deployed.stdout);
    fs.writeFileSync(temp + '.ancestor', old.stdout);
    fs.writeFileSync(temp + '.inventory', incoming.toString('utf8').replace(/\r\n/g, '\n'));
    const merged = cp.spawnSync('git', ['merge-file', '-p', temp + '.current', temp + '.ancestor', temp + '.inventory'], { encoding: 'buffer' });
    if (merged.status !== 0) throw Error('MERGE_CONFLICT_REQUIRES_REVIEW');
    output = merged.stdout;
    preservedDeployedChanges = true;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, output);
  files.push({ file: e.file, validatedSha256: e.sha256, candidateSha256: hash(output), preservedDeployedChanges });
}
fs.copyFileSync('.dockerignore', path.join(dir, '.dockerignore'));
const source = { deployedBase, inventorySource: approved.reviewedHead, reviewedAtHead: cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), files, unrelatedFunctionalChanges: false };
fs.writeFileSync(path.join(dir, 'INVENTARIO-RELEASE.json'), JSON.stringify(source, null, 2) + '\n');
const archive = dir + '.tar.gz';
cp.execFileSync('tar', ['-czf', archive, '-C', dir, '.']);
const result = { ...source, directory: dir, archive, archiveSha256: hash(fs.readFileSync(archive)), configurationIncluded: false, deployed: false };
fs.writeFileSync('docs/INVENTARIO-PRODUCCION-CANDIDATO.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ directory: dir, archive, sha256: result.archiveSha256, files: files.length, preservedExistingFiles: files.filter(f => f.preservedDeployedChanges).map(f => f.file) }));
