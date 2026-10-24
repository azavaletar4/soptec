// Ejecuta las funciones reales de la vista/store sin cargar módulos ni red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function functions(source,names){
 const tree=ts.createSourceFile('isolated.ts',source,ts.ScriptTarget.Latest,true);const found=new Map();
 function visit(node){if(ts.isFunctionDeclaration(node)&&node.name&&names.includes(node.name.text))found.set(node.name.text,node.getText(tree));ts.forEachChild(node,visit);}visit(tree);
 for(const name of names)assert.ok(found.has(name),'Función real ausente: '+name);
 return ts.transpileModule([...found.values()].join('\n')+'\nexports.api={'+names.join(',')+'};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
}
const view=readFileSync(new URL('../../src/views/clientes/ClientServiceDetailView.vue',import.meta.url),'utf8');
const script=view.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
function harness({confirm=true,admin=true,error=null,refreshError=false}={}){
 const calls=[];
 const context={exports:{},contract:{value:{id:'a',status:'active',updated_at:'2026-01-01',client_id:'client'}},contractForm:{value:{status:'cancelled'}},
  inventoryAdmin:{value:admin},savingContract:{value:false},contractError:{value:null},
  fibra:{napPuertosPorElemento:{nap:[{contract_id:'a',service_contracts:{status:'active'}},{contract_id:'b',service_contracts:{status:'active'}}]}},
  confirm(message){calls.push(['confirm',message]);return confirm;},
  getErrorMessage(e){return e.message;},
  emit(name,saved){assert.equal(name,'commercialCancelled');assert.equal(saved.status,'cancelled');},
  fillFormFromContract(c){context.contractForm.value.status=c.status;},
  clientsStore:{async fetchClients(){calls.push(['refresh']);if(refreshError)throw new Error('refresh failed');}},
  contractsStore:{async cancelContractAdministrative(id,stamp){calls.push(['cancel',id,stamp]);if(error)throw new Error(error);return {id,status:'cancelled',updated_at:'2026-01-02'};},
   async updateContract(){throw new Error('Baja no debe usar guardado genérico');}},
  async syncMikrotikProfile(){throw new Error('Red prohibida');},async syncXuiLineStatus(){throw new Error('Red prohibida');},async syncNap(){throw new Error('NAP no debe desasignarse');},
 };
 vm.runInNewContext(functions(script,['handleAdministrativeCancellation','handleContractStatusSelection','handleSaveContract']),context);
 return {...context,calls,api:context.exports.api};
}
test('confirmación cancelada no escribe ni cambia contrato o NAP',async()=>{
 const h=harness({confirm:false});await h.api.handleSaveContract();
 assert.deepEqual(h.calls,[['confirm','Este contrato pasará a Cancelado y liberará su ocupación en la NAP. ¿Confirmar?']]);
 assert.equal(h.contract.value.status,'active');assert.equal(h.contractForm.value.status,'active');assert.equal(h.fibra.napPuertosPorElemento.nap[0].service_contracts.status,'active');
});
test('baja usa sólo RPC administrativa, actualiza caché seleccionada y omite todas las sincronizaciones',async()=>{
 const h=harness();await h.api.handleSaveContract();
 assert.equal(h.contract.value.status,'cancelled');assert.equal(h.contractForm.value.status,'cancelled');
 assert.deepEqual(h.calls.map(c=>c[0]),['confirm','cancel','refresh']);assert.deepEqual(h.calls[1],['cancel','a','2026-01-01']);
 assert.equal(h.fibra.napPuertosPorElemento.nap[0].service_contracts.status,'cancelled');assert.equal(h.fibra.napPuertosPorElemento.nap[1].service_contracts.status,'active');
});
test('sin permisos no confirma ni escribe; una operación en curso no se duplica',async()=>{
 const h=harness({admin:false});await h.api.handleSaveContract();assert.equal(h.calls.length,0);assert.match(h.contractError.value,/ADMIN/);
 const busy=harness();busy.savingContract.value=true;await busy.api.handleSaveContract();assert.equal(busy.calls.length,0);
});
test('fallo RPC conserva contrato y NAP; fallo de refresco no presenta como fallida una baja confirmada',async()=>{
 const failed=harness({error:'RPC no habilitada'});await failed.api.handleSaveContract();assert.equal(failed.contract.value.status,'active');assert.equal(failed.fibra.napPuertosPorElemento.nap[0].service_contracts.status,'active');
 const refreshed=harness({refreshError:true});await refreshed.api.handleSaveContract();assert.equal(refreshed.contract.value.status,'cancelled');assert.match(refreshed.contractError.value,/Baja confirmada/);
});
test('store real: RPC ausente falla cerrada, sin UPDATE alternativo ni reintento',async()=>{
 const source=readFileSync(new URL('../../src/stores/contracts.ts',import.meta.url),'utf8'),calls=[];
 const context={exports:{},contracts:{value:[]},supabase:{async rpc(name,args){calls.push({name,args});return {error:{code:'PGRST202'}};},from(){throw new Error('Fallback prohibido');}}};
 vm.runInNewContext(functions(source,['cancelContractAdministrative']),context);
 await assert.rejects(context.exports.api.cancelContractAdministrative('a','stamp'),/no está habilitada/);
 assert.equal(calls.length,1);assert.equal(calls[0].name,'contract_cancel_administrative');
});
