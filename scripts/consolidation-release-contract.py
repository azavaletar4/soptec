"""Contrato puro de integridad, compartido por build, deploy y pruebas aisladas."""
import hashlib
import json
import pathlib
import posixpath
import re


def differences(before, after):
    return {p for p in set(before) | set(after) if before.get(p) != after.get(p)}


def validate_scope(scope):
    required = {'version', 'sourceCommit', 'backendSources', 'frontendSources', 'frontendAssets'}
    assert set(scope) in [required, required | {'backendEnvironment'}], 'INVALID_SCOPE_FIELDS'
    assert scope['version'] == 1 and re.fullmatch('[a-f0-9]{40}', scope['sourceCommit']), 'INVALID_SCOPE_VERSION_OR_COMMIT'
    for key in ['backendSources', 'frontendSources', 'frontendAssets']:
        values = scope[key]
        assert isinstance(values, list) and len(values) == len(set(values)), 'INVALID_SCOPE_LIST_' + key
        for p in values:
            assert isinstance(p, str) and p and '\\' not in p and not pathlib.PurePosixPath(p).is_absolute() and '..' not in p.split('/') and '*' not in p, 'INVALID_SCOPE_PATH'
    assert all(p.startswith(('server/src/', 'src/lib/')) and p.endswith('.ts') for p in scope['backendSources']), 'INVALID_BACKEND_SCOPE'
    assert bool(scope['frontendSources']) == bool(scope['frontendAssets']), 'INCOMPLETE_FRONTEND_SCOPE'
    assert release_services(scope), 'EMPTY_RELEASE_SCOPE'
    backend_environment(scope)


def backend_environment(scope):
    env = scope.get('backendEnvironment', {})
    assert isinstance(env, dict), 'INVALID_BACKEND_ENVIRONMENT'
    if not env:
        return {}
    assert scope['backendSources'], 'ENVIRONMENT_REQUIRES_BACKEND_RELEASE'
    assert set(env) == {'TR069_HOSTS_ON_DEMAND_ENABLED', 'TR069_HOSTS_ON_DEMAND_SERIALS'}, 'UNDECLARED_BACKEND_ENVIRONMENT'
    assert env['TR069_HOSTS_ON_DEMAND_ENABLED'] in ['true', 'false'], 'INVALID_HOSTS_ENABLE_FLAG'
    serials = env['TR069_HOSTS_ON_DEMAND_SERIALS'].split(',')
    assert 1 <= len(serials) <= 16 and len(set(serials)) == len(serials) and all(re.fullmatch('[A-Z0-9]{4}[0-9A-F]{8}', s) for s in serials), 'INVALID_HOSTS_SERIAL_SCOPE'
    return env


def release_services(scope):
    return [s for s, key in [('backend', 'backendSources'), ('frontend', 'frontendSources')] if scope[key]]


def release_overrides(scope, tags, rollback_tags):
    # No environment overrides: conserva WiFi y el resto de configuración efectiva.
    services = release_services(scope)
    return ({'services': {s: {'image': tags[s]} for s in services}},
            {'services': {s: {'image': rollback_tags[s]} for s in services}})


def validate_frontend_sources(before, after, scope):
    changed = differences(before, after)
    expected = set(scope['frontendSources'])
    assert changed == expected, 'FRONTEND_SOURCE_SCOPE_MISMATCH:unexpected=' + ','.join(sorted(changed - expected)) + ';missing=' + ','.join(sorted(expected - changed))


def validate_backend(before, after, scope, expected):
    changed = differences(before, after)
    allowed = set(scope['backendSources'])
    assert changed == allowed, 'BACKEND_SCOPE_MISMATCH:unexpected=' + ','.join(sorted(changed - allowed)) + ';missing=' + ','.join(sorted(allowed - changed))
    assert all(after.get(p) == h for p, h in expected.items()), 'BACKEND_SOURCE_CONTENT_MISMATCH'


# Conserva el grafo alcanzable y la neutralización de hashes Vite ya verificados.
NAME_HASH_RE = re.compile(r'^(.*?)-[\w-]{8,12}(\.(?:js|css))$')
REF_HASH_RE = re.compile(rb'([\w.\-]+?)-[\w-]{8,12}(\.(?:js|css))')
REF_HASH_TXT_RE = re.compile(r'[\w./\-]+?-[\w-]{8,12}\.(?:js|css)')


