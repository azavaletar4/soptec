import assert from 'node:assert/strict';

export async function offlineCases({ evaluate, reload, anotherPage }) {
  let passed=0;
  // Nuevas BD: ambos órdenes de primer uso, sin preparar stores por fuera.
  for(const first of ['draft','queue']) {
    await reload();
    await evaluate(`(async()=>{await harness.closeCampoDatabase();await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('smartrayco-campo');r.onsuccess=resolve;r.onerror=()=>reject(r.error)})})()`);
    const actual=await evaluate(`(async()=>{
      const draft=()=>harness.saveDraft('mode-only',{closureForm:{iptvInstallationMode:'smart_tv_app'},closurePhotos:{facade:new File(['PHOTO'],'p.txt')},equipmentEntries:[]});
      const queue=()=>harness.enqueueClosure({jobType:'installation',jobId:'first',photos:[],equipmentPhotos:[]});
      ${first==='draft'?'await draft();await queue()':'await queue();await draft()'};
      return {mode:(await harness.loadDraft('mode-only')).closureForm.iptvInstallationMode,count:(await harness.listQueuedClosures()).length};
    })()`);
    assert.deepEqual(actual,{mode:'smart_tv_app',count:1});passed++;
    await reload();
    assert.equal(await evaluate('(async()=>{return (await harness.loadDraft("mode-only")).closurePhotos.facade.size})()'),5);passed++;
  }
  // Esquemas anteriores de un solo store: upgrade aditivo con conexión vieja
  // retenida. onblocked debe fallar sin borrar; cerrar la vista permite reintento.
  for(const existing of ['drafts','closures']) {
    await reload();
    await evaluate(`(async()=>{await harness.closeCampoDatabase();await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('smartrayco-campo');r.onsuccess=resolve;r.onerror=()=>reject(r.error)});
      window.legacyConnection=await new Promise((resolve,reject)=>{const r=indexedDB.open('smartrayco-campo',1);r.onupgradeneeded=()=>{r.result.createObjectStore('${existing}');r.result.createObjectStore('untouched-extra')};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
      await new Promise((resolve,reject)=>{const t=legacyConnection.transaction(['${existing}','untouched-extra'],'readwrite');t.objectStore('${existing}').put({data:{note:'LEGACY',photo:new Blob(['legacy-photo'])},savedAt:1},'legacy');t.objectStore('untouched-extra').put('KEEP','x');t.oncomplete=resolve;t.onerror=()=>reject(t.error)});
    })()`);
    const blocked=await evaluate('(async()=>{try{await harness.listQueuedClosures();return "unexpected"}catch(e){return e.message}})()');
    assert.match(blocked,/Otra vista/);passed++;
    await evaluate('legacyConnection.close()');
    const kept=await evaluate(`(async()=>{await harness.saveDraft('new',{closureForm:{iptvInstallationMode:'customer_device'}});const store=harness.legacyCreateStore('smartrayco-campo','${existing}');const legacy=await harness.legacyGet('legacy',store);const extra=await harness.legacyGet('x',harness.legacyCreateStore('smartrayco-campo','untouched-extra'));return {note:legacy.data.note,photo:legacy.data.photo.size,extra,mode:(await harness.loadDraft('new')).closureForm.iptvInstallationMode}})()`);
    assert.deepEqual(kept,{note:'LEGACY',photo:12,extra:'KEEP',mode:'customer_device'});passed++;
    // Cambiar de documento cierra también los handles de idb-keyval antiguo.
    await reload();
  }
  // Fixture limpio únicamente en perfil efímero. En la aplicación no existe
  // deleteDatabase ni borrado masivo: todos los pendientes se conservan.
  await evaluate(`(async()=>{await harness.closeCampoDatabase();await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('smartrayco-campo');r.onsuccess=resolve;r.onerror=()=>reject(r.error)})})()`);
  const seeded=await evaluate(`(async()=>{
    const photo=new File(['legacy-photo'],'p.jpg',{type:'image/jpeg'});
    const base={jobType:'installation',jobId:'needs-mode',clientId:'c',contractId:'k',photos:[{category:'facade',blob:photo,fileName:photo.name}],equipmentPhotos:[],closureNotes:'KEEP-NOTES'};
    const a=await harness.enqueueClosure(base);await new Promise(r=>setTimeout(r,20));
    const b=await harness.enqueueClosure({...base,closureNotes:'SECOND-INTENT'});await new Promise(r=>setTimeout(r,20));
    const c=await harness.enqueueClosure({...base,jobId:'independent',iptvInstallationMode:'customer_device'});
    await harness.saveDraft('preserved',{closureForm:{iptvInstallationMode:'smart_tv_app'},closurePhotos:{facade:photo}});
    return {a:a.localId,b:b.localId,c:c.localId};
  })()`);
  await reload();
  const result=await evaluate(`(async()=>{const visited=[];const result=await harness.flushQueue(async i=>{visited.push(i.jobId);if(!i.iptvInstallationMode)throw new Error('Selecciona modalidad IPTV')});const q=await harness.listQueuedClosures();return {result,visited,notes:q.map(i=>i.closureNotes),bytes:await q[0].photos[0].blob.text()}})()`);
  assert.deepEqual(result.result,{synced:1,remaining:2});assert.deepEqual(result.visited,['needs-mode','independent']);assert.deepEqual(result.notes,['KEEP-NOTES','SECOND-INTENT']);assert.equal(result.bytes,'legacy-photo');passed++;
  // Solo una elección humana modifica la modalidad; no sustituye fotos/notas.
  await evaluate(`harness.setQueuedIptvMode(${JSON.stringify(seeded.a)},'smart_tv_app')`);
  const recovery=await evaluate(`(async()=>{const q=await harness.listQueuedClosures();return {mode:q[0].iptvInstallationMode,notes:q[0].closureNotes,bytes:await q[0].photos[0].blob.text(),same:q[0].localId===${JSON.stringify(seeded.a)}}})()`);
  assert.deepEqual(recovery,{mode:'smart_tv_app',notes:'KEEP-NOTES',bytes:'legacy-photo',same:true});passed++;
  const recovered=await evaluate(`(async()=>{const r=await harness.flushQueue(async i=>{if(!i.iptvInstallationMode)throw new Error('Revisar intención distinta')});return {r,q:(await harness.listQueuedClosures()).map(i=>i.localId)}})()`);
  assert.deepEqual(recovered.r,{synced:1,remaining:1});assert.deepEqual(recovered.q,[seeded.b]);passed++;
  // Hash compara bytes y sobrevive a la serialización File -> Blob de la cola.
  const hashing=await evaluate(`(async()=>{const f=new File(['AAA'],'p.jpg');const a={jobType:'installation',jobId:'x',photos:[{category:'facade',file:f}]};const b={...a,photos:[{category:'facade',blob:new Blob(['AAA']),fileName:'p.jpg'}]};const c={...a,photos:[{category:'facade',file:new File(['BBB'],'p.jpg')}]};return {equal:await harness.closurePayloadHash(a)===await harness.closurePayloadHash(b),different:await harness.closurePayloadHash(a)!==await harness.closurePayloadHash(c)}})()`);
  assert.deepEqual(hashing,{equal:true,different:true});passed++;
  // Error global de red: conserva todos los elementos todavía no confirmados.
  const network=await evaluate(`(async()=>{let count=0;const r=await harness.flushQueue(async()=>{count++;throw new TypeError('Failed to fetch')});return {r,count}})()`);
  assert.equal(network.r.synced,0);assert.equal(network.r.remaining,1);assert.equal(network.count,1);passed++;
  // Dos pestañas no transmiten dos veces el mismo lote. El primer elemento
  // retenido se usa ahora como envío sintético confirmado.
  const other=await anotherPage();
  try {
    const one=evaluate('(async()=>{window.sent=[];return harness.flushQueue(async i=>{sent.push(i.localId);await new Promise(r=>setTimeout(r,250))})})()');
    const two=other.evaluate('(async()=>{window.sent=[];return harness.flushQueue(async i=>{sent.push(i.localId)})})()');
    const outcomes=await Promise.all([one,two]);
    const sent=[...await evaluate('window.sent'),...await other.evaluate('window.sent')];
    assert.equal(outcomes[0].synced+outcomes[1].synced,1);assert.deepEqual(sent,[seeded.b]);passed++;
  } finally { await other.close(); }
  // Una confirmación no borra un borrador guardado después de empezar el envío.
  const newer=await evaluate(`(async()=>{const before=Date.now()-1;await harness.saveDraft('newer',{note:'DO-NOT-DELETE'});await harness.clearDraft('newer',before);return (await harness.loadDraft('newer')).note})()`);
  assert.equal(newer,'DO-NOT-DELETE');passed++;
  // Un 42501 por asignación es local a su orden; conserva mensaje PostgREST
  // plano y deja pasar otra orden del mismo técnico. Otra cuenta no se envía.
  const permission=await evaluate(`(async()=>{
    await harness.enqueueClosure({jobType:'installation',jobId:'forbidden',actorId:'technician',photos:[],equipmentPhotos:[]});
    await harness.enqueueClosure({jobType:'installation',jobId:'other-owner',actorId:'another',photos:[],equipmentPhotos:[]});
    await harness.enqueueClosure({jobType:'installation',jobId:'allowed',actorId:'technician',photos:[],equipmentPhotos:[]});
    const visited=[];const r=await harness.flushQueue(async i=>{visited.push(i.jobId);if(i.jobId==='forbidden')throw {code:'42501',status:403,message:'Asignación no vigente; revisar modalidad IPTV'}},'technician');
    return {r,visited,pending:(await harness.listQueuedClosures()).map(i=>({job:i.jobId,error:i.lastError??null}))};
  })()`);
  assert.deepEqual(permission,{r:{synced:1,remaining:2},visited:['forbidden','allowed'],pending:[{job:'forbidden',error:'Asignación no vigente; revisar modalidad IPTV'},{job:'other-owner',error:null}]});passed++;
  return passed;
}
