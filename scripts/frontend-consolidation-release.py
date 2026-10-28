import subprocess,pathlib,json,hashlib,os,sys,tarfile,io,datetime,time,shutil,re
os.umask(0o077)
stage=pathlib.Path(STAGE);repo=pathlib.Path('/opt/smartrayco');I=json.loads((stage/'input.json').read_text())
def run(a,cwd=repo):return subprocess.check_output(a,cwd=cwd,text=True,stderr=subprocess.PIPE).strip()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def hashfile(p):
 h=hashlib.sha256()
 with pathlib.Path(p).open('rb')as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def current(s):return json.loads(run(['docker','inspect','smartrayco-'+s+'-1']))[0]
def states():return {s:{'id':current(s)['Id'],'image':current(s)['Image'],'started':current(s)['State']['StartedAt']} for s in ['frontend','backend','caddy','mongo','genieacs']}
def tree(cid,root,raw=False):
 data=subprocess.check_output(['docker','cp',cid+':'+root+'/.','-'])
 with tarfile.open(fileobj=io.BytesIO(data))as t:
  if raw:return {m.name.removeprefix('./'):t.extractfile(m).read() for m in t if m.isfile()}
  return {m.name.removeprefix('./'):hashlib.sha256(t.extractfile(m).read()).hexdigest() for m in t if m.isfile()}
# Vite nombra cada chunk con un hash de su contenido e incluye ese nombre en los
# chunks que lo importan (import "./x-HASH.js") y en el mapa de prefetch del
# entry comun (__vite__mapDeps). Si un solo chunk cambia, todos los que lo
# referencian cambian de nombre en cascada, sin que su logica cambie en
# absoluto. Ademas, el frontend en vivo acarrea archivos huerfanos de builds
# incrementales anteriores (nunca se limpia /usr/share/nginx/html entre fases;
# confirmado real: 657 de 779 archivos del contenedor activo no los referencia
# nada) y el Dockerfile de esta release copia el dist/ nuevo ENCIMA de esa
# imagen sin vaciarla, asi que ambos arboles cargan ese ruido historico.
# Comparar el arbol crudo completo (incluso ya sin el hash) mezcla huerfanos
# con la pieza real. Se compara solo el grafo REALMENTE ALCANZABLE desde
# index.html (igual que lo cargaria el navegador), por nombre sin el sufijo
# hash y con las referencias a otros archivos neutralizadas; lo unico que
# puede diferir de verdad ahi es el alcance declarado en FRONT_ALLOW.
NAME_HASH_RE=re.compile(r'^(.*?)-[\w-]{8,12}(\.(?:js|css))$')
REF_HASH_RE=re.compile(rb'([\w.\-]+?)-[\w-]{8,12}(\.(?:js|css))')
REF_HASH_TXT_RE=re.compile(r'[\w./\-]+?-[\w-]{8,12}\.(?:js|css)')
def stripname(p):
 m=NAME_HASH_RE.match(p);return (m.group(1)+m.group(2))if m else p
def normcontent(b):return REF_HASH_RE.sub(rb'\1\2',b)
def reachable(files):
 index=files['index.html'].decode('utf-8','replace')
 seeds=re.findall(r'assets/[\w.\-]+\.(?:js|css)',index);seen=set(seeds);queue=list(seeds)
 while queue:
  cur=queue.pop();content=files.get(cur)
  if content is None:continue
  text=content.decode('utf-8','replace')
  for ref in REF_HASH_TXT_RE.findall(text):
   cand='assets/'+ref.split('/')[-1]
   if cand in files and cand not in seen:seen.add(cand);queue.append(cand)
 return seen
def compose(m,extras=[]):
 a=['docker','compose','-p','smartrayco','--project-directory',str(repo)]
 for f in m['composeFiles']+extras:a+=['-f',f]
 return a
def unchanged(m,skip=[]):
 for s,b in m['before'].items():
  if s in skip:continue
  o=current(s);assert o['Id']==b['id'] and o['Image']==b['image'] and o['State']['StartedAt']==b['started'] and o['State']['Running'],'SERVICE_DRIFT_'+s
