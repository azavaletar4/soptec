import subprocess,pathlib,json,hashlib,os,sys,tarfile,io,datetime,time
os.umask(0o077)
stage=pathlib.Path(STAGE);repo=pathlib.Path('/opt/smartrayco');I=json.loads((stage/'input.json').read_text())
assert I['toolHash']==TOOL_HASH,'RELEASE_TOOL_DRIFT'
scope=I['scope'];validate_scope(scope)
assert scope['sourceCommit']==I['commit']==I['snapshot']['commit'],'SOURCE_COMMIT_MISMATCH'
assert set(I['back'])==set(scope['backendSources']),'BACKEND_INPUT_SCOPE_MISMATCH'
services=release_services(scope)
hosts_environment=backend_environment(scope)

def run(a,cwd=repo):return subprocess.check_output(a,cwd=cwd,text=True,stderr=subprocess.PIPE).strip()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def hashfile(p):
 h=hashlib.sha256()
 with pathlib.Path(p).open('rb')as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def current(s):return json.loads(run(['docker','inspect','smartrayco-'+s+'-1']))[0]
def states():return {s:{'id':current(s)['Id'],'image':current(s)['Image'],'started':current(s)['State']['StartedAt']}for s in ['frontend','backend','caddy','mongo','genieacs']}
def environment_hashes(cid):
 return {k:hashlib.sha256(v.encode()).hexdigest()for k,v in (item.split('=',1)for item in current(cid)['Config']['Env'])}
def tree(cid,root,raw=False):
 data=subprocess.check_output(['docker','cp',cid+':'+root+'/.','-'])
 with tarfile.open(fileobj=io.BytesIO(data))as t:
  if raw:return {m.name.removeprefix('./'):t.extractfile(m).read()for m in t if m.isfile()}
  return {m.name.removeprefix('./'):hashlib.sha256(t.extractfile(m).read()).hexdigest()for m in t if m.isfile()}
def backend_tree(cid):
 return {prefix+p:h for prefix,root in [('server/src/','/app/server/src'),('src/','/app/src')]for p,h in tree(cid,root).items()}
def compose(m,extras=[]):
 a=['docker','compose','-p','smartrayco','--project-directory',str(repo)]
 for f in m['composeFiles']+extras:a+=['-f',f]
 return a
def unchanged(m,skip=[]):
 for s,b in m['before'].items():
  if s in skip:continue
  o=current(s);assert o['Id']==b['id']and o['Image']==b['image']and o['State']['StartedAt']==b['started']and o['State']['Running'],'SERVICE_DRIFT_'+s
def http(route):return subprocess.check_output(['curl','--fail','--silent','--max-time','5','--resolve','panel.rayconetworks.com:443:127.0.0.1','https://panel.rayconetworks.com'+route])
def health():
 for i in range(15):
  try:assert json.loads(http('/api/health'))['status']=='ok';return
  except Exception:time.sleep(2)
 raise AssertionError('API_UNHEALTHY')
def build(folder,tag,rebuild=False):
 args=['docker','build','--pull=false','--network=none']+(['--no-cache']if rebuild else[])+['-t',tag,'.']
 with (stage/(folder.name+('-repro'if rebuild else'')+'-private.log')).open('w')as log:subprocess.run(args,cwd=folder,stdout=log,stderr=subprocess.STDOUT,check=True)
 return run(['docker','image','inspect',tag,'--format','{{.Id}}'])
def save_image_archive(tag,p):
 with p.open('wb')as f:subprocess.run(['docker','save',tag],stdout=f,check=True)
 return hashfile(p)
def safe_extract(src,target):
 with tarfile.open(src)as t:
  assert all((target/m.name).resolve().is_relative_to(target.resolve())for m in t.getmembers()),'UNSAFE_ARCHIVE'
  t.extractall(target,filter='data')
def write_sources(folder,files):
 for name,text in files.items():
  p=folder/name;assert p.resolve().is_relative_to(folder.resolve());p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text)
def read_manifest(cid):return json.loads(tree(cid,'/usr/share/nginx/html',raw=True)['release-manifest.json'])
def load_state(name):
 m=json.loads((stage/name).read_text());assert m['toolHash']==TOOL_HASH and m['services']==services,'PREPARED_CONTRACT_DRIFT';assert hashfile(stage/'input.json')==m['inputHash'],'PREPARED_INPUT_DRIFT';return m