def stripname(p):
    m = NAME_HASH_RE.match(p)
    return m.group(1) + m.group(2) if m else p


def normcontent(b, pinned=()):
    # Si dos assets legítimos comparten nombre lógico, sus referencias completas
    # NO son intercambiables: conservar el hash que los distingue.
    return REF_HASH_RE.sub(lambda m: m.group(0) if m.group(0).decode() in pinned else m.group(1) + m.group(2), b)


def reachable(files):
    seeds = re.findall(r'assets/[\w.\-]+\.(?:js|css)', files['index.html'].decode('utf-8', 'replace'))
    seen, queue = set(seeds), list(seeds)
    while queue:
        content = files.get(queue.pop())
        assert content is not None, 'MISSING_REACHABLE_ASSET'
        for ref in REF_HASH_TXT_RE.findall(content.decode('utf-8', 'replace')):
            candidate = 'assets/' + ref.split('/')[-1]
            if candidate in files and candidate not in seen:
                seen.add(candidate)
                queue.append(candidate)
    return seen


VITE_MANIFEST = '.vite/manifest.json'
STATIC_IMPORT_RE = re.compile(r'''\b(?:import|export)\s*(?:[^;()"']*?\bfrom\s*)?(["'])(\./[^"']+)\1''')
DYNAMIC_IMPORT_RE = re.compile(r'''\bimport\s*\(\s*(["'])(\./[^"']+)\1\s*\)''')


def metadata_json(raw, label):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            assert key not in result, 'METADATA_DUPLICATE_KEY:' + label + ':' + key
            result[key] = value
        return result
    try:
        return json.loads(raw, object_pairs_hook=unique)
    except (ValueError, UnicodeDecodeError):
        raise AssertionError('INVALID_METADATA_JSON:' + label)


