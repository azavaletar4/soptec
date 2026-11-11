// Sonda física del wrapper Flutter. Librerías y selector reales; transporte
// sintético explícito. No certifica por sí sola PostgreSQL ni toda la vista Campo.
import {createApp,h,ref,onMounted,nextTick,watch} from 'vue';
import {createPinia} from 'pinia';
import Field from '/src/components/campo/IptvInstallationModeField.vue';
import {useInstallationsStore} from '/src/stores/installations.ts';
import {supabase} from '/src/lib/supabase.ts';
import {saveDraft,loadDraft} from '/src/lib/formDrafts.ts';
import {enqueueClosure,listQueuedClosures,flushQueue,setQueuedIptvMode} from '/src/lib/offlineQueue.ts';
import {closurePayloadHash,withClosureLock} from '/src/lib/closureSubmission.ts';
const actor='LAB-technician';
const mode=ref(null),note=ref(''),photo=ref(null),message=ref(''),error=ref(''),items=ref([]),snapshot=ref(null);
const currentId=ref(localStorage.getItem('LAB-last-draft')??'LAB-'+crypto.randomUUID()),offline=ref(false),loseResponse=ref(false),rejectRayco=ref(true),preview=ref('');
watch(photo,value=>{if(preview.value)URL.revokeObjectURL(preview.value);preview.value=value?URL.createObjectURL(value):'';});
let operationId=crypto.randomUUID();
async function transport(input){if(offline.value)throw new TypeError('Failed to fetch (sin red simulado)');const r=await fetch('/lab/transport',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const body=await r.json();if(!r.ok)throw new Error(body.error);return body;}
supabase.rpc=async(name,args)=>{
 if(name==='work_order_is_final')return {data:(await transport({action:'read',id:args.p_job_id})).data.status==='completed',error:null};
 if(name==='installation_iptv_preflight')return transport({action:'preflight',id:args.p_installation_id,args,rejectRayco:rejectRayco.value});
 throw Error('RPC bloqueada en laboratorio: '+name);
};
supabase.from=table=>{
 if(table!=='installations')throw Error('Tabla bloqueada en laboratorio');
 let id,patch;const query={select(){return query},eq(key,value){if(key!=='id')throw Error('Filtro no permitido');id=value;return query},update(value){patch=value;return query},async single(){const lost=loseResponse.value;if(patch)loseResponse.value=false;return transport({action:patch?'update':'read',id,patch,loseResponse:lost})}};return query;
};
const pinia=createPinia(),installations=useInstallationsStore(pinia);
async function perform(item){return withClosureLock('job:installation:'+item.jobId,async()=>{
 const hash=await closurePayloadHash(item),result=await installations.prepareIptvClosure(item.jobId,item.clientId,item.contractId,item.iptvInstallationMode,{operationId:item.closureOperationId??item.localId,hash});
 if(!result.alreadyCompleted)await installations.updateInstallation(item.jobId,{status:'completed',...result.patch});
});}
async function refresh(){items.value=await listQueuedClosures();if(!offline.value)snapshot.value=await(await fetch('/lab/state')).json();}
async function capture(action){error.value='';try{await action();await refresh()}catch(e){error.value=e.message;await refresh().catch(()=>{});throw e;}}
async function save(){await saveDraft('LAB-draft:'+currentId.value,{mode:mode.value,note:note.value,photo:photo.value,id:currentId.value,operationId});await saveDraft('LAB-pointer',{id:currentId.value});localStorage.setItem('LAB-last-draft',currentId.value);message.value='Guardado en IndexedDB confirmado';}
async function restore(){const pointer=await loadDraft('LAB-pointer');if(pointer?.id?.startsWith('LAB-'))currentId.value=pointer.id;const value=await loadDraft('LAB-draft:'+currentId.value);if(value){mode.value=value.mode;note.value=value.note;photo.value=value.photo;currentId.value=value.id;operationId=value.operationId;message.value='Borrador recuperado desde IndexedDB';}else message.value='Sin borrador previo en esta APK de laboratorio';await refresh();}
async function enqueue(){await save();const item=await enqueueClosure({actorId:actor,closureOperationId:operationId,jobType:'installation',jobId:currentId.value,clientId:'LAB-client',contractId:'LAB-contract-'+currentId.value,targetStatus:'completed',iptvInstallationMode:mode.value,closureNotes:note.value,photos:photo.value?[{category:'facade',blob:photo.value,fileName:photo.value.name??'photo.jpg'}]:[],equipmentPhotos:[],signatureBlob:null,clientPhotoCategories:[],pendingApprovalCategories:[]});message.value='Cierre guardado: '+item.localId;return item;}
async function sync(){const result=await flushQueue(perform,actor);message.value=JSON.stringify(result);await refresh();return result;}
async function evidence(){const result={sourceCommit:__LAB_SOURCE_COMMIT__,at:new Date().toISOString(),ua:navigator.userAgent,secureContext:isSecureContext,indexedDB:!!indexedDB,webLocks:!!navigator.locks,webCrypto:!!crypto.subtle,mode:mode.value,note:note.value,photoBytes:photo.value?.size??0,photoHash:photo.value?await closurePayloadHash({photos:[{blob:photo.value,fileName:photo.value.name??'photo.jpg'}]}):null,queue:(await listQueuedClosures()).map(i=>({id:i.localId,job:i.jobId,mode:i.iptvInstallationMode,photoBytes:i.photos[0]?.blob.size??0,error:i.lastError??null}))};await transport({action:'evidence',id:currentId.value,result});return result;}
const view=createApp({setup(){
 onMounted(()=>capture(restore).catch(()=>{}));
 const button=(label,action)=>h('button',{onClick:()=>capture(action).catch(()=>{})},label);
 return()=>h('main',[
  h('h1','IPTV LAB — NO PRODUCCIÓN'),h('p','APK independiente. Librerías/selector reales; transporte sintético. No usar datos de clientes.'),h('small',__LAB_SOURCE_COMMIT__),
  h('section',[h('h2','1. Borrador y cámara'),h('p',currentId.value),h(Field,{modelValue:mode.value,'onUpdate:modelValue':v=>mode.value=v}),h('textarea',{placeholder:'Nota sintética',value:note.value,onInput:e=>note.value=e.target.value}),h('input',{type:'file',accept:'image/*',onChange:e=>{photo.value=e.target.files[0]??photo.value}}),photo.value?h('img',{src:preview.value,alt:'Foto de prueba'}):null,button('Guardar borrador',save),button('Recuperar borrador',restore),button('Encolar cierre sintético',enqueue)]),
  h('section',[h('h2','2. Reintentos'),h('label',[h('input',{type:'checkbox',checked:offline.value,onChange:e=>offline.value=e.target.checked}),'Simular fallo de red (no cambia radios)']),h('label',[h('input',{type:'checkbox',checked:loseResponse.value,onChange:e=>loseResponse.value=e.target.checked}),'Perder una respuesta después de confirmar el cierre sintético']),h('label',[h('input',{type:'checkbox',checked:rejectRayco.value,onChange:e=>rejectRayco.value=e.target.checked}),'Respuesta Rayco sin serie/MAC/custodia']),button('Sincronizar pendientes',sync),button('Guardar evidencia del dispositivo',evidence),button('Nueva orden sintética (conserva pendientes)',async()=>{await save();currentId.value='LAB-'+crypto.randomUUID();operationId=crypto.randomUUID();mode.value=null;note.value='';photo.value=null;await save();})]),
  h('section',[h('h2','3. Pendientes conservados'),...items.value.map(item=>h('div',[h('p',item.jobId+' · '+(item.iptvInstallationMode??'sin modalidad')+' · '+(item.lastError??'pendiente')),h(Field,{modelValue:item.iptvInstallationMode,'onUpdate:modelValue':value=>capture(()=>setQueuedIptvMode(item.localId,value,actor)).catch(()=>{})})]))]),
  h('p',{role:'status'},message.value),h('p',{role:'alert',class:'error'},error.value),h('pre',JSON.stringify({capabilities:{secureContext:isSecureContext,webLocks:!!navigator.locks,webCrypto:!!crypto.subtle},server:snapshot.value},null,2))]);
}}).use(pinia);view.mount('#app');
window.lab={mode,note,photo,message,error,items,snapshot,currentId,offline,loseResponse,rejectRayco,save,restore,enqueue,sync,refresh,evidence,capture,nextTick};window.ready=true;