def probe(m):
 health();unchanged(m,services)
 for s in ['frontend','backend']:assert current(s)['Image']==m[s+'Image'],'CANDIDATE_NOT_DEPLOYED_'+s
 assert tree(current('frontend')['Id'],'/usr/share/nginx/html')==m['assets'],'CANDIDATE_ASSETS_NOT_DEPLOYED'
 assert tree(current('frontend')['Id'],'/etc/nginx')==m['oldNginx'],'NGINX_CONFIG_CHANGED'
 assert backend_tree(current('backend')['Id'])==m['backendSources'],'CANDIDATE_BACKEND_NOT_DEPLOYED'
 assert environment_hashes('backend')==m['expectedBackendEnvironmentHashes'],'BACKEND_EFFECTIVE_ENVIRONMENT_CHANGED'
 manifest=json.loads(http('/release-manifest.json'));assert manifest['commit']==m['frontendCommit'],'FRONTEND_MANIFEST_COMMIT_MISMATCH'
 checked=[]
 for route in ['/','/tr069','/asistencia','/campo','/campo/mi-custodia','/puntos','/soporte','/mikrotik','/analitica','/rutinas','/olt']:
  assert hashlib.sha256(http(route)).hexdigest()==m['assets']['index.html'],'HTML_ROUTE_MISMATCH_'+route;checked.append(route)
 for p,h in manifest['artifacts'].items():assert hashlib.sha256(http('/'+p)).hexdigest()==h,'HTTP_ARTIFACT_MISMATCH_'+p
 for route in ['/api/genieacs-sync/wifi/HWTC1D3691B7/trial/status','/api/genieacs-sync/hosts/HWTC1D3691B7']:
  code=run(['curl','--silent','--output','/dev/null','--write-out','%{http_code}','--resolve','panel.rayconetworks.com:443:127.0.0.1','https://panel.rayconetworks.com'+route]);assert code=='401','UNAUTHENTICATED_CHECK_GOT_'+code
 return {'routes':checked,'artifactsVerified':len(manifest['artifacts']),'sourceCommit':I['commit'],'frontendCommit':m['frontendCommit'],'servicesChanged':services,'unauthenticatedStatus':401,'ssidTasksSent':0}
def verify_rollback(m):
 health();unchanged(m,services)
 assert all(current(s)['Image']==m['before'][s]['image']for s in ['frontend','backend']),'ROLLBACK_IMAGE_MISMATCH'
 assert tree(current('frontend')['Id'],'/usr/share/nginx/html')==m['oldAssets'],'ROLLBACK_ASSETS_MISMATCH'
 assert backend_tree(current('backend')['Id'])==m['oldBackend'],'ROLLBACK_SOURCES_MISMATCH'
 assert environment_hashes('backend')==m['oldBackendEnvironmentHashes'],'ROLLBACK_ENVIRONMENT_MISMATCH'

