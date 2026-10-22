import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { presentAlertHistoryOnt, type AlertHistoryOnt } from '../oltAlertHistoryOnt';
import { OntTelemetryEvidence, type OntEvidence } from '../oltTelemetry';
import { buildOltAlertLogEntryView } from '../../../../src/lib/oltAlertPresentation';

const now = Date.parse('2026-10-21T17:00:00Z');
const row: AlertHistoryOnt = { id:'old', olt_device_id:'olt', serial:'MSTC8CCE647E', description:'history', frame:1, slot:2, port:8, ont_id:3, status:'online', retired_at:null };
function cache() {
  const c = new OntTelemetryEvidence(()=>now);
  c.remember(row, { oltDeviceId:'olt', serial:row.serial, position:'1/2/8:3', outcome:'valid', status:'online', stateReadAt:new Date(now).toISOString(), checkedAt:new Date(now).toISOString(), validUntil:new Date(now+60000).toISOString(), signalReadAt:null, observedSerial:row.serial, rxPower:null, txPower:null, signalOutcome:'not-read' } as OntEvidence);
  return c;
}
function view(ont: ReturnType<typeof presentAlertHistoryOnt>) {
  return buildOltAlertLogEntryView({id:'alert',oltOntId:row.id,kind:'offline',at:'2026-10-19T10:00:00Z',detail:'original LOS',durationMinutes:12,client:{id:'c',name:'original'},contract:{id:'ctr',contractNumber:'N',clientCode:'C'},zoneName:'Z',ont});
}
test('active: confirmed live state is separate from original offline event',()=>{
  const v=view(presentAlertHistoryOnt(row,cache()));
  assert.match(v.currentStatusLabel,/Estado actual confirmado: online/);
  assert.equal(v.kind,'offline'); assert.equal(v.retired,false); assert.equal(v.ont?.currentStatusAt,new Date(now).toISOString());
});
test('retired: cached online never labels historical ONT connected; pre-retirement event unchanged',()=>{
  const retired={...row,retired_at:'2026-10-21T16:00:00Z'};
  const before=JSON.stringify(retired); const v=view(presentAlertHistoryOnt(retired,cache()));
  assert.equal(v.currentStatusLabel,'ONT retirada'); assert.equal(v.ont?.status,null);
  assert.equal(v.ont?.currentStatusAt,null); assert.equal(v.retired,true);
  assert.equal(v.at,'2026-10-19T10:00:00Z'); assert.equal(v.detail,'original LOS');
  assert.equal(v.durationMinutes,12); assert.equal(v.client?.id,'c'); assert.equal(v.contract?.id,'ctr');
  assert.equal(v.ont?.serial,row.serial); assert.equal(JSON.stringify(retired),before);
});
test('unconfirmed, expired, reused position, missing relation and legacy payload never imply live state',()=>{
  const expired=new OntTelemetryEvidence(()=>now+120000);
  expired.remember(row,{...cache().project(row).telemetry,oltDeviceId:'olt',serial:row.serial,position:'1/2/8:3',status:'online',validUntil:new Date(now+60000).toISOString()} as OntEvidence);
  for(const ont of [presentAlertHistoryOnt(row,new OntTelemetryEvidence(()=>now)),presentAlertHistoryOnt(row,expired),presentAlertHistoryOnt({...row,serial:'HWTCE5C94DB6'},cache()),null,{serial:row.serial,description:null,slot:2,port:8,ontId:3,status:'online'}]) {
    assert.equal(view(ont as ReturnType<typeof presentAlertHistoryOnt>).currentStatusLabel,'Estado actual no confirmado');
  }
});
test('active confirmed offline and recovered historical event remain independent',()=>{
  const c=cache(); const e=c.project(row);
  c.remember(row,{...e.telemetry,oltDeviceId:'olt',serial:row.serial,position:'1/2/8:3',status:'offline',rxPower:null,txPower:null} as OntEvidence);
  const v=buildOltAlertLogEntryView({...view(presentAlertHistoryOnt(row,c)),kind:'recovered'});
  assert.match(v.currentStatusLabel,/confirmado: offline/); assert.equal(v.kind,'recovered');
});
test('route and template wire lifecycle projection without filtering out historical alerts',()=>{
  const route=readFileSync(new URL('../../routes/olt.ts',import.meta.url),'utf8');
  const history=route.slice(route.indexOf("oltRoutes.get('/:id/alert-log'"),route.indexOf('/** Perfiles de ancho'));
  assert.match(history,/olt_onts\(id, olt_device_id, serial, description, frame, slot, port, ont_id, status, retired_at\)/);
  assert.match(history,/ont: presentAlertHistoryOnt\(row.olt_onts\)/);
  assert.doesNotMatch(history,/\.is\('retired_at'/);
  const template=readFileSync(new URL('../../../../src/views/olt/OltDetailView.vue',import.meta.url),'utf8');
  assert.match(template,/Evento registrado: \{\{ h.kindLabel/); assert.match(template,/h.currentStatusLabel/);
  assert.doesNotMatch(template,/estado actual: \{\{ h.ont.status/);
});
