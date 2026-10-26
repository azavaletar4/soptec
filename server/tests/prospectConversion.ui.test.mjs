import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { computed, ref } from 'vue';

const source=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const script=source('../../src/views/clientes/ClientesView.vue').split('<script setup lang="ts">')[1].split('</script>')[0];
function namedFunction(text,name,context){
 const ast=ts.createSourceFile('source.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let node;
 function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)node=n;ts.forEachChild(n,visit);}visit(ast);
 assert.ok(node,'Function missing: '+name);
 const js=ts.transpileModule(node.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 return runInNewContext(js+'\n'+name,context);
}
function fixture(){
 const calls=[];const state={saving:ref(false),duplicateClient:ref(null),editing:ref(null),convertingProspectId:ref('prospect-fixture'),convertingProspectName:ref('Prospect'),convertingZoneId:ref('zone'),convertingPlanId:ref('plan'),showModal:ref(true),formError:ref(null),referenteId:ref(''),pendingPppoeHint:ref(null),form:ref({document_type:'cedula',document_number:'synthetic-doc',first_name:'Ficticio',last_name:'Prueba',phone:'',phone_2:'',email:'',address:'',status:'prospect'})};
 const receipt={prospect_id:'prospect-fixture',client_id:'client-fixture',contract_id:'contract-fixture',installation_id:'installation-fixture',initial_points:0,replayed:false};
 const context={...state,clientsStore:{clients:[],createClient:async p=>{calls.push(['createClient',p]);return {id:'direct-client'};},updateClient:async(id,p)=>{calls.push(['updateClient',id,p]);return {id};}},prospectsStore:{convertToClient:async(...args)=>{calls.push(['atomic',...args]);return receipt;}},referidosStore:{create:async(...args)=>calls.push(['referral',...args])},toast:{success:m=>calls.push(['success',m]),error:m=>calls.push(['error',m])},router:{push:p=>calls.push(['route',p])},confirmDialog:async()=>true,getErrorMessage:(e,f)=>e?.message||f,alert:m=>calls.push(['alert',m])};
 return {state,calls,receipt,context,submit:namedFunction(script,'handleSubmit',context)};
}

test('Conversión usa una sola RPC y navega con el recibo, sin escrituras frontend de cliente/contrato/Alta',async()=>{
 const f=fixture();f.state.referenteId.value='referrer';await f.submit();
 assert.equal(f.calls.filter(c=>c[0]==='atomic').length,1);assert.ok(!f.calls.some(c=>['createClient','updateClient','referral'].includes(c[0])));
 assert.equal(f.calls.find(c=>c[0]==='atomic')[3],'referrer');assert.equal(f.calls.find(c=>c[0]==='route')[1],'/clientes/client-fixture');assert.equal(f.state.convertingProspectId.value,null);assert.equal(f.state.saving.value,false);
});
test('Respuesta perdida: mantiene el Prospecto y reintenta aunque aparezca la ficha duplicada del primer commit',async()=>{
 const f=fixture();let failed=true;f.context.prospectsStore.convertToClient=async(...args)=>{f.calls.push(['atomic',...args]);if(failed)throw Error('Network response lost');return {...f.receipt,replayed:true};};
 await f.submit();assert.equal(f.state.convertingProspectId.value,'prospect-fixture');assert.equal(f.state.saving.value,false);assert.equal(f.state.formError.value,'Network response lost');
 failed=false;f.state.duplicateClient.value={id:'client-fixture',first_name:'Ficticio',last_name:'Prueba'};await f.submit();assert.equal(f.calls.filter(c=>c[0]==='atomic').length,2);assert.ok(f.calls.some(c=>c[0]==='success'&&c[1].includes('misma ficha')));assert.ok(!f.calls.some(c=>c[0]==='createClient'));
});
test('Doble envío mientras espera: una sola llamada atómica',async()=>{
 const f=fixture();let finish;f.context.prospectsStore.convertToClient=async()=>{f.calls.push(['atomic']);return new Promise(r=>{finish=r;});};const first=f.submit();await f.submit();assert.equal(f.calls.filter(c=>c[0]==='atomic').length,1);finish(f.receipt);await first;
});
test('Alta y edición de cliente que no convierten Prospecto conservan su ruta anterior',async()=>{
 const direct=fixture();direct.state.convertingProspectId.value=null;direct.state.referenteId.value='referrer';await direct.submit();assert.equal(direct.calls.filter(c=>c[0]==='createClient').length,1);assert.equal(direct.calls.filter(c=>c[0]==='referral').length,1);assert.ok(!direct.calls.some(c=>c[0]==='atomic'));
 const edit=fixture();edit.state.convertingProspectId.value=null;edit.state.editing.value={id:'existing-client'};await edit.submit();assert.equal(edit.calls.filter(c=>c[0]==='updateClient').length,1);assert.ok(!edit.calls.some(c=>['createClient','atomic'].includes(c[0])));
});
test('Store envía solo el Prospecto, datos de ficha y referente; exige recibo completo y no convierte ante error',async()=>{
 const prospects=ref([{id:'prospect-fixture',estado:'por_contactar',converted_client_id:null}]);let response={data:{prospect_id:'prospect-fixture',client_id:'c',contract_id:'k',installation_id:'i',initial_points:0,replayed:false},error:null};const calls=[];
 const context={prospects,supabase:{rpc:async(name,args)=>{calls.push([name,args]);return response;}}};const convert=namedFunction(source('../../src/stores/prospects.ts'),'convertToClient',context);
 await convert('prospect-fixture',{document_number:'synthetic-doc'},null);assert.equal(calls[0][0],'convert_prospect_with_installation');assert.equal(Object.keys(calls[0][1]).sort().join(','),'p_client,p_prospect_id,p_referrer_id');assert.equal(prospects.value[0].estado,'convertido');
 prospects.value[0].estado='por_contactar';response={data:null,error:{message:'transaction failed'}};await assert.rejects(convert('prospect-fixture',{},null));assert.equal(prospects.value[0].estado,'por_contactar');
 response={data:{...response.data,client_id:'only-client'},error:null};await assert.rejects(convert('prospect-fixture',{},null),/recibo de conversión/);
});
test('Editor solo desbloquea el cero de origen comprobado para ADMIN/SUPERADMIN; histórico directo sigue protegido',()=>{
 const editor=source('../../src/components/soporte/WorkOrderPointsEditor.vue');const expression=editor.match(/const allowed = (computed\([\s\S]*?\));/)[1];
 for(const role of ['ADMIN','SUPERADMIN','SOPORTE','TECNICO_RED'])for(const provenance of [true,false,undefined]){
  const context={computed,isAdmin:ref(['ADMIN','SUPERADMIN'].includes(role)),reviewLoading:ref(false),review:ref({historical:true,prospectPointsPending:provenance,confirmation:null,status:'completed',finished:true}),pointsAreEditable:()=>false};
  const allowed=runInNewContext(expression,context);assert.equal(allowed.value,['ADMIN','SUPERADMIN'].includes(role)&&provenance===true);
 }
});
