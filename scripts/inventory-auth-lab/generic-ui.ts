import {createApp,ref,onMounted,onUnmounted,watch} from 'vue';
import {createPinia} from 'pinia';
import {useAuthStore} from '../../src/stores/auth';
import {createFieldInventoryClient} from '../../src/lib/fieldInventoryClient';
// @ts-ignore módulo experimental local, fuera de la aplicación
import {createGenericRefresh} from './generic-refresh.mjs';
createApp({setup(){
 const auth=useAuthStore(),accounts=ref<any[]>([]),jobs=ref<any[]>([]),role=ref('leader'),selected=ref(''),session=ref('Sin sesión'),status=ref('signed-out'),rows=ref<any>(null);
 let source:EventSource|null=null,retryTimer:ReturnType<typeof setTimeout>|null=null,retryDelay=1000,networkOnline=true;
 const controller=createGenericRefresh({clear:()=>{rows.value=null;},publish:(value:any)=>{rows.value=value;},state:(s:string)=>{status.value=s;},
  load:async(context:any,token:string,signal:AbortSignal)=>{
   const client=createFieldInventoryClient(async(path:string)=>{
    const response=await fetch(path,{signal,headers:{Authorization:'Bearer '+token},cache:'no-store'});
    const data=await response.json();
    if(!response.ok)throw Object.assign(Error('Consulta no autorizada o no disponible'),{status:response.status});
    return data;
   },c=>c.actorId===auth.user?.id&&c.jobId===selected.value);
   return Promise.all(['materials','assigned','pending'].map(v=>client.read(context,v as any)));
  }});
 const selectContext=()=>{
  const job=jobs.value.find(j=>j.id===selected.value),user=auth.user,token=auth.session?.access_token;
  controller.setContext(job&&user&&token?{jobType:job.type,jobId:job.id,actorId:user.id,clientId:job.clientId,contractId:job.contractId}:null,token??'');
 };
 watch(()=>[auth.user?.id,auth.session?.access_token,selected.value],selectContext);
 const cancelRetry=()=>{if(retryTimer)clearTimeout(retryTimer);retryTimer=null;};
 const reconnect=()=>{
  cancelRetry();source?.close();if(!networkOnline)return;
  const stream=new EventSource('/generic-clock');source=stream;
  stream.addEventListener('invalidate',(e:MessageEvent)=>{if(source===stream&&e.data==='{"v":1}'&&e.lastEventId==='')void controller.tick();});
  stream.onerror=()=>{if(source!==stream)return;controller.setOnline(false);stream.close();source=null;if(networkOnline){retryTimer=setTimeout(reconnect,retryDelay);retryDelay=Math.min(retryDelay*2,10000);}};
  stream.onopen=()=>{if(source!==stream)return;retryDelay=1000;controller.setOnline(true);void controller.tick();};
 };
 const offline=()=>{networkOnline=false;cancelRetry();controller.setOnline(false);source?.close();source=null;};
 const online=()=>{networkOnline=true;reconnect();};
 const visibility=()=>controller.setVisible(document.visibilityState==='visible');
 async function login(){controller.setContext(null);rows.value=null;session.value='Iniciando sesión';try{await auth.signOut();const a=accounts.value.find(a=>a.role===role.value);await auth.signIn(a.email,a.password);session.value='Sesión Auth real: '+role.value;}catch{session.value='No se pudo iniciar sesión';}}
 onMounted(async()=>{
  const [c,m]=await Promise.all([fetch('/lab/config').then(r=>r.json()),fetch('/generic-fixture').then(r=>r.json())]);
  accounts.value=c.accounts;jobs.value=m.jobs;selected.value=m.jobs[0].id;
  await auth.init();selectContext();reconnect();
  window.addEventListener('offline',offline);window.addEventListener('online',online);document.addEventListener('visibilitychange',visibility);
  // Instrumentación solo de la página de laboratorio; sin tokens ni filas.
  (window as any).__genericLab={stats:()=>controller.stats(),tick:()=>controller.tick()};
 });
 onUnmounted(()=>{cancelRetry();source?.close();source=null;controller.dispose();window.removeEventListener('offline',offline);window.removeEventListener('online',online);document.removeEventListener('visibilitychange',visibility);});
 return {accounts,jobs,role,selected,session,status,rows,login,reconnect,retry:()=>controller.retry()};
},template:`<main style="max-width:850px;margin:2rem auto;font:16px system-ui"><h1>Avisos genéricos de Campo — laboratorio</h1><p>Datos ficticios. Los avisos periódicos no contienen información de órdenes.</p><select id="role" v-model="role"><option v-for="a in accounts" :value="a.role">{{a.role}}</option></select><button id="login" @click="login">Iniciar sesión real</button><p id="session">{{session}}</p><select id="job" v-model="selected"><option v-for="j in jobs" :value="j.id">{{j.label}}</option></select><p id="state">{{status}}</p><p v-if="status==='blocked'">Sin autorización. Se limpiaron los datos de la orden. Solicita revisión y vuelve a comprobar el acceso.</p><button id="retry" @click="retry">Comprobar acceso</button><button id="reconnect" @click="reconnect">Reconectar avisos</button><pre id="results">{{rows?JSON.stringify(rows,null,2):''}}</pre></main>`}).use(createPinia()).mount('#app');
