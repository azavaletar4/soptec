"""Despliegue exclusivo del frontend aprobado; sin acceso a BD ni backend operativo."""
import subprocess,pathlib,json,hashlib,datetime,tarfile,io,shutil,importlib.util,re
repo=pathlib.Path('/opt/smartrayco');stage=pathlib.Path(EXPECTED['stage'])
assert re.fullmatch(r'/opt/smartrayco-staging/clientes-\d{8}T\d{6}Z',str(stage))
before=EXPECTED['before'];release=EXPECTED['artifact'];action=EXPECTED['action']
def run(args,binary=False):return subprocess.check_output(args,cwd=repo,text=not binary) if binary else subprocess.check_output(args,cwd=repo,text=True).strip()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def inspect(cid):return json.loads(run(['docker','inspect',cid]))[0]
assert run(['git','rev-parse','HEAD'])==before['base'] and not run(['git','status','--porcelain']),'PRODUCTION_GIT_DIVERGENCE'
for name,digest in EXPECTED['stagedHashes'].items():assert sha(stage/name)==digest,'STAGED_HASH_DIVERGENCE'
for name,meta in before['files'].items():assert sha(stage/'backup'/name)==meta['sha256'],'VM_BACKUP_DIVERGENCE'
assert sha(stage/'frontend-dist.tar.gz')==release['frontendArchive']['sha256'],'ARTIFACT_DIVERGENCE'
base=['docker','compose']
for i,f in enumerate(before['composeFiles']):
    assert sha(pathlib.Path(f))==before['files']['compose-'+str(i)+'.yml']['sha256'],'LIVE_COMPOSE_DIVERGENCE'
    base+=['-f',f]
def service(name):return run(base+['ps','-q',name])
def protected():
    for name,expected in before['services'].items():
        if name=='frontend':continue
        cid=service(name);obj=inspect(cid)
        assert cid==expected['id'] and obj['Image']==expected['image'] and obj['State']['StartedAt']==expected['started'] and obj['State']['Running'],'PROTECTED_SERVICE_DIVERGENCE'
protected()
cid=service('frontend');current=inspect(cid)
if action!='verify':
    old=before['services']['frontend']
    assert cid==old['id'] and current['Image']==old['image'] and current['State']['StartedAt']==old['started'] and current['State']['Running'],'FRONTEND_DIVERGENCE'
def files(tarbytes):
    result={}
    with tarfile.open(fileobj=io.BytesIO(tarbytes)) as tar:
        for m in tar.getmembers():
            if m.isfile():result[m.name.removeprefix('./')]=hashlib.sha256(tar.extractfile(m).read()).hexdigest()
    return result
candidate=files((stage/'frontend-dist.tar.gz').read_bytes())
def containerFiles(cid):return files(run(['docker','cp',cid+':/usr/share/nginx/html/.','-'],True))
def nginxHash(cid):
    content=run(['docker','cp',cid+':/etc/nginx/conf.d/default.conf','-'],True)
    with tarfile.open(fileobj=io.BytesIO(content)) as tar:
        members=[m for m in tar.getmembers() if m.isfile()];assert len(members)==1
        return hashlib.sha256(tar.extractfile(members[0]).read()).hexdigest()
if action!='verify':
    assert containerFiles(cid)==before['assets'],'LIVE_ASSET_DIVERGENCE'
    config=json.loads(run(base+['config','--format','json']))
    args={k:v for k,v in config['services']['frontend']['build']['args'].items() if k.startswith('VITE_')}
    assert hashlib.sha256(json.dumps(args,separators=(',',':')).encode()).hexdigest()==release['configSha256'],'PUBLIC_CONFIG_DIVERGENCE'
    check=json.loads(run(['python3',str(stage/'rollback-check.py'),str(stage)]));assert check['check']=='PASS'
if action=='preflight':
    print(json.dumps({'status':'PASS','action':action,'base':before['base'],'image':current['Image'],'artifactSha256':release['frontendArchive']['sha256'],'backupPCandVMVerified':True,'rollbackVerified':True,'protectedServicesUnchanged':True,'servedFiles':len(before['assets'])}))
