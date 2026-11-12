// Transporte RouterOS REAL del paquete candidato contra un servidor ficticio
// dentro de Docker local --network none. No inicia index.ts ni schedulers.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const prepIndex=process.argv.indexOf('--preparation');
const prep=JSON.parse(fs.readFileSync(prepIndex<0?'deploy/pppoe-20261112/preparation.json':process.argv[prepIndex+1],'utf8'));
const program=String.raw`
import assert from 'node:assert/strict';import http from 'node:http';
import {mikrotikRequest} from './server/src/mikrotik/client.ts';
import {createDashboardPppoeReader,PPPOE_RESOURCE_PATH,PPPOE_SECRET_PATH,PPPOE_ACTIVE_PATH} from './server/src/services/dashboardPppoeProfiles.ts';
let requests=0,fail=false,clock=Date.parse('2026-11-12T18:00:00Z');
const allowed=new Set([PPPOE_RESOURCE_PATH,PPPOE_SECRET_PATH,PPPOE_ACTIVE_PATH]);
const server=http.createServer((req,res)=>{
 assert.equal(req.method,'GET');assert.ok(req.url.startsWith('/rest/'));
 const route=req.url.slice('/rest'.length);assert.ok(allowed.has(route));requests++;
 if(fail){res.writeHead(503,{'Content-Type':'application/json'});res.end('{}');return;}
 const result=route===PPPOE_RESOURCE_PATH?{'board-name':'CCR2116-12G-4S+'}:
 route===PPPOE_SECRET_PATH?[{'.id':'*1',name:'ficticio',service:'pppoe',profile:'Profile_Dedicado'}]:
 [{name:'ficticio',service:'pppoe',radius:'false'},{name:'ficticio',service:'pppoe',radius:'false'}];
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 let lookups=0;
 const get=createDashboardPppoeReader({now:()=>clock,findAdmins:async()=>{
 lookups++;return [{id:'fake',device_role:'pppoe_admin',is_active:true,host:'127.0.0.1',port:server.address().port,use_tls:false,username:'fake',password:'fake'}];},
 read:(target,path)=>mikrotikRequest(target,path,{method:'GET',timeoutMs:1000,retries:0})});
 const result=await Promise.all(Array.from({length:25},()=>get()));
 assert.equal(requests,3);assert.equal(lookups,1);assert.equal(result[0].profiles[0].connected,1);
 assert.equal(result[0].profiles[0].registered,1);assert.equal(result[0].status,'fresh');
 assert.ok(!JSON.stringify(result).includes('ficticio'));
 clock+=60000;fail=true;const stale=await get();assert.equal(stale.status,'stale');
 assert.equal(stale.lastSuccessAt,result[0].lastSuccessAt);assert.deepEqual(stale.profiles,result[0].profiles);
 assert.equal(requests,4);
 console.log('PASS: Node22/Linux; cliente RouterOS existente; GET unicamente; 25 solicitudes/1 lote; usuarios unicos; stale; cero almacenamiento');
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
`;
console.log(execFileSync('docker',['run','--rm','--network','none',prep.candidateImages.backend,
 'node','--import','tsx','--input-type=module','-e',program],{encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trim());
