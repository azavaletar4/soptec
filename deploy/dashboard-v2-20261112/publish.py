"""Procedimiento exclusivo frontend. NO ejecutar apply/rollback sin autorización.

Se ejecutará en la VM únicamente después de transferir el paquete autorizado.
preflight/verify solo leen; apply/rollback exigen --authorized y hash externo.
"""
import argparse, hashlib, io, json, pathlib, re, subprocess, sys, tarfile, time

parser = argparse.ArgumentParser()
parser.add_argument('action', choices=['preflight', 'apply', 'verify', 'rollback'])
parser.add_argument('--expected-package-sha256', required=True)
parser.add_argument('--authorized', action='store_true')
args = parser.parse_args()
assert re.fullmatch('[a-f0-9]{64}', args.expected_package_sha256), 'INVALID_PACKAGE_DIGEST'
stage = pathlib.Path(__file__).resolve().parent
sha = lambda b: hashlib.sha256(b).hexdigest()
def file_hash(p):
    h = hashlib.sha256()
    with pathlib.Path(p).open('rb') as f:
        for chunk in iter(lambda: f.read(1048576), b''): h.update(chunk)
    return h.hexdigest()
assert file_hash(stage / 'package.json') == args.expected_package_sha256, 'PACKAGE_NOT_APPROVED'
package = json.loads((stage / 'package.json').read_text())
assert package['services'] == ['frontend'] and package['backendSources'] == [], 'FRONTEND_ONLY_REQUIRED'
for name, digest in package['files'].items():
    assert pathlib.PurePosixPath(name).name == name, 'UNSAFE_PACKAGE_NAME'
    assert file_hash(stage / name) == digest, 'PACKAGE_FILE_DRIFT:' + name
baseline = json.loads((stage / 'production-baseline.json').read_text())
plan = json.loads((stage / 'deployment-plan.json').read_text())
assert plan['services'] == ['frontend'] and plan['sourceCommit'] == package['sourceCommit'], 'PLAN_SCOPE_DRIFT'
assert plan['beforeImage'] == baseline['services']['frontend']['image'], 'BACKUP_IMAGE_DRIFT'
assert str(stage) == package['stage'] == plan['stage'], 'WRONG_DEPLOYMENT_DIRECTORY'
def run(argv): return subprocess.check_output(argv, stderr=subprocess.PIPE, text=True).strip()
def inspect(service): return json.loads(run(['docker', 'inspect', 'smartrayco-' + service + '-1']))[0]
def tree(container, root):
    raw = subprocess.check_output(['docker', 'cp', container + ':' + root + '/.', '-'], stderr=subprocess.PIPE)
    with tarfile.open(fileobj=io.BytesIO(raw)) as t:
        return {m.name.removeprefix('./'): sha(t.extractfile(m).read()) for m in t if m.isfile()}
def environment(d): return sha(json.dumps(sorted(d['Config']['Env']), separators=(',', ':')).encode())
def unchanged(frontend_too):
    for name, previous in baseline['services'].items():
        if name == 'frontend' and not frontend_too: continue
        d = inspect(name)
        assert (d['Id'], d['Image'], d['State']['StartedAt'], environment(d), d['State']['Running']) == (previous['id'], previous['image'], previous['started'], previous['environmentHash'], True), 'SERVICE_DRIFT:' + name
def config_unchanged():
    for p, digest in baseline['configurationHashes'].items(): assert file_hash(p) == digest, 'CONFIG_DRIFT:' + p
    for p, digest in baseline['backendContractHashes'].items():
        raw = subprocess.check_output(['docker', 'exec', 'smartrayco-backend-1', 'cat', '/app/' + p], stderr=subprocess.PIPE)
        assert sha(raw.replace(b'\r\n', b'\n')) == digest, 'BACKEND_CONTRACT_DRIFT:' + p
def compose(extra=None):
    cmd = ['docker', 'compose', '-p', 'smartrayco', '--project-directory', '/opt/smartrayco']
    for p in plan['composeFiles']: cmd += ['-f', p]
    if extra: cmd += ['-f', str(stage / extra)]
    return cmd
def compose_proof(extra, image):
    # No imprime el compose efectivo: contiene valores privados del entorno.
    old = json.loads(run(compose() + ['config', '--format', 'json']))
    expected = json.loads(json.dumps(old)); expected['services']['frontend']['image'] = image
    actual = json.loads(run(compose(extra) + ['config', '--format', 'json']))
    assert expected == actual, 'OTHER_COMPOSE_CONFIGURATION_CHANGED'
def http(route, status_only=False):
    command = ['curl', '--silent', '--show-error', '--max-time', '8', '--resolve', 'panel.rayconetworks.com:443:127.0.0.1']
    if status_only: command += ['--output', '/dev/null', '--write-out', '%{http_code}']
    else: command += ['--fail']
    return subprocess.check_output(command + ['https://panel.rayconetworks.com' + route], stderr=subprocess.PIPE)
def health():
    for attempt in range(10):
        try:
            assert json.loads(http('/api/health'))['status'] == 'ok'; return
        except Exception:
            if attempt == 9: raise AssertionError('API_HEALTH_FAILED')
            time.sleep(2)
