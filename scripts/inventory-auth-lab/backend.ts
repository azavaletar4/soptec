// Punto de entrada exclusivo del laboratorio. Nunca importar server/src/index.ts.
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
const c=JSON.parse(readFileSync(new URL('./runtime/config.json',import.meta.url),'utf8'));
if(c.gateway!=='http://127.0.0.1:54381'||c.project!=='smartrayco-inventory-auth-lab')throw Error('Destino no autorizado');
process.env.VITE_SUPABASE_URL=c.gateway;
process.env.VITE_SUPABASE_ANON_KEY=c.anonKey;
process.env.SUPABASE_SERVICE_ROLE_KEY=c.serviceKey;
// Todas las llamadas fetch del backend deben quedarse en los tres servicios locales.
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(url.hostname!=='127.0.0.1'||!['54381','54382','54383'].includes(url.port))throw Error('Salida externa bloqueada');
 return originalFetch(input,init);
};
const {fieldInventoryRoutes}=await import('../../server/src/routes/fieldInventory.ts');
const app=new Hono();
const transactionMode=process.env.LAB_INVENTORY_WRITES==='1';
app.use('*',async(ctx,next)=>{ctx.header('Access-Control-Allow-Origin','http://127.0.0.1:54384');ctx.header('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,x-lab-drop-response');ctx.header('Access-Control-Allow-Methods','GET,POST,HEAD,OPTIONS');if(ctx.req.method==='OPTIONS')return ctx.body(null,204);await next();});
app.get('/lab/config',ctx=>ctx.json({gateway:c.gateway,anonKey:c.anonKey,accounts:c.accounts,transactionMode}));
app.get('/lab/transactions',ctx=>{try{return ctx.json(JSON.parse(readFileSync(new URL('./runtime/transactions.json',import.meta.url),'utf8')));}catch{return ctx.json({error:'Fixture transaccional no preparada'},503);}});
app.get('/lab/manifest',ctx=>{try{return ctx.json(JSON.parse(readFileSync(new URL('./runtime/manifest.json',import.meta.url),'utf8')));}catch{return ctx.json({error:'Datos ficticios aún no preparados'},503);}});
app.route('/api/campo-inventory',fieldInventoryRoutes);
app.all('/auth/v1/*',async ctx=>{
 const path=ctx.req.path.slice('/auth/v1'.length)+new URL(ctx.req.url).search;
 const response=await fetch('http://127.0.0.1:54382'+path,{method:ctx.req.method,headers:ctx.req.raw.headers,body:['GET','HEAD'].includes(ctx.req.method)?undefined:await ctx.req.arrayBuffer()});
 return new Response(response.body,{status:response.status,headers:response.headers});
});
app.all('/rest/v1/*',async ctx=>{
 const rpc=ctx.req.path==='/rest/v1/rpc/campo_inventory_operation';
 const control=ctx.req.path==='/rest/v1/rpc/lab_authorization_hold';
 if(!['GET','HEAD'].includes(ctx.req.method)&&!(transactionMode&&ctx.req.method==='POST'&&(rpc||control)))return ctx.json({error:'Laboratorio: operación HTTP no habilitada'},405);
 const path=ctx.req.path.slice('/rest/v1'.length)+new URL(ctx.req.url).search;
 const response=await fetch('http://127.0.0.1:54383'+path,{method:ctx.req.method,headers:ctx.req.raw.headers,body:ctx.req.method==='POST'?await ctx.req.arrayBuffer():undefined});
 // Fallo de transporte controlado SOLO del laboratorio, después de confirmar REST.
 if(rpc&&response.ok&&ctx.req.header('x-lab-drop-response')==='1'){
  await response.arrayBuffer();return ctx.json({message:'Respuesta de prueba no entregada. Confirma la operación pendiente.'},503);
 }
 return new Response(response.body,{status:response.status,headers:response.headers});
});
serve({fetch:app.fetch,port:54381,hostname:'127.0.0.1'});
console.log('LAB_BACKEND_READY http://127.0.0.1:54381; sin schedulers; modo transaccional='+transactionMode);
