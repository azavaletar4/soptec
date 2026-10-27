"""Pruebas del verificador, sin servicios ni acceso a red."""
import hashlib
import io
import json
import tarfile
import tempfile
from pathlib import Path
import importlib.util

module_path = Path(__file__).with_name('asistencia-a3-archive-verify.py')
if not module_path.exists():
    module_path = Path(__file__).with_name('asistencia_a3_archive_verify.py')
spec = importlib.util.spec_from_file_location('asistencia_a3_archive_verify', module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
verify_archive = module.verify_archive


with tempfile.TemporaryDirectory(prefix='a3-archive-check-') as directory:
    def make_archive(tamper=False, wrong_layer_size=False):
        blobs = {}

        def add(raw, media):
            digest = 'sha256:' + hashlib.sha256(raw).hexdigest()
            blobs['blobs/sha256/' + digest[7:]] = raw
            return dict(digest=digest, size=len(raw), mediaType=media)

        layer = add(b'isolated synthetic layer', 'application/vnd.oci.image.layer.v1.tar')
        if wrong_layer_size:
            layer['size'] += 1
        config = add(json.dumps(dict(os='linux', architecture='amd64', config={}, rootfs=dict(diff_ids=['sha256:fixture']))).encode(), 'application/vnd.oci.image.config.v1+json')
        manifest = add(json.dumps(dict(config=config, layers=[layer])).encode(), 'application/vnd.oci.image.manifest.v1+json')
        root = add(json.dumps(dict(manifests=[manifest])).encode(), 'application/vnd.oci.image.index.v1+json')
        if tamper:
            blobs['blobs/sha256/' + layer['digest'][7:]] = b'corrupted'
        blobs['index.json'] = json.dumps(dict(manifests=[root])).encode()
        target = Path(directory) / ('archive-' + str(tamper) + str(wrong_layer_size) + '.tar')
        with tarfile.open(target, 'w') as tar:
            for name, raw in blobs.items():
                info = tarfile.TarInfo(name)
                info.size = len(raw)
                tar.addfile(info, io.BytesIO(raw))
        return str(target), root['digest']

    valid, digest = make_archive()
    assert verify_archive(valid, digest, {}, ['sha256:fixture'])['allBlobDigestsVerified']
    cases = [(valid, 'sha256:' + '0'*64, None), (*make_archive(tamper=True), None), (*make_archive(wrong_layer_size=True), None), (valid, digest, {'wrong': True})]
    for archive, expected, config in cases:
        try:
            verify_archive(archive, expected, config, ['sha256:fixture'])
        except (ValueError, KeyError):
            pass
        else:
            raise AssertionError('Invalid archive accepted')
    print(json.dumps(dict(verifierTests=5, passed=5, network=False)))
