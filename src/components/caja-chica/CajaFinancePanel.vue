<script setup lang="ts">
import {ref,computed,onMounted} from 'vue';import {useCajaChicaStore} from '@/stores/cajaChica';import {useCatalogsStore} from '@/stores/catalogs';import {formatPen,limaDate,penCents,penDecimal} from '@/lib/financeMoney';import {cashMethodLabel} from '@/lib/financeCash';
const store=useCajaChicaStore(),catalogs=useCatalogsStore(),day=ref(limaDate()),busy=ref(false),error=ref(''),notice=ref(''),available=ref(true),counted=ref(''),closeReason=ref(''),withdraw=ref(''),withdrawReason=ref(''),reopenReason=ref('');
const closeId=ref(crypto.randomUUID()),withdrawId=ref(crypto.randomUUID()),reopenId=ref(crypto.randomUUID());
const activeClosure=computed(()=>store.daily?.closures.find(c=>!c.reopened_at)),canWithdraw=computed(()=>day.value===limaDate()&&!activeClosure.value);
const difference=computed(()=>{try{return formatPen(penDecimal(penCents(counted.value)-penCents(String(store.daily?.closingCash??0))));}catch{return '—';}});
const money=(n:unknown)=>formatPen(String(n??0));
function actorName(id:string|null|undefined){if(!id)return '—';const p=catalogs.staff.find(s=>s.id===id);return p?(p.full_name||p.email):'—';}
async function load(){busy.value=true;error.value='';try{await store.fetchDaily(day.value);available.value=true;}catch{available.value=false;store.daily=null;}finally{busy.value=false;}}
// Fase 30: confirmación previa obligatoria para cierre/retiro/reapertura —
// antes se ejecutaban directo al enviar el formulario.
const pendingAction=ref<'close'|'withdraw'|'reopen'|null>(null);
function askConfirm(kind:'close'|'withdraw'|'reopen'){pendingAction.value=kind;}
function cancelConfirm(){pendingAction.value=null;}
async function action(kind:'close'|'withdraw'|'reopen'){busy.value=true;error.value='';notice.value='';try{
 if(kind==='close'){await store.closeDay(closeId.value,day.value,penDecimal(penCents(counted.value)),closeReason.value.trim());closeId.value=crypto.randomUUID();notice.value='Cierre guardado con el efectivo contado y su diferencia.';}
 if(kind==='withdraw'){await store.ownerWithdraw(withdrawId.value,penDecimal(penCents(withdraw.value)),withdrawReason.value.trim());withdrawId.value=crypto.randomUUID();withdraw.value='';withdrawReason.value='';notice.value='Retiro del propietario registrado por separado.';}
 if(kind==='reopen'&&activeClosure.value){await store.reopenDay(reopenId.value,activeClosure.value.id,reopenReason.value.trim());reopenId.value=crypto.randomUUID();reopenReason.value='';notice.value='Caja reabierta; el cierre anterior queda en el historial.';}
 await store.fetchDaily(day.value);
 }catch(e){error.value=e instanceof Error?e.message:String((e as {message?:string})?.message??'No se pudo registrar la operación.');}finally{busy.value=false;pendingAction.value=null;}}
onMounted(()=>{load();catalogs.fetchStaff().catch(()=>{});});
</script>
<template><section class="surface p-5 mb-6 caja-finance" aria-labelledby="cash-finance-title">
<div class="cash-heading">
 <h2 id="cash-finance-title" class="text-lg font-semibold">Cobranzas y cierre de efectivo</h2>
 <span v-if="available && store.daily?.enabled" class="badge" :class="activeClosure ? 'bg-slate-700/15 text-slate-700' : 'bg-green-500/15 text-green-700'">{{ activeClosure ? 'Caja cerrada' : 'Caja abierta' }}</span>
 <label>Día en Perú<input v-model="day" type="date" :max="limaDate()" class="field-input" @change="load"></label>
 <button class="btn-secondary" :disabled="busy" @click="load">Actualizar conciliación</button>
