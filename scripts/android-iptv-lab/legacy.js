// Librerías candidatas reales. Solo se redirige el NOMBRE de BD en esta página
// LAB para no tocar la BD que contiene la foto y los cierres ya probados.
import {saveDraft,loadDraft} from '/src/lib/formDrafts.ts';
import {enqueueClosure,listQueuedClosures} from '/src/lib/offlineQueue.ts';
import {closeCampoDatabase} from '/src/lib/campoDatabase.ts';
import {createStore,get} from 'idb-keyval';
const original=indexedDB.open,nativeOpen=(...args)=>original.apply(indexedDB,args);
const namespace='LAB-legacy-'+crypto.randomUUID(),checks=[];
const assert=(value,name)=>{if(!value)throw Error(name);checks.push(name);};
const open=name=>new Promise((resolve,reject)=>{const r=nativeOpen(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
const values=(db,name)=>new Promise((resolve,reject)=>{const r=db.transaction(name).objectStore(name).getAll();r.onsuccess=()=>resolve(r.result.map(x=>({savedAt:x.savedAt,data:x.data?{id:x.data.id,mode:x.data.mode,note:x.data.note,bytes:x.data.photo?.size??0}:null,id:x.localId??null})));r.onerror=()=>reject(r.error)});
async function originalSnapshot(){const db=await open('smartrayco-campo');try{const out={};for(const name of db.objectStoreNames)out[name]=await values(db,name);return JSON.stringify(out)}finally{db.close()}}
async function run(){
let retained;
try{
 const before=await originalSnapshot();
 indexedDB.open=function(name,...args){return nativeOpen(name==='smartrayco-campo'?namespace:name,...args)};
 retained=await new Promise((resolve,reject)=>{const r=indexedDB.open('smartrayco-campo',1);r.onupgradeneeded=()=>{r.result.createObjectStore('drafts');r.result.createObjectStore('extra-preservado')};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 await new Promise((resolve,reject)=>{const t=retained.transaction(['drafts','extra-preservado'],'readwrite');t.objectStore('drafts').put({data:{mode:'customer_device',note:'LEGADO-ANDROID-CONSERVAR',photo:new Blob(['FOTO-LEGADO-ANDROID'])},savedAt:1},'LAB-old');t.objectStore('extra-preservado').put('NO-BORRAR','LAB-extra');t.oncomplete=resolve;t.onerror=()=>reject(t.error)});
 let blocked='';try{await loadDraft('LAB-old')}catch(e){blocked=e.message}
 assert(/Otra vista/.test(blocked),'conexión antigua bloquea upgrade con mensaje recuperable');
 assert((await values(retained,'drafts'))[0].data.bytes===19,'bloqueo conserva Blob legado');
 retained.close();retained=null;
 await saveDraft('LAB-new',{mode:'smart_tv_app'});
 const old=await loadDraft('LAB-old');assert(old.mode==='customer_device'&&old.note==='LEGADO-ANDROID-CONSERVAR'&&await old.photo.text()==='FOTO-LEGADO-ANDROID','upgrade recupera modalidad, nota y bytes originales');
 await enqueueClosure({jobType:'installation',jobId:'LAB-legacy-physical',photos:[{category:'facade',blob:old.photo,fileName:'legacy.bin'}],equipmentPhotos:[],iptvInstallationMode:'smart_tv_app',closureNotes:'PENDIENTE-CONSERVAR'});
 assert((await listQueuedClosures()).length===1,'store closures nuevo permite guardar pendiente sin borrar drafts');
 assert(await get('LAB-extra',createStore('smartrayco-campo','extra-preservado'))==='NO-BORRAR','store adicional preservado');
 assert((await get('LAB-old',createStore('smartrayco-campo','drafts'))).data.note==='LEGADO-ANDROID-CONSERVAR','biblioteca antigua sigue leyendo el store tras upgrade');
 const db=await open(namespace),stores=[...db.objectStoreNames],version=db.version;db.close();assert(stores.includes('drafts')&&stores.includes('closures')&&stores.includes('extra-preservado')&&version>1,'esquema aditivo contiene ambos stores y versión incrementada');
 assert(before===await originalSnapshot(),'BD principal LAB y sus fotos/borradores permanecen intactos');
 window.legacyResult={passed:checks.length,checks,namespace,version,stores,blocked,databaseNameRedirected:true,productionWrites:0,recordsDeleted:0,pendingPreserved:1};
}catch(error){window.legacyResult={passed:checks.length,checks,namespace,error:error.message};}
finally{retained?.close();await closeCampoDatabase().catch(()=>{});indexedDB.open=original;document.querySelector('#result').textContent=JSON.stringify(window.legacyResult,null,2);window.legacyReady=true;}
}
run();
