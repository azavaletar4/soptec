import unittest
import copy
import json
import ast


def sample_scope(backend=False, frontend=False):
    return {'version': 1, 'sourceCommit': 'd' * 40,
            'backendSources': ['server/src/services/tr069Hosts.ts'] if backend else [],
            'frontendSources': ['src/views/tr069/Tr069View.vue'] if frontend else [],
            'frontendAssets': ['assets/Tr069View.js'] if frontend else []}


def frontend(version=1):
    suffix = 'AAAAAAAA' if version == 1 else 'BBBBBBBB'
    return {'index.html': ('<script src="/assets/index-' + suffix + '.js"></script>').encode(),
            'assets/index-' + suffix + '.js': ('import "./Tr069View-' + suffix + '.js";import "./Asistencia-AAAAAAAA.js"').encode(),
            'assets/Tr069View-' + suffix + '.js': ('export const hosts=' + str(version)).encode(),
            'assets/Asistencia-AAAAAAAA.js': b'export const asistencia=true',
            'assets/old-orphan-AAAAAAAA.js': b'old', 'logo.png': b'logo',
            'release-manifest.json': str(version).encode()}


class ReleaseContractTests(unittest.TestCase):
    def graph_pair(self):
        before = self.metadata_fixture(frontend())
        after = dict(before)
        after['assets/Tr069View-AAAAAAAA.js'] = b'import "./closureSubmission-CCCCCCCC.js";export const hosts=2'
        after['assets/closureSubmission-CCCCCCCC.js'] = b'export const closure=true'
        after = self.metadata_fixture(after)
        digest = lambda files: hashlib.sha256(json.dumps(validate_vite_manifest(files, set()), sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
        scope = sample_scope(frontend=True)
        scope['frontendAssets'].append('assets/closureSubmission.js')
        scope['frontendGraphTransition'] = {'before': digest(before), 'after': digest(after), 'added': ['assets/closureSubmission.js']}
        return before, after, scope

    def test_explicit_graph_addition_validates_both_graphs(self):
        before, after, scope = self.graph_pair()
        validate_scope(scope)
        self.assertEqual(validate_frontend(before, after, scope), sorted(scope['frontendAssets']))
        for key in ['before', 'after']:
            bad = copy.deepcopy(scope)
            bad['frontendGraphTransition'][key] = '0'*64
            with self.subTest(key=key), self.assertRaisesRegex(AssertionError, 'GRAPH_TRANSITION_DIGEST_MISMATCH'):
                validate_frontend(before, after, bad)

    def test_graph_proof_never_hides_unrelated_code_or_orphans(self):
        before, after, scope = self.graph_pair()
        for path in ['assets/Asistencia-AAAAAAAA.js', 'assets/old-orphan-AAAAAAAA.js', 'logo.png']:
            bad = self.metadata_fixture({**after, path: b'unexpected'})
            with self.subTest(path=path), self.assertRaises(AssertionError):
                validate_frontend(before, bad, scope)

    def test_graph_proof_cannot_remove_chunks_without_declaring_it(self):
        before, after, scope = self.graph_pair()
        bad = dict(after)
        bad['assets/index-AAAAAAAA.js'] = b'import "./Tr069View-AAAAAAAA.js"'
        with self.assertRaisesRegex(AssertionError, 'HISTORICAL_ASSETS_STRUCTURE_CHANGED'):
            validate_frontend(before, self.metadata_fixture(bad), scope)
        bad = copy.deepcopy(scope)
        bad['frontendGraphTransition']['added'] = []
        with self.assertRaisesRegex(AssertionError, 'EMPTY_GRAPH_TRANSITION'):
            validate_scope(bad)
        bad['frontendGraphTransition']['added'] = ['assets/closureSubmission.js'] * 2
        with self.assertRaisesRegex(AssertionError, 'INVALID_GRAPH_ADDITIONS'):
            validate_scope(bad)
        bad['frontendGraphTransition']['added'] = ['assets/unlisted.js']
        with self.assertRaisesRegex(AssertionError, 'UNDECLARED_GRAPH_ADDITION'):
            validate_scope(bad)

    def merge_pair(self):
        # Fusión real de chunk (sentido inverso a graph_pair): un chunk antes
        # independiente ('absorbed') desaparece, su código queda dentro de
        # 'Asistencia' — mismo fenómeno que descuentosCompensacion.js fusionado
        # en ClientServiceDetailView por el heurístico de chunking de Vite.
        raw_before = frontend()
        raw_before['assets/Asistencia-AAAAAAAA.js'] = b'import "./absorbed-AAAAAAAA.js";export const asistencia=true'
        raw_before['assets/absorbed-AAAAAAAA.js'] = b'export const absorbed=1'
        raw_after = dict(raw_before)
        del raw_after['assets/absorbed-AAAAAAAA.js']
        raw_after['assets/Asistencia-AAAAAAAA.js'] = b'export const asistencia=true;export const absorbed=1'
        before, after = self.metadata_fixture(raw_before), self.metadata_fixture(raw_after)
        digest = lambda files: hashlib.sha256(json.dumps(validate_vite_manifest(files, set()), sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
        scope = sample_scope(frontend=True)
        scope['frontendAssets'] = ['assets/Asistencia.js', 'assets/absorbed.js']
        scope['frontendGraphTransition'] = {'before': digest(before), 'after': digest(after), 'removed': ['assets/absorbed.js']}
        return before, after, scope

    def test_explicit_graph_removal_validates_both_graphs(self):
        before, after, scope = self.merge_pair()
        validate_scope(scope)
        self.assertEqual(validate_frontend(before, after, scope), sorted(scope['frontendAssets']))
        for key in ['before', 'after']:
            bad = copy.deepcopy(scope)
            bad['frontendGraphTransition'][key] = '0' * 64
            with self.subTest(key=key), self.assertRaisesRegex(AssertionError, 'GRAPH_TRANSITION_DIGEST_MISMATCH'):
                validate_frontend(before, after, bad)

    def test_graph_removal_proof_never_hides_unrelated_code_or_orphans(self):
        before, after, scope = self.merge_pair()
        for path in ['assets/Tr069View-AAAAAAAA.js', 'assets/old-orphan-AAAAAAAA.js', 'logo.png']:
            bad = self.metadata_fixture({**after, path: b'unexpected'})
            with self.subTest(path=path), self.assertRaises(AssertionError):
                validate_frontend(before, bad, scope)

    def test_graph_removal_requires_explicit_consistent_declaration(self):
        before, after, scope = self.merge_pair()
        without_removed = copy.deepcopy(scope)
        without_removed['frontendGraphTransition']['removed'] = []
        with self.assertRaisesRegex(AssertionError, 'EMPTY_GRAPH_TRANSITION'):
            validate_scope(without_removed)
        duplicated = copy.deepcopy(scope)
        duplicated['frontendGraphTransition']['removed'] = ['assets/absorbed.js'] * 2
        with self.assertRaisesRegex(AssertionError, 'INVALID_GRAPH_REMOVALS'):
            validate_scope(duplicated)
        undeclared = copy.deepcopy(scope)
        undeclared['frontendGraphTransition']['removed'] = ['assets/unlisted.js']
        with self.assertRaisesRegex(AssertionError, 'UNDECLARED_GRAPH_REMOVAL'):
            validate_scope(undeclared)
        wrong_name = copy.deepcopy(scope)
        wrong_name['frontendAssets'] = wrong_name['frontendAssets'] + ['assets/other.js']
        wrong_name['frontendGraphTransition']['removed'] = ['assets/other.js']
        with self.assertRaisesRegex(AssertionError, 'HISTORICAL_ASSETS_STRUCTURE_CHANGED'):
            validate_frontend(before, after, wrong_name)

    def metadata_fixture(self, files):
        files = dict(files)
        reach = reachable(files)
        keys = {p: 'index.html' if p.startswith('assets/index-') and p.endswith('.js') else '_' + p.split('/')[-1] for p in reach}
        manifest = {}
        for p in reach:
            entry = {'file': p, 'name': stripname(p).split('/')[-1].rsplit('.', 1)[0]}
            if keys[p] == 'index.html':
                entry.update({'src': 'index.html', 'isEntry': True})
            if p.endswith('.js'):
                for field, pattern in [('imports', STATIC_IMPORT_RE), ('dynamicImports', DYNAMIC_IMPORT_RE)]:
                    refs = sorted({posixpath.normpath(posixpath.join(posixpath.dirname(p), m[1])) for m in pattern.findall(files[p].decode())})
                    if refs:
                        entry[field] = [keys[ref] for ref in refs]
            manifest[keys[p]] = entry
        files[VITE_MANIFEST] = json.dumps(manifest).encode()
        return self.rehash_metadata(files)

    def rehash_metadata(self, files):
        files = dict(files)
        try:
            release = json.loads(files['release-manifest.json'])
        except ValueError:
            release = {}
        if not isinstance(release, dict):
            release = {}
        release['artifacts'] = {p: hashlib.sha256(b).hexdigest() for p, b in files.items() if p != 'release-manifest.json'}
        files['release-manifest.json'] = json.dumps(release).encode()
        return files

    def metadata_pair(self):
        return self.metadata_fixture(frontend()), self.metadata_fixture({**frontend(), **frontend(2)})

    def test_vite_manifest_legitimate_update_and_formatting(self):
        before, after = self.metadata_pair()
        manifest = json.loads(after[VITE_MANIFEST])
        after[VITE_MANIFEST] = json.dumps(dict(reversed(list(manifest.items()))), indent=4).encode()
        after = self.rehash_metadata(after)
        self.assertNotEqual(before[VITE_MANIFEST], after[VITE_MANIFEST])
        self.assertEqual(validate_frontend(before, after, sample_scope(frontend=True)), ['assets/Tr069View.js'])

    def test_vite_native_repeated_dynamic_imports_are_valid(self):
        # Reproduce el bloqueo real de ambos manifiestos (AsistenciaPanel: 4
        # referencias a index.html). Pendiente: no parchear tras detener release.
        before = frontend()
        before['assets/Asistencia-AAAAAAAA.js'] += b';async function read(){await import("./index-AAAAAAAA.js");await import("./index-AAAAAAAA.js")}'
        after = {**before, 'assets/Tr069View-AAAAAAAA.js': b'export const hosts=2'}
        before, after = self.metadata_fixture(before), self.metadata_fixture(after)
        for files in [before, after]:
            manifest = json.loads(files[VITE_MANIFEST])
            manifest['_Asistencia-AAAAAAAA.js']['dynamicImports'] = ['index.html'] * 4
            files[VITE_MANIFEST] = json.dumps(manifest).encode()
            files.update(self.rehash_metadata(files))
        self.assertEqual(validate_frontend(before, after, sample_scope(frontend=True)), ['assets/Tr069View.js'])

    def test_vite_manifest_rejects_missing_asset_and_import_key(self):
        before, after = self.metadata_pair()
        for field in ['file', 'imports']:
            manifest = json.loads(after[VITE_MANIFEST])
            manifest['index.html'][field] = 'assets/missing-CCCCCCCC.js' if field == 'file' else ['missing-key']
            bad = self.rehash_metadata({**after, VITE_MANIFEST: json.dumps(manifest).encode()})
            with self.subTest(field=field), self.assertRaisesRegex(AssertionError, 'VITE_(ASSET|IMPORT)_MISSING'):
                validate_frontend(before, bad, sample_scope(frontend=True))

    def test_vite_manifest_rejects_inconsistent_compiled_imports_and_entry_flags(self):
        before, after = self.metadata_pair()
        for edit in ['imports', 'isEntry', 'assets']:
            manifest = json.loads(after[VITE_MANIFEST])
            manifest['index.html'][edit] = [] if edit == 'imports' else False if edit == 'isEntry' else ['assets/Asistencia-AAAAAAAA.js']
            bad = self.rehash_metadata({**after, VITE_MANIFEST: json.dumps(manifest).encode()})
            with self.subTest(edit=edit), self.assertRaises(AssertionError):
                validate_frontend(before, bad, sample_scope(frontend=True))

    def test_vite_metadata_cannot_hide_unrelated_functional_changes(self):
        before, after = self.metadata_pair()
        after['assets/Asistencia-AAAAAAAA.js'] = b'export const asistencia=false'
        after = self.metadata_fixture(after)
        with self.assertRaisesRegex(AssertionError, 'HISTORICAL_ASSETS_CHANGED:assets/Asistencia.js'):
            validate_frontend(before, after, sample_scope(frontend=True))

    def test_vite_manifest_rejects_physical_collision_and_duplicate_json_keys(self):
        before, after = self.metadata_pair()
        manifest = json.loads(after[VITE_MANIFEST])
        manifest['_duplicate.js'] = {'file': manifest['index.html']['file']}
        bad = self.rehash_metadata({**after, VITE_MANIFEST: json.dumps(manifest).encode()})
        with self.assertRaisesRegex(AssertionError, 'VITE_ASSET_COLLISION'):
            validate_frontend(before, bad, sample_scope(frontend=True))
        bad[VITE_MANIFEST] = b'{"same":{},"same":{}}'
        with self.assertRaisesRegex(AssertionError, 'METADATA_DUPLICATE_KEY'):
            validate_frontend(before, bad, sample_scope(frontend=True))

    def test_vite_manifest_and_shared_extraction_are_validated_together(self):
        before, after, scope, proof = self.extraction_fixture()
        before, after = self.metadata_fixture(before), self.metadata_fixture(after)
        self.assertEqual(self.with_extraction(before, after, scope, proof), ['assets/Tr069View.js'])

    def test_vite_metadata_preserves_qr_collision_protection(self):
        before, workers, importer = self.qr_assets()
        before = self.metadata_fixture(before)
        after = self.metadata_fixture({**before, 'assets/Tr069View-AAAAAAAA.js': b'export const hosts=2'})
        self.assertEqual(validate_frontend(before, after, sample_scope(frontend=True)), ['assets/Tr069View.js'])
        after[workers[1]] += b'changed'
        with self.assertRaisesRegex(AssertionError, 'AMBIGUOUS_ASSET_CONTENT_CHANGED'):
            validate_frontend(before, self.rehash_metadata(after), sample_scope(frontend=True))

    def test_vite_metadata_tolerates_node_modules_symlink_src_prefix(self):
        # Caso real (build remoto contra la VM, confirmado con manifiestos
        # reales descargados de produccion): el Dockerfile de build enlaza
        # node_modules con un symlink (ln -s /app/node_modules node_modules);
        # Rollup puede resolver el MISMO archivo fisico (mismo hash, mismo
        # contenido) con un prefijo relativo distinto segun por donde
        # atraviese el symlink -- "node_modules/qr-scanner/..." en la imagen
        # ya desplegada vs "../../app/node_modules/qr-scanner/..." en la
        # candidata recien construida. No es un cambio real de codigo.
        before, workers, importer = self.qr_assets()
        before = self.metadata_fixture(before)
        old_key = '_' + workers[0].split('/')[-1]
        manifest = json.loads(before[VITE_MANIFEST])
        entry = manifest.pop(old_key)
        entry['src'] = 'node_modules/qr-scanner/qr-scanner-worker.min.js'
        entry['isDynamicEntry'] = True
        manifest[entry['src']] = entry
        before[VITE_MANIFEST] = json.dumps(manifest).encode()
        before = self.rehash_metadata(before)

        def rekey(files, new_src):
            files = dict(files)
            manifest = json.loads(files[VITE_MANIFEST])
            entry = dict(manifest.pop('node_modules/qr-scanner/qr-scanner-worker.min.js'))
            entry['src'] = new_src
            manifest[new_src] = entry
            files[VITE_MANIFEST] = json.dumps(manifest).encode()
            return files

        after = rekey(before, '../../app/node_modules/qr-scanner/qr-scanner-worker.min.js')
        after['assets/Tr069View-AAAAAAAA.js'] = b'export const hosts=2'
        after = self.rehash_metadata(after)
        self.assertEqual(validate_frontend(before, after, sample_scope(frontend=True)), ['assets/Tr069View.js'])

        # Pero un cambio real de PAQUETE (no solo el prefijo del symlink)
        # sigue detectandose -- la normalizacion solo tolera el prefijo.
        swapped = rekey(before, '../../app/node_modules/otro-paquete/qr-scanner-worker.min.js')
        swapped['assets/Tr069View-AAAAAAAA.js'] = b'export const hosts=2'
        swapped = self.rehash_metadata(swapped)
        with self.assertRaisesRegex(AssertionError, 'VITE_METADATA_IDENTITY_CHANGED'):
            validate_frontend(before, swapped, sample_scope(frontend=True))

    def test_vite_metadata_requires_artifact_hashes_presence_and_explicit_classification(self):
        before, after = self.metadata_pair()
        bad = dict(after)
        release = json.loads(bad['release-manifest.json'])
        release['artifacts'][VITE_MANIFEST] = '0'*64
        bad['release-manifest.json'] = json.dumps(release).encode()
        with self.assertRaisesRegex(AssertionError, 'RELEASE_ARTIFACT_HASH_MISMATCH'):
            validate_frontend(before, bad, sample_scope(frontend=True))
        bad = dict(after)
        del bad[VITE_MANIFEST]
        with self.assertRaisesRegex(AssertionError, 'VITE_MANIFEST_PRESENCE_CHANGED'):
            validate_frontend(before, bad, sample_scope(frontend=True))
        with self.assertRaisesRegex(AssertionError, 'UNRELATED_STATIC_ASSETS_CHANGED'):
            validate_frontend(before, self.rehash_metadata({**after, '.vite/other.json': b'{}'}), sample_scope(frontend=True))
        with self.assertRaisesRegex(AssertionError, 'FRONTEND_MUST_BE_IDENTICAL'):
            validate_frontend(before, after, sample_scope(backend=True))

    def test_vite_css_placeholder_is_metadata_not_functional_identity(self):
        before, after = self.metadata_pair()
        for files, placeholder in [(before, '01n'), (after, '01o')]:
            p = 'assets/leaflet-AAAAAAAA.css'
            files[p] = b'.map{color:green}'
            files['index.html'] += ('<link href="/' + p + '">').encode()
            manifest = json.loads(files[VITE_MANIFEST])
            key = '_leaflet-!~{' + placeholder + '}~.js'
            manifest[key] = {'file': p, 'src': key}
            manifest['index.html']['css'] = [p]
            files[VITE_MANIFEST] = json.dumps(manifest).encode()
            files.update(self.rehash_metadata(files))
        self.assertEqual(validate_frontend(before, after, sample_scope(frontend=True)), ['assets/Tr069View.js'])

    def extraction_fixture(self):
        before = frontend()
        before['assets/index-AAAAAAAA.js'] += b';import "./OltDetailView-AAAAAAAA.js"'
        before['assets/OltDetailView-AAAAAAAA.js'] = b'function serial(x){return x};export const olt=1'
        after = dict(before)
        after['assets/index-AAAAAAAA.js'] += b';const preload="./gponSerial-AAAAAAAA.js"'
        after['assets/OltDetailView-AAAAAAAA.js'] = b'import {n} from "./gponSerial-AAAAAAAA.js";export const olt=1'
        after['assets/Tr069View-AAAAAAAA.js'] = b'import {n} from "./gponSerial-AAAAAAAA.js";export const hosts=2'
        after['assets/gponSerial-AAAAAAAA.js'] = b'function serial(x){return x};export{serial as n}'
        scope = sample_scope(frontend=True)
        sources = {'src/lib/gponSerial.ts': 'source-hash', scope['frontendSources'][0]: 'old'}
        before['release-manifest.json'] = json.dumps({'sourceFiles': sources}).encode()
        after['release-manifest.json'] = json.dumps({'sourceFiles': {**sources, scope['frontendSources'][0]: 'new'}}).encode()
        digest = lambda b: hashlib.sha256(normcontent(b)).hexdigest()
        proof = {'commit': scope['sourceCommit'], 'source': 'src/lib/gponSerial.ts', 'sourceHash': 'source-hash',
                 'leaf': 'assets/gponSerial.js', 'leafHash': digest(after['assets/gponSerial-AAAAAAAA.js']),
                 'pairs': {stripname(p): [digest(before[p]), digest(after[p])] for p in ['assets/index-AAAAAAAA.js', 'assets/OltDetailView-AAAAAAAA.js']},
                 'allowedAssets': scope['frontendAssets'],
                 'importers': ['assets/OltDetailView.js', 'assets/Tr069View.js', 'assets/index.js']}
        return before, after, scope, proof

    def with_extraction(self, before, after, scope, proof):
        global VERIFIED_CHUNK_EXTRACTION
        original = VERIFIED_CHUNK_EXTRACTION
        try:
            VERIFIED_CHUNK_EXTRACTION = proof
            return validate_frontend(before, after, scope)
        finally:
            VERIFIED_CHUNK_EXTRACTION = original

    def test_verified_shared_extraction_preserves_protected_chunk(self):
        before, after, scope, proof = self.extraction_fixture()
        self.assertEqual(self.with_extraction(before, after, scope, proof), ['assets/Tr069View.js'])

    def test_extraction_rejects_any_helper_or_protected_functional_change(self):
        before, after, scope, proof = self.extraction_fixture()
        for p in ['assets/gponSerial-AAAAAAAA.js', 'assets/OltDetailView-AAAAAAAA.js', 'assets/index-AAAAAAAA.js', 'assets/Asistencia-AAAAAAAA.js']:
            with self.subTest(p=p), self.assertRaises(AssertionError):
                self.with_extraction(before, {**after, p: after[p] + b';unexpected()'}, scope, proof)

    def test_extraction_rejects_source_scope_or_dependency_drift(self):
        before, after, scope, proof = self.extraction_fixture()
        for source in ['src/lib/gponSerial.ts', 'src/views/olt/OltDetailView.vue']:
            altered = dict(after)
            sources = json.loads(after['release-manifest.json'])['sourceFiles']
            sources[source] = 'unexpected'
            altered['release-manifest.json'] = json.dumps({'sourceFiles': sources}).encode()
            with self.subTest(source=source), self.assertRaises(AssertionError):
                self.with_extraction(before, altered, scope, proof)
        altered = {**after, 'assets/Asistencia-AAAAAAAA.js': after['assets/Asistencia-AAAAAAAA.js'] + b';import "./gponSerial-AAAAAAAA.js"'}
        with self.assertRaisesRegex(AssertionError, 'EXTRACTION_DEPENDENCIES_CHANGED'):
            self.with_extraction(before, altered, scope, proof)

    def test_extraction_requires_exact_structure_commit_and_declared_scope(self):
        before, after, scope, proof = self.extraction_fixture()
        altered = {**after, 'assets/other-AAAAAAAA.js': b'export const x=1'}
        altered['assets/Tr069View-AAAAAAAA.js'] += b';import "./other-AAAAAAAA.js"'
        for candidate, declared in [(altered, scope), (after, {**scope, 'sourceCommit': 'a'*40}), (after, {**scope, 'frontendAssets': scope['frontendAssets'] + ['assets/OltDetailView.js']})]:
            with self.assertRaises(AssertionError):
                self.with_extraction(before, candidate, declared, proof)

    def qr_assets(self):
        files = frontend()
        workers = ['assets/qr-scanner-worker.min-D85Z9gVD.js', 'assets/qr-scanner-worker.min-PJMWJc5V.js']
        importer = 'assets/AuthorizeOnuModal-AAAAAAAA.js'
        files[importer] = ('const a="' + workers[0] + '";const b="' + workers[1] + '";').encode()
        files['assets/index-AAAAAAAA.js'] += b';import "./AuthorizeOnuModal-AAAAAAAA.js"'
        files[workers[0]], files[workers[1]] = b'worker module', b'worker iife'
        return files, workers, importer

    def test_real_qr_worker_names_are_distinct_unchanged_assets(self):
        before, workers, importer = self.qr_assets()
        self.assertEqual(stripname(workers[0]), stripname(workers[1]))
        self.assertNotEqual(before[workers[0]], before[workers[1]])
        after = dict(before)
        after['assets/Tr069View-AAAAAAAA.js'] = b'export const hosts=2'
        self.assertEqual(validate_frontend(before, after, sample_scope(frontend=True)), ['assets/Tr069View.js'])
        self.assertEqual(set(workers), set(reachable(before)) & set(workers))

    def test_each_ambiguous_worker_is_checked_byte_for_byte_even_if_declared_allowed(self):
        before, workers, importer = self.qr_assets()
        scope = sample_scope(frontend=True)
        scope['frontendAssets'].append('assets/qr-scanner-worker.min.js')
        for worker in workers:
            after = {**before, worker: b'changed'}
            with self.subTest(worker=worker), self.assertRaisesRegex(AssertionError, 'AMBIGUOUS_ASSET_CONTENT_CHANGED'):
                validate_frontend(before, after, scope)

    def test_ambiguous_worker_membership_and_reference_swap_are_not_hidden(self):
        before, workers, importer = self.qr_assets()
        after = dict(before)
        after[importer] = before[importer].replace(workers[0].encode(), b'PLACEHOLDER').replace(workers[1].encode(), workers[0].encode()).replace(b'PLACEHOLDER', workers[1].encode())
        with self.assertRaisesRegex(AssertionError, 'HISTORICAL_ASSETS_CHANGED:assets/AuthorizeOnuModal.js'):
            validate_frontend(before, after, sample_scope(frontend=True))
        renamed = dict(before)
        renamed['assets/qr-scanner-worker.min-CCCCCCCC.js'] = renamed.pop(workers[0])
        renamed[importer] = before[importer].replace(workers[0].encode(), b'assets/qr-scanner-worker.min-CCCCCCCC.js')
        with self.assertRaisesRegex(AssertionError, 'AMBIGUOUS_ASSET_MEMBERSHIP_CHANGED'):
            validate_frontend(before, renamed, sample_scope(frontend=True))

    def test_hosts_environment_explicit_and_scoped_only(self):
        scope = {**sample_scope(backend=True), 'backendEnvironment': {
            'TR069_HOSTS_ON_DEMAND_ENABLED': 'true', 'TR069_HOSTS_ON_DEMAND_SERIALS': 'HWTC1D3691B7'}}
        validate_scope(scope)
        self.assertEqual(backend_environment(scope), scope['backendEnvironment'])
        self.assertEqual(backend_environment(sample_scope(backend=True)), {})

    def test_environment_rejects_wifi_credentials_or_missing_serial_scope(self):
        for env in [{'TR069_WIFI_TRIAL_ENABLED': 'false'}, {'PASSWORD': 'x'},
                    {'TR069_HOSTS_ON_DEMAND_ENABLED': 'true'},
                    {'TR069_HOSTS_ON_DEMAND_ENABLED': 'true', 'TR069_HOSTS_ON_DEMAND_SERIALS': '*'}]:
            with self.subTest(env=env), self.assertRaises(AssertionError):
                validate_scope({**sample_scope(backend=True), 'backendEnvironment': env})

    def check_mode(self, backend, front):
        scope = sample_scope(backend, front)
        validate_scope(scope)
        before = frontend()
        after = {**before, **frontend(2)} if front else dict(before)
        changes = validate_frontend(before, after, scope)
        self.assertEqual(changes, ['assets/Tr069View.js'] if front else [])
        back = {'server/src/services/tr069Hosts.ts': 'old', 'server/src/routes/olt.ts': 'protected', 'src/lib/gponSerial.ts': 'protected'}
        candidate = {**back, 'server/src/services/tr069Hosts.ts': 'new'} if backend else dict(back)
        validate_backend(back, candidate, scope, {'server/src/services/tr069Hosts.ts': 'new'} if backend else {})
        source_before = {'src/views/tr069/Tr069View.vue': 'old', 'src/views/asistencia/AsistenciaView.vue': 'protected'}
        source_after = {**source_before, 'src/views/tr069/Tr069View.vue': 'new'} if front else dict(source_before)
        validate_frontend_sources(source_before, source_after, scope)
        selected = (['backend'] if backend else []) + (['frontend'] if front else [])
        self.assertEqual(release_services(scope), selected)
        override, rollback = release_overrides(scope, {'backend': 'new-back', 'frontend': 'new-front'}, {'backend': 'old-back', 'frontend': 'old-front'})
        self.assertEqual(list(override['services']), selected)
        self.assertEqual(list(rollback['services']), selected)
        self.assertTrue(all(set(v) == {'image'} for v in [*override['services'].values(), *rollback['services'].values()]))

    def test_backend_only_exact_frontend(self):
        self.check_mode(True, False)

    def test_frontend_only_exact_backend(self):
        self.check_mode(False, True)

    def test_both_declared_changes_and_vite_hash_cascade(self):
        self.check_mode(True, True)

    def test_backend_only_rejects_any_frontend_change_including_manifest(self):
        before = frontend()
        for path in before:
            with self.subTest(path=path), self.assertRaisesRegex(AssertionError, 'FRONTEND_MUST_BE_IDENTICAL'):
                validate_frontend(before, {**before, path: b'unexpected'}, sample_scope(True))

    def test_unrelated_modules_rejected_in_all_three_modes(self):
        for backend, front in [(True, False), (False, True), (True, True)]:
            scope = sample_scope(backend, front)
            for module in ['asistencia', 'puntos', 'campo', 'olt', 'rutinas', 'tr069WifiTrial']:
                p = 'server/src/services/' + module + '.ts'
                before = {'server/src/services/tr069Hosts.ts': 'old', p: 'protected'}
                after = {**before, p: 'unexpected'}
                if backend:
                    after['server/src/services/tr069Hosts.ts'] = 'new'
                with self.subTest(mode=(backend, front), module=module), self.assertRaisesRegex(AssertionError, 'BACKEND_SCOPE_MISMATCH.*' + module):
                    validate_backend(before, after, scope, {})

    def test_frontend_change_does_not_hide_other_chunk_changes(self):
        before = frontend()
        after = {**before, **frontend(2), 'assets/Asistencia-AAAAAAAA.js': b'unexpected'}
        with self.assertRaisesRegex(AssertionError, 'HISTORICAL_ASSETS_CHANGED:assets/Asistencia.js'):
            validate_frontend(before, after, sample_scope(frontend=True))

    def test_frontend_rejects_static_or_orphan_changes_additions_deletions(self):
        for path in ['logo.png', 'assets/old-orphan-AAAAAAAA.js', 'new.txt']:
            with self.subTest(path=path), self.assertRaisesRegex(AssertionError, 'UNRELATED_STATIC_ASSETS_CHANGED'):
                validate_frontend(frontend(), {**frontend(), **frontend(2), path: b'unexpected'}, sample_scope(frontend=True))
        after = {**frontend(), **frontend(2)}
        del after['logo.png']
        with self.assertRaisesRegex(AssertionError, 'UNRELATED_STATIC_ASSETS_CHANGED'):
            validate_frontend(frontend(), after, sample_scope(frontend=True))

    def test_declared_frontend_change_must_exist(self):
        with self.assertRaisesRegex(AssertionError, 'HISTORICAL_ASSETS_NO_EXPECTED_CHANGE'):
            validate_frontend(frontend(), frontend(), sample_scope(frontend=True))

    def test_backend_requires_exact_source_and_rejects_missing_or_extra_files(self):
        scope = sample_scope(backend=True)
        p = scope['backendSources'][0]
        with self.assertRaisesRegex(AssertionError, 'BACKEND_SOURCE_CONTENT_MISMATCH'):
            validate_backend({p: 'old'}, {p: 'wrong'}, scope, {p: 'expected'})
        with self.assertRaisesRegex(AssertionError, 'BACKEND_SCOPE_MISMATCH'):
            validate_backend({p: 'old'}, {p: 'old'}, scope, {p: 'new'})
        for before, after in [({p: 'old', 'extra': 'old'}, {p: 'new'}), ({p: 'old'}, {p: 'new', 'extra': 'new'})]:
            with self.assertRaisesRegex(AssertionError, 'BACKEND_SCOPE_MISMATCH.*extra'):
                validate_backend(before, after, scope, {p: 'new'})

    def test_frontend_source_scope_rejects_unrelated_changes(self):
        with self.assertRaisesRegex(AssertionError, 'FRONTEND_SOURCE_SCOPE_MISMATCH'):
            validate_frontend_sources({'src/lib/campo.ts': 'old'}, {'src/lib/campo.ts': 'new'}, sample_scope(backend=True))

    def test_scope_rejects_empty_wildcards_traversal_and_incomplete_frontend(self):
        invalid = [sample_scope(), {**sample_scope(True), 'backendSources': ['../private']},
                   {**sample_scope(True), 'backendSources': ['server/src/*.ts']},
                   {**sample_scope(True), 'frontendSources': ['src/App.vue']}]
        for scope in invalid:
            with self.subTest(scope=scope), self.assertRaises(AssertionError):
                validate_scope(scope)

    def test_python_entrypoint_compiles_with_injected_contract(self):
        ast.parse(RELEASE_PROGRAM)
        self.assertIn("+services,cwd=repo", RELEASE_PROGRAM)
        self.assertNotIn("'TR069_WIFI_TRIAL_ENABLED':''", RELEASE_PROGRAM)


unittest.main(verbosity=2)
