// Prueba local sobre artefactos capturados; no red ni tareas TR-069.
const fs = require('node:fs'), ts = require('typescript'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const capture = JSON.parse(fs.readFileSync('scripts/inventory-auth-lab/runtime/hosts-chunk-capture.json', 'utf8')).at(-1);
const diffs = capture.chunkDiffs;
function parse(text) {
  const filename = '/artifact.ts';
  const sf = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  assert.equal(sf.parseDiagnostics.length, 0);
  const host = { getSourceFile: p => p === filename ? sf : undefined, getDefaultLibFileName: () => '', writeFile() {}, getCurrentDirectory: () => '/', getDirectories: () => [], fileExists: p => p === filename, readFile: () => text, getCanonicalFileName: p => p, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n' };
  return { sf, checker: ts.createProgram([filename], { noLib: true, noResolve: true }, host).getTypeChecker() };
}
function canonical(text, { remove = [], external = {} } = {}) {
  const { sf, checker } = parse(text), ids = new Map();
  let ordinal = 0;
  const excluded = new Set(remove.map(i => sf.statements[i]));
  const symbol = node => checker.getSymbolAtLocation(node);
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      const mod = statement.moduleSpecifier.text;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const e of bindings.elements) ids.set(symbol(e.name), ['import', mod, (e.propertyName || e.name).text]);
    }
  }
  for (const [name, identity] of Object.entries(external)) {
    const candidates = [];
    for (const s of sf.statements) {
      if (ts.isFunctionDeclaration(s) && s.name?.text === name) candidates.push(s.name);
      if (ts.isImportDeclaration(s) && s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings))
        for (const e of s.importClause.namedBindings.elements) if (e.name.text === name) candidates.push(e.name);
    }
    assert.equal(candidates.length, 1, 'External identity must resolve to one top-level binding');
    ids.set(symbol(candidates[0]), identity);
  }
  function declarations(n) {
    if (excluded.has(n) || ts.isImportDeclaration(n)) return;
    if (ts.isIdentifier(n) && ts.isDeclarationName(n)) {
      const s = symbol(n);
      if (s && !ids.has(s)) ids.set(s, ['binding', ordinal++]);
    }
    ts.forEachChild(n, declarations);
  }
  declarations(sf);
  function walk(n) {
    if (excluded.has(n)) return null;
    if (ts.isImportDeclaration(n)) return ['import', n.moduleSpecifier.text, n.importClause?.isTypeOnly || false,
      n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings) ? n.importClause.namedBindings.elements.map(e => (e.propertyName || e.name).text).sort() : []];
    if (ts.isIdentifier(n)) {
      // Property names and public keys are semantic, never alpha-renamed.
      const p = n.parent;
      const key = (ts.isPropertyAccessExpression(p) && p.name === n) ||
        ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p)) && p.name === n && !ts.isComputedPropertyName(n));
      return ['identifier', key ? n.text : ids.get(symbol(n)) || ['global', n.text]];
    }
    if (ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isRegularExpressionLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return [n.kind, n.text];
    // Full child token sequence preserves operators, modifiers and optional chains.
    return [n.kind, ...n.getChildren(sf).map(walk).filter(x => x !== null)];
  }
  return sf.statements.filter(s => !excluded.has(s)).map(walk);
}
const olt = diffs['assets/OltDetailView.js'], leaf = diffs['assets/gponSerial.js'].after;
const oldParse = parse(olt.before), newParse = parse(olt.after), leafParse = parse(leaf);
const first = oldParse.sf.statements.findIndex(s => s.getText(oldParse.sf).includes('/^[A-Z0-9]{4}[0-9A-F]{8}$/'));
assert(first >= 0);
const oldLeaf = oldParse.sf.statements.slice(first, first + 3).map(s => s.getText(oldParse.sf)).join('');
const leafBody = leafParse.sf.statements.filter(s => !ts.isExportDeclaration(s)).map(s => s.getText(leafParse.sf)).join('');
assert.deepEqual(canonical(oldLeaf), canonical(leafBody), 'Extracted helper function bodies changed');
const oldExport = oldParse.sf.statements[first + 2].name.text;
const importIndex = newParse.sf.statements.findIndex(s => ts.isImportDeclaration(s) && s.moduleSpecifier.text === './gponSerial.js');
assert(importIndex >= 0);
const newExport = newParse.sf.statements[importIndex].importClause.namedBindings.elements[0];
assert.equal(newExport.propertyName.text, 'n');
const identity = ['verified-extraction', 'src/lib/gponSerial.ts', 'normalizeGponSerial'];
assert.deepEqual(canonical(olt.before, { remove: [first, first+1, first+2], external: { [oldExport]: identity } }),
  canonical(olt.after, { remove: [importIndex], external: { [newExport.name.text]: identity } }), 'Protected OLT AST changed beyond extraction/alpha-renaming');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const index = diffs['assets/index.js'];
const header = /^const __vite__mapDeps=\(i,m=__vite__mapDeps,d=\(m.f\|\|\(m.f=(\[.*?\])\)\)\)=>i.map\(i=>d\[i\]\);/;
const oldHeader = index.before.match(header), newHeader = index.after.match(header);
assert(oldHeader && newHeader);
const oldTable = JSON.parse(oldHeader[1]), newTable = JSON.parse(newHeader[1]);
assert.deepEqual(newTable.filter(p => p !== 'assets/gponSerial.js'), oldTable);
const preloadOwners = [];
let revertedIndex = index.after.replace(header, oldHeader[0]).replace(/import\("(\.\/[^" ]+)"\),__vite__mapDeps\(\[([\d,]*)\]\)/g, (call, owner, list) => {
  const deps = list.split(',').map(Number).map(i => newTable[i]);
  if (deps.includes('assets/gponSerial.js')) preloadOwners.push(owner);
  const restored = deps.filter(p => p !== 'assets/gponSerial.js').map(p => { const i = oldTable.indexOf(p); assert(i >= 0); return i; });
  return 'import("' + owner + '"),__vite__mapDeps([' + restored.join(',') + '])';
});
assert.deepEqual(preloadOwners.sort(), ['./OltDetailView.js', './Tr069View.js']);
assert.equal(revertedIndex, index.before, 'Entry code/dependencies changed beyond verified preload extraction');
const report = { helperAstEqual: true, protectedOltAstEqual: true, oldHelper: oldExport, newHelper: newExport.name.text,
  entryEqualAfterPreloadRemap: true, preloadOwners,
  source: 'src/lib/gponSerial.ts', sourceHash: capture.graphDetails.active.sources['src/lib/gponSerial.ts'],
  unchangedSource: capture.graphDetails.active.sources['src/lib/gponSerial.ts'] === capture.graphDetails.candidate.sources['src/lib/gponSerial.ts'],
  hashes: { oldOlt: sha(olt.before), newOlt: sha(olt.after), leaf: sha(leaf), oldIndex: sha(index.before), newIndex: sha(index.after) } };
assert(report.unchangedSource);
fs.writeFileSync('docs/TR069-HOSTS-CHUNK-PROOF-20261028.json', JSON.stringify(report, null, 2) + '\n');
const graphs = Object.fromEntries(Object.entries(capture.graphDetails).map(([label, g]) => [label, { edges: g.edges }]));
fs.writeFileSync('docs/TR069-HOSTS-CHUNK-GRAPH-20261028.json', JSON.stringify({ checkedAt: capture.checkedAt, graphs, proof: report,
  changedChunks: Object.keys(diffs).filter(p => p !== 'assets/qr-scanner-worker.min.js') }, null, 2) + '\n');
console.log(JSON.stringify(report));
