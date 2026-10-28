"""Contrato puro de integridad, compartido por build, deploy y pruebas aisladas."""
import hashlib
import pathlib
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
    assert set(old_norm) == set(new_norm), 'HISTORICAL_ASSETS_STRUCTURE_CHANGED:removed=' + ','.join(sorted(k[1] for k in set(old_norm) - set(new_norm))) + ';added=' + ','.join(sorted(k[1] for k in set(new_norm) - set(old_norm)))
    changed = {key[1] for key in differences(old_norm, new_norm)}
    if normcontent(before['index.html'], pinned_names) != normcontent(after['index.html'], pinned_names):
        changed.add('index.html')
    allowed = set(scope['frontendAssets'])
    assert changed, 'HISTORICAL_ASSETS_NO_EXPECTED_CHANGE'
    assert changed <= allowed, 'HISTORICAL_ASSETS_CHANGED:' + ','.join(sorted(changed - allowed))
    # También protege estáticos y huérfanos fuera del grafo de Vite.
    outside = (set(before) | set(after)) - old_reach - new_reach - {'index.html', 'release-manifest.json'}
    unexpected = {p for p in outside if before.get(p) != after.get(p)}
    assert not unexpected, 'UNRELATED_STATIC_ASSETS_CHANGED:' + ','.join(sorted(unexpected))
    return sorted(changed)
