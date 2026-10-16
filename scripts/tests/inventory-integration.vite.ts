import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
export default defineConfig({root,envDir:false,plugins:[vue(),tailwindcss()],resolve:{alias:{'@':root+'src'}},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://inventory.invalid'),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('synthetic-only')},server:{host:'127.0.0.1',port:4179,strictPort:true,fs:{deny:['**/.env*','**/runtime/**','**/*.pem']}}});
