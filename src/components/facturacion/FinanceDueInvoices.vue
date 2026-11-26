<script setup lang="ts">
import {computed,ref} from 'vue';import {supabase} from '@/lib/supabase';import {formatPen} from '@/lib/financeMoney';
defineProps<{zones:{id:string;name:string}[]}>();const emit=defineEmits<{changed:[]}>();
type Period={periodStart:string;periodEnd:string;issueDate:string;dueDate:string;graceEndDate:string|null;amount:string;eligibleForSuspension:boolean};
type Row={contractId:string;contractNumber:string;clientCode:string;customer:string;eligible:boolean;warnings:string[];periods:Period[]};
async function rpc<T>(name:string,args:Record<string,unknown>={}){const r=await supabase.rpc(name,args);if(r.error)throw Error(r.error.message);return r.data as T;}
const zone=ref(''),search=ref(''),results=ref<{id:string;contract_number:string;client_code:string;customer:string}[]>([]),picked=ref<{id:string;contract_number:string;customer:string}[]>([]);
const rows=ref<Row[]>([]),selected=ref<Set<string>>(new Set()),busy=ref(false),error=ref(''),notice=ref('');
const batchId=ref(''),reason=ref(''),reviewOpen=ref(false),outcome=ref<Record<string,unknown>|null>(null),reviewedSnapshot=ref('');
async function searchContracts(){if(!search.value.trim())return;error.value='';try{const data=await rpc<{id:string;contract_number:string;client_code:string;customer:string}[]>('finance_search_contracts',{p_search:search.value});results.value=data??[];}catch(e){error.value=String(e);}}
function pick(c:{id:string;contract_number:string;client_code:string;customer:string}){if(!picked.value.some(p=>p.id===c.id))picked.value.push({id:c.id,contract_number:c.contract_number,customer:c.customer});}
function unpick(id:string){picked.value=picked.value.filter(p=>p.id!==id);}
async function loadPreview(){busy.value=true;error.value='';outcome.value=null;try{
 if(!zone.value&&!picked.value.length)throw Error('Selecciona una PON o al menos un contrato.');
 const args=zone.value?{p_zone:zone.value,p_contract_ids:null}:{p_zone:null,p_contract_ids:picked.value.map(p=>p.id)};
 rows.value=(await rpc<{rows:Row[]}>('finance_due_invoice_preview',args)).rows;
 selected.value=new Set();batchId.value='';reviewOpen.value=false;
 notice.value=`${rows.value.length} contratos revisados. Ningún dato se escribió todavía.`;
}catch(e){error.value=String(e);}finally{busy.value=false;}}
function toggle(contractId:string){const s=new Set(selected.value);if(s.has(contractId))s.delete(contractId);else s.add(contractId);selected.value=s;}
const eligibleWithPending=computed(()=>rows.value.filter(r=>r.eligible&&r.periods.length>0));
const toGenerate=computed(()=>eligibleWithPending.value.filter(r=>selected.value.has(r.contractId)));
function review(){error.value='';try{if(reason.value.trim().length<10)throw Error('Motivo requerido (mínimo 10 caracteres).');if(!toGenerate.value.length)throw Error('Selecciona al menos un contrato con períodos pendientes.');batchId.value=crypto.randomUUID();reviewedSnapshot.value=JSON.stringify([toGenerate.value.map(r=>r.contractId),reason.value]);reviewOpen.value=true;}catch(e){error.value=String(e);}}
async function commit(){if(busy.value||!reviewOpen.value)return;busy.value=true;error.value='';try{
 if(reviewedSnapshot.value!==JSON.stringify([toGenerate.value.map(r=>r.contractId),reason.value])){reviewOpen.value=false;throw Error('La selección cambió. Vuelve a revisar.');}
 const result=await rpc<Record<string,unknown>>('finance_generate_due_invoices',{p_operation_id:batchId.value,p_contract_ids:toGenerate.value.map(r=>r.contractId),p_reason:reason.value});
 outcome.value=result;reviewOpen.value=false;notice.value='Mensualidades generadas. Ningún pago se registró — el ingreso real depende de que el cliente pague.';emit('changed');
}catch(e){error.value=String(e);}finally{busy.value=false;}}
</script>
<template><article class="finance-panel"><h3>Próximas mensualidades</h3>
 <p class="finance-help">Consulta qué períodos corresponde facturar (contratos ya conciliados, con condiciones comerciales confirmadas) antes de que lleguen sin factura disponible para cobrar. Nunca factura un período que todavía no empezó; nunca cortesías ni contratos sin configurar.</p>
 <p v-if="error" role="alert" class="finance-error">{{error}}</p><p v-if="notice" role="status" class="finance-notice">{{notice}}</p>
 <div class="finance-filters"><label>PON<select v-model="zone" aria-label="PON para mensualidades"><option value="">Seleccionar</option><option v-for="z in zones" :key="z.id" :value="z.id">{{z.name}}</option></select></label>
 <label>o buscar contrato exacto<input v-model="search" @keyup.enter="searchContracts"></label><button class="btn-ghost" :disabled="busy" @click="searchContracts">Buscar</button>
 <button class="btn-secondary" :disabled="busy" @click="loadPreview">Cargar próximas mensualidades</button></div>
 <div v-if="results.length" class="reconcile-promo"><label v-for="c in results" :key="c.id"><button class="btn-ghost" @click="pick(c)">+ {{c.contract_number}} · {{c.client_code}} · {{c.customer}}</button></label></div>
 <p v-if="picked.length">Seleccionados: <span v-for="p in picked" :key="p.id">{{p.contract_number}} ({{p.customer}}) <button class="btn-ghost" @click="unpick(p.id)">quitar</button> </span></p>
 <div v-if="rows.length" class="reconcile-rows"><details v-for="r in rows" :key="r.contractId" class="reconcile-row" :open="r.eligible&&r.periods.length>0"><summary class="reconcile-row-head"><b>{{r.contractNumber}} · {{r.clientCode}}</b><span>{{r.customer}}</span><span>{{r.periods.length}} período(s) pendiente(s)</span></summary>
 <p v-if="r.warnings.length" class="reconcile-hint">{{r.warnings.join(' · ')}}</p>
 <template v-if="r.eligible&&r.periods.length"><label class="reconcile-attest"><input type="checkbox" :checked="selected.has(r.contractId)" @change="toggle(r.contractId)">Incluir en la generación</label>
 <table class="finance-table"><thead><tr><th>Período</th><th>Emisión</th><th>Vencimiento</th><th>Fin de prórroga</th><th>Monto</th><th>Elegible para corte</th></tr></thead><tbody>
 <tr v-for="(p,n) in r.periods" :key="n"><td>{{p.periodStart}} – {{p.periodEnd}}</td><td>{{p.issueDate}}</td><td>{{p.dueDate}}</td><td>{{p.graceEndDate||'Sin prórroga'}}</td><td>{{formatPen(p.amount)}}</td><td>{{p.eligibleForSuspension?'Sí':'No'}}</td></tr>
 </tbody></table></template>
 <p v-else-if="r.eligible" class="finance-help">Al día: ningún período pendiente.</p></details></div>
 <div v-if="eligibleWithPending.length" class="finance-filters"><label>Motivo del lote<input v-model="reason" maxlength="500" minlength="10"></label>
 <button class="btn-primary" :disabled="busy||!toGenerate.length" @click="review">Revisar generación ({{toGenerate.length}} contratos)</button></div>
 <div v-if="reviewOpen" class="reconcile-final"><h3>Confirmación humana · {{toGenerate.length}} contratos</h3><p>Se crearán facturas reales (sin pagos ni recibos). El ingreso real sigue dependiendo de que el cliente pague.</p><button class="btn-secondary" :disabled="busy" @click="reviewOpen=false">Volver a revisión</button><button class="btn-primary" :disabled="busy" @click="commit">Confirmar generación</button></div>
 <div v-if="outcome" class="reconcile-result"><h3>Resultado</h3><pre>{{JSON.stringify(outcome,null,2)}}</pre></div>
</article></template>
