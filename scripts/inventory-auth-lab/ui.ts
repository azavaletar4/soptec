import { createApp,ref,onMounted } from 'vue';
import { createPinia } from 'pinia';
import { useAuthStore } from '../../src/stores/auth';
import { createFieldInventoryClient } from '../../src/lib/fieldInventoryClient';
import { apiFetch } from '../../src/lib/api';
import { executeFieldInventory,pendingFieldInventory,type FieldInventoryAction } from '../../src/lib/fieldInventoryOperation';
createApp({setup(){
 const auth=useAuthStore(),accounts=ref<any[]>([]),jobs=ref<any[]>([]),role=ref('leader'),selected=ref(''),status=ref('Sin sesión'),rows=ref<any>(null);
 const tx=ref<any>(null),txEnabled=ref(false),txJob=ref(0),action=ref<FieldInventoryAction>('consume'),quantity=ref(1),movementId=ref(''),unitIndex=ref(0),condition=ref('in_stock'),dropOnce=ref(false),busy=ref(false),receipt=ref<any>(null);
 let publicKey='';
 onMounted(async()=>{const c=await fetch('/lab/config').then(r=>r.json()),m=await fetch('/lab/manifest').then(r=>r.json());publicKey=c.anonKey;txEnabled.value=c.transactionMode;if(c.transactionMode)tx.value=await fetch('/lab/transactions').then(r=>r.json());accounts.value=c.accounts;jobs.value=m.jobs;selected.value=m.jobs[0].id;await auth.init();});
 const client=createFieldInventoryClient(path=>apiFetch(path),c=>c.actorId===auth.user?.id);
 async function login(){try{await auth.signOut();const a=accounts.value.find(a=>a.role===role.value);await auth.signIn(a.email,a.password);status.value='Sesión Auth real: '+role.value;rows.value=null;}catch(e){status.value=String(e);}}
 async function read(){try{const j=jobs.value.find(j=>j.id===selected.value);rows.value=null;const context={jobType:j.type,jobId:j.id,actorId:auth.user!.id,clientId:j.clientId,contractId:j.contractId};const result=await Promise.all(['materials','assigned','pending'].map(view=>client.read(context,view as any)));rows.value=result;status.value='Lectura autorizada';}catch(e){status.value='Denegado: '+String(e);}}
 async function transact(retry=false){
  if(busy.value||!auth.user||!tx.value)return;busy.value=true;status.value='Operación en curso';
  try{
   const j=tx.value.jobs[txJob.value],context={jobType:j.type,jobId:j.id,actorId:auth.user.id,clientId:j.clientId,contractId:j.contractId};
   let act=action.value,payload:Record<string,unknown>={};
   if(retry){const p=pendingFieldInventory(localStorage,context);if(!p)throw Error('No hay operación pendiente');act=p.p_action;payload=p.p_payload;}
   else if(act==='consume')payload={productId:tx.value.material,quantity:Number(quantity.value)};
   else if(act==='correct'||act==='reverse')payload={movementId:movementId.value,...(act==='correct'?{quantity:Number(quantity.value)}:{})};
   else payload={unitId:tx.value.units[unitIndex.value].id,...(act==='return'?{condition:condition.value}:{})};
   const drop=dropOnce.value;dropOnce.value=false;
   receipt.value=await navigator.locks.request(`inventory-lab:${context.actorId}:${context.jobId}`,()=>executeFieldInventory(localStorage,context,act,payload,async request=>{
    const response=await fetch('http://127.0.0.1:54381/rest/v1/rpc/campo_inventory_operation',{method:'POST',headers:{apikey:publicKey,Authorization:'Bearer '+auth.session!.access_token,'Content-Type':'application/json',...(drop?{'x-lab-drop-response':'1'}:{})},body:JSON.stringify(request)});
    const body=await response.json();return response.ok?{data:body,error:null}:{data:null,error:{code:body.code,message:body.message}};
   }));
   if(act==='consume')movementId.value=receipt.value.ids[0];if(act==='correct')movementId.value=receipt.value.ids[1];status.value='Operación confirmada';
  }catch(e){status.value='Error: '+String(e);}finally{busy.value=false;}
 }
 return {accounts,jobs,role,selected,status,rows,login,read,tx,txEnabled,txJob,action,quantity,movementId,unitIndex,condition,dropOnce,busy,receipt,transact};
},template:`<main style="max-width:850px;margin:2rem auto;font:16px system-ui"><h1>Laboratorio local de inventario</h1><p>Datos ficticios. Sesiones emitidas por Supabase Auth local.</p><label>Cuenta de prueba <select id="role" v-model="role"><option v-for="a in accounts" :value="a.role">{{a.role}}</option></select></label><button id="login" @click="login">Iniciar sesión real</button><p id="status">{{status}}</p><label>Orden <select id="job" v-model="selected"><option v-for="j in jobs" :value="j.id">{{j.label}}</option></select></label><button id="read" @click="read">Consultar materiales y equipos</button><pre id="results">{{rows?JSON.stringify(rows,null,2):''}}</pre>
<section v-if="txEnabled && tx"><h2>Escrituras sobre fixture transaccional ficticia</h2><label>Orden <select id="tx-job" v-model.number="txJob"><option :value="0">Alta transaccional</option><option :value="1">Avería transaccional</option></select></label><label>Acción <select id="tx-action" v-model="action"><option v-for="a in ['consume','correct','reverse','assign','unassign','stage','unlink','return']">{{a}}</option></select></label><label>Cantidad <input id="tx-quantity" type="number" v-model.number="quantity"></label><label>Movimiento <input id="tx-movement" v-model="movementId"></label><label>Equipo <select id="tx-unit" v-model.number="unitIndex"><option v-for="(u,i) in tx.units" :value="i">{{u.label}}</option></select></label><label>Condición <select v-model="condition"><option>in_stock</option><option>damaged</option><option>in_repair</option></select></label><label><input id="tx-drop" type="checkbox" v-model="dropOnce">Perder próxima respuesta después del commit local</label><button id="tx-send" :disabled="busy" @click="transact(false)">Ejecutar en laboratorio</button><button id="tx-retry" :disabled="busy" @click="transact(true)">Confirmar operación de inventario pendiente</button><pre id="tx-receipt">{{receipt?JSON.stringify(receipt,null,2):''}}</pre></section></main>`}).use(createPinia()).mount('#app');
