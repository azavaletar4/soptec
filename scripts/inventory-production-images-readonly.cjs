// Only reads Docker metadata. Never print Config.Env, commands or credentials.
const cp = require('node:child_process'), fs = require('node:fs'), path = require('node:path');
const program = String.raw`import json,subprocess,urllib.parse,datetime
names=['smartrayco-frontend-1','smartrayco-backend-1','smartrayco-caddy-1','smartrayco-genieacs-1']
containers=json.loads(subprocess.check_output(['docker','inspect',*names]))
out=[]
for c in containers:
 env=dict(s.split('=',1) for s in c['Config'].get('Env',[]) if '=' in s)
 image=json.loads(subprocess.check_output(['docker','image','inspect',c['Image']]))[0]
 labels=c['Config'].get('Labels') or {}
 out.append(dict(name=c['Name'],image=c['Image'],tag=c['Config']['Image'],startedAt=c['State']['StartedAt'],running=c['State']['Running'],recoverableLocally=image['Id']==c['Image'],revision=labels.get('org.opencontainers.image.revision'),composeProject=labels.get('com.docker.compose.project'),composeFiles=labels.get('com.docker.compose.project.config_files'),supabaseCloudMatch=urllib.parse.urlparse(env.get('VITE_SUPABASE_URL','')).hostname=='mzupdnjegfwmpajywckd.supabase.co' if 'backend' in c['Name'] else None))
source_program=r"""const fs=require('fs'),path=require('path'),crypto=require('crypto');const out={};function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(f.endsWith('.ts'))out[f.replace('/app/','')]=crypto.createHash('sha256').update(fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n')).digest('hex');}}walk('/app/server/src');console.log(JSON.stringify(out));"""
source_hashes=json.loads(subprocess.check_output(['docker','exec','smartrayco-backend-1','node','-e',source_program]))
print(json.dumps(dict(checkedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),containers=out,backendSourceSha256=source_hashes,readOnly=True)))
`;
try {
 const result = cp.execFileSync('ssh', ['-o','BatchMode=yes','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'], { input: program, encoding: 'utf8', timeout: 20000, stdio:['pipe','pipe','pipe'] });
 const data = JSON.parse(result);
 fs.writeFileSync('docs/INVENTARIO-PRODUCCION-IMAGENES.json', JSON.stringify(data,null,2)+'\n');
 console.log(JSON.stringify({checkedAt:data.checkedAt,containers:data.containers,backendSourceFiles:Object.keys(data.backendSourceSha256).length}));
} catch { console.error('REMOTE_IMAGE_READ_FAILED; original output withheld'); process.exitCode=1; }
