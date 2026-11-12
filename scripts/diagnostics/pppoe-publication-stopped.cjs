// Diagnostico de solo lectura del intento detenido. No construye ni publica.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const base = 'deploy/pppoe-20261112';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const prep = read(base + '/preparation.json');
const pkg = read(prep.package);
const packageDir = path.dirname(prep.package);
const archive = fs.readFileSync(path.join(packageDir, 'source.tar'));
const input = read(path.join(packageDir, 'input.json'));
function tarFiles(bytes) {
  const files = new Map();
  let extended = {}, global = {};
  const metadata = [];
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) break;
    const str = (start, end) => header.subarray(start, end).toString().replace(/\0.*$/s, '');
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = str(156, 157);
    const content = bytes.subarray(offset + 512, offset + 512 + size);
    const prefix = str(345, 500);
    const name = (prefix ? prefix + '/' : '') + str(0, 100);
    if (type === 'x' || type === 'g') {
      const attrs = {};
      for (let at = 0; at < content.length;) {
        const space = content.indexOf(32, at);
        assert.ok(space > at);
        const length = Number(content.subarray(at, space).toString());
        assert.ok(length > space - at && at + length <= content.length);
        const text = content.subarray(space + 1, at + length - 1).toString();
        const equal = text.indexOf('=');
        attrs[text.slice(0, equal)] = text.slice(equal + 1);
        at += length;
      }
      if (type === 'g') global = {...global, ...attrs};
      else extended = attrs;
      metadata.push({header: name, attributes: attrs});
    } else {
      const filename = extended.path || global.path || name;
      if (type === '0' || type === '') {
        assert.ok(!files.has(filename), 'DUPLICATE_ARCHIVE_FILE');
        files.set(filename, sha(content));
      } else assert.equal(type, '5', 'UNEXPECTED_ARCHIVE_ENTRY');
      extended = {};
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return {files, metadata};
}
const actual = tarFiles(archive);
const gitArchive = cp.execFileSync('git', ['archive', prep.sourceCommit, '--format=tar',
  'src', 'index.html', 'vite.config.ts', 'package.json', 'package-lock.json',
  'scripts/frontend-release-build.mjs', 'deploy/Dockerfile.frontend',
  'deploy/frontend-release-policy.json'], {maxBuffer: 64 * 1024 * 1024, windowsHide: true});
const expected = tarFiles(gitArchive);
expected.files.set('release-source.json', sha(fs.readFileSync('scripts/inventory-auth-lab/runtime/pppoe-publication/release-source.json')));
assert.deepEqual(actual.files, expected.files, 'ARCHIVE_CONTENT_DIFFERS_FROM_ISOLATED_COMMIT');
assert.deepEqual(input.snapshot, read('scripts/inventory-auth-lab/runtime/pppoe-publication/release-source.json'));
assert.equal(sha(fs.readFileSync(prep.package)), prep.packageSha256);
assert.equal(sha(fs.readFileSync(path.join(packageDir, 'input.json'))), pkg.files['input.json']);
const localBackups = {};
for (const service of prep.services) {
  const backup = prep.backupImages[service];
  assert.equal(sha(fs.readFileSync(backup.archive)), backup.sha256);
  localBackups[service] = {image: backup.image, sha256: backup.sha256, verified: true};
}
const state = read('scripts/inventory-auth-lab/runtime/pppoe-publication/live-state-only.json');
assert.ok(Date.now() - Date.parse(state.at) < 5 * 60000, 'STATE_READ_EXPIRED');
for (const [service, before] of Object.entries(prep.before)) {
  for (const field of ['id', 'image', 'started', 'running', 'environmentHash']) {
    assert.equal(state.services[service][field], before[field], 'PRODUCTION_CHANGED:' + service + ':' + field);
  }
}
const python = `import json,pathlib,hashlib,subprocess
p=pathlib.Path(${JSON.stringify(input.stage)})
m=json.loads((p/'prepared.json').read_text())
def sha(file):
 h=hashlib.sha256()
 with open(file,'rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
assert not(p/'built.json').exists(),'UNEXPECTED_BUILD'
assert not(p/'attempt.json').exists(),'UNEXPECTED_DEPLOY_ATTEMPT'
for s,b in m['before'].items():
 c=json.loads(subprocess.check_output(['docker','inspect','smartrayco-'+s+'-1']))[0]
 assert c['Id']==b['id'] and c['Image']==b['image'] and c['State']['StartedAt']==b['started'] and c['State']['Running'],'PRODUCTION_CHANGED_'+s
backups={}
for s,file in m['backupFiles'].items():
 assert sha(file)==m['backupHashes'][s],'BACKUP_DRIFT_'+s
 backups[s]={'path':file,'sha256':m['backupHashes'][s],'image':m['before'][s]['image'],'verified':True}
assert sha(p/'source.tar')==m['sourceArchiveHash'],'STAGED_ARCHIVE_CHANGED'
assert sha(p/'input.json')==m['inputHash'],'STAGED_INPUT_CHANGED'
health=json.loads(subprocess.check_output(['curl','--fail','--silent','--max-time','5','--resolve','panel.rayconetworks.com:443:127.0.0.1','https://panel.rayconetworks.com/api/health']))
assert health['status']=='ok','API_UNHEALTHY'
print(json.dumps({'health':'ok','servicesUnchanged':True,'buildStarted':False,'deploymentAttempted':False,'stagedSourceArchiveSha256':m['sourceArchiveHash'],'rollbackTested':m['rollbackTested'],'rollbackOverride':m['rollback'],'backups':backups}))
`;
const remote = JSON.parse(cp.execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
  '-i', path.join(process.env.USERPROFILE, '.ssh/smartrayco-deploy'), 'root@192.168.55.201', 'python3 -'],
  {input: python, encoding: 'utf8', timeout: 60000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']}));
assert.equal(remote.stagedSourceArchiveSha256, sha(archive));
const result = {
  status: 'STOPPED_BEFORE_BUILD_AND_DEPLOY', verifiedAt: new Date().toISOString(),
  sourceCommit: prep.sourceCommit, preparationCommit: '8875af009b3bdad9857b4278a6967616c53989ab',
  reason: 'PACKAGE_DRIFT:source.tar', expectedArchiveSha256: pkg.files['source.tar'],
  actualArchiveSha256: sha(archive), archiveFilesMatchIsolatedCommit: true,
  archiveFileCount: actual.files.size, inputAndSnapshotUnchanged: true,
  originalArchiveRetained: false,
  appendedSnapshotMetadata: actual.metadata.filter(row => row.header.includes('release-source')),
  localBackups, remote, rollbackExecuted: false, supabaseWritesByThisProcedure: 0,
  mikrotikRequestsByThisProcedure: 0, servicesDeployed: [],
};
fs.writeFileSync(base + '/stopped-verification.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