def health():
 for i in range(15):
  try:assert json.loads(http('/api/health'))['status']=='ok';return
  except Exception:time.sleep(2)
 raise Exception('API_UNHEALTHY')
def http(route):return subprocess.check_output(['curl','--fail','--silent','--max-time','5','--resolve','panel.rayconetworks.com:443:127.0.0.1','https://panel.rayconetworks.com'+route])
def build(folder,tag,rebuild=False):
 args=['docker','build','--pull=false','--network=none']+(['--no-cache']if rebuild else[])+['-t',tag,'.']
 with (stage/(folder.name+'-private.log')).open('w')as log:subprocess.run(args,cwd=folder,stdout=log,stderr=subprocess.STDOUT,check=True)
 return run(['docker','image','inspect',tag,'--format','{{.Id}}'])
def save_image_archive(tag,p):
 with p.open('wb')as f:subprocess.run(['docker','save',tag],stdout=f,check=True)
 return hashfile(p)
def safe_extract(src,target):
 with tarfile.open(src)as t:
  assert all((target/m.name).resolve().is_relative_to(target.resolve()) for m in t.getmembers())
  t.extractall(target,filter='data')
def write_sources(folder,files):
 for name,text in files.items():
  p=folder/name;assert p.resolve().is_relative_to(folder.resolve());p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text)
def probe(m):
 health();unchanged(m,['frontend','backend'])
 for s in ['frontend','backend']:assert current(s)['Image']==m[s+'Image']
 assert tree(current('frontend')['Id'],'/usr/share/nginx/html')==m['assets']
 manifest=json.loads(http('/release-manifest.json'));assert manifest['commit']==I['commit']
 checked=[]
 for route in ['/','/tr069','/asistencia','/campo','/campo/mi-custodia','/puntos','/soporte','/mikrotik','/analitica']:
  assert hashlib.sha256(http(route)).hexdigest()==m['assets']['index.html'],'HTML_ROUTE_MISMATCH_'+route;checked.append(route)
 for p,h in manifest['artifacts'].items():assert hashlib.sha256(http('/'+p)).hexdigest()==h,'HTTP_ARTIFACT_MISMATCH_'+p
 # Solo GET al backend, sin auth: debe rechazar antes de cualquier acceso/tarea.
 code=run(['curl','--silent','--output','/dev/null','--write-out','%{http_code}','--resolve','panel.rayconetworks.com:443:127.0.0.1','https://panel.rayconetworks.com/api/genieacs-sync/wifi/HWTC1D3691B7/trial/status']);assert code=='401'
 return {'routes':checked,'artifactsVerified':len(manifest['artifacts']),'sourceCommit':I['commit'],'unauthenticatedStatus':401,'ssidTasksSent':0}