if ACTION=='prepare':
 assert not(stage/'prepared.json').exists(),'ALREADY_PREPARED';before=states();b=current('backend');f=current('frontend')
 manifest=read_manifest(f['Id']);validate_frontend_sources(manifest['sourceFiles'],I['snapshot']['files'],scope)
 m={'before':before,'at':now(),'toolHash':TOOL_HASH,'services':services,'composeFiles':b['Config']['Labels']['com.docker.compose.project.config_files'].split(','),'backupFiles':{},'backupHashes':{},'sourceArchiveHash':hashfile(stage/'source.tar'),'inputHash':hashfile(stage/'input.json')}
 for s in ['backend','frontend']:
  file=stage/(s+'-before.image.tar');m['backupFiles'][s]=str(file);m['backupHashes'][s]=save_image_archive(before[s]['image'],file)
  m[s+'RollbackTag']='smartrayco-consolidado-'+s+'-rollback:'+I['commit'][:7]+'-'+TOOL_HASH[:10]
  run(['docker','tag',before[s]['image'],m[s+'RollbackTag']]);cid=run(['docker','create','--network','none',m[s+'RollbackTag']])
  try:
   if s=='frontend':assert tree(cid,'/usr/share/nginx/html')==tree(before[s]['id'],'/usr/share/nginx/html'),'ROLLBACK_RESTORE_MISMATCH_frontend'
   else:assert backend_tree(cid)==backend_tree(before[s]['id']),'ROLLBACK_RESTORE_MISMATCH_backend'
  finally:run(['docker','rm',cid])
 config=json.loads(run(compose(m)+['config','--format','json']));assert config['services']['backend']['image']==b['Config']['Image']and config['services']['frontend']['image']==f['Config']['Image'],'LIVE_COMPOSE_IMAGE_MISMATCH'
 m['oldBackendEnvironmentHashes']=environment_hashes('backend');m['expectedBackendEnvironmentHashes']=dict(m['oldBackendEnvironmentHashes'])
 for key,value in hosts_environment.items():
  assert key not in config['services']['backend'].get('environment',{})or config['services']['backend']['environment'][key]==value,'HOSTS_ENVIRONMENT_OVERRIDDEN_'+key
  m['expectedBackendEnvironmentHashes'][key]=hashlib.sha256(value.encode()).hexdigest()
 # Compose efectivo y entorno de los contenedores deben coincidir antes de promover.
 for s in ['backend','frontend']:
  live=dict(item.split('=',1)for item in current(s)['Config']['Env'])
  for key,value in config['services'][s].get('environment',{}).items():assert live.get(key)==str(value),'LIVE_ENV_CONFIG_DRIFT_'+s+'_'+key
 (stage/'compose-private.json').write_text(json.dumps(config));m['configurationHashes']={p:hashfile(p)for p in m['composeFiles']+[str(repo/'.env')]}
 m['oldAssets']=tree(f['Id'],'/usr/share/nginx/html');m['oldBackend']=backend_tree(b['Id']);m['oldNginx']=tree(f['Id'],'/etc/nginx');m['oldFrontendCommit']=manifest['commit']
 rollback=stage/'release.rollback.json';rollback.write_text(json.dumps({'services':{s:{'image':m[s+'RollbackTag']}for s in services}}));m['rollback']=str(rollback)
 rollback_config=json.loads(run(compose(m,[m['rollback']])+['config','--format','json']));expected=json.loads(json.dumps(config))
 for s in services:expected['services'][s]['image']=m[s+'RollbackTag']
 assert rollback_config==expected,'ROLLBACK_CONFIG_CHANGED'
 m['rollbackFileHash']=hashfile(m['rollback'])
 m['rollbackTested']=True;(stage/'prepared.json').write_text(json.dumps(m));unchanged(m);health()
 print(json.dumps({'prepared':True,'rollbackTested':True,'backupFiles':m['backupFiles'],'stage':str(stage),'sourceCommit':I['commit'],'declaredServices':services,'servicesChanged':False}))