</div>
<p v-if="!available||!store.daily?.enabled" class="text-sm text-slate-600">La conexión de cobranzas con caja está pendiente de habilitación.</p>
<template v-else>
<div class="cash-metrics">
 <div><span class="cash-metric-label">Saldo inicial</span><b>{{money(store.daily.openingCash)}}</b></div>
 <div><span class="cash-metric-label">Efectivo de cobranzas</span><b>{{money(store.daily.linkedCashCollections)}}</b></div>
 <div><span class="cash-metric-label">Gastos operativos</span><b>{{money(store.daily.operatingExpenses)}}</b></div>
 <div><span class="cash-metric-label">Retiros del propietario</span><b>{{money(store.daily.ownerWithdrawals)}}</b></div>
 <div><span class="cash-metric-label">Efectivo esperado</span><b>{{money(store.daily.closingCash)}}</b></div>
</div>
<p :class="Number(store.daily.unmatchedCash)===0?'text-green-700':'text-red-600'">{{Number(store.daily.unmatchedCash)===0?'Cobranzas de efectivo registradas en el libro: conciliadas con las facturas pagadas en efectivo.':'Diferencia entre las cobranzas registradas y los movimientos de caja: '+money(store.daily.unmatchedCash)}}</p>
<p class="cash-disclaimer">Esto NO es el conteo físico del dinero — esa confirmación es el arqueo de abajo ("Cierre diario de efectivo"); la caja física solo queda conciliada cuando se guarda ese cierre.</p>
<div class="cash-columns">
 <div class="surface p-4"><h3>Medios de pago</h3><p v-for="m in store.daily.methods??[]" :key="m.method">{{cashMethodLabel(m.method)}}: <b>{{money(m.net)}}</b><small v-if="m.method!=='cash'"> · separado del efectivo</small></p></div>
 <div class="surface p-4"><h3>Administradoras responsables</h3><p v-for="c in store.daily.collectors??[]" :key="c.id+c.method">{{c.name}} · {{cashMethodLabel(c.method)}} · {{money(c.received)}}</p></div>
</div>
<div class="cash-columns">
 <div class="surface p-4">
  <form v-if="!activeClosure" @submit.prevent="askConfirm('close')"><h3>Arqueo del día (cierre físico de efectivo)</h3><label>Efectivo contado<input v-model="counted" inputmode="decimal" class="field-input" placeholder="0.00"></label><p>Diferencia: {{difference}}</p><label>Observación del arqueo<input v-model="closeReason" class="field-input" maxlength="500"></label><button class="btn-primary" :disabled="busy||!counted||closeReason.trim().length<5||Number(store.daily.unmatchedCash)!==0">Revisar cierre de efectivo</button></form>
  <div v-else><h3>Arqueo del día — caja cerrada</h3><div class="cash-metrics"><div><span class="cash-metric-label">Contado</span><b>{{money(activeClosure.counted_cash)}}</b></div><div><span class="cash-metric-label">Esperado</span><b>{{money(activeClosure.expected_cash)}}</b></div><div><span class="cash-metric-label">Diferencia</span><b>{{money(activeClosure.difference)}}</b></div></div><p class="text-xs text-slate-500">Cerrada por {{actorName(activeClosure.actor_id)}}</p><label>Motivo de reapertura<input v-model="reopenReason" class="field-input" maxlength="500"></label><button class="btn-secondary" :disabled="busy||reopenReason.trim().length<5" @click="askConfirm('reopen')">Revisar reapertura con auditoría</button></div>
 </div>
 <div class="surface p-4">
  <form @submit.prevent="askConfirm('withdraw')"><h3>Retiro del propietario</h3><p class="text-sm">Se registra como salida de efectivo separada de los gastos operativos.</p><label>Importe<input v-model="withdraw" inputmode="decimal" class="field-input" placeholder="0.00" :disabled="!canWithdraw"></label><label>Motivo<input v-model="withdrawReason" class="field-input" maxlength="500" :disabled="!canWithdraw"></label><button class="btn-secondary" :disabled="busy||!canWithdraw||!withdraw||withdrawReason.trim().length<5">Revisar retiro del propietario</button></form>
  <p v-if="!canWithdraw" class="text-xs text-slate-400 mt-2">{{ activeClosure ? 'La caja está cerrada — reábrela con auditoría para registrar un retiro.' : 'Solo se puede retirar en el día de hoy.' }}</p>
 </div>
