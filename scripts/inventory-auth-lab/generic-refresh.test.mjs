import test from 'node:test';
import assert from 'node:assert/strict';
import {createGenericRefresh} from './generic-refresh.mjs';
const settle=()=>new Promise(r=>setImmediate(r));
function harness(load){let data=null,status;const c=createGenericRefresh({load,clear:()=>{data=null;},publish:v=>{data=v;},state:s=>{status=s;}});return {c,get data(){return data;},get status(){return status;}};}
test('401 y 403 borran resultados y detienen ticks hasta comprobación explícita',async()=>{
 for(const code of [401,403]){
  let allowed=true,calls=0;const h=harness(async()=>{calls++;if(!allowed)throw {status:code};return ['protegido'];});
  h.c.setContext({jobId:'A'},'token');await settle();assert.deepEqual(h.data,['protegido']);
  allowed=false;await h.c.tick();assert.equal(h.data,null);assert.equal(h.status,'blocked');
  const n=calls;for(let i=0;i<20;i++)await h.c.tick();assert.equal(calls,n);
  allowed=true;await h.c.tick();assert.equal(calls,n);h.c.retry();await settle();assert.deepEqual(h.data,['protegido']);h.c.dispose();
 }
});
test('respuesta antigua no restaura caché tras cambio de usuario u orden',async()=>{
 let finish;const h=harness(ctx=>ctx.actorId==='viejo'?new Promise(r=>{finish=r;}):Promise.resolve(['nuevo']));
 h.c.setContext({actorId:'viejo',jobId:'A'},'v');h.c.setContext({actorId:'nuevo',jobId:'B'},'n');assert.equal(h.data,null);
 await settle();assert.deepEqual(h.data,['nuevo']);finish(['datos antiguos']);await settle();assert.deepEqual(h.data,['nuevo']);h.c.dispose();
});
test('401 antiguo no bloquea la sesión nueva',async()=>{
 let reject;const h=harness(ctx=>ctx.actorId==='viejo'?new Promise((_r,j)=>{reject=j;}):Promise.resolve(['nuevo']));
 h.c.setContext({actorId:'viejo'},'v');h.c.setContext({actorId:'nuevo'},'n');await settle();reject({status:401});await settle();
 assert.deepEqual(h.data,['nuevo']);assert.equal(h.c.stats().blocked,false);h.c.dispose();
});
test('ráfaga de ticks no duplica la lectura en curso',async()=>{
 let finish,calls=0;const h=harness(()=>{calls++;return new Promise(r=>{finish=r;});});h.c.setContext({jobId:'A'},'t');
 await Promise.all(Array.from({length:100},()=>h.c.tick()));assert.equal(calls,1);finish(['actual']);await settle();assert.deepEqual(h.data,['actual']);h.c.dispose();
});
test('desconexión y ocultar orden abortan y limpian sin consultas en segundo plano',async()=>{
 let calls=0;const h=harness(async()=>{calls++;return ['actual'];});h.c.setContext({jobId:'A'},'t');await settle();
 h.c.setOnline(false);assert.equal(h.data,null);await h.c.tick();assert.equal(calls,1);
 h.c.setOnline(true);await h.c.tick();assert.equal(calls,2);h.c.setVisible(false);assert.equal(h.data,null);
 await h.c.tick();assert.equal(calls,2);h.c.setVisible(true);await settle();assert.equal(calls,3);h.c.dispose();
});
test('logout elimina resultados e invalida respuestas pendientes',async()=>{
 let finish;const h=harness(()=>new Promise(r=>{finish=r;}));h.c.setContext({jobId:'A'},'t');h.c.setContext(null);finish(['protegido']);await settle();
 assert.equal(h.data,null);assert.equal(h.status,'signed-out');await h.c.tick();assert.equal(h.c.stats().requests,1);h.c.dispose();
});
