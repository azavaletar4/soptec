// Policy experimental, solo en el DB de laboratorio; no es migración de Cloud.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {RealtimeClient} from '@supabase/realtime-js';
import {config,sql,gateway,wait} from './common.mjs';
const c=config();
sql(`create schema if not exists realtime;
 do $$begin
 if not exists(select 1 from pg_roles where rolname='dashboard_user') then create role dashboard_user nologin; end if;
 if not exists(select 1 from pg_roles where rolname='supabase_admin') then create role supabase_admin nologin; end if;
 if not exists(select 1 from pg_roles where rolname='supabase_realtime_admin') then create role supabase_realtime_admin nologin; end if;
 end$$;`);
const auth=createClient(gateway,c.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
const a=c.accounts.find(a=>a.role==='leader');
const {data,error}=await auth.auth.signInWithPassword(a); assert(!error,error?.message);
const rt=new RealtimeClient('ws://127.0.0.1:54385/socket',{params:{apikey:c.anonKey},accessToken:async()=>data.session.access_token});
try {
 await rt.setAuth(data.session.access_token);
 const channel=rt.channel('lab-initialize-no-data',{config:{private:true}});
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('Inicialización Realtime agotó espera')),25000);
  channel.subscribe((status,error)=>{
   if(status==='SUBSCRIBED'){clearTimeout(timeout);resolve();}
   else if(status==='CHANNEL_ERROR'){clearTimeout(timeout);resolve();} // Sin policy aún: JOIN denegado, migraciones iniciadas.
   else if(status==='TIMED_OUT'){clearTimeout(timeout);reject(Error('Inicialización '+status));}
  });
 });
 await wait(()=>sql("select (to_regclass('realtime.messages') is not null)::int")==='1');
 sql(readFileSync(new URL('./realtime-policy.sql',import.meta.url),'utf8'));
 console.log('REALTIME_POLICY_READY: SELECT contextual, sin INSERT de clientes; solo laboratorio.');
}finally{await rt.removeAllChannels();rt.disconnect();}
