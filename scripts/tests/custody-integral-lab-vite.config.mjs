import{defineConfig}from'vite';import vue from'@vitejs/plugin-vue';import tailwindcss from'@tailwindcss/vite';import{config,root}from'../custody-integral-lab-common.mjs';
const c=config();
export default defineConfig({root,envDir:false,plugins:[vue(),tailwindcss()],resolve:{alias:{'@':root+'/src'}},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(c.gateway),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify(c.anonKey)},server:{host:'127.0.0.1',port:54422,strictPort:true,fs:{deny:['**/.env*','**/runtime/**','**/*.pem']},proxy:{'/api':c.api,'/lab':c.api}}});
