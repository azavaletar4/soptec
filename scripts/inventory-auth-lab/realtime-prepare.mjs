// Añadido exclusivo al laboratorio conservado. No carga .env ni URLs remotas.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { config, sql, runtime, project, docker } from './common.mjs';
const c = config();
const compose = JSON.parse(readFileSync(runtime + 'compose.json', 'utf8'));
if (compose.name !== project || !compose.networks.lab.internal || compose.services.db.container_name !== project + '-db') throw Error('Laboratorio no autorizado');
if (existsSync(runtime + 'realtime-prepared.json')) throw Error('Realtime ya preparado; conservar runtime y revisar estado, no repetir preparación');
const rest = readFileSync(runtime + 'rest.env', 'utf8');
const jwks = rest.split(/\r?\n/).find(l => l.startsWith('PGRST_JWT_SECRET=')).slice('PGRST_JWT_SECRET='.length);
if (!JSON.parse(jwks).keys.every(k => !k.d)) throw Error('JWKS debe ser pública');
const baseline = sql(`select jsonb_object_agg(t, h) from (
 select 'units' t, md5(coalesce(string_agg(to_jsonb(u)::text,'' order by id),'')) h from inventory_units u union all
 select 'movements', md5(coalesce(string_agg(to_jsonb(u)::text,'' order by id),'')) from inventory_movements u union all
 select 'products', md5(coalesce(string_agg(to_jsonb(u)::text,'' order by id),'')) from inventory_products u union all
 select 'events', md5(coalesce(string_agg(to_jsonb(u)::text,'' order by id),'')) from inventory_unit_events u union all
 select 'receipts', md5(coalesce(string_agg(to_jsonb(u)::text,'' order by id),'')) from campo_inventory_operations u) b`);
const caddy = readFileSync(runtime + 'Caddyfile', 'utf8');
if (caddy.includes(':4000')) throw Error('Puerto Realtime ya configurado');
writeFileSync(runtime + 'realtime-baseline.json', baseline + '\n');
writeFileSync(runtime + 'Caddyfile.before-realtime', caddy);
writeFileSync(runtime + 'realtime.env', Object.entries({
 PORT: '4000', DB_HOST: 'db', DB_PORT: '5432', DB_USER: 'postgres', DB_PASSWORD: c.dbPassword, DB_NAME: 'inventory_lab',
 DB_AFTER_CONNECT_QUERY: 'SET search_path TO _realtime', DB_ENC_KEY: randomBytes(8).toString('hex'),
 API_JWT_SECRET: c.legacySecret, API_JWT_JWKS: jwks, SECRET_KEY_BASE: randomBytes(64).toString('hex'),
 METRICS_JWT_SECRET: c.legacySecret, ERL_AFLAGS: '-proto_dist inet_tcp', DNS_NODES: "''", RLIMIT_NOFILE: '10000',
 APP_NAME: 'realtime', SEED_SELF_HOST: 'true', SELF_HOST_TENANT_NAME: 'inventory-lab', RUN_JANITOR: 'true',
 DISABLE_HEALTHCHECK_LOGGING: 'true', DB_SSL: 'false',
}).map(([k,v]) => `${k}=${v}`).join('\n') + '\n');
writeFileSync(runtime + 'realtime-compose.json', JSON.stringify({services:{
 realtime: {image:'supabase/realtime:v2.143.3',container_name:project+'-realtime',env_file:['realtime.env'],networks:['lab']},
 edge: {ports:['127.0.0.1:54385:4000']},
}}, null, 2));
writeFileSync(runtime + 'Caddyfile', caddy + '\n:4000 {\n reverse_proxy realtime:4000 {\n  header_up Host inventory-lab.localhost\n }\n}\n');
sql(`create schema if not exists _realtime; create schema if not exists realtime; create extension if not exists pgcrypto;
 do $$begin
 if not exists(select 1 from pg_roles where rolname='dashboard_user') then create role dashboard_user nologin; end if;
 if not exists(select 1 from pg_roles where rolname='supabase_admin') then create role supabase_admin nologin; end if;
 if not exists(select 1 from pg_roles where rolname='supabase_realtime_admin') then create role supabase_realtime_admin nologin; end if;
 end$$;
 create or replace function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'$$;
 grant execute on function auth.role() to authenticated,anon,service_role;`);
// Necesario para el CDC interno del servicio; reinicio solo del DB local fijo.
const oldWal = sql('show wal_level');
if (oldWal !== 'logical') {
 sql("alter system set wal_level='logical'");
 docker(['restart', project+'-db']);
}
docker(['compose','--project-name',project,'-f',runtime+'compose.json','-f',runtime+'realtime-compose.json','up','-d','--pull','never','--no-deps','realtime','edge']);
writeFileSync(runtime + 'realtime-prepared.json', JSON.stringify({at:new Date().toISOString(),oldWal,endpoint:'http://127.0.0.1:54385',image:'supabase/realtime:v2.143.3'}));
console.log('REALTIME_LAB_PREPARED: puerto 54385 solo loopback; volumen y credenciales Auth conservados; sin Cloud.');