if ACTION=='prepare':
 assert not (stage/'prepared.json').exists();before=states();b=current('backend');f=current('frontend')
 oldstage=pathlib.Path('/opt/smartrayco-staging/tr069-wifi-manual-20261027');old=json.loads((oldstage/'prepared.json').read_text())
 for s in ['backend','frontend']:assert before[s]['image']==old['before'][s]['image'],'BACKUP_BASE_DRIFT'
 m={'before':before,'at':now(),'composeFiles':b['Config']['Labels']['com.docker.compose.project.config_files'].split(','),'backupFiles':{},'backupHashes':{}}
 for s in ['backend','frontend']:
  file=oldstage/(s+'-before.image.tar');assert hashfile(file)==old['backupHashes'][s]
  m['backupFiles'][s]=str(file);m['backupHashes'][s]=hashfile(file);m[s+'RollbackTag']='smartrayco-consolidado-'+s+'-rollback:'+I['commit'][:7]
  run(['docker','tag',before[s]['image'],m[s+'RollbackTag']])
  # Cargar archivo respaldado y acreditar rootfs en un contenedor aislado, sin iniciar servicios.
  run(['docker','load','--input',str(file)])
  cid=run(['docker','create','--network','none',m[s+'RollbackTag']])
  try:
   location='/usr/share/nginx/html' if s=='frontend' else '/app/server/src';assert tree(cid,location)==tree(before[s]['id'],location),'ROLLBACK_RESTORE_MISMATCH_'+s
  finally:run(['docker','rm',cid])
 config=json.loads(run(compose(m)+['config','--format','json']));assert config['services']['backend']['image']==b['Config']['Image'] and config['services']['frontend']['image']==f['Config']['Image']
 (stage/'compose-private.json').write_text(json.dumps(config));m['configurationHashes']={p:hashfile(p) for p in m['composeFiles']+[str(repo/'.env')]}
 m['oldAssets']=tree(f['Id'],'/usr/share/nginx/html');m['oldBackend']=tree(b['Id'],'/app/server/src');m['oldNginx']=tree(f['Id'],'/etc/nginx')
 m['rollbackTested']=True;(stage/'prepared.json').write_text(json.dumps(m));unchanged(m);health()
 print(json.dumps({'prepared':True,'rollbackTested':True,'backupFiles':m['backupFiles'],'stage':str(stage),'sourceCommit':I['commit'],'servicesChanged':False}))
