"""Valida contenido direccionado por hash de un docker save OCI, sin extraerlo."""
import hashlib
import json
import tarfile


def verify_archive(archive, expected_digest, expected_config=None, expected_diff_ids=None):
    if not expected_digest.startswith('sha256:') or len(expected_digest) != 71:
        raise ValueError('EXPECTED_DIGEST_INVALID')
    with tarfile.open(archive) as tar:
        names = tar.getnames()
        if len(names) != len(set(names)):
            raise ValueError('DUPLICATE_ARCHIVE_PATH')
        index = json.load(tar.extractfile('index.json'))
        roots = index.get('manifests', [])
        matching = [d for d in roots if d.get('digest') == expected_digest]
        if len(roots) != 1 or len(matching) != 1:
            raise ValueError('ARCHIVE_IMAGE_MISMATCH')
        visited = set()
        runtime_configs = []

        def blob(descriptor):
            digest = descriptor['digest']
            if not digest.startswith('sha256:') or len(digest) != 71:
                raise ValueError('UNSUPPORTED_DIGEST')
            raw = tar.extractfile('blobs/sha256/' + digest[7:]).read()
            if len(raw) != descriptor['size'] or hashlib.sha256(raw).hexdigest() != digest[7:]:
                raise ValueError('BLOB_INTEGRITY_MISMATCH')
            return raw

        def visit(descriptor):
            raw = blob(descriptor)
            digest = descriptor['digest']
            if digest in visited:
                return
            visited.add(digest)
            media = descriptor['mediaType']
            if media in ('application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json'):
                for child in json.loads(raw)['manifests']:
                    visit(child)
            elif media in ('application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'):
                manifest = json.loads(raw)
                config = json.loads(blob(manifest['config']))
                visited.add(manifest['config']['digest'])
                for layer in manifest['layers']:
                    blob(layer)
                    visited.add(layer['digest'])
                if config.get('os') == 'linux' and config.get('architecture') in ('amd64', 'arm64'):
                    runtime_configs.append(config)
            else:
                raise ValueError('UNSUPPORTED_MANIFEST_TYPE')

        # Verifica TODOS los índices exportados, incluidas attestations.
        for root in roots:
            visit(root)
        if not runtime_configs:
            raise ValueError('NO_RUNTIME_CONFIG')
        if expected_config is not None and not any(
            c.get('config') == expected_config and c.get('rootfs', {}).get('diff_ids') == expected_diff_ids
            for c in runtime_configs
        ):
            raise ValueError('RUNTIME_CONFIG_MISMATCH')
        return dict(expectedDigest=expected_digest, rootDigestMatches=True,
                    allBlobDigestsVerified=True, verifiedBlobCount=len(visited),
                    runtimeConfigCount=len(runtime_configs), archiveSha256=hashlib.sha256(open(archive, 'rb').read()).hexdigest())