elif ACTION=='build':
 m=load_state('prepared.json');unchanged(m);assert hashfile(stage/'source.tar')==m['sourceArchiveHash']and hashfile(stage/'input.json')==m['inputHash'],'PREPARED_INPUT_DRIFT'
 config=json.loads((stage/'compose-private.json').read_text());oldRaw=tree(current('frontend')['Id'],'/usr/share/nginx/html',raw=True)
 oldManifest=json.loads(oldRaw['release-manifest.json']);validate_frontend_sources(oldManifest['sourceFiles'],I['snapshot']['files'],scope)
 m['assets']=m['oldAssets'];m['frontendCommit']=m['oldFrontendCommit'];m['frontendImage']=m['before']['frontend']['image'];m['frontendTag']=current('frontend')['Config']['Image']
 m['backendImage']=m['before']['backend']['image'];m['backendTag']=current('backend')['Config']['Image'];m['backendSources']=m['oldBackend'];m['artifactCount']=len(oldManifest['artifacts']);m['frontendChangedAssets']=[]
 if 'frontend'in services:
  args=dict(config['services']['frontend']['build']['args']);args['VITE_MATERIAL_CUSTODY_LIVE_SINCE']=''
  oldtext='\n'.join(v.decode(errors='replace')for p,v in oldRaw.items()if p.endswith('.js'))
  for key in ['VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY']:assert args[key]in oldtext,'ACTIVE_PUBLIC_CONFIG_MISMATCH_'+key
  expectedConfig={key:hashlib.sha256((args[key]or'').encode()).hexdigest()for key in ['VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY','VITE_MATERIAL_CUSTODY_LIVE_SINCE']}
  assert expectedConfig==oldManifest['configurationHashes'],'PUBLIC_CONFIGURATION_CHANGED_WITHOUT_APPROVAL'
  m['frontendTag']='smartrayco-frontend-consolidado:'+I['commit'][:12];manifests=[];front_trees=[]
  for name in ['canonical','repro']:
   folder=stage/name;folder.mkdir();source=folder/'source';source.mkdir();safe_extract(stage/'source.tar',source)
   docker='FROM '+m['backendRollbackTag']+' AS build\nWORKDIR /build/source\nCOPY source/ ./\nRUN ln -s /app/node_modules node_modules\n'
   for k,v in args.items():
    if k.startswith('VITE_'):docker+='ENV '+k+'='+json.dumps(v or'')+'\n'
   docker+='ENV SOURCE_COMMIT='+I['commit']+'\nRUN node scripts/frontend-release-build.mjs --snapshot release-source.json\nFROM '+m['frontendRollbackTag']+'\nCOPY --from=build /build/source/dist/ /usr/share/nginx/html/\nLABEL org.opencontainers.image.revision="'+I['commit']+'"\n'
   (folder/'Dockerfile').write_text(docker);tag=m['frontendTag']if name=='canonical'else m['frontendTag']+'-repro';iid=build(folder,tag,name=='repro');cid=run(['docker','create','--network','none',tag])
   try:
    raw=tree(cid,'/usr/share/nginx/html',raw=True);manifest=json.loads(raw['release-manifest.json']);assert manifest['commit']==I['commit'],'MANIFEST_COMMIT_MISMATCH';assert manifest['configurationHashes']==expectedConfig,'EFFECTIVE_CONFIGURATION_CHANGED'
    assert VITE_MANIFEST in oldRaw and VITE_MANIFEST in raw,'REQUIRED_VITE_MANIFEST_MISSING'
    changed=validate_frontend(oldRaw,raw,scope);assert tree(cid,'/etc/nginx')==m['oldNginx'],'NGINX_CONFIG_CHANGED';manifests.append(manifest);front_trees.append(tree(cid,'/usr/share/nginx/html'))
    if name=='canonical':m['frontendImage']=iid;m['assets']=front_trees[-1];m['frontendChangedAssets']=changed
   finally:run(['docker','rm',cid])
  assert manifests[0]==manifests[1]and front_trees[0]==front_trees[1],'BUILD_NOT_REPRODUCIBLE'
  m['frontendCommit']=I['commit'];m['artifactCount']=len(manifests[0]['artifacts'])
 else:validate_frontend(oldRaw,tree(current('frontend')['Id'],'/usr/share/nginx/html',raw=True),scope)
 if 'backend'in services:
  folder=stage/'backend';folder.mkdir();write_sources(folder,I['back'])
  docker='FROM '+m['backendRollbackTag']+'\n'
  for p in scope['backendSources']:docker+='COPY '+json.dumps([p,'/app/'+p])+'\n'
  for key,value in hosts_environment.items():docker+='ENV '+key+'='+json.dumps(value)+'\n'
  (folder/'Dockerfile').write_text(docker+'LABEL org.opencontainers.image.revision="'+I['commit']+'"\n')
  m['backendTag']='smartrayco-backend-wifitrial:'+I['commit'][:12];expected={p:hashlib.sha256(text.encode()).hexdigest()for p,text in I['back'].items()};backend_trees=[]
  for repro in [False,True]:
   tag=m['backendTag']+('-repro'if repro else'');iid=build(folder,tag,repro);cid=run(['docker','create','--network','none',tag])
   try:
    after=backend_tree(cid);validate_backend(m['oldBackend'],after,scope,expected);backend_trees.append(after)
    if not repro:m['backendImage']=iid;m['backendSources']=after
   finally:run(['docker','rm',cid])
  assert backend_trees[0]==backend_trees[1],'BACKEND_BUILD_NOT_REPRODUCIBLE'
  run(['docker','run','--rm','--network','none',m['backendTag'],'node','--import','tsx','-e',"import('./server/src/routes/genieacsSync.ts').then(()=>console.log('IMPORT_OK'))"])
 else:validate_backend(m['oldBackend'],backend_tree(current('backend')['Id']),scope,{})
 # Solo GET del guard existente, sin arrancar index/schedulers ni ejecutar tareas.
 envfile=stage/'backend-env-private';envfile.write_text('\n'.join(current('backend')['Config']['Env'])+'\n');network=next(iter(current('backend')['NetworkSettings']['Networks']))
 program="import {validateWifiTrialContract} from './server/src/services/tr069WifiTrial.ts';await validateWifiTrialContract();console.log('CONTRACT_GUARD_OK');"
 assert 'CONTRACT_GUARD_OK'in run(['docker','run','--rm','--network',network,'--env-file',str(envfile),m['backendTag'],'node','--import','tsx','--input-type=module','-e',program]),'CONTRACT_GUARD_FAILED'
 overrides,_=release_overrides(scope,{s:m[s+'Tag']for s in services},{s:m[s+'RollbackTag']for s in services})
 override=stage/'release.override.json';override.write_text(json.dumps(overrides));m['override']=str(override)
 afterconfig=json.loads(run(compose(m,[m['override']])+['config','--format','json']));expectedConfig=json.loads(json.dumps(config))
 for s in services:expectedConfig['services'][s]['image']=m[s+'Tag']
 assert afterconfig==expectedConfig,'OTHER_CONFIG_CHANGED'
 m['candidateArchives']={s:save_image_archive(m[s+'Tag'],stage/(s+'-candidate.image.tar'))for s in services};m['reproducible']=True
 m['releaseFileHashes']={p:hashfile(p)for p in [m['override'],m['rollback'],str(stage/'input.json')]};(stage/'built.json').write_text(json.dumps(m));unchanged(m);health()
 print(json.dumps({'built':True,'sourceCommit':I['commit'],'frontendCommit':m['frontendCommit'],'declaredServices':services,'frontendChangedAssets':m['frontendChangedAssets'],'reproducible':True,'contractGuardValidatedReadOnly':True,'artifactCount':m['artifactCount'],'frontendImage':m['frontendImage'],'backendImage':m['backendImage'],'servicesChanged':False}))
