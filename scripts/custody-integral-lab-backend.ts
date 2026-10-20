// Selected real application routes only; never imports server/src/index.ts or schedulers.
import fs from 'node:fs';import path from 'node:path';import{Hono}from'hono';import{serve}from'@hono/node-server';
import{config}from'./custody-integral-lab-common.mjs';
const c=config();
process.env.VITE_SUPABASE_URL=c.gateway;process.env.VITE_SUPABASE_ANON_KEY=c.anonKey;process.env.SUPABASE_SERVICE_ROLE_KEY=c.serviceKey;
const original=globalThis.fetch;
globalThis.fetch=async(input,init)=>{const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(u.origin!==c.gateway)throw Error('External network disabled in custody laboratory');return original(input,init);};
const{fieldInventoryRoutes}=await import('../server/src/routes/fieldInventory.ts');
// Ruta real publica (sin Auth/SQL, ver inventorySignals.ts): sin ella, el
// EventSource real de startInventorySignals reintenta sin parar contra el
// 503 generico de abajo, abortando cualquier lectura de inventario en
// curso antes de que termine -- nunca pasa en produccion (la ruta real
// existe ahi), pero sin montarla aqui el laboratorio no puede probar nada
// que dependa de una lectura que sobreviva mas de ~1s.
const{inventorySignalRoutes}=await import('../server/src/routes/inventorySignals.ts');
const app=new Hono();
app.route('/api/campo-inventory',fieldInventoryRoutes);
app.route('/api/inventory-signals',inventorySignalRoutes);
app.get('/lab/config',ctx=>ctx.json({accounts:c.accounts,fixture:JSON.parse(fs.readFileSync(path.join(c.directory,'fixture.json'),'utf8'))}));
app.all('/api/*',ctx=>ctx.json({error:'Integración de hardware deshabilitada en el laboratorio aislado.'},503));
serve({fetch:app.fetch,hostname:'127.0.0.1',port:54423});console.log('CUSTODY_INTEGRAL_BACKEND_LOCAL_54423');
