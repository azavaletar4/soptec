// Exporta por stdout las dos imagenes activas hacia respaldos LOCALES.
// En produccion solo docker inspect/save: sin archivos, tags, staging ni cambios.
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const runtime=path.resolve('scripts/inventory-auth-lab/runtime/pppoe-publication');
const live=JSON.parse(fs.readFileSync(path.join(runtime,'live-readonly.json'),'utf8'));
(async()=>{
 const result={at:new Date().toISOString(),remoteWrites:0,images:{}};
 for(const service of ['backend','frontend']){
  const expected=live.services[service];
  if(!/^sha256:[a-f0-9]{64}$/.test(expected.image))throw Error('INVALID_IMAGE_ID');
  const destination=path.join(runtime,service+'-before.image.tar.gz');
  const python=`import subprocess,sys,gzip,shutil,json\nd=json.loads(subprocess.check_output(['docker','inspect','smartrayco-${service}-1']))[0]\nassert d['Id']==${JSON.stringify(expected.id)} and d['Image']==${JSON.stringify(expected.image)},'SERVICE_DRIFT'\np=subprocess.Popen(['docker','save',${JSON.stringify(expected.image)}],stdout=subprocess.PIPE,stderr=subprocess.PIPE)\nwith gzip.GzipFile(fileobj=sys.stdout.buffer,mode='wb',mtime=0) as target:shutil.copyfileobj(p.stdout,target)\np.stdout.close();assert p.wait()==0,'IMAGE_EXPORT_FAILED'\n`;
  const fd=fs.openSync(destination,'wx');
  try {
   const child=cp.spawn('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'],{windowsHide:true,stdio:['pipe',fd,'pipe']});
   child.stdin.end(python);let error='';child.stderr.on('data',chunk=>{error+=chunk;});
   const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
   if(code!==0)throw Error('READONLY_IMAGE_EXPORT_FAILED_'+service);
  }finally{fs.closeSync(fd);}
  const sha256=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(destination))sha256.update(chunk);
  result.images[service]={image:expected.image,archive:destination,sha256:sha256.digest('hex'),bytes:fs.statSync(destination).size};
  console.log(JSON.stringify({service,readOnlyExport:'PASS',bytes:result.images[service].bytes,remoteWrites:0}));
 }
 fs.writeFileSync(path.join(runtime,'image-backups.json'),JSON.stringify(result,null,2)+'\n');
})().catch(error=>{console.error('PPPOE_IMAGE_BACKUP_STOPPED; no remote changes; '+error.code);process.exitCode=1;});
