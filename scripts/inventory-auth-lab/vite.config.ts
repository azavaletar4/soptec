import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const here=fileURLToPath(new URL('./',import.meta.url));
const root=fileURLToPath(new URL('../../',import.meta.url));
const c=JSON.parse(readFileSync(here+'runtime/config.json','utf8'));
if(c.gateway!=='http://127.0.0.1:54381')throw Error('Solo laboratorio local');
export default defineConfig({root:here,envDir:false,plugins:[vue()],resolve:{alias:{'@':root+'src','vue':'vue/dist/vue.esm-bundler.js'}},
 define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(c.gateway),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify(c.anonKey)},
 server:{host:'127.0.0.1',port:54384,strictPort:true,fs:{allow:[root],deny:['**/runtime/**','**/.env*','**/*.pem']},proxy:{'/api':c.gateway,'/lab':c.gateway}}});
