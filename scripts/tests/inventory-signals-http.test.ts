import {test} from 'node:test';
import assert from 'node:assert/strict';
import {serve} from '@hono/node-server';
import {inventorySignalRoutes} from '../../server/src/routes/inventorySignals';

test('HTTP real: dos clientes reciben el mismo reloj de 10 s sin identidad ni metadatos',async()=>{
 const server=serve({fetch:inventorySignalRoutes.fetch,hostname:'127.0.0.1',port:0});
 await new Promise<void>(resolve=>server.listening?resolve():server.once('listening',resolve));
 const address=server.address();assert.ok(address && typeof address!=='string');
 const abort=new AbortController();
 try{
  const url=`http://127.0.0.1:${address.port}/`;
  const responses=await Promise.all([fetch(url,{signal:abort.signal}),fetch(url,{signal:abort.signal,headers:{Authorization:'Bearer ficticio','Last-Event-ID':'no-utilizar'}})]);
  const readers=responses.map(r=>r.body!.getReader());
  for(const response of responses){assert.equal(response.status,200);assert.equal(response.headers.get('date'),null);assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('etag'),null);}
  const first=await Promise.all(readers.map(r=>r.read()));const start=performance.now();
  const second=await Promise.all(readers.map(r=>r.read()));const elapsed=performance.now()-start;
  assert.ok(elapsed>=9500 && elapsed<=11500,`Intervalo ${elapsed} ms`);
  for(const packet of [...first,...second])assert.equal(new TextDecoder().decode(packet.value),'event: invalidate\ndata: {"v":1}\n\n');
  console.log(`Dos clientes, cuatro frames idénticos; intervalo ${Math.round(elapsed)} ms.`);
 }finally{abort.abort();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