def validate_vite_manifest(files, pinned_paths):
    manifest = metadata_json(files[VITE_MANIFEST], VITE_MANIFEST)
    assert isinstance(manifest, dict) and manifest, 'INVALID_VITE_MANIFEST'
    fields = {'file', 'src', 'name', 'isEntry', 'isDynamicEntry', 'imports', 'dynamicImports', 'css', 'assets'}
    def asset(p):
        assert isinstance(p, str) and p.startswith('assets/') and '\\' not in p and not any(c in p for c in '?#') and all(s not in ['', '.', '..'] for s in p.split('/')), 'UNSAFE_VITE_ASSET_PATH'
        assert p in files, 'VITE_ASSET_MISSING:' + p
        return p
    physical = set()
    for key, entry in manifest.items():
        assert isinstance(key, str) and key and isinstance(entry, dict) and set(entry) <= fields and 'file' in entry, 'INVALID_VITE_ENTRY:' + key
        p = asset(entry['file'])
        assert p not in physical, 'VITE_ASSET_COLLISION:' + p
        physical.add(p)
        for flag in ['isEntry', 'isDynamicEntry']:
            assert flag not in entry or type(entry[flag]) is bool, 'INVALID_VITE_FLAG:' + key
        for text in ['src', 'name']:
            assert text not in entry or isinstance(entry[text], str) and entry[text], 'INVALID_VITE_TEXT:' + key
        if 'src' in entry:
            assert key == entry['src'], 'VITE_SOURCE_KEY_MISMATCH:' + key
        else:
            assert key == '_' + p.split('/')[-1], 'VITE_GENERATED_KEY_MISMATCH:' + key
        for field in ['imports', 'dynamicImports', 'css', 'assets']:
            values = entry.get(field, [])
            assert isinstance(values, list) and all(isinstance(v, str) for v in values) and len(values) == len(set(values)), 'INVALID_VITE_LIST:' + key + ':' + field
            for ref in values:
                if field in ['imports', 'dynamicImports']:
                    assert ref in manifest, 'VITE_IMPORT_MISSING:' + key + ':' + ref
                else:
                    asset(ref)
                    assert field != 'css' or ref.endswith('.css'), 'VITE_CSS_TYPE_MISMATCH:' + key
    reached = reachable(files)
    covered = physical | {p for e in manifest.values() for field in ['css', 'assets'] for p in e.get(field, [])}
    assert reached <= covered, 'VITE_GRAPH_ASSETS_UNDECLARED:' + ','.join(sorted(reached - covered))
    assert {p for p in physical if p.endswith(('.js', '.css'))} <= reached, 'VITE_UNREACHABLE_CHUNK'
    html_refs = set(re.findall(r'assets/[\w.\-]+\.(?:js|css)', files['index.html'].decode()))
    roots = {e['file'] for e in manifest.values() if e.get('isEntry')}
    assert roots == {p for p in html_refs if p.endswith('.js')}, 'VITE_ENTRY_HTML_MISMATCH'
    assert {p for p in html_refs if p.endswith('.css')} <= {p for e in manifest.values() if e.get('isEntry') for p in e.get('css', [])}, 'VITE_ENTRY_CSS_MISMATCH'
    def resolved_imports(p, pattern):
        return {asset(posixpath.normpath(posixpath.join(posixpath.dirname(p), m[1]))) for m in pattern.findall(files[p].decode())}
    normalized = {}
    def identity(p):
        return p if p in pinned_paths else stripname(p)
    for key, entry in manifest.items():
        p = entry['file']
        if p.endswith('.js'):
            for field, pattern in [('imports', STATIC_IMPORT_RE), ('dynamicImports', DYNAMIC_IMPORT_RE)]:
                declared = {manifest[k]['file'] for k in entry.get(field, []) if manifest[k]['file'].endswith('.js')}
                actual = resolved_imports(p, pattern)
                assert actual == declared, 'VITE_COMPILED_IMPORT_MISMATCH:' + p + ':' + field + ':undeclared=' + ','.join(sorted(actual - declared)) + ';unobserved=' + ','.join(sorted(declared - actual))
        name = identity(p)
        assert name not in normalized, 'VITE_NORMALIZED_ENTRY_COLLISION:' + name
        record = {k: entry[k] for k in ['src', 'name', 'isEntry', 'isDynamicEntry'] if k in entry}
        # Vite asigna IDs de orden a las entradas CSS puras. Solo este formato
        # sintético cambia de identidad; la hoja CSS real sigue comparada.
        if 'src' in record and re.fullmatch(r'_[\w.\-]+-!~\{[A-Za-z0-9]+\}~\.js', record['src']):
            assert p.endswith('.css') and set(entry) == {'file', 'src'} and record['src'].split('-!~{')[0] == '_' + stripname(p).split('/')[-1][:-4], 'INVALID_VITE_CSS_PLACEHOLDER'
            record['src'] = '@vite-css:' + name
        for field in ['imports', 'dynamicImports']:
            record[field] = sorted(identity(manifest[k]['file']) for k in entry.get(field, []))
        for field in ['css', 'assets']:
            record[field] = sorted(identity(ref) for ref in entry.get(field, []))
        normalized[name] = record
    # El manifiesto de release ya valida commit/configuración/fuentes en build.
    # Aquí se comprueba además que sus hashes realmente cubren el manifiesto
    # Vite y el grafo actual (sin exigir que incluya huérfanos de imágenes previas).
    release = metadata_json(files['release-manifest.json'], 'release-manifest.json')
    assert isinstance(release, dict) and isinstance(release.get('artifacts'), dict), 'INVALID_RELEASE_ARTIFACTS'
    artifacts = release['artifacts']
    assert reached | covered | {VITE_MANIFEST, 'index.html'} <= set(artifacts), 'RELEASE_ARTIFACTS_INCOMPLETE'
    for p, digest in artifacts.items():
        assert p in files and isinstance(digest, str) and re.fullmatch('[a-f0-9]{64}', digest) and hashlib.sha256(files[p]).hexdigest() == digest, 'RELEASE_ARTIFACT_HASH_MISMATCH:' + p
    return normalized


