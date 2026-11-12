// Verificacion puntual del servicio desplegado. Solo stdout agregado; sin historial.
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const prep=JSON.parse(fs.readFileSync('deploy/pppoe-20261112/preparation-reproducible.json','utf8'));
const pkg=JSON.parse(fs.readFileSync(prep.package,'utf8'));
const deployed=JSON.parse(fs.readFileSync(path.join(path.dirname(prep.package),'deploy.json'),'utf8'));
const program=String.raw`
import assert from 'node:assert/strict';
import diagnostics from 'node:diagnostics_channel';
let dbReads=0,routerReads=0,mutations=0;
const originalFetch=globalThis.fetch;
const tables=new Set(['mikrotik_devices','olt_devices','tickets','inventory_units','invoices']);
globalThis.fetch=async(input,init={})=>{
 const method=init.method||(input instanceof Request?input.method:'GET');
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 assert.ok(['GET','HEAD'].includes(method),'WRITE_FORBIDDEN');
 assert.equal(url.origin,new URL(process.env.VITE_SUPABASE_URL).origin);
 assert.ok(url.pathname.startsWith('/rest/v1/')&&tables.has(url.pathname.split('/').at(-1)),'UNEXPECTED_DB_PATH');
 dbReads++;return originalFetch(input,init);
};
const channel=diagnostics.channel('undici:request:create');
const observer=({request})=>{
 if(!['GET','HEAD'].includes(request.method)){mutations++;throw Error('WRITE_FORBIDDEN');}
 if(String(request.origin)!==new URL(process.env.VITE_SUPABASE_URL).origin&&String(request.path).startsWith('/rest/'))routerReads++;
};
channel.subscribe(observer);
try{
 const {supabaseAdmin}=await import('./server/src/lib/supabaseAdmin.ts');
 const {mikrotikRequest}=await import('./server/src/mikrotik/client.ts');
 const {getDashboardPppoeProfiles,PPPOE_RESOURCE_PATH,PPPOE_SECRET_PATH,PPPOE_ACTIVE_PATH}=await import('./server/src/services/dashboardPppoeProfiles.ts');
 const {PPPOE_DASHBOARD_PROFILES}=await import('./src/lib/pppoeProfileCounts.ts');
 const {data:devices,error}=await supabaseAdmin.from('mikrotik_devices').select('id,name,host,port,use_tls,username,password').eq('is_active',true).eq('device_role','pppoe_admin').limit(2);
 assert.ok(!error&&devices?.length===1,'ADMIN_NOT_UNIQUE');
 const device=devices[0];
 const target={host:device.host,port:device.port,useTls:device.use_tls,username:device.username,password:device.password};
 const get=path=>mikrotikRequest(target,path,{method:'GET',timeoutMs:8000,retries:0});
 const resource=await get(PPPOE_RESOURCE_PATH),board=Array.isArray(resource)?resource[0]:resource;
 assert.match(board['board-name'],/^CCR2116(?:-|$)/);
 const [secrets,before,aaa]=await Promise.all([get(PPPOE_SECRET_PATH),get(PPPOE_ACTIVE_PATH),get('/ppp/aaa?.proplist=use-radius')]);
 const radius=(Array.isArray(aaa)?aaa[0]:aaa)['use-radius'];
 assert.ok(['false','no',false].includes(radius),'RADIUS_UNEXPECTED');
 const start={dbReads,routerReads};
 const requests=await Promise.all(Array.from({length:25},()=>getDashboardPppoeProfiles()));
 assert.equal(routerReads-start.routerReads,3,'CONCURRENT_ROUTER_BATCHES');
 assert.equal(dbReads-start.dbReads,1,'CONCURRENT_ADMIN_LOOKUPS');
 const result=requests[0];
 for(const row of requests)assert.deepEqual(row,result);
 assert.equal(result.status,'fresh','READ_NOT_FRESH');assert.equal(result.partial,false,'READ_PARTIAL');
 assert.deepEqual(result.profiles.map(row=>row.profile),PPPOE_DASHBOARD_PROFILES.map(row=>row.profile));
 assert.equal(result.profiles.length,4);assert.ok(!JSON.stringify(result).includes('Profile_Morosos'));
 const cacheCalls={dbReads,routerReads};assert.deepEqual(await getDashboardPppoeProfiles(),result);
 assert.deepEqual({dbReads,routerReads},cacheCalls,'CACHE_REQUERIES_ROUTER');
 const [after,...filtered]=await Promise.all([get(PPPOE_ACTIVE_PATH),...PPPOE_DASHBOARD_PROFILES.map(row=>get('/ppp/secret?.proplist=name,profile,service&profile='+encodeURIComponent(row.profile)))]);
 const localNames=new Set(secrets.map(row=>row.name));
 const pppoe=after.filter(row=>row.service==='pppoe');
 const radiusSessions=pppoe.filter(row=>['true','yes',true].includes(row.radius)).length;
 const unknownUsers=new Set(pppoe.filter(row=>!localNames.has(row.name)).map(row=>row.name)).size;
 const duplicateSessions=pppoe.length-new Set(pppoe.map(row=>row.name)).size;
 assert.equal(radiusSessions,0);assert.equal(unknownUsers,0);
 const compared=[];
 for(let i=0;i<result.profiles.length;i++){
  const actual=result.profiles[i],manual=filtered[i];
  assert.ok(manual.every(row=>row.profile===actual.profile));
  assert.equal(actual.registered,manual.length,'REGISTERED_MISMATCH');
  assert.equal(manual.length,secrets.filter(row=>row.profile===actual.profile).length,'SECRETS_CHANGED');
  const eligible=new Set(manual.filter(row=>['pppoe','any'].includes(row.service)).map(row=>row.name));
  const count=active=>new Set(active.filter(row=>row.service==='pppoe'&&!['true','yes',true].includes(row.radius)&&eligible.has(row.name)).map(row=>row.name)).size;
  const oldCount=count(before),newCount=count(after);
  if(oldCount!==newCount)throw Error('LIVE_SESSIONS_CHANGED_RETRY');
  assert.equal(actual.connected,newCount,'CONNECTED_MISMATCH');
  compared.push({profile:actual.profile,registered:actual.registered,connected:actual.connected,comparison:'PASS'});
 }
 const modules={};
 for(const [name,table]of [['olt','olt_devices'],['support','tickets'],['inventory','inventory_units'],['billing','invoices']]){
  const {error}=await supabaseAdmin.from(table).select('id').limit(1).abortSignal(AbortSignal.timeout(5000));
  assert.ok(!error,'MODULE_READ_FAILED_'+name);modules[name]='READ_OK';
 }
 assert.equal(mutations,0);
 console.log(JSON.stringify({status:'PASS',service:'deployed-backend-code',httpUserSessionTested:false,board:board['board-name'],profiles:compared,
  lastSuccessAt:result.lastSuccessAt,lastSuccessPeru:new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',dateStyle:'short',timeStyle:'medium'}).format(new Date(result.lastSuccessAt)),
  concurrentRequests:25,concurrentRouterReads:3,cacheHitWithoutReads:true,morososExcluded:true,radiusEnabled:false,radiusSessions,unknownUsers,duplicateSessions,
  criticalModuleDataReads:modules,supabaseMethods:['GET'],routerMethods:['GET'],mutations,persistentReadings:0}));
}finally{channel.unsubscribe(observer);}
`;
const python=`import subprocess,json,sys
c=json.loads(subprocess.check_output(['docker','inspect','smartrayco-backend-1']))[0]
assert c['Image']==${JSON.stringify(deployed.services.backend.image)} and c['State']['Running'],'DEPLOYED_IMAGE_MISMATCH'
r=subprocess.run(['docker','exec','-i','smartrayco-backend-1','node','--import','tsx','--input-type=module'],input=${JSON.stringify(program)},text=True,capture_output=True,timeout=60)
if r.returncode:
 reasons=['LIVE_SESSIONS_CHANGED_RETRY','ADMIN_NOT_UNIQUE','READ_NOT_FRESH','READ_PARTIAL','RADIUS_UNEXPECTED','REGISTERED_MISMATCH','SECRETS_CHANGED','CONNECTED_MISMATCH','CONCURRENT_ROUTER_BATCHES','CONCURRENT_ADMIN_LOOKUPS','CACHE_REQUERIES_ROUTER','MODULE_READ_FAILED_olt','MODULE_READ_FAILED_support','MODULE_READ_FAILED_inventory','MODULE_READ_FAILED_billing','WRITE_FORBIDDEN','UNEXPECTED_DB_PATH']
 print(json.dumps({'ok':False,'reason':next((x for x in reasons if x in r.stderr),'READONLY_POSTCHECK_FAILED'),'readonlyGuardEnabled':True}));sys.exit(1)
print(r.stdout.strip())
`;
const result=cp.spawnSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh/smartrayco-deploy'),'root@192.168.55.201','python3 -'],{input:python,encoding:'utf8',timeout:75000,windowsHide:true,maxBuffer:1024*1024});
process.stdout.write(result.stdout||'READONLY_POSTCHECK_FAILED\n');
if(result.status!==0)process.exitCode=1;
