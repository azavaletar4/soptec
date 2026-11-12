// Solo lecturas: inspect/cp/cat de servicios activos. Sin staging ni cambios remotos.
// No consulta contadores, usuarios PPP, Supabase ni MikroTik.
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const destination=path.resolve('scripts/inventory-auth-lab/runtime/pppoe-publication');
const stateOnly=process.argv.includes('--state-only');
const program=String.raw`
import subprocess,json,hashlib,tarfile,io,base64,datetime,gzip
def output(args):return subprocess.check_output(args,stderr=subprocess.PIPE)
def tree(container,root):
 raw=output(['docker','cp',container+':'+root+'/.','-'])
 with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
  return {m.name.removeprefix('./'):archive.extractfile(m).read() for m in archive if m.isfile()}
sha=lambda raw:hashlib.sha256(raw).hexdigest()
out={'readOnly':True,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'services':{}}
for name in ['frontend','backend','caddy','mongo','genieacs']:
 cid='smartrayco-'+name+'-1';d=json.loads(output(['docker','inspect',cid]))[0]
 out['services'][name]={'id':d['Id'],'image':d['Image'],'tag':d['Config']['Image'],'running':d['State']['Running'],
  'started':d['State']['StartedAt'],'composeFiles':d['Config']['Labels'].get('com.docker.compose.project.config_files','').split(','),
  'environmentHash':sha(json.dumps(sorted(d['Config']['Env']),separators=(',',':')).encode()),'cmd':d['Config']['Cmd']}
if ${stateOnly?'True':'False'}:
 print(base64.b64encode(gzip.compress(json.dumps(out).encode())).decode());raise SystemExit(0)
front=tree('smartrayco-frontend-1','/usr/share/nginx/html')
out['frontendManifest']=json.loads(front['release-manifest.json'])
out['frontendFiles']={p:base64.b64encode(b).decode() for p,b in front.items()}
out['nginxFiles']={p:base64.b64encode(b).decode() for p,b in tree('smartrayco-frontend-1','/etc/nginx').items()}
out['backendFiles']={prefix+p:base64.b64encode(b).decode() for prefix,root in [('server/src/','/app/server/src'),('src/','/app/src')] for p,b in tree('smartrayco-backend-1',root).items()}
out['backendConfig']={}
for p in ['package.json','package-lock.json','tsconfig.server.json']:
 out['backendConfig'][p]=base64.b64encode(output(['docker','exec','smartrayco-backend-1','cat','/app/'+p])).decode()
out['backendRuntime']=json.loads(output(['docker','exec','smartrayco-backend-1','node','-e',
 'console.log(JSON.stringify({node:process.version,arch:process.arch,tsx:require("tsx/package.json").version}))']))
print(base64.b64encode(gzip.compress(json.dumps(out).encode())).decode())
`;
try {
 const raw=cp.execFileSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),
  'root@192.168.55.201','python3 -'],{input:program,encoding:'utf8',timeout:60000,maxBuffer:100*1024*1024,windowsHide:true,stdio:['pipe','pipe','pipe']});
 const result=JSON.parse(zlib.gunzipSync(Buffer.from(raw.trim(),'base64')).toString());if(result.readOnly!==true||!result.services.frontend.running||!result.services.backend.running)throw Error('SERVICES_NOT_RUNNING');
 fs.mkdirSync(destination,{recursive:true});
 fs.writeFileSync(path.join(destination,stateOnly?'live-state-only.json':'live-readonly.json'),JSON.stringify(result));
 console.log(JSON.stringify({readOnly:true,at:result.at,frontendCommit:result.frontendManifest?.commit,
  backendRuntime:result.backendRuntime,services:Object.fromEntries(Object.entries(result.services).map(([name,row])=>[name,{image:row.image,running:row.running}])),
  sourceAndAssetsSavedLocally:!stateOnly,remoteWrites:0}));
}catch(error){
 const safe=String(error.stderr||'').split('\n').filter(line=>/Permission denied|not accessible|Connection refused|timed out|KeyError:|CalledProcessError:|File "<stdin>"|No such container|SyntaxError:/.test(line)).map(line=>line.slice(0,280));
 console.error(JSON.stringify({status:'PPPOE_PUBLICATION_READONLY_STOPPED',type:error.name,code:error.status??error.code??null,reason:error.message==='SERVICES_NOT_RUNNING'?error.message:undefined,diagnostic:safe,remoteChanges:0}));process.exitCode=1;
}
