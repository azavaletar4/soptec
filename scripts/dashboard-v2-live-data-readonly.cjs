// Validación puntual de las consultas existentes del Dashboard. Solo GET/HEAD;
// no arranca schedulers, no escanea OLTs y no escribe datos ni lecturas históricas.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const baseline=JSON.parse(fs.readFileSync('deploy/dashboard-v2-20261112/production-baseline.json','utf8'));
const program=String.raw`
import assert from 'node:assert/strict';
process.env.TZ='America/Lima';
let reads=0,writes=0;
const originalFetch=globalThis.fetch;
const tables=new Set(['clients','service_contracts','tickets','invoices','olt_devices','olt_sync_cache','mikrotik_devices']);
globalThis.fetch=async(input,init={})=>{
 const method=init.method||(input instanceof Request?input.method:'GET');
 if(!['GET','HEAD'].includes(method)){writes++;throw Error('WRITE_FORBIDDEN');}
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 assert.equal(url.origin,new URL(process.env.VITE_SUPABASE_URL).origin,'UNEXPECTED_ORIGIN');
 assert.ok(url.pathname.startsWith('/rest/v1/')&&tables.has(url.pathname.split('/').at(-1)),'UNEXPECTED_TABLE');
 reads++;return originalFetch(input,init);
};
const {supabaseAdmin:db}=await import('./server/src/lib/supabaseAdmin.ts');
const {CLIENT_LIFECYCLE_SELECT,countClientLifecycles,readAllClientPages}=await import('./src/lib/clientLifecycle.ts');
const query=(table,columns,options)=>db.from(table).select(columns,options);
const checked=async q=>{const r=await q.abortSignal(AbortSignal.timeout(15000));assert.ok(!r.error,'DASHBOARD_QUERY_FAILED');return r;};
const first=new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString();
const day=new Date();day.setHours(0,0,0,0);
const six=new Date(new Date().getFullYear(),new Date().getMonth()-5,1).toISOString();
const [clients,contracts,recent,open,working,urgent,tickets,pending,billed,paid,today,seriesBilled,seriesPaid,olts,mikrotiks]=await Promise.all([
 readAllClientPages((from,to)=>checked(query('clients','id,status,'+CLIENT_LIFECYCLE_SELECT,{count:'exact'}).order('id').range(from,to))),
 checked(query('service_contracts','*',{head:true,count:'exact'}).eq('status','active')),
 checked(query('clients','id,first_name,last_name,status,created_at').order('created_at',{ascending:false}).limit(5)),
 checked(query('tickets','*',{head:true,count:'exact'}).eq('status','open')),
 checked(query('tickets','*',{head:true,count:'exact'}).eq('status','in_progress')),
 checked(query('tickets','*',{head:true,count:'exact'}).eq('priority','urgent').not('status','in','(resolved,closed)')),
 checked(query('tickets','id,ticket_number,title,status,created_at,clients(first_name,last_name)').not('status','in','(resolved,closed)').order('created_at',{ascending:false}).limit(5)),
 checked(query('invoices','amount,due_date').eq('status','pending')),
 checked(query('invoices','amount,status').neq('status','cancelled').gte('created_at',first)),
 checked(query('invoices','amount').eq('status','paid').gte('paid_at',first)),
 checked(query('invoices','amount').eq('status','paid').gte('paid_at',day.toISOString())),
 checked(query('invoices','amount,created_at').neq('status','cancelled').gte('created_at',six)),
 checked(query('invoices','amount,paid_at').eq('status','paid').gte('paid_at',six)),
 checked(query('olt_devices','id,last_test_ok').eq('is_active',true)),
 checked(query('mikrotik_devices','last_test_ok').eq('is_active',true)),
]);
const ids=(olts.data??[]).map(r=>r.id);
const cached=ids.length?(await checked(query('olt_sync_cache','unconfigured,online,offline,low_signal,scan_complete,checked_at').in('olt_device_id',ids))).data??[]:[];
const cache={online:0,offline:0,unconfigured:0,lowSignal:0,scanComplete:cached.length>0,checkedAt:null};
for(const row of cached){for(const [field,key]of [['online','online'],['offline','offline'],['unconfigured','unconfigured'],['lowSignal','low_signal']]){assert.ok(Number.isFinite(row[key]),'INVALID_ONT_COUNTER');cache[field]+=row[key];}cache.scanComplete&&=row.scan_complete;if(row.checked_at&&(!cache.checkedAt||row.checked_at<cache.checkedAt))cache.checkedAt=row.checked_at;}
const network=rows=>({total:rows.length,ok:rows.filter(r=>r.last_test_ok===true).length,down:rows.filter(r=>r.last_test_ok===false).length,untested:rows.filter(r=>r.last_test_ok===null).length});
for(const rows of [pending.data,billed.data,paid.data,today.data,seriesBilled.data,seriesPaid.data])assert.ok((rows??[]).every(r=>Number.isFinite(Number(r.amount))),'INVALID_BILLING_VALUE');
assert.equal(writes,0);
console.log(JSON.stringify({status:'PASS',at:new Date().toISOString(),verificationContext:'existing-service-account-readonly-not-user-http-session',clients:countClientLifecycles(clients),activeContracts:contracts.count,recentClientsReturned:recent.data?.length??0,tickets:{open:open.count,inProgress:working.count,urgent:urgent.count,recentReturned:tickets.data?.length??0},ont:{...cache,deviceCount:ids.length},equipment:{olt:network(olts.data??[]),mikrotik:network(mikrotiks.data??[])},billing:{queries:'PASS',numericValuesValid:true,amountsLogged:false},supabaseMethods:['GET','HEAD'],supabaseReads:reads,writes,mikrotikRequests:0,persistentReadings:0,personalDataLogged:false}));
`;
const python=String.raw`import subprocess,json,sys
d=json.loads(subprocess.check_output(['docker','inspect','smartrayco-backend-1']))[0]
assert d['Image']==${JSON.stringify(baseline.services.backend.image)} and d['Id']==${JSON.stringify(baseline.services.backend.id)},'BACKEND_DRIFT'
r=subprocess.run(['docker','exec','-i','-e','TSX_DISABLE_CACHE=1','smartrayco-backend-1','node','--import','tsx','--input-type=module'],input=${JSON.stringify(program)},text=True,capture_output=True,timeout=55)
if r.returncode:
 reasons=['WRITE_FORBIDDEN','UNEXPECTED_ORIGIN','UNEXPECTED_TABLE','DASHBOARD_QUERY_FAILED','INVALID_ONT_COUNTER','INVALID_BILLING_VALUE']
 print(json.dumps({'status':'STOPPED','reason':next((s for s in reasons if s in r.stderr),'READONLY_DATA_CHECK_FAILED')}));sys.exit(1)
print(r.stdout.strip())
`;
const result=cp.spawnSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'],{input:python,encoding:'utf8',timeout:65000,windowsHide:true,maxBuffer:1024*1024});
process.stdout.write(result.stdout||'READONLY_DATA_CHECK_FAILED\n');if(result.status!==0)process.exitCode=1;