</div>
<details v-if="store.daily.closures.length"><summary>Historial de cierres</summary><p v-for="c in store.daily.closures" :key="c.id">{{new Date(c.created_at).toLocaleString('es-PE',{timeZone:'America/Lima'})}} · {{money(c.counted_cash)}} · {{c.reopened_at?'Reabierto':'Cerrado'}} · {{actorName(c.actor_id)}} · {{c.reason}}</p></details>
</template>
<p v-if="error" class="text-red-600" role="alert">{{error}}</p><p v-if="notice" class="text-green-700" role="status">{{notice}}</p>
<Teleport to="body"><div v-if="pendingAction" class="modal-overlay"><div class="modal-panel w-full max-w-sm">
 <template v-if="pendingAction==='close'"><h3 class="text-sm font-semibold mb-3">Confirmar cierre de efectivo</h3><p class="text-sm mb-1">Efectivo contado: <b>{{money(penDecimal(penCents(counted)))}}</b></p><p class="text-sm mb-1">Efectivo esperado: <b>{{money(store.daily?.closingCash)}}</b></p><p class="text-sm mb-3">Diferencia: <b>{{difference}}</b></p><p class="text-xs text-slate-500 mb-4">Esto registra el conteo físico real de la caja — no se puede deshacer, solo reabrir con auditoría.</p></template>
 <template v-else-if="pendingAction==='withdraw'"><h3 class="text-sm font-semibold mb-3">Confirmar retiro del propietario</h3><p class="text-sm mb-1">Importe: <b>{{money(withdraw)}}</b></p><p class="text-sm mb-3">Motivo: {{withdrawReason}}</p></template>
 <template v-else><h3 class="text-sm font-semibold mb-3">Confirmar reapertura de caja</h3><p class="text-sm mb-3">Motivo: {{reopenReason}}</p><p class="text-xs text-slate-500 mb-4">El cierre anterior queda intacto en el historial, marcado como reabierto.</p></template>
 <p v-if="error" class="text-xs text-red-600 mb-2">{{error}}</p>
 <div class="flex justify-end gap-2"><button type="button" class="btn-ghost" :disabled="busy" @click="cancelConfirm">Cancelar</button><button type="button" class="btn-primary" :disabled="busy" @click="action(pendingAction)">{{busy?'Guardando…':'Confirmar'}}</button></div>
</div></div></Teleport>
</section></template>
<style scoped>.cash-heading{display:flex;align-items:center;gap:1rem;flex-wrap:wrap}.cash-heading h2{margin-right:auto}.cash-heading label{display:flex;align-items:center;gap:.5rem;font-size:.8rem;color:#64748b}.cash-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.75rem;margin:1rem 0}.cash-metrics>div{background:#f8fafc;border-radius:10px;padding:10px 12px}.cash-metrics b{display:block;font-size:1.2rem;margin-top:2px}.cash-metric-label{font-size:.7rem;color:#64748b}.cash-disclaimer{font-size:.75rem;color:var(--text-muted,#64748b);margin-top:-.25rem}.cash-columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:1.5rem;margin:1rem 0}.cash-columns h3{font-weight:600;margin:.5rem 0}.cash-columns label{display:block;margin:.5rem 0}.cash-columns button{margin-top:.7rem}
@media(max-width:640px){.cash-heading{flex-direction:column;align-items:stretch}.cash-heading h2{margin-right:0}}</style>
