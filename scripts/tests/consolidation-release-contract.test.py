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
