// Diagnóstico consolidado SOLO LECTURA. No construye, promueve ni modifica el contrato.
// No llama GenieACS. Las discrepancias se enumeran, nunca habilitan una release.
const fs = require('node:fs'), cp = require('node:child_process'), path = require('node:path');
const contract = fs.readFileSync('scripts/consolidation-release-contract.py', 'utf8');
const py = contract + String.raw`
import subprocess,tarfile,io,datetime
def run(args):return subprocess.check_output(args,stderr=subprocess.PIPE)
def current(s):return json.loads(run(['docker','inspect','smartrayco-'+s+'-1']))[0]
def files(cid):
 data=run(['docker','cp',cid+':/usr/share/nginx/html/.','-'])
 with tarfile.open(fileobj=io.BytesIO(data))as t:return {m.name.removeprefix('./'):t.extractfile(m).read()for m in t if m.isfile()}
out={'diagnosticOnly':True,'releaseAllowed':False,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'services':{}}
for s in ['frontend','backend','caddy','mongo','genieacs']:
 c=current(s);out['services'][s]={'id':c['Id'],'image':c['Image'],'tag':c['Config']['Image'],'started':c['State']['StartedAt'],'running':c['State']['Running']}
out['health']=json.loads(run(['curl','--fail','--silent','--max-time','7','--resolve','panel.rayconetworks.com:443:127.0.0.1','https://panel.rayconetworks.com/api/health']))
old=files(current('frontend')['Id'])
tag='smartrayco-frontend-consolidado:ac511d7c70c8'
cid=run(['docker','create','--network','none',tag]).decode().strip()
try:new=files(cid)
finally:run(['docker','rm',cid])
out['metadataChecks']={};normalized={}
for label,data in [('active',old),('candidate',new)]:
 manifest=json.loads(data[VITE_MANIFEST]);release=json.loads(data['release-manifest.json']);reached=reachable(data)
 result={'manifestEntries':len(manifest),'reachableAssets':len(reached),'duplicateLists':[],'missingReferences':[], 'compiledImportMismatches':[], 'invalidKeys':[], 'duplicatePhysicalFiles':[], 'artifactHashMismatches':[]}
 byfile={};covered=set();norm={}
 for key,e in manifest.items():
  p=e['file'];covered.add(p)
  if p in byfile:result['duplicatePhysicalFiles'].append(p)
  byfile[p]=key
  if p not in data:result['missingReferences'].append({'entry':key,'file':p})
  if (e.get('src')!=key)if 'src'in e else key!='_'+p.split('/')[-1]:result['invalidKeys'].append(key)
  for field in ['imports','dynamicImports','css','assets']:
   values=e.get(field,[])
   duplicates={v:values.count(v)for v in values if values.count(v)>1}
   if duplicates:result['duplicateLists'].append({'entry':key,'field':field,'duplicates':duplicates})
   for ref in values:
    if field in ['imports','dynamicImports']:
     if ref not in manifest:result['missingReferences'].append({'entry':key,'key':ref})
    else:
     covered.add(ref)
     if ref not in data:result['missingReferences'].append({'entry':key,'file':ref})
  if p.endswith('.js'):
   for field,pattern in [('imports',STATIC_IMPORT_RE),('dynamicImports',DYNAMIC_IMPORT_RE)]:
    actual={posixpath.normpath(posixpath.join(posixpath.dirname(p),m[1]))for m in pattern.findall(data[p].decode())}
    declared={manifest[k]['file']for k in e.get(field,[])if k in manifest and manifest[k]['file'].endswith('.js')}
    if actual!=declared:result['compiledImportMismatches'].append({'file':p,'field':field,'undeclared':sorted(actual-declared),'unobserved':sorted(declared-actual)})
  record={k:e[k]for k in ['src','name','isEntry','isDynamicEntry']if k in e}
  if 'src'in record and re.fullmatch(r'_[\w.\-]+-!~\{[A-Za-z0-9]+\}~\.js',record['src']):record['src']='@vite-css:'+stripname(p)
  for field in ['imports','dynamicImports']:record[field]=sorted(set(stripname(manifest[k]['file'])for k in e.get(field,[])if k in manifest))
  for field in ['css','assets']:record[field]=sorted(set(stripname(ref)for ref in e.get(field,[])))
  norm[stripname(p)]=record
 for p,digest in release['artifacts'].items():
  if p not in data or hashlib.sha256(data[p]).hexdigest()!=digest:result['artifactHashMismatches'].append(p)
 result['uncoveredGraphAssets']=sorted(reached-covered)
 result['unreachableChunks']=sorted(p for p in byfile if p.endswith(('.js','.css'))and p not in reached)
 result['unhashedGraphAssets']=sorted((reached|covered|{VITE_MANIFEST,'index.html'})-set(release['artifacts']))
 result['htmlEntryFiles']=sorted(p for p in re.findall(r'assets/[\w.\-]+\.(?:js|css)',data['index.html'].decode())if p.endswith('.js'))
 result['manifestEntryFiles']=sorted(e['file']for e in manifest.values()if e.get('isEntry'))
 result['manifestSHA256']=hashlib.sha256(data[VITE_MANIFEST]).hexdigest()
 try:validate_vite_manifest(data,set());result['actualValidator']='PASS'
 except AssertionError as e:result['actualValidator']=str(e)
 out['metadataChecks'][label]=result;normalized[label]=norm
out['normalizedMetadataDifferences']={p:{'active':normalized['active'].get(p),'candidate':normalized['candidate'].get(p)}for p in sorted(set(normalized['active'])|set(normalized['candidate']))if normalized['active'].get(p)!=normalized['candidate'].get(p)}
stage=pathlib.Path('/opt/smartrayco-staging/frontend-consolidado-tr069-ac511d7-6e89052be8')
out['stage']=str(stage)
out['phaseEvidence']={p:(stage/p).exists()for p in ['prepared.json','canonical-private.log','repro-private.log','backend-private.log','backend-repro-private.log','built.json','attempt.json','deploy-result.json','auto-rollback.json']}
out['tasksSent']=0
print(json.dumps(out))
`;
const r = cp.spawnSync('ssh', ['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'], {input:py,encoding:'utf8',timeout:60000,windowsHide:true,maxBuffer:2*1024*1024});
if(r.status!==0) {console.error('READONLY_DIAGNOSTIC_FAILED');process.exitCode=1;} else {
 const data=JSON.parse(r.stdout), file='docs/TR069-HOSTS-VITE-DIAGNOSTICO-CONSOLIDADO-20261028.json';
 fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');
 console.log(JSON.stringify({file,health:data.health,phases:data.phaseEvidence,metadata:Object.fromEntries(Object.entries(data.metadataChecks).map(([k,v])=>[k,{validator:v.actualValidator,duplicateLists:v.duplicateLists.length,missing:v.missingReferences.length,compiledImportMismatches:v.compiledImportMismatches.length,hashMismatches:v.artifactHashMismatches.length,uncovered:v.uncoveredGraphAssets,unreachable:v.unreachableChunks}])),metadataDifferences:Object.keys(data.normalizedMetadataDifferences)}));
}