def verify_site(rollback=False):
    unchanged(False); config_unchanged(); health()
    d = inspect('frontend'); expected_image = plan['beforeImage'] if rollback else plan['candidateImage']
    assert d['Image'] == expected_image and d['State']['Running'], 'FRONTEND_IMAGE_MISMATCH'
    assert environment(d) == baseline['services']['frontend']['environmentHash'], 'FRONTEND_ENVIRONMENT_CHANGED'
    expected_files = plan['beforeSiteHashes'] if rollback else plan['candidateSiteHashes']
    assert tree(d['Id'], '/usr/share/nginx/html') == expected_files, 'FRONTEND_TREE_MISMATCH'
    assert tree(d['Id'], '/etc/nginx') == baseline['nginxHashes'], 'NGINX_CHANGED'
    for route in ['/', '/dashboard', '/clientes', '/soporte', '/olt', '/mikrotik', '/inventario', '/facturacion', '/tr069', '/asistencia', '/campo']:
        assert sha(http(route)) == expected_files['index.html'], 'HTML_ROUTE_FAILED:' + route
    release = json.loads(http('/release-manifest.json'))
    assert release['commit'] == (plan['baseCommit'] if rollback else plan['sourceCommit']), 'PUBLIC_MANIFEST_DRIFT'
    for p, digest in release['artifacts'].items(): assert sha(http('/' + p)) == digest, 'HTTP_ASSET_DRIFT:' + p
    for route in ['/api/dashboard/pppoe-profiles', '/api/dashboard/network-status', '/api/dashboard/olt-summary']:
        assert http(route, True).decode() == '401', 'AUTHENTICATION_GUARD_FAILED:' + route
    return {'status': 'PASS', 'frontendImage': expected_image, 'frontendCommit': release['commit'], 'backendUnchanged': True, 'otherServicesUnchanged': True, 'apiUnauthenticatedStatus': 401, 'sqlExecuted': False, 'mikrotikRequests': 0}
if args.action == 'preflight':
    unchanged(True); config_unchanged(); health()
    assert tree(inspect('frontend')['Id'], '/usr/share/nginx/html') == plan['beforeSiteHashes'], 'BASE_SITE_DRIFT'
    assert tree(inspect('frontend')['Id'], '/etc/nginx') == baseline['nginxHashes'], 'BASE_NGINX_DRIFT'
    chains = [baseline['services'][s]['composeFiles'] for s in ['frontend', 'backend']]
    assert all(plan['composeFiles'][:len(chain)] == chain for chain in chains), 'COMPOSE_CHAIN_DIVERGED'
    compose_proof('release.override.json', plan['candidateTag']); compose_proof('rollback.override.json', plan['rollbackTag'])
    print(json.dumps({'status': 'PASS', 'action': 'preflight', 'servicesChanged': False, 'writes': 0}))
elif args.action == 'verify': print(json.dumps(verify_site()))
else:
    assert args.authorized, 'EXPLICIT_AUTHORIZATION_REQUIRED'
    if args.action == 'apply':
        unchanged(True); config_unchanged(); health()
        assert not (stage / 'attempt.json').exists(), 'APPLICATION_ALREADY_ATTEMPTED'
        assert tree(inspect('frontend')['Id'], '/usr/share/nginx/html') == plan['beforeSiteHashes'], 'BASE_SITE_DRIFT'
        run(['docker', 'load', '-i', str(stage / 'frontend-candidate.image.tar.gz')])
        assert run(['docker', 'image', 'inspect', plan['candidateTag'], '--format', '{{.Id}}']) == plan['candidateImage'], 'CANDIDATE_IMAGE_DRIFT'
        run(['docker', 'tag', plan['beforeImage'], plan['rollbackTag']])
        compose_proof('release.override.json', plan['candidateTag'])
        (stage / 'attempt.json').write_text(json.dumps({'action': 'apply', 'sourceCommit': plan['sourceCommit']}))
        extra = 'release.override.json'
    else:
        unchanged(False); config_unchanged()
        assert (stage / 'attempt.json').exists(), 'NO_APPLICATION_TO_ROLL_BACK'
        assert inspect('frontend')['Image'] == plan['candidateImage'], 'ROLLBACK_FRONTEND_DRIFT'
        run(['docker', 'load', '-i', str(stage / 'frontend-before.image.tar.gz')])
        run(['docker', 'tag', plan['beforeImage'], plan['rollbackTag']])
        assert run(['docker', 'image', 'inspect', plan['rollbackTag'], '--format', '{{.Id}}']) == plan['beforeImage'], 'ROLLBACK_IMAGE_DRIFT'
        compose_proof('rollback.override.json', plan['rollbackTag']); extra = 'rollback.override.json'
    # Exclusivamente frontend. No build, pull, recreación de dependencias ni SQL.
    result = subprocess.run(compose(extra) + ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'frontend'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert result.returncode == 0, 'FRONTEND_COMPOSE_FAILED_STOP_AND_EVALUATE_ROLLBACK'
    validation = verify_site(args.action == 'rollback')
    (stage / (args.action + '-result.json')).write_text(json.dumps(validation, indent=2) + '\n')
    print(json.dumps(validation))