def validate_generated_metadata(before, after, scope, pinned_paths, extraction):
    if VITE_MANIFEST not in before and VITE_MANIFEST not in after:
        return set()  # No exime ningún archivo si no existe metadata Vite.
    assert VITE_MANIFEST in before and VITE_MANIFEST in after, 'VITE_MANIFEST_PRESENCE_CHANGED'
    old, new = [validate_vite_manifest(files, pinned_paths) for files in [before, after]]
    if extraction:
        proof = VERIFIED_CHUNK_EXTRACTION
        leaf = proof['leaf']
        assert leaf in new and leaf not in old, 'VITE_EXTRACTION_ENTRY_MISMATCH'
        assert new[leaf] == {'name': 'gponSerial', 'imports': [], 'dynamicImports': [], 'css': [], 'assets': []}, 'VITE_EXTRACTION_METADATA_MISMATCH'
        del new[leaf]
        for importer in ['assets/OltDetailView.js', 'assets/Tr069View.js']:
            assert leaf in new[importer]['imports'], 'VITE_EXTRACTION_IMPORT_MISSING:' + importer
            new[importer]['imports'].remove(leaf)
    assert set(old) == set(new), 'VITE_METADATA_STRUCTURE_CHANGED'
    for p in old:
        # Las fuentes, flags, CSS y assets no son imports JS; no pueden cambiar
        # amparándose en un permiso de edición de código de otro chunk.
        invariant = lambda r: {k: v for k, v in r.items() if k not in ['imports', 'dynamicImports']}
        assert invariant(old[p]) == invariant(new[p]), 'VITE_METADATA_IDENTITY_CHANGED:' + p
        if p not in scope['frontendAssets']:
            assert old[p] == new[p], 'VITE_PROTECTED_DEPENDENCIES_CHANGED:' + p
    return {VITE_MANIFEST}


# Transición revisada mediante AST con bindings y remapeo exacto de precargas.
# NO es un permiso de edición para OLT/index: ambos lados y el nuevo helper
# quedan fijados. Evidencia: TR069-HOSTS-CHUNK-PROOF-20261028.json.
VERIFIED_CHUNK_EXTRACTION = {
    'commit': 'ac511d7c70c8a11700d3553f331af5bb2930926a',
    'source': 'src/lib/gponSerial.ts',
    'sourceHash': '60ef16fbdd7026ccf2e9a24236124de72113dd975673d69fc6dce6fd29f6a947',
    'leaf': 'assets/gponSerial.js',
    'leafHash': '4605143d9324945dca8ddcfcffc2c57727c501fa85c6db163b7a5258b32e3777',
    'pairs': {
        'assets/OltDetailView.js': ['6bdaf6376d4bc63d894fe2bf91017fb81f687e9ebac3512ddff80800264f0350', 'aab2f3b598b4469f32fda5492587e19b40408e7621452491758c96b40de3c385'],
        'assets/index.js': ['fc82eb1f1dd4a384420d7534219374250a4b30bf3211f035f45df416e12d8dfd', 'e4eb9b7e1c37e3f3b5fbf4e59fc45305d7cd385f0e474182747c48a8c943409a'],
    },
    'allowedAssets': ['assets/Tr069View.js', 'assets/tr069.js'],
    'importers': ['assets/OltDetailView.js', 'assets/Tr069View.js', 'assets/index.js'],
}


