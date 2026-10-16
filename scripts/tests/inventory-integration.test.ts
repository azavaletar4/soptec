import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as wait} from 'node:timers/promises';
import {createInventoryRefresh} from '../../src/lib/inventoryRefresh';
import {createInventorySignalHub,inventorySignalRoutes} from '../../server/src/routes/inventorySignals';
import {startInventorySignals} from '../../src/lib/inventorySignals';
test('agrupa lectores, escritura exige snapshot posterior sin publicar el anterior',async()=>{
 let finish:((n:number)=>void)|undefined,calls=0;const published:number[]=[];
 const r=createInventoryRefresh({load:async()=>{calls++;return new Promise<number>(done=>{finish=done;});},clear:()=>{},state:()=>{},publish:v=>published.push(v)});
 r.setContext('orden');const running=r.refresh();void r.refresh();void r.refresh(true);void r.refresh(true);
 assert.equal(calls,1);finish!(1);await wait(0);assert.deepEqual(published,[]);assert.equal(calls,2);finish!(2);await running;assert.deepEqual(published,[2]);r.dispose();
});
test('401/403 pausan avisos; cambio de usuario no hereda bloqueo ni resultados',async()=>{
 for(const status of [401,403]){
  let deny=false,calls=0,data:number|null=null;
  const r=createInventoryRefresh({load:async()=>{calls++;if(deny)throw {status};return 7;},clear:()=>{data=null;},publish:v=>{data=v;},state:()=>{}});
  r.setContext('A');await r.refresh();deny=true;await r.refresh();assert.equal(data,null);const n=calls;await r.refresh();assert.equal(calls,n);
  deny=false;r.setContext('B');await r.refresh();assert.equal(data,7);r.dispose();
 }
});
test('logout/desmontaje descarta respuesta tardía de otra generación',async()=>{
 let finish:((n:number)=>void)|undefined;const published:number[]=[];
 const r=createInventoryRefresh({load:async()=>new Promise<number>(done=>{finish=done;}),clear:()=>{},state:()=>{},publish:v=>published.push(v)});
 r.setContext('A');const running=r.refresh();r.dispose();finish!(3);await running;assert.deepEqual(published,[]);
});
test('ruta pública no tiene contexto, frames idénticos y cleanup con cliente lento',async()=>{
 const response=await inventorySignalRoutes.request('/');assert.equal(response.status,200);await response.body!.cancel();
 const hub=createInventorySignalHub(20),a=new AbortController(),b=new AbortController();
 try {
  const ra=hub.response(a.signal).body!.getReader(),rb=hub.response(b.signal).body!.getReader();
  const values=await Promise.all([ra.read(),rb.read(),wait(40)]);
  assert.equal(new TextDecoder().decode(values[0].value),'event: invalidate\ndata: {"v":1}\n\n');assert.deepEqual(values[0].value,values[1].value);
  a.abort();await rb.cancel();assert.equal(hub.size(),0);
  const slow=hub.response(new AbortController().signal);await wait(70);assert.equal(hub.size(),0);await slow.body!.cancel();
 }finally{hub.dispose();}
});
test('WebView sin EventSource usa reloj local y elimina timers/listeners al desmontar',()=>{
 const descriptors=Object.fromEntries(['window','document','navigator','EventSource','setInterval','clearInterval'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 let active=0,refreshes=0;const w=new EventTarget(),d=Object.assign(new EventTarget(),{hidden:false});
 try{
  for(const [key,value] of Object.entries({window:w,document:d,navigator:{onLine:true},EventSource:undefined,setInterval:()=>{active++;return 1;},clearInterval:()=>{active--;}}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  const stop=startInventorySignals({refresh:()=>{refreshes++;},online:()=>{},visible:()=>{}});assert.equal(active,1);assert.equal(refreshes,1);
  stop();assert.equal(active,0);w.dispatchEvent(new Event('online'));assert.equal(refreshes,1);
 }finally{for(const [key,descriptor] of Object.entries(descriptors)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});