elif ACTION in ['deploy','verify','rollback']:
 m=load_state('prepared.json'if ACTION=='rollback'and not(stage/'built.json').exists()else'built.json')
 if ACTION=='verify':print(json.dumps(probe(m)));sys.exit(0)
 if ACTION=='rollback':
  assert hashfile(m['rollback'])==m['rollbackFileHash'],'ROLLBACK_FILE_DRIFT'
  for s,p in m['backupFiles'].items():assert hashfile(p)==m['backupHashes'][s],'BACKUP_DRIFT_'+s
  for s in services:assert run(['docker','image','inspect',m[s+'RollbackTag'],'--format','{{.Id}}'])==m['before'][s]['image'],'ROLLBACK_TAG_DRIFT_'+s
 if ACTION=='deploy':
  assert not(stage/'attempt.json').exists(),'DEPLOY_ALREADY_ATTEMPTED';unchanged(m)
  for p,h in {**m['configurationHashes'],**m['releaseFileHashes']}.items():assert hashfile(p)==h,'CONFIG_DRIFT:'+p
  for s,p in m['backupFiles'].items():assert hashfile(p)==m['backupHashes'][s],'BACKUP_DRIFT_'+s
  for s,h in m['candidateArchives'].items():assert hashfile(stage/(s+'-candidate.image.tar'))==h,'CANDIDATE_ARCHIVE_DRIFT_'+s
  for s in services:assert run(['docker','image','inspect',m[s+'Tag'],'--format','{{.Id}}'])==m[s+'Image'],'CANDIDATE_TAG_DRIFT_'+s
  (stage/'attempt.json').write_text(json.dumps({'at':now()}))
 try:
  with(stage/(ACTION+'-private.log')).open('w')as log:subprocess.run(compose(m,[m['override']if ACTION=='deploy'else m['rollback']])+['up','-d','--no-deps','--no-build','--pull','never']+services,cwd=repo,stdout=log,stderr=subprocess.STDOUT,check=True)
  if ACTION=='deploy':validation=probe(m)
  else:verify_rollback(m);validation={'rolledBack':True}
 except Exception:
  if ACTION=='deploy':
   with(stage/'auto-rollback-private.log').open('w')as log:subprocess.run(compose(m,[m['rollback']])+['up','-d','--no-deps','--no-build','--pull','never']+services,cwd=repo,stdout=log,stderr=subprocess.STDOUT,check=True)
   verify_rollback(m);(stage/'auto-rollback.json').write_text(json.dumps({'at':now(),'rolledBack':True}))
  raise
 result={'at':now(),'action':ACTION,'validation':validation,'services':states(),'stage':str(stage),'sourceCommit':I['commit'],'ssidTasksSent':0};(stage/(ACTION+'-result.json')).write_text(json.dumps(result));print(json.dumps(result))
