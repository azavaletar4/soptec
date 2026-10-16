import {readFileSync} from 'node:fs';
import {config,docker,project,runtime,sql} from './common.mjs';
import {SignJWT} from 'jose';
const c=config();
let logs=docker(['logs','--tail','180',project+'-realtime']);
const secrets=[c.dbPassword,c.legacySecret,c.anonKey,c.serviceKey,...c.accounts.map(a=>a.password),
 ...readFileSync(runtime+'realtime.env','utf8').split('\n').filter(l=>/PASSWORD|SECRET|ENC_KEY/.test(l)).map(l=>l.slice(l.indexOf('=')+1))];
for(const s of secrets.filter(Boolean))logs=logs.split(s).join('[REDACTED]');
console.log(logs.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g,'[JWT_REDACTED]').split('\n').filter(l=>/error_code|message:|MigrationsFailed|== Migrated|Starting Elixir.Realtime|Tenant set-up/i.test(l)).map(l=>l.slice(0,350)).join('\n'));
console.log(sql("select to_regclass('_realtime.tenants'),to_regclass('realtime.messages')"));
console.log('TENANTS',sql('select external_id from _realtime.tenants'));
try {
 // Token de control del servicio local, nunca identidad de técnico.
 const token=await new SignJWT({role:'service_role'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('2m').sign(new TextEncoder().encode(c.legacySecret));
 const r=await fetch('http://127.0.0.1:54385/api/tenants/inventory-lab/health',{headers:{Authorization:'Bearer '+token}});
 console.log('REALTIME_HEALTH',r.status,await r.text());
}catch{console.log('REALTIME_HEALTH_UNAVAILABLE');}
