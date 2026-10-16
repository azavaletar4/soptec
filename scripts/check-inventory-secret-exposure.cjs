// Read-only: report key names and paths, never credential values or source lines.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const secrets = [];
for (const file of ['.env', 'server/.env']) {
  if (!fs.existsSync(path.join(root, file))) continue;
  for (const line of fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || !/KEY|SECRET|PASSWORD|TOKEN|DB_URL|DATABASE_URL/.test(m[1]) || /FILE|PATH|URL$/.test(m[1]) && !/DB_URL|DATABASE_URL/.test(m[1])) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (value.length > 0) secrets.push({ key: m[1], value });
  }
}
const hits = [];
function check(file, label = file) {
  let content; try { content = fs.readFileSync(file, 'utf8'); } catch { return; }
  const keys = [...new Set(secrets.filter(s => content.includes(s.value)).map(s => s.key))];
  if (keys.length) hits.push({ file: label, keys });
}
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist', '.aws'].includes(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else if (!/\.(png|jpg|jpeg|webp|zip|dump|gz|pdf|mp4)$/i.test(f)) check(f);
  }
}
walk(root);
walk(path.join(process.env.USERPROFILE, '.claude', 'projects', 'D--SmartRayco'));
const revisions = cp.execFileSync('git', ['rev-list', '--all'], { cwd: root, encoding: 'utf8' }).trim().split(/\s+/);
let historyMatches = 0;
for (const rev of revisions) {
  const diff = cp.execFileSync('git', ['show', '--format=', '--no-ext-diff', rev], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const keys = [...new Set(secrets.filter(s => diff.includes(s.value)).map(s => s.key))];
  if (keys.length) { hits.push({ commit: rev, keys }); historyMatches++; }
}
console.log(JSON.stringify({ scope: 'Exact matches of current local env values; historical/revoked values not covered', keysChecked: secrets.map(s => s.key), revisionsChecked: revisions.length, historyMatches, hits }, null, 2));
