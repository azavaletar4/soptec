// Solo diagnóstico de imágenes/assets y salud; nunca tareas GenieACS ni comandos de red.
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const action=process.argv[2];if(!['health','inspect','graph'].includes(action))throw Error('INVALID_ACTION');
const contract=fs.readFileSync('scripts/consolidation-release-contract.py','utf8');
const common=String.raw`
import subprocess,json,datetime,tarfile,io,hashlib
def run(a):return subprocess.check_output(a,text=True,stderr=subprocess.PIPE).strip()
def current(s):return json.loads(run(['docker','inspect','smartrayco-'+s+'-1']))[0]
def http(route):return run(['curl','--fail','--silent','--max-time','7','--resolve','panel.rayconetworks.com:443:127.0.0.1','https://panel.rayconetworks.com'+route])
out={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'services':{}}
for s in ['frontend','backend','caddy','mongo','genieacs']:
 d=current(s);out['services'][s]={'id':d['Id'],'image':d['Image'],'tag':d['Config']['Image'],'started':d['State']['StartedAt'],'running':d['State']['Running']}
out['health']=json.loads(http('/api/health'));assert out['health']['status']=='ok','API_UNHEALTHY'
out['frontendCommit']=json.loads(http('/release-manifest.json'))['commit']
`;
const inspect=String.raw`
def files(cid):
 data=subprocess.check_output(['docker','cp',cid+':/usr/share/nginx/html/.','-'])
 with tarfile.open(fileobj=io.BytesIO(data))as t:return {m.name.removeprefix('./'):t.extractfile(m).read()for m in t if m.isfile()}
old=files(current('frontend')['Id'])
tag='smartrayco-frontend-consolidado:ac511d7c70c8'
cid=run(['docker','create','--network','none',tag])
try:new=files(cid)
finally:run(['docker','rm',cid])
out['candidateTag']=tag
out['graphs']={}
for name,data in [('active',old),('candidate',new)]:
 reach=reachable(data);groups={}
 for p in reach:groups.setdefault(stripname(p),[]).append(p)
 collisions={k:sorted(v)for k,v in groups.items()if len(v)>1}
 details={}
 for k,paths in collisions.items():
  details[k]=[{'path':p,'sha256':hashlib.sha256(data[p]).hexdigest(),'normalizedContentSha256':hashlib.sha256(normcontent(data[p])).hexdigest(),
   'referencedBy':sorted(q for q in reach|{'index.html'}if p.split('/')[-1].encode()in data[q])}for p in paths]
 out['graphs'][name]={'reachableCount':len(reach),'collisions':details,'manifestArtifacts':[p for p in json.loads(data['release-manifest.json'])['artifacts']if stripname(p)in collisions]}
out['manifestFileOverlap']=sorted(set(json.loads(old['release-manifest.json'])['artifacts'])&set(json.loads(new['release-manifest.json'])['artifacts']))
if ACTION=='graph':
 import difflib
 out['graphDetails']={}
 for label,data in [('active',old),('candidate',new)]:
  reach=reachable(data)
  out['graphDetails'][label]={'edges':{p:sorted(set('assets/'+r.split('/')[-1] for r in REF_HASH_TXT_RE.findall(data[p].decode()) if 'assets/'+r.split('/')[-1] in reach)) for p in sorted(reach)},'sources':json.loads(data['release-manifest.json'])['sourceFiles']}
 out['chunkDiffs']={}
 oldlogical={stripname(p):p for p in reachable(old)}
 for p in sorted(reachable(new)):
  q=oldlogical.get(stripname(p));a=normcontent(old[q]).decode()if q else '';b=normcontent(new[p]).decode()
  if a!=b:
   out['chunkDiffs'][stripname(p)]={'before':a,'after':b}
`;
const py='ACTION='+JSON.stringify(action)+'\n'+contract+'\n'+common+'\n'+(action!=='health'?inspect:'')+'\nprint(json.dumps(out))\n';
const r=cp.spawnSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'],{input:py,encoding:'utf8',timeout:55000,windowsHide:true,maxBuffer:2*1024*1024});
try{
 if(r.status!==0)throw Error('SSH_OR_CHECK_FAILED_'+(r.error?.code||r.status));
 const data={action,...JSON.parse(r.stdout)};
 const file=action==='graph'?'scripts/inventory-auth-lab/runtime/hosts-chunk-capture.json':'docs/TR069-HOSTS-ASSET-COLLISION-20261028.json';const history=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];
 history.push(data);fs.writeFileSync(file,JSON.stringify(history,null,2)+'\n');console.log(JSON.stringify(action==='graph'?{file,changedChunks:Object.keys(data.chunkDiffs),health:data.health}:data));
}catch(e){console.error(e.message);process.exitCode=1;}
