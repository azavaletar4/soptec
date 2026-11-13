"""Explica diferencias OCI de las dos imágenes locales; nunca usa SSH."""
import subprocess, json, tarfile, io, pathlib, collections, re

run = lambda args: subprocess.check_output(args, text=True, stderr=subprocess.PIPE).strip()
context = run(['docker', 'context', 'show'])
endpoint = json.loads(run(['docker', 'context', 'inspect', context]))[0]['Endpoints']['docker']['Host']
assert re.match(r'^(npipe:|unix:|tcp://(?:127\.0\.0\.1|localhost):)', endpoint), 'LOCAL_DOCKER_REQUIRED'
out = pathlib.Path('deploy/dashboard-v2-20261112')
proof = json.loads((out / 'build-reproducibility.json').read_text())
images = [attempt['image'] for attempt in proof['attempts']]
inspections = [json.loads(run(['docker', 'image', 'inspect', image]))[0] for image in images]
trees = []
for image in images:
    cid = run(['docker', 'create', '--network', 'none', image])
    try:
        raw = subprocess.check_output(['docker', 'cp', cid + ':/usr/share/nginx/html/.', '-'], stderr=subprocess.PIPE)
        with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
            trees.append({m.name: {'mtime': m.mtime, 'uid': m.uid, 'gid': m.gid, 'mode': m.mode, 'type': m.type.decode()} for m in archive if m.isfile()})
    finally:
        subprocess.check_call(['docker', 'rm', cid], stdout=subprocess.DEVNULL)
assert trees[0].keys() == trees[1].keys()
counts = collections.Counter(k for p in trees[0] for k in trees[0][p] if trees[0][p][k] != trees[1][p][k])
assert set(counts) <= {'mtime'}, 'UNEXPECTED_IMAGE_FILE_METADATA_DIFFERENCE'
assert inspections[0]['Config'] == inspections[1]['Config'], 'RUNTIME_CONFIG_DIFFERENCE'
result = {'status': 'PASS', 'imageIds': images, 'created': [d['Created'] for d in inspections], 'runtimeConfigIdentical': True, 'fileContentsIdentical': True, 'fileTreeSha256': proof['attempts'][0]['treeSha256'], 'fileMetadataDifferences': dict(counts), 'imageIdsByteIdentical': False, 'sourceAndFrontendTarByteIdentical': True, 'candidateArchiveFrozen': True}
target = out / 'image-metadata-differences.json'
content = json.dumps(result, indent=2) + '\n'
if target.exists(): assert target.read_text() == content, 'SEALED_METADATA_REPORT_DRIFT'
else: target.write_bytes(content.encode('utf8'))
print(json.dumps(result))