elif ACTION=='build':
 m=json.loads((stage/'prepared.json').read_text());unchanged(m);config=json.loads((stage/'compose-private.json').read_text());args=config['services']['frontend']['build']['args']
 # Preservar la configuración EFECTIVA compilada, no una fecha de Compose nunca publicada.
 oldtar=subprocess.check_output(['docker','cp',current('frontend')['Id']+':/usr/share/nginx/html/.','-'])
 with tarfile.open(fileobj=io.BytesIO(oldtar))as archive:oldfiles={x.name.removeprefix('./'):archive.extractfile(x).read()for x in archive if x.isfile()}
 oldtext='\n'.join(v.decode(errors='replace')for p,v in oldfiles.items()if p.endswith('.js'))
 if 'release-manifest.json'not in oldfiles:
  custody=oldfiles['assets/technicianCustody-D5nqO_RL.js'].decode()
  assert 'H={};'in custody and 'H.VITE_MATERIAL_CUSTODY_LIVE_SINCE'in custody and 'return!u||!u.trim()||Number.isNaN(Date.parse(u))?null:u.trim()'in custody,'EFFECTIVE_CUSTODY_CONFIGURATION_UNPROVEN'
  args=dict(args);args['VITE_MATERIAL_CUSTODY_LIVE_SINCE']=''
  m['configurationResolution']={'effectiveCustodyBoundary':None,'preservedInactiveBoundary':True,'evidenceModule':'assets/technicianCustody-D5nqO_RL.js','evidenceSha256':hashlib.sha256(custody.encode()).hexdigest()}
 else:
  args=dict(args);args['VITE_MATERIAL_CUSTODY_LIVE_SINCE']=''
  m['previousConfigurationHashes']=json.loads(oldfiles['release-manifest.json'])['configurationHashes']
 for key in ['VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY']:assert args[key]in oldtext,'ACTIVE_PUBLIC_CONFIG_MISMATCH_'+key
 m['frontendTag']='smartrayco-frontend-consolidado:'+I['commit'][:12];m['backendTag']='smartrayco-backend-wifitrial:'+I['commit'][:12]
 manifests=[]
 for name in ['canonical','repro']:
  folder=stage/name;folder.mkdir(exist_ok=True);source=folder/'source';source.mkdir(exist_ok=True);safe_extract(stage/'source.tar',source)
  docker='FROM '+m['backendRollbackTag']+' AS build\nWORKDIR /build/source\nCOPY source/ ./\nRUN ln -s /app/node_modules node_modules\n'
  for k,v in args.items():
   if k.startswith('VITE_'):docker+='ENV '+k+'='+json.dumps(v or '')+'\n'
  docker+='ENV SOURCE_COMMIT='+I['commit']+'\nRUN node scripts/frontend-release-build.mjs --snapshot release-source.json\nFROM '+m['frontendRollbackTag']+'\nCOPY --from=build /build/source/dist/ /usr/share/nginx/html/\nLABEL org.opencontainers.image.revision="'+I['commit']+'"\n'
  (folder/'Dockerfile').write_text(docker);tag=m['frontendTag'] if name=='canonical' else m['frontendTag']+'-repro';iid=build(folder,tag,name=='repro');cid=run(['docker','create','--network','none',tag])
  try:
   dest=stage/(name+'-release-manifest.json');run(['docker','cp',cid+':/usr/share/nginx/html/release-manifest.json',str(dest)]);manifest=json.loads(dest.read_text());assert manifest['commit']==I['commit'];manifests.append(manifest)
   if name=='canonical':
    m['frontendImage']=iid;m['assets']=tree(cid,'/usr/share/nginx/html');assert tree(cid,'/etc/nginx')==m['oldNginx']
    oldRaw=tree(current('frontend')['Id'],'/usr/share/nginx/html',raw=True);newRaw=tree(cid,'/usr/share/nginx/html',raw=True)
    oldReach=reachable(oldRaw);newReach=reachable(newRaw)
    oldNorm={stripname(p):hashlib.sha256(normcontent(oldRaw[p])).hexdigest() for p in oldReach}
    newNorm={stripname(p):hashlib.sha256(normcontent(newRaw[p])).hexdigest() for p in newReach}
    assert set(oldNorm)==set(newNorm),'HISTORICAL_ASSETS_STRUCTURE_CHANGED'
    changed={k for k in oldNorm if oldNorm[k]!=newNorm[k]}
    assert changed,'HISTORICAL_ASSETS_NO_EXPECTED_CHANGE'
    assert changed<=set(FRONT_ALLOW),'HISTORICAL_ASSETS_CHANGED:'+','.join(sorted(changed-set(FRONT_ALLOW)))
  finally:run(['docker','rm',cid])
 assert manifests[0]==manifests[1],'BUILD_NOT_REPRODUCIBLE'
 expectedConfig={key:hashlib.sha256((args[key]or'').encode()).hexdigest()for key in ['VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY','VITE_MATERIAL_CUSTODY_LIVE_SINCE']}
 assert manifests[0]['configurationHashes']==expectedConfig,'EFFECTIVE_CONFIGURATION_CHANGED'
 if 'previousConfigurationHashes'in m:assert expectedConfig==m['previousConfigurationHashes'],'PUBLIC_CONFIGURATION_CHANGED_WITHOUT_APPROVAL'
 m['reproducible']=True;m['artifactCount']=len(manifests[0]['artifacts'])
 backend=stage/'backend';backend.mkdir(exist_ok=True);write_sources(backend,I['back']);(backend/'Dockerfile').write_text('FROM '+m['backendRollbackTag']+'\nWORKDIR /app\nCOPY . /app/\nLABEL org.opencontainers.image.revision="'+I['commit']+'"\n');m['backendImage']=build(backend,m['backendTag'])
 cid=run(['docker','create','--network','none',m['backendTag']])
 try:
  after=tree(cid,'/app/server/src');allowed={p.removeprefix('server/src/')for p in I['back']if p.startswith('server/src/')};assert all(after.get(p)==h for p,h in m['oldBackend'].items()if p not in allowed),'UNRELATED_BACKEND_SOURCE_CHANGED'
 finally:run(['docker','rm',cid])
 run(['docker','run','--rm','--network','none',m['backendTag'],'node','--import','tsx','-e',"import('./server/src/routes/tr069WifiPreparation.ts').then(()=>console.log('IMPORT_OK'))"])
 # Validar el guard de contrato por GET, sin arrancar index/schedulers ni llamar cambio/verify/restore.
 envfile=stage/'backend-env-private';envfile.write_text('\n'.join(current('backend')['Config']['Env'])+'\n')
 network=next(iter(current('backend')['NetworkSettings']['Networks']))
 program="import {validateWifiTrialContract} from './server/src/services/tr069WifiTrial.ts';await validateWifiTrialContract();console.log('CONTRACT_GUARD_OK');"
 assert 'CONTRACT_GUARD_OK' in run(['docker','run','--rm','--network',network,'--env-file',str(envfile),m['backendTag'],'node','--import','tsx','--input-type=module','-e',program])
 override=stage/'release.override.json';override.write_text(json.dumps({'services':{'backend':{'image':m['backendTag'],'environment':{'TR069_WIFI_TRIAL_ENABLED':'HWTC1D3691B7:CTR-2026-00214'}},'frontend':{'image':m['frontendTag']}}}));m['override']=str(override)
 rollback=stage/'release.rollback.json';rollback.write_text(json.dumps({'services':{'backend':{'image':m['backendRollbackTag'],'environment':{'TR069_WIFI_TRIAL_ENABLED':''}},'frontend':{'image':m['frontendRollbackTag']}}}));m['rollback']=str(rollback)
 afterconfig=json.loads(run(compose(m,[m['override']])+['config','--format','json']));expected=json.loads(json.dumps(config));expected['services']['frontend']['image']=m['frontendTag'];expected['services']['backend']['image']=m['backendTag'];expected['services']['backend']['environment']['TR069_WIFI_TRIAL_ENABLED']='HWTC1D3691B7:CTR-2026-00214';assert afterconfig==expected,'OTHER_CONFIG_CHANGED'
 m['candidateArchives']={s:save_image_archive(m[s+'Tag'],stage/(s+'-candidate.image.tar'))for s in ['backend','frontend']};(stage/'built.json').write_text(json.dumps(m));unchanged(m);health()
 print(json.dumps({'built':True,'sourceCommit':I['commit'],'reproducible':True,'contractGuardValidatedReadOnly':True,'artifactCount':m['artifactCount'],'frontendImage':m['frontendImage'],'backendImage':m['backendImage'],'servicesChanged':False}))
