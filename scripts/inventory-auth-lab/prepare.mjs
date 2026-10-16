// Genera exclusivamente claves/credenciales nuevas para un laboratorio local.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { runtime, project, gateway } from './common.mjs';
mkdirSync(runtime,{recursive:true});
if(existsSync(runtime+'config.json'))throw Error('Laboratorio ya preparado; reutiliza su configuración.');
const secret=()=>randomBytes(32).toString('hex');
const {privateKey,publicKey}=await generateKeyPair('ES256',{extractable:true});
const kid=randomUUID(),priv={...await exportJWK(privateKey),kid,alg:'ES256',use:'sig',key_ops:['sign','verify']};
const pub={...await exportJWK(publicKey),kid,alg:'ES256',use:'sig',key_ops:['verify']};
const token=role=>new SignJWT({role}).setProtectedHeader({alg:'ES256',kid}).setIssuedAt().setExpirationTime('7d').sign(privateKey);
const c={project,gateway,anonKey:await token('anon'),serviceKey:await token('service_role'),dbPassword:secret(),legacySecret:secret(),
 accounts:['leader','support','outsider','removed'].map(role=>({role,email:`${role}@inventory-lab.example`,password:secret()}))};
writeFileSync(runtime+'config.json',JSON.stringify(c,null,2));
writeFileSync(runtime+'auth.env',[
 'GOTRUE_API_HOST=0.0.0.0','GOTRUE_API_PORT=9999',`API_EXTERNAL_URL=${gateway}/auth/v1`,
 `GOTRUE_JWT_ISSUER=${gateway}/auth/v1`,'GOTRUE_SITE_URL=http://127.0.0.1:54384',
 'GOTRUE_DB_DRIVER=postgres',`GOTRUE_DB_DATABASE_URL=postgres://postgres:${c.dbPassword}@db:5432/inventory_lab?search_path=auth`,
 `GOTRUE_JWT_SECRET=${c.legacySecret}`,`GOTRUE_JWT_KEYS=${JSON.stringify([priv])}`,
 'GOTRUE_JWT_AUD=authenticated','GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated','GOTRUE_JWT_ADMIN_ROLES=service_role',
 'GOTRUE_JWT_EXP=3600','GOTRUE_DISABLE_SIGNUP=false','GOTRUE_EXTERNAL_EMAIL_ENABLED=true','GOTRUE_MAILER_AUTOCONFIRM=true',
 'GOTRUE_EXTERNAL_PHONE_ENABLED=false','GOTRUE_RATE_LIMIT_EMAIL_SENT=1000',
].join('\n')+'\n');
writeFileSync(runtime+'rest.env',`PGRST_DB_URI=postgres://authenticator:${c.dbPassword}@db:5432/inventory_lab\nPGRST_DB_SCHEMAS=public\nPGRST_DB_ANON_ROLE=anon\nPGRST_JWT_SECRET=${JSON.stringify({keys:[pub]})}\nPGRST_JWT_AUD=authenticated\nPGRST_DB_MAX_ROWS=100\n`);
writeFileSync(runtime+'db.env',`POSTGRES_DB=inventory_lab\nPOSTGRES_PASSWORD=${c.dbPassword}\n`);
writeFileSync(runtime+'compose.json',JSON.stringify({name:project,services:{
 db:{image:'postgres:17',container_name:project+'-db',env_file:['db.env'],networks:['lab'],volumes:['db:/var/lib/postgresql/data'],healthcheck:{test:['CMD-SHELL','pg_isready -U postgres -d inventory_lab'],interval:'2s',timeout:'2s',retries:20}},
 auth:{image:'supabase/gotrue:v2.197.0',container_name:project+'-auth',env_file:['auth.env'],networks:['lab']},
 rest:{image:'postgrest/postgrest:v14.18',container_name:project+'-rest',env_file:['rest.env'],networks:['lab']},
 edge:{image:'caddy:2',container_name:project+'-edge',networks:['lab','edge'],ports:['127.0.0.1:54382:9999','127.0.0.1:54383:3000'],volumes:['./Caddyfile:/etc/caddy/Caddyfile:ro'],read_only:true},
},networks:{lab:{internal:true},edge:{}},volumes:{db:{}}},null,2));
writeFileSync(runtime+'Caddyfile','{\n admin off\n auto_https off\n}\n:9999 {\n reverse_proxy auth:9999\n}\n:3000 {\n reverse_proxy rest:3000\n}\n');
console.log('LAB_CONFIG_READY: solo credenciales locales generadas; runtime excluido de Git.');
