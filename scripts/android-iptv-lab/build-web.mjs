// Actualiza únicamente los assets de la sonda; conserva todos sus datos.
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'vite';
import vue from '@vitejs/plugin-vue';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),root=fs.realpathSync.native(process.cwd());
process.env.NODE_ENV='production';process.env.VITE_USER_NODE_ENV='production';
if(!path.resolve(config.web).startsWith(path.join(root,'scripts/inventory-auth-lab/runtime')+path.sep)||path.basename(config.web)!=='web')throw Error('OUTSIDE_LAB_WEB_OUTPUT');
const staging=path.resolve(config.web+'-build-'+Date.now());
await build({configFile:false,root,plugins:[vue()],resolve:{alias:{'@':path.join(root,'src')}},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://iptv-lab.invalid'),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('synthetic-only'),'__LAB_SOURCE_COMMIT__':JSON.stringify(config.sourceCommit)},logLevel:'error',build:{outDir:staging,rollupOptions:{input:[path.join(root,'scripts/android-iptv-lab/lab.html'),path.join(root,'scripts/android-iptv-lab/legacy.html')]}}});
// Ambas rutas están resueltas dentro del runtime LAB. Conservar la salida
// anterior y sustituir solo tras compilar; nunca dejar el servidor sin assets.
if(fs.existsSync(config.web)){if(!fs.realpathSync.native(config.web).startsWith(path.join(root,'scripts/inventory-auth-lab/runtime')+path.sep))throw Error('UNSAFE_LAB_WEB_LINK');fs.renameSync(config.web,config.web+'-before-'+Date.now());}
fs.renameSync(staging,config.web);
console.log(JSON.stringify({labWebBuilt:true,web:config.web,deviceDataChanged:false}));
