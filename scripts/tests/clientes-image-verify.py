"""Verificación OCI de sólo lectura, sin extraer ni cargar la imagen."""
import hashlib,json,re,tarfile

def verify_image_archive(path,expected):
    checked={}
    with tarfile.open(path,'r') as archive:
        names=archive.getnames()
        assert len(names)==len(set(names)),'DUPLICATE_TAR_MEMBER'
        def read(name):
            member=archive.getmember(name)
            assert member.isfile(),'NOT_A_FILE'
            return archive.extractfile(member)
        def verify(d):
            digest=d['digest'];assert re.fullmatch(r'sha256:[a-f0-9]{64}',digest),'UNSUPPORTED_DIGEST'
            if digest in checked:
                assert checked[digest]['size']==d['size'];return
            h=hashlib.sha256();size=0;parts=[]
            is_json=d['mediaType'].endswith(('+json','.json'))
            with read('blobs/'+digest.replace(':','/')) as f:
                for b in iter(lambda:f.read(1024*1024),b''):
                    h.update(b);size+=len(b)
                    if is_json:parts.append(b)
            assert 'sha256:'+h.hexdigest()==digest and size==d['size'],'BLOB_HASH_MISMATCH'
            checked[digest]={'size':size}
            if is_json:
                obj=json.loads(b''.join(parts))
                if 'manifests' in obj:
                    for child in obj['manifests']:verify(child)
                elif 'config' in obj and 'layers' in obj:
                    verify(obj['config'])
                    for layer in obj['layers']:verify(layer)
        with read('index.json') as f:index=json.load(f)
        assert len(index['manifests'])==1 and index['manifests'][0]['digest']==expected,'EXACT_IMAGE_MISMATCH'
        verify(index['manifests'][0])
    return {'image':expected,'exactIdentity':True,'allReachableDescriptorsVerified':True,
            'blobsVerified':len(checked),'bytesVerified':sum(d['size'] for d in checked.values())}