elif action=='prepare':
    context=stage/'clientes-image-context';context.mkdir(mode=0o700);html=context/'html';html.mkdir()
    with tarfile.open(stage/'frontend-dist.tar.gz') as tar:
        for m in tar.getmembers():
            name=pathlib.PurePosixPath(m.name)
            assert not name.is_absolute() and '..' not in name.parts and (m.isfile() or m.isdir()),'UNSAFE_TAR'
            target=html.joinpath(*name.parts)
            if m.isdir():target.mkdir(parents=True,exist_ok=True)
            else:
                target.parent.mkdir(parents=True,exist_ok=True)
                with tar.extractfile(m) as src,target.open('wb') as dst:shutil.copyfileobj(src,dst)
    live=args.get('VITE_MATERIAL_CUSTODY_LIVE_SINCE');assert live and any(live in p.read_text() for p in (html/'assets').glob('*.js')),'LIVE_CONFIG_NOT_IN_CANDIDATE'
    runtime='smartrayco-frontend:clientes-runtime-314269b'
    subprocess.run(['docker','tag',current['Image'],runtime],check=True)
    image=EXPECTED['imageTag']
    (context/'Dockerfile').write_text('FROM '+runtime+'\nRUN rm -rf /usr/share/nginx/html && mkdir -p /usr/share/nginx/html\nCOPY html/ /usr/share/nginx/html/\nLABEL io.smartrayco.clientes.revision="2f25873" io.smartrayco.clientes.artifact="'+release['frontendArchive']['sha256']+'"\n')
    with (stage/'clientes-image-build.log').open('wb') as log:subprocess.run(['docker','build','--network','none','--pull=false','-t',image,str(context)],stdout=log,stderr=log,check=True)
    new=inspect(image);old=inspect(current['Image'])
    assert new['RootFS']['Layers'][:len(old['RootFS']['Layers'])]==old['RootFS']['Layers'],'RUNTIME_LAYER_DIVERGENCE'
    scratch=run(['docker','create','--network','none',image]);assert scratch!=cid
    try:
        assert containerFiles(scratch)==candidate,'IMAGE_ASSET_DIVERGENCE'
        assert nginxHash(scratch)==before['files']['nginx.conf']['sha256'],'IMAGE_NGINX_DIVERGENCE'
    finally:subprocess.run(['docker','rm',scratch],check=True,stdout=subprocess.DEVNULL)
    protected();assert service('frontend')==cid
    result={'status':'IMAGE_READY','revision':EXPECTED['revision'],'imageTag':image,'imageId':new['Id'],'artifactSha256':release['frontendArchive']['sha256'],'assetFilesVerified':len(candidate),'runtimeLayersPreserved':True,'nginxUnchanged':True,'productionUnchanged':True}
    (stage/'clientes-deploy.override.json').write_text(json.dumps({'services':{'frontend':{'image':image}}},indent=2))
    (stage/'clientes-image-ready.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
elif action=='activate':
    ready=json.loads((stage/'clientes-image-ready.json').read_text())
    assert ready['artifactSha256']==release['frontendArchive']['sha256'] and inspect(ready['imageTag'])['Id']==ready['imageId'],'IMAGE_READY_DIVERGENCE'
    override=json.loads((stage/'clientes-deploy.override.json').read_text());assert override=={'services':{'frontend':{'image':ready['imageTag']}}}
    at=datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        with (stage/'clientes-activation.log').open('wb') as log:subprocess.run(base+['-f',str(stage/'clientes-deploy.override.json'),'up','-d','--no-deps','--no-build','--pull','never','frontend'],stdout=log,stderr=log,check=True)
        newcid=service('frontend');new=inspect(newcid)
        assert new['Image']==ready['imageId'] and new['State']['Running'],'ACTIVATED_IMAGE_MISMATCH'
        protected();assert containerFiles(newcid)==candidate,'PUBLISHED_ASSET_DIVERGENCE'
        assert nginxHash(newcid)==before['files']['nginx.conf']['sha256'],'PUBLISHED_NGINX_DIVERGENCE'
    except Exception:
        with (stage/'clientes-automatic-rollback.log').open('wb') as log:subprocess.run(base+['-f',str(stage/'backup/rollback.override.json'),'up','-d','--no-deps','--no-build','--pull','never','frontend'],stdout=log,stderr=log,check=True)
        assert inspect(service('frontend'))['Image']==before['image'],'ROLLBACK_FAILED'
        raise RuntimeError('ACTIVATION_FAILED_FRONTEND_ROLLED_BACK')
    result={'status':'FRONTEND_ACTIVATED','revision':EXPECTED['revision'],'imageTag':ready['imageTag'],'imageId':new['Image'],'container':newcid,'artifactSha256':release['frontendArchive']['sha256'],'assetFilesVerified':len(candidate),'protectedServicesUnchanged':True,'nginxUnchanged':True,'activatedAt':at,'startedAt':new['State']['StartedAt']}
    (stage/'clientes-activation-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
elif action=='verify':
    activation=json.loads((stage/'clientes-activation-result.json').read_text())
    assert cid==activation['container'] and current['Image']==activation['imageId'] and current['State']['Running'],'ACTIVE_IMAGE_DIVERGENCE'
    assert containerFiles(cid)==candidate and nginxHash(cid)==before['files']['nginx.conf']['sha256'],'ACTIVE_FILES_DIVERGENCE'
    errors={}
    for name in ['frontend','backend']:
        logs=subprocess.run(['docker','logs','--since',activation['activatedAt'],service(name)],capture_output=True,text=True,check=True)
        errors[name]=len(re.findall(r'(?i)\[(?:emerg|alert|crit|error)\]|\b(?:fatal|panic|uncaught exception|unhandled rejection)\b',logs.stdout+'\n'+logs.stderr))
        assert errors[name]==0,'NEW_CRITICAL_LOG_ERRORS'
    result={'status':'PASS','revision':EXPECTED['revision'],'imageId':current['Image'],'filesVerified':len(candidate),'protectedServicesUnchanged':True,'nginxUnchanged':True,'criticalErrorsSinceActivation':errors,'rollbackImage':before['image'],'rollbackAvailable':True}
    (stage/'clientes-final-verification.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
