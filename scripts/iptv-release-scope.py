"""Prepara alcance local con el contrato existente; no accede a ningún servidor."""
import hashlib
import json
import pathlib
import runpy
import sys

baseline, candidate, output = map(pathlib.Path, sys.argv[1:4])
contract = runpy.run_path('scripts/consolidation-release-contract.py')
read = lambda folder: {p.relative_to(folder).as_posix(): p.read_bytes() for p in folder.rglob('*') if p.is_file()}
old, current = read(baseline), read(candidate)
# Mismo overlay que el publicador: conserva assets históricos y huérfanos.
new = {**old, **current}
before, after = [json.loads(files['release-manifest.json']) for files in [old, new]]
assert before['configurationHashes'] == after['configurationHashes'], 'PUBLIC_CONFIGURATION_DRIFT'
reach = contract['reachable']
strip = contract['stripname']
old_reach, new_reach = reach(old), reach(new)
groups = lambda paths: {name: {p for p in paths if strip(p) == name} for name in map(strip, paths)}
og, ng = groups(old_reach), groups(new_reach)
ambiguous = {p for p in set(og) | set(ng) if len(og.get(p, ())) > 1 or len(ng.get(p, ())) > 1}
pinned = set()
for name in ambiguous:
    assert og.get(name) == ng.get(name), 'AMBIGUOUS_ASSET_MEMBERSHIP_CHANGED:' + name
    pinned.update(og[name])
names = {p.split('/')[-1] for p in pinned}
digest = lambda b: hashlib.sha256(b).hexdigest()
normalize = lambda files, paths: {p if p in pinned else strip(p): digest(contract['normcontent'](files[p], names)) for p in paths}
on, nn = normalize(old, old_reach), normalize(new, new_reach)
changed = contract['differences'](on, nn)
if contract['normcontent'](old['index.html'], names) != contract['normcontent'](new['index.html'], names):
    changed.add('index.html')
scope = {'version': 1, 'sourceCommit': after['commit'], 'backendSources': [],
         'frontendSources': sorted(contract['differences'](before['sourceFiles'], after['sourceFiles'])),
         'frontendAssets': sorted(changed)}
metadata = [contract['validate_vite_manifest'](files, pinned) for files in [old, new]]
additions = set(metadata[1]) - set(metadata[0])
if additions:
    graph_digest = lambda graph: digest(json.dumps(graph, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode())
    scope['frontendGraphTransition'] = {'before': graph_digest(metadata[0]), 'after': graph_digest(metadata[1]), 'added': sorted(additions)}
contract['validate_scope'](scope)
contract['validate_frontend_sources'](before['sourceFiles'], after['sourceFiles'], scope)
verified = contract['validate_frontend'](old, new, scope)
output.write_text(json.dumps(scope, indent=2) + '\n', encoding='utf8')
print(json.dumps({'baselineCommit': before['commit'], 'sourceCommit': after['commit'], 'changedAssets': verified,
                  'sourceCount': len(scope['frontendSources']), 'graphAdditions': sorted(additions), 'contractPassed': True}))
