// Lectura puntual autorizada. Sin archivos/historial; imprime solo agregados.
import 'dotenv/config';
import { supabaseAdmin } from '../../server/src/lib/supabaseAdmin.ts';
import { mikrotikRequest } from '../../server/src/mikrotik/client.ts';
import { aggregatePppoeProfiles, PPPOE_RESOURCE_PATH, PPPOE_SECRET_PATH, PPPOE_ACTIVE_PATH } from '../../server/src/services/dashboardPppoeProfiles.ts';
import { PPPOE_DASHBOARD_PROFILES } from '../../src/lib/pppoeProfileCounts.ts';
import assert from 'node:assert/strict';
try {
  const {data,error}=await supabaseAdmin.from('mikrotik_devices')
    .select('id,name,host,port,use_tls,username,password,device_role,is_active')
    .eq('is_active',true).eq('device_role','pppoe_admin').limit(2);
  if(error||data?.length!==1)throw Error('ADMIN_NOT_UNIQUE');
  const device=data[0];
  const target={host:device.host,port:device.port,useTls:device.use_tls,username:device.username,password:device.password};
  const get=path=>mikrotikRequest(target,path,{method:'GET',timeoutMs:8000,retries:0});
  const resource=await get(PPPOE_RESOURCE_PATH);
  const board=Array.isArray(resource)?resource[0]:resource;
  if(!/^CCR2116(?:-|$)/.test(board?.['board-name']??''))throw Error('NOT_CCR2116');
  const [secrets,active,aaa]=await Promise.all([get(PPPOE_SECRET_PATH),get(PPPOE_ACTIVE_PATH),get('/ppp/aaa?.proplist=use-radius')]);
  const aggregate=aggregatePppoeProfiles(secrets,active);
  const checks=[];
  for(const profile of PPPOE_DASHBOARD_PROFILES) {
    const filtered=await get('/ppp/secret?.proplist=name,profile,service&profile='+encodeURIComponent(profile.profile));
    assert.ok(Array.isArray(filtered));
    const eligible=new Set(filtered.filter(row=>['pppoe','any'].includes(row.service)).map(row=>row.name));
    const users=new Set(active.filter(row=>row.service==='pppoe'&&!['true','yes',true].includes(row.radius)&&eligible.has(row.name)).map(row=>row.name));
    const counted=aggregate.profiles.find(row=>row.profile===profile.profile);
    assert.equal(counted.registered,filtered.length);
    assert.equal(counted.connected,users.size);
    checks.push({profile:profile.profile,registered:filtered.length,connected:users.size,comparison:'PASS'});
  }
  const pppoe=active.filter(row=>row.service==='pppoe');
  const aaaRow=Array.isArray(aaa)?aaa[0]:aaa;
  const localNames=new Set(secrets.map(row=>row.name));
  console.log(JSON.stringify({readOnly:true,router:device.name,board:board['board-name'],
    profiles:checks,partial:aggregate.partial,radiusEnabled:aaaRow?.['use-radius'],
    radiusSessions:pppoe.filter(row=>['true','yes',true].includes(row.radius)).length,
    radiusFlagAvailable:pppoe.every(row=>['true','false','yes','no',true,false].includes(row.radius)),
    activeUsersWithoutSecret:new Set(pppoe.filter(row=>!localNames.has(row.name)).map(row=>row.name)).size,
    duplicatePppoeSessions:pppoe.length-new Set(pppoe.map(row=>row.name)).size,
    supabaseWrites:0,routerMethods:['GET'],persistentReadings:0}));
} catch {
  console.error('DASHBOARD_PPPOE_READONLY_FAILED; no writes; inspect connectivity/selection locally');
  process.exitCode=1;
}