def verified_chunk_extraction(before, after, old_norm, new_norm, scope):
    proof = VERIFIED_CHUNK_EXTRACTION
    if set(old_norm) == set(new_norm):
        return
    leaf = ('logical', proof['leaf'])
    if scope['sourceCommit'] != proof['commit'] or set(old_norm) - set(new_norm) or set(new_norm) - set(old_norm) != {leaf}:
        return  # El control estructural existente informa cualquier otra forma.
    assert sorted(scope['frontendAssets']) == sorted(proof['allowedAssets']), 'EXTRACTION_SCOPE_MISMATCH'
    import json
    old_sources, new_sources = [json.loads(files['release-manifest.json'])['sourceFiles'] for files in [before, after]]
    assert old_sources.get(proof['source']) == new_sources.get(proof['source']) == proof['sourceHash'], 'EXTRACTED_SOURCE_CHANGED'
    validate_frontend_sources(old_sources, new_sources, scope)
    assert new_norm[leaf] == proof['leafHash'], 'EXTRACTED_CHUNK_CONTENT_CHANGED'
    for name, pair in proof['pairs'].items():
        key = ('logical', name)
        assert [old_norm.get(key), new_norm.get(key)] == pair, 'EXTRACTION_PROTECTED_CONTENT_CHANGED:' + name
    new_paths = reachable(after)
    target = next(p for p in new_paths if stripname(p) == proof['leaf'])
    importers = sorted(stripname(p) for p in new_paths if target.split('/')[-1].encode() in after[p])
    assert importers == proof['importers'], 'EXTRACTION_DEPENDENCIES_CHANGED'
    assert not REF_HASH_TXT_RE.findall(after[target].decode()), 'EXTRACTION_LEAF_HAS_DEPENDENCIES'
    # Sustituye solo la representación física probada por su identidad anterior.
    # El resto del grafo, contenido protegido, estáticos y huérfanos sigue igual.
    for name in proof['pairs']:
        new_norm[('logical', name)] = old_norm[('logical', name)]
    del new_norm[leaf]
    return True


def validate_frontend(before, after, scope):
    if not scope['frontendSources']:
        changed = differences(before, after)
        assert not changed, 'FRONTEND_MUST_BE_IDENTICAL:' + ','.join(sorted(changed))
        return []
    old_reach, new_reach = reachable(before), reachable(after)
    def groups(paths):
        result = {}
        for p in paths:
            result.setdefault(stripname(p), set()).add(p)
        return result
    old_groups, new_groups = groups(old_reach), groups(new_reach)
    ambiguous = {p for p in set(old_groups) | set(new_groups)
                 if len(old_groups.get(p, ())) > 1 or len(new_groups.get(p, ())) > 1}
    pinned_paths = set()
    for name in sorted(ambiguous):
        old_paths, new_paths = old_groups.get(name, set()), new_groups.get(name, set())
        assert old_paths == new_paths, 'AMBIGUOUS_ASSET_MEMBERSHIP_CHANGED:' + name
        for p in sorted(old_paths):
            assert before[p] == after[p], 'AMBIGUOUS_ASSET_CONTENT_CHANGED:' + p
        pinned_paths.update(old_paths)
    pinned_names = {p.split('/')[-1] for p in pinned_paths}
    def normalized(files, paths):
        # Identidades tipadas: una ruta física fijada nunca pisa un nombre lógico.
        result = {('physical', p) if p in pinned_paths else ('logical', stripname(p)):
                  hashlib.sha256(normcontent(files[p], pinned_names)).hexdigest() for p in paths}
        assert len(result) == len(paths), 'NORMALIZED_ASSET_NAME_COLLISION'
        return result
    old_norm, new_norm = normalized(before, old_reach), normalized(after, new_reach)
    extraction = verified_chunk_extraction(before, after, old_norm, new_norm, scope)
    assert set(old_norm) == set(new_norm), 'HISTORICAL_ASSETS_STRUCTURE_CHANGED:removed=' + ','.join(sorted(k[1] for k in set(old_norm) - set(new_norm))) + ';added=' + ','.join(sorted(k[1] for k in set(new_norm) - set(old_norm)))
    changed = {key[1] for key in differences(old_norm, new_norm)}
    if normcontent(before['index.html'], pinned_names) != normcontent(after['index.html'], pinned_names):
        changed.add('index.html')
    allowed = set(scope['frontendAssets'])
    assert changed, 'HISTORICAL_ASSETS_NO_EXPECTED_CHANGE'
    assert changed <= allowed, 'HISTORICAL_ASSETS_CHANGED:' + ','.join(sorted(changed - allowed))
    # También protege estáticos y huérfanos fuera del grafo de Vite.
    metadata = validate_generated_metadata(before, after, scope, pinned_paths, extraction)
    outside = (set(before) | set(after)) - old_reach - new_reach - {'index.html', 'release-manifest.json'} - metadata
    unexpected = {p for p in outside if before.get(p) != after.get(p)}
    assert not unexpected, 'UNRELATED_STATIC_ASSETS_CHANGED:' + ','.join(sorted(unexpected))
    return sorted(changed)