elif ACTION in ['deploy','verify','rollback']:
 m=json.loads((stage/'built.json').read_text())
 if ACTION=='verify':print(json.dumps(probe(m)));sys.exit(0)
 if ACTION=='deploy':
  assert not (stage/'attempt.json').exists();unchanged(m)
  for p,h in m['configurationHashes'].items():assert hashfile(p)==h,'CONFIG_DRIFT'
  for s,p in m['backupFiles'].items():assert hashfile(p)==m['backupHashes'][s]
  for s,h in m['candidateArchives'].items():assert hashfile(stage/(s+'-candidate.image.tar'))==h
  (stage/'attempt.json').write_text(json.dumps({'at':now()}))
 try:
  with (stage/(ACTION+'-private.log')).open('w')as log:subprocess.run(compose(m,[m['override']if ACTION=='deploy'else m['rollback']])+['up','-d','--no-deps','--no-build','--pull','never','backend','frontend'],cwd=repo,stdout=log,stderr=subprocess.STDOUT,check=True)
  if ACTION=='deploy':validation=probe(m)
  else:
   health();unchanged(m,['backend','frontend']);assert all(current(s)['Image']==m['before'][s]['image']for s in ['backend','frontend']);validation={'rolledBack':True}
 except Exception:
  if ACTION=='deploy':
   with (stage/'auto-rollback-private.log').open('w')as log:subprocess.run(compose(m,[m['rollback']])+['up','-d','--no-deps','--no-build','--pull','never','backend','frontend'],cwd=repo,stdout=log,stderr=subprocess.STDOUT,check=True)
   health();(stage/'auto-rollback.json').write_text(json.dumps({'at':now(),'rolledBack':True}))
  raise
 result={'at':now(),'action':ACTION,'validation':validation,'services':states(),'stage':str(stage),'sourceCommit':I['commit'],'ssidTasksSent':0};(stage/(ACTION+'-result.json')).write_text(json.dumps(result));print(json.dumps(result))
