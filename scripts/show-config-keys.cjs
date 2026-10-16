// Safe replacement for printing .env during diagnostics.
// Deliberately accepts no file argument and prints no values or lengths.
const fs = require('node:fs');
const path = require('node:path');
for (const file of ['.env', 'server/.env']) {
  const target = path.join(__dirname, '..', file);
  if (!fs.existsSync(target)) continue;
  for (const line of fs.readFileSync(target, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) console.log(`${file}: ${m[1]}=${m[2].replace(/^(['"])(.*)\1$/, '$2') ? '[CONFIGURADO]' : '[VACIO]'}`);
  }
}
