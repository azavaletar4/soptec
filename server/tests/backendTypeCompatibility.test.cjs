const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process'),ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const paths={mikrotik:'server/src/mikrotik/client.ts',proxmox:'server/src/proxmox/client.ts',genieacs:'server/src/routes/genieacs.ts',scheduler:'server/src/services/tr069Scheduler.ts',provisioning:'server/src/services/oltProvisioningService.ts'};
const source=(name,before)=>before?cp.execFileSync('git',['show','b201183:'+paths[name]],{cwd:root,encoding:'utf8',windowsHide:true}):fs.readFileSync(root+'/'+paths[name],'utf8');
const transpile=text=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
function load(name,before,imports,globals={}){
 const exports={};
 const context={exports,module:{exports},Buffer,URL,URLSearchParams,Headers,Response,process:{env:{}},console:{log(){},error(){}},
  fetch(){throw Error('Red externa prohibida');},
  require(id){if(!Object.hasOwn(imports,id))throw Error('Importacion externa prohibida: '+id);return imports[id];},...globals};
 vm.runInNewContext(transpile(source(name,before)),context,{filename:paths[name]});return exports;
}
const outcome=async fn=>{try{return {value:await fn()};}catch(e){return {error:{name:e.name,message:e.message}};}};
const normalize=value=>JSON.parse(JSON.stringify(value));
async function clientRun(name,before,scenario){
 const calls=[],sleeps=[],timeouts=[];let index=0;
 const responses=scenario.responses||[{status:200,body:name==='proxmox'?'{"data":{"value":7}}':'{"value":7}'}];
 class Agent{constructor(options){this.options=options;}}
 const request=async(url,opts)=>{
  calls.push({url,method:opts.method,headers:opts.headers,body:opts.body,dispatcher:opts.dispatcher?.options??null,signal:opts.signal});
  const r=responses[Math.min(index++,responses.length-1)];
  if(r.error){const error=new Error(r.error);if(r.cause)error.cause=Object.assign(new Error(r.cause),{code:'ECONNREFUSED'});throw error;}
  return {ok:r.status>=200&&r.status<300,status:r.status,text:async()=>r.body};
 };
 const env=scenario.missingConfig?{}:{PROXMOX_HOST:'proxmox.invalid',PROXMOX_TOKEN_ID:'fixture@realm!token',PROXMOX_TOKEN_SECRET:'synthetic'};
 const mod=load(name,before,{undici:{Agent,fetch:request}},{process:{env},AbortSignal:{timeout(ms){timeouts.push(ms);return {timeout:ms};}},setTimeout(fn,ms){sleeps.push(ms);fn();}});
 const result=await outcome(()=>name==='mikrotik'?mod.mikrotikRequest({host:'router.invalid',port:443,useTls:scenario.tls??true,username:'fixture',password:'synthetic'},'/fixture',scenario.opts||{}):mod.proxmoxRequest('/fixture',scenario.opts||{}));
 return normalize({result,calls,sleeps,timeouts});
}
async function proxyRun(before,scenario){
 const calls=[],middleware=[];let handler;
 class Hono{use(...args){middleware.push(args.map(x=>typeof x));}all(_path,fn){handler=fn;}}
 const requireAuth=()=>{};const roles=[];const requireRole=(...r)=>{roles.push(r);return ()=>{};};
 load('genieacs',before,{hono:{Hono},'../middleware/auth':{requireAuth,requireRole}},
  {process:{env:{GENIEACS_NBI:'http://nbi.invalid:7557'}},AbortSignal:{timeout:ms=>({timeout:ms})},
   fetch:async(url,opts)=>{calls.push({url,method:opts.method,headers:opts.headers,body:opts.body?[...opts.body]:null,timeout:opts.signal.timeout});if(scenario.reject)throw Error('synthetic upstream failure');return {status:202,text:async()=>'{"fixture":true}',headers:new Headers({'content-type':'application/json'})};}});
 const bytes=scenario.bytes??[0,255,1,128];
 const request={method:scenario.method||'GET',url:'http://panel.invalid/api/genieacs/devices?limit=2',raw:{headers:new Headers({authorization:'Bearer synthetic',host:'panel.invalid','x-fixture':'keep',...(scenario.contentType?{'content-type':scenario.contentType}:{})})},arrayBuffer:async()=>Uint8Array.from(bytes).buffer};
 const response=await handler({req:request,get:()=>scenario.role===null?null:{role:scenario.role||'ADMIN'},json:(body,status)=>({body,status})});
 const result=response instanceof Response?{status:response.status,body:await response.text(),contentType:response.headers.get('content-type')}:response;
 return normalize({calls,roles,middleware,result});
}
async function schedulerRun(before,scenario){
 const logs=[],errors=[],timeouts=[],intervals=[],calls={sync:0,metrics:0};let resolveSync,resolveMetrics;
 const tick=()=>new Promise(resolve=>setImmediate(resolve));
 const sync=()=>{calls.sync++;if(scenario.reject)return Promise.reject(Error('synthetic sync failure'));if(scenario.overlap)return new Promise(resolve=>{resolveSync=resolve;});return Promise.resolve(scenario.failure?{ok:false,error:'synthetic sync error'}:{ok:true,created:2,synced:3,total:5});};
 const metrics=()=>{calls.metrics++;if(scenario.reject)return Promise.reject(Error('synthetic metrics failure'));if(scenario.overlap)return new Promise(resolve=>{resolveMetrics=resolve;});return Promise.resolve(scenario.failure?{ok:false,error:'synthetic metrics error'}:{ok:true,collected:4,total:5,failed:1});};
 const mod=load('scheduler',before,{'../routes/tr069sync':{syncTr069Devices:sync},'../routes/genieacsSync':{collectAllTr069Metrics:metrics}},
  {process:{env:scenario.env||{}},console:{log:(...args)=>logs.push(args),error:(...args)=>errors.push(args.map(x=>x instanceof Error?x.message:x))},
   setTimeout:(fn,ms)=>timeouts.push({fn,ms}),setInterval:(fn,ms)=>intervals.push({fn,ms})});
 mod.startTr069Scheduler();
 if(timeouts.length){
  timeouts[0].fn();
  if(scenario.overlap){intervals[0].fn();intervals[1].fn();assert.deepEqual(calls,{sync:1,metrics:1});resolveSync({ok:false,error:'synthetic sync error'});resolveMetrics({ok:true,collected:4,total:5,failed:1});await tick();intervals[0].fn();intervals[1].fn();assert.deepEqual(calls,{sync:2,metrics:2});resolveSync({ok:true,created:2,synced:3,total:5});resolveMetrics({ok:false,error:'synthetic metrics error'});}
  await tick();
  if(scenario.repeat){intervals[0].fn();intervals[1].fn();await tick();}
 }
 return normalize({calls,logs,errors,timeouts:timeouts.map(x=>x.ms),intervals:intervals.map(x=>x.ms)});
}
test('Cuatro correcciones exclusivamente de tipos conservan el JavaScript emitido',()=>{
 for(const name of ['mikrotik','proxmox','genieacs','provisioning'])assert.equal(transpile(source(name,false)),transpile(source(name,true)),name);
});
for(const name of ['mikrotik','proxmox'])test(name+': solicitudes y respuestas identicas a la base, sin red',async t=>{
 const scenarios=[
  ['GET correcto',{}],['metodo, cuerpo y timeout',{opts:{method:'POST',body:{fixture:'a b',count:2},timeoutMs:1234}}],
  ['HTTP 400',{responses:[{status:400,body:'{"message":"synthetic client error"}'}]}],
  ['HTTP 503',{responses:[{status:503,body:'{"errors":{"fixture":"unavailable"}}'}]}],
  ['fallo de conexion con causa',{responses:[{error:'fetch failed',cause:'synthetic refused'}]}],
  ['JSON invalido',{responses:[{status:200,body:'not json'}]}],
 ];
 if(name==='mikrotik')scenarios.push(['sin TLS',{tls:false}],['reintento transitorio',{responses:[{status:503,body:'{}'},{status:200,body:'{"recovered":true}'}]}],['sin reintentos',{opts:{retries:0},responses:[{status:503,body:'{}'}]}]);
 else scenarios.push(['configuracion ausente',{missingConfig:true}]);
 for(const [label,scenario] of scenarios)await t.test(label,async()=>{
  const before=await clientRun(name,true,scenario),after=await clientRun(name,false,scenario);assert.deepEqual(after,before);
  if(label==='GET correcto'){assert.equal(after.result.value.value,7);assert.equal(after.calls.length,1);assert.equal(after.calls[0].method,'GET');}
  if(label==='HTTP 400')assert.equal(after.calls.length,1);
  if(label==='metodo, cuerpo y timeout'){assert.equal(after.calls[0].method,'POST');assert.equal(after.timeouts[0],1234);assert.equal(after.calls[0].body,name==='mikrotik'?'{"fixture":"a b","count":2}':'fixture=a+b&count=2');}
  if(label==='reintento transitorio'){assert.equal(after.calls.length,2);assert.deepEqual(after.sleeps,[500]);}
 });
});
test('GenieACS: bytes, permisos, cabeceras y errores del proxy intactos, sin red',async t=>{
 for(const scenario of [{method:'GET'},{method:'HEAD'},{method:'POST'},{method:'PUT',contentType:'application/octet-stream'},{method:'POST',bytes:[]},{method:'DELETE'},{method:'POST',role:'SOPORTE'},{method:'POST',role:null},{reject:true}])await t.test(JSON.stringify(scenario),async()=>{
  const before=await proxyRun(true,scenario),after=await proxyRun(false,scenario);assert.deepEqual(after,before);
  if(scenario.role==='SOPORTE'||scenario.role===null){assert.equal(after.calls.length,0);assert.equal(after.result.status,403);}
  if(after.calls.length){assert.equal(after.calls[0].headers.authorization,undefined);assert.equal(after.calls[0].headers.host,undefined);assert.equal(after.calls[0].headers['x-fixture'],'keep');assert.equal(after.calls[0].timeout,60000);}
  if(scenario.method==='POST'&&!Object.hasOwn(scenario,'role')&&!scenario.bytes)assert.deepEqual(after.calls[0].body,[0,255,1,128]);
 });
});
test('TR069: ramas booleanas, temporizadores y exclusion de solapamientos intactos',async t=>{
 for(const [label,scenario] of [['desactivado',{env:{TR069_SCHEDULER_ENABLED:'false'}}],['exito',{}],['error de servicio',{failure:true,repeat:true}],['excepcion',{reject:true,repeat:true}],['solapamiento y liberacion',{overlap:true}],['intervalos configurados',{env:{TR069_SYNC_INTERVAL_MINUTES:'2',TR069_METRICS_INTERVAL_MINUTES:'3'}}]])await t.test(label,async()=>{
  const before=await schedulerRun(true,scenario),after=await schedulerRun(false,scenario);assert.deepEqual(after,before);
  if(label==='desactivado'){assert.equal(after.timeouts.length,0);assert.deepEqual(after.calls,{sync:0,metrics:0});}
  if(label==='exito'){assert.deepEqual(after.timeouts,[30000]);assert.deepEqual(after.intervals,[900000,600000]);assert.deepEqual(after.calls,{sync:1,metrics:1});assert.equal(after.errors.length,0);}
  if(label==='error de servicio'||label==='excepcion'){assert.deepEqual(after.calls,{sync:2,metrics:2});assert.equal(after.errors.length,4);}
  if(label==='intervalos configurados')assert.deepEqual(after.intervals,[120000,180000]);
 });
});
