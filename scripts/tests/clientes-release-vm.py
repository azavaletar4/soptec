"""Prepare/inspect backups only. No deploy, checkout, restart, exec or database access."""
import subprocess,pathlib,json,hashlib,datetime,tarfile,io,shutil

repo=pathlib.Path('/opt/smartrayco')
def run(args,binary=False):
    return subprocess.check_output(args,cwd=repo,text=not binary).strip() if not binary else subprocess.check_output(args,cwd=repo)
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()
assert run(['git','rev-parse','HEAD'])==EXPECTED['base'],'PRODUCTION_BASE_CHANGED'
assert not run(['git','status','--porcelain']),'PRODUCTION_DIRTY'
cid=run(['docker','compose','-f','docker-compose.onprem.yml','ps','-q','frontend'])
obj=json.loads(run(['docker','inspect',cid]))[0]
assert obj['Image']==EXPECTED['image'] and obj['State']['Running'],'PRODUCTION_FRONTEND_CHANGED'
composeFiles=obj['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
compose=['docker','compose']
for f in composeFiles: compose+=['-f',f]
services={}
for service in ['frontend','backend','caddy','mongo','genieacs']:
    current=run(compose+['ps','-q',service])
    if current:
        o=json.loads(run(['docker','inspect',current]))[0]
        assert o['State']['Running'],'SERVICE_NOT_RUNNING'
        services[service]={'id':current,'image':o['Image'],'started':o['State']['StartedAt']}
archive=run(['docker','cp',cid+':/usr/share/nginx/html/.','-'],True)
assets={}
with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
    for m in tar.getmembers():
        if m.isfile(): assets[m.name.removeprefix('./')]=hashlib.sha256(tar.extractfile(m).read()).hexdigest()
assert assets==EXPECTED['assets'],'SERVED_ASSETS_DIVERGENCE'
config=json.loads(run(compose+['config','--format','json']))
args={k:v for k,v in config['services']['frontend']['build']['args'].items() if k.startswith('VITE_')}
assert args.get('VITE_SUPABASE_URL') and args.get('VITE_SUPABASE_ANON_KEY'),'PUBLIC_BUILD_CONFIG_MISSING'
assert not any('SERVICE_ROLE' in k or 'PASSWORD' in k for k in args),'UNEXPECTED_PUBLIC_CONFIG'
result={'base':EXPECTED['base'],'image':obj['Image'],'services':services,'composeFiles':composeFiles,
 'buildArguments':args,'assets':assets,'at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
if EXPECTED['mode']=='backup':
    assert shutil.disk_usage('/opt').free>1024**3,'INSUFFICIENT_BACKUP_SPACE'
    stage=pathlib.Path('/opt/smartrayco-staging')/('clientes-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    stage.mkdir(mode=0o700);backup=stage/'backup';backup.mkdir(mode=0o700)
    with (backup/'frontend.image.tar').open('wb') as out: subprocess.run(['docker','save',obj['Image']],stdout=out,check=True,cwd=repo)
    result['imageVerification']=verify_image_archive(backup/'frontend.image.tar',obj['Image'])
    (backup/'html.tar').write_bytes(archive)
    subprocess.run(['docker','cp',cid+':/etc/nginx/conf.d/default.conf',str(backup/'nginx.conf')],check=True,stdout=subprocess.DEVNULL)
    previous={k:v for k,v in result.items() if k!='buildArguments'}
    (backup/'previous.json').write_text(json.dumps(previous,indent=2))
    (backup/'rollback.override.json').write_text(json.dumps({'services':{'frontend':{'image':obj['Image']}}},indent=2))
    for n,f in enumerate(composeFiles): shutil.copy2(f,backup/('compose-'+str(n)+'.yml'))
    result['stage']=str(stage)
    result['files']={p.name:{'bytes':p.stat().st_size,'sha256':sha(p)} for p in backup.iterdir() if p.is_file()}
    (backup/'manifest.json').write_text(json.dumps({k:v for k,v in result.items() if k!='buildArguments'},indent=2))
    for p in backup.iterdir():p.chmod(0o600)
print(json.dumps(result))
