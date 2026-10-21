import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OntTelemetryEvidence, collectOltTelemetry, evaluateOntEvidence, type OntEvidence } from '../oltTelemetry';
import { detectSignalAlert } from '../oltAlerts';
import { beginOltReadOperation, createOltReadBudget } from '../oltReadOperation';
import { withOltLock } from '../oltTelnetLock';
import type { OltDeviceRow } from '../../lib/oltDevice';
import { createClient } from '@supabase/supabase-js';

const row={id:'old',olt_device_id:'olt',serial:'MSTC8CCE647E',frame:1,slot:2,port:8,ont_id:3};
const at=Date.now();
const evidence=(rx=-23.98):OntEvidence=>({oltDeviceId:'olt',serial:row.serial,position:'1/2/8:3',outcome:'valid',status:'online',checkedAt:new Date(at).toISOString(),stateReadAt:new Date(at).toISOString(),validUntil:new Date(at+60000).toISOString(),signalReadAt:new Date(at).toISOString(),observedSerial:row.serial,rxPower:rx,txPower:2,signalOutcome:'valid'});

test('reinicio: checkpoint conserva cruce verificado y no restaura estado/potencia como actuales ni duplica alerta',()=>{
  const path=join(mkdtempSync(join(tmpdir(),'olt-checkpoint-')),'signal.json');
  const before=new OntTelemetryEvidence(()=>at+1000,path);before.rememberSignal(row,evidence());before.flushSignalReferences();
  const after=new OntTelemetryEvidence(()=>at+2000,path);
  assert.equal(after.project(row).status,'unknown');assert.equal(after.project(row).rx_power,null);
  assert.equal(detectSignalAlert(after.signalReference(row),-30,-27),'lowSignal');
  after.rememberSignal(row,evidence(-30));after.flushSignalReferences();
  const second=new OntTelemetryEvidence(()=>at+3000,path);
  assert.equal(detectSignalAlert(second.signalReference(row),-30,-27),null);
  assert.equal(detectSignalAlert(second.signalReference(row),-23.98,-27),'signalRecovered');
  assert.equal(second.signalReference({...row,serial:'HWTCE5C94DB6'}),null);
});

test('reinicio: ausencia/conflicto invalida checkpoint; corrupción, versión y evidencia antigua no habilitan alertas',()=>{
  const path=join(mkdtempSync(join(tmpdir(),'olt-checkpoint-')),'signal.json');
  const cache=new OntTelemetryEvidence(()=>at+1000,path);cache.rememberSignal(row,evidence());cache.flushSignalReferences();
  cache.remember(row,{...evidence(),outcome:'conflict'});
  assert.equal(new OntTelemetryEvidence(()=>at+2000,path).signalReference(row),null);
  writeFileSync(path,JSON.stringify({version:1,payload:'[]',sha256:'bad'}));
  assert.equal(new OntTelemetryEvidence(()=>at+2000,path).signalReference(row),null);
  cache.rememberSignal(row,evidence());cache.flushSignalReferences();
  assert.equal(new OntTelemetryEvidence(()=>at+25*3600000,path).signalReference(row),null);
});

test('fallo de checkpoint no se oculta como persistencia correcta',()=>{
  const dir=mkdtempSync(join(tmpdir(),'olt-checkpoint-'));const parent=join(dir,'not-a-directory');writeFileSync(parent,'x');
  const cache=new OntTelemetryEvidence(()=>at,join(parent,'signal.json'));cache.rememberSignal(row,evidence());
  assert.throws(()=>cache.flushSignalReferences());
});

test('puerto de potencia ajeno o fila duplicada: nunca atribuir RX/TX por onu-id aislado',async()=>{
  for(const bad of ['gpon-onu_1/2/9:3 -10(dbm)','gpon-onu_1/2/8:3 -10(dbm)\ngpon-onu_1/2/8:3 -30(dbm)']) {
    const scan=await collectOltTelemetry(async commands=>{
      const c=commands.at(-1)!;
      if(c==='show running-config')return ['enable','interface gpon-olt_1/2/8\n onu 3 type GPT sn MSTC8CCE647E\n!\nend'];
      if(c==='show gpon onu state')return ['enable','OnuIndex AdminState OMCC RunState\n1/2/8:3 enable enable working\nONU Number: 1/1'];
      return ['enable',bad];
    },{includeSignal:true});
    const result=evaluateOntEvidence(row,scan);
    assert.equal(result.status,'online');assert.equal(result.rxPower,null);assert.equal(result.signalOutcome,'failed');
    assert.deepEqual(scan.failedPorts,['1/2/8']);
  }
});

test('operación lógica: importación, scheduler y señal comparten exclusión; se libera al terminar',()=>{
  const release=beginOltReadOperation('operation-test');assert(release);
  for(let n=0;n<100;n++)assert.equal(beginOltReadOperation('operation-test'),null);
  release();const next=beginOltReadOperation('operation-test');assert(next);next();
});

test('presupuesto incluye cola: la sesión vencida no se ejecuta después ni se solapa',async()=>{
  let release!:()=>void,executed=false;
  const first=withOltLock('deadline-test',()=>new Promise<void>(resolve=>{release=resolve;}));
  await Promise.resolve();
  const controller=new AbortController();
  const pending=withOltLock('deadline-test',async()=>{executed=true;},{signal:controller.signal});
  controller.abort();await assert.rejects(pending);release();await first;
  await withOltLock('deadline-test',async()=>{});assert.equal(executed,false);
});

test('presupuesto real breve: abandona espera sin abrir conexión al equipo',async()=>{
  let release!:()=>void;
  const first=withOltLock('budget-test',()=>new Promise<void>(resolve=>{release=resolve;}));
  await Promise.resolve();
  const device={id:'budget-test',host:'127.0.0.1',telnet_port:1} as OltDeviceRow;
  const budget=createOltReadBudget(device,10);
  const timer=setTimeout(()=>release(),50);
  await assert.rejects(budget.read(['show running-config'],1000));assert(budget.signal.aborted);
  clearTimeout(timer);release();await first;
});

test('error síncrono del lector libera el mutex y permite el siguiente turno',async()=>{
  await assert.rejects(withOltLock('throw-test',()=>{throw Error('reader failed');}));
  assert.equal(await withOltLock('throw-test',async()=>42),42);
});

test('REST lento comparte presupuesto: aborta petición de metadatos sin lanzar escrituras posteriores',async()=>{
  let requests=0;
  const client=createClient('http://127.0.0.1:1','local-test-only',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
    requests++;const request=new Request(input,init);assert.equal(new URL(request.url).origin,'http://127.0.0.1:1');
    return new Promise<Response>((_resolve,reject)=>{
      const fail=()=>reject(new DOMException('simulated REST timeout','AbortError'));
      if(request.signal.aborted)fail();else request.signal.addEventListener('abort',fail,{once:true});
    });
  }}});
  const device={id:'rest-budget-test'} as OltDeviceRow,budget=createOltReadBudget(device,10);
  const keepAlive=setTimeout(()=>{},100);
  const result=await client.from('olt_onts').update({description:'metadata'}).eq('id','fake').abortSignal(budget.signal);
  clearTimeout(keepAlive);assert(result.error);assert(budget.signal.aborted);assert.equal(requests,1);
});
