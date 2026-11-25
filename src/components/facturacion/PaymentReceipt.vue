<script setup lang="ts">
import CommercialReceipt from './CommercialReceipt.vue';
import {commercialReceiptMessage} from '@/lib/commercialReceipt';
import {computed,ref,nextTick} from 'vue';
import {supabase} from '@/lib/supabase';
import {receiptBrandLogo} from '@/lib/receiptBrand';
import {receiptFilename,type FinanceReceipt} from '@/lib/financeReceipts';
import {makeReceiptPdf} from '@/lib/receiptPdf';
const opened=ref(false),busy=ref(false),error=ref(''),status=ref(''),paymentId=ref(''),receipt=ref<FinanceReceipt|null>(null);
const message=computed(()=>receipt.value&&!receipt.value.reversal?commercialReceiptMessage(receipt.value):'');
async function refresh(){const {data,error:e}=await supabase.rpc('finance_receipt',{p_payment_id:paymentId.value});if(e)throw Error(e.message);receipt.value=data as FinanceReceipt;return receipt.value;}
async function open(id:string){paymentId.value=id;receipt.value=null;opened.value=true;error.value='';status.value='';busy.value=true;try{await refresh();}catch(e){error.value=String(e);}finally{busy.value=false;}}
defineExpose({open});
function save(blob:Blob,data:FinanceReceipt){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=receiptFilename(data);a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function act(kind:'download'|'print'|'share'){
 if(busy.value)return;busy.value=true;error.value='';status.value='';
 try{const current=await refresh();if(kind==='print'){await nextTick();window.print();status.value='Se abrió el diálogo de impresión; no se confirma una impresión física.';return;}
  if(kind==='share'&&current.reversal)throw Error('Pago revertido: no compartir como confirmación vigente.');
  const blob=await makeReceiptPdf(current);
  if(kind==='download'){save(blob,current);status.value='Descarga del PDF solicitada.';return;}
  const file=new File([blob],receiptFilename(current),{type:'application/pdf'});
  if(navigator.canShare?.({files:[file]})&&navigator.share){await navigator.share({files:[file],title:current.document.number,text:commercialReceiptMessage(current)});status.value='Diálogo de compartir completado. No se confirma entrega al destinatario.';}
  else{save(blob,current);status.value='Este dispositivo no permite compartir el PDF directamente. Se solicitó la descarga: adjúntalo manualmente en WhatsApp. Abrir WhatsApp no envía el archivo.';}
 }catch(e){status.value=e instanceof Error&&e.name==='AbortError'?'Compartir cancelado.':'';if(!status.value)error.value=String(e);}finally{busy.value=false;}
}
async function copy(){if(busy.value)return;busy.value=true;error.value='';try{const current=await refresh();const text=commercialReceiptMessage(current);try{await navigator.clipboard.writeText(text);status.value='Mensaje copiado. No se ha enviado.';}catch{status.value='Selecciona y copia el mensaje manualmente.';}}catch(e){error.value=String(e);}finally{busy.value=false;}}
async function whatsapp(){
 if(busy.value)return;busy.value=true;error.value='';const popup=window.open('about:blank','_blank');
 try{if(!popup)throw Error('Permite la ventana de WhatsApp o copia el mensaje manualmente.');popup.opener=null;const current=await refresh();popup.location.href='https://wa.me/?text='+encodeURIComponent(commercialReceiptMessage(current));status.value='Se abrió WhatsApp con un mensaje preparado. No se confirma envío ni entrega; adjunta el PDF manualmente.';}
 catch(e){popup?.close();error.value=String(e);}finally{busy.value=false;}
}
</script>
<template><Teleport to="body"><div v-if="opened" class="modal-overlay receipt-overlay"><section class="modal-panel receipt-dialog" role="dialog" aria-modal="true" aria-labelledby="receipt-title"><div class="finance-dialog-head receipt-controls"><h2 id="receipt-title">Recibo interno</h2><button :disabled="busy" aria-label="Cerrar recibo" @click="opened=false">×</button></div><p v-if="!receiptBrandLogo" class="finance-warning receipt-controls">Logo horizontal oficial pendiente de archivo. Vista de revisión con texto; no se usa el logo circular anterior.</p><p v-if="error" class="finance-error" role="alert">{{error}}</p><p v-if="status" class="finance-notice" role="status">{{status}}</p><p v-if="busy" class="receipt-controls">Preparando documento…</p><CommercialReceipt v-if="receipt" :receipt="receipt"/><div v-if="receipt" class="receipt-controls"><div class="receipt-actions"><button class="btn-primary" :disabled="busy" @click="act('download')">Descargar PDF</button><button class="btn-secondary" :disabled="busy" @click="act('print')">Imprimir / reimprimir</button><button class="btn-secondary" :disabled="busy||!!receipt.reversal" @click="act('share')">Compartir PDF manualmente</button></div><label v-if="!receipt.reversal" class="receipt-message">Mensaje preparado<textarea readonly :value="message" rows="5"></textarea></label><div v-if="!receipt.reversal" class="receipt-actions"><button class="btn-ghost" @click="copy">Copiar mensaje</button><button class="btn-ghost" :disabled="busy" @click="whatsapp">Abrir WhatsApp (solo mensaje)</button></div><p class="finance-help">El envío requiere tu intervención. SmartRayco no confirma la entrega del PDF ni del mensaje. Nunca se envía automáticamente.</p></div><button v-else-if="!busy" class="btn-secondary receipt-controls" @click="open(paymentId)">Reintentar lectura del recibo</button></section></div></Teleport></template>
<style>
.receipt-overlay{z-index:2000}.receipt-dialog{width:min(510px,98vw);max-height:96vh;overflow:auto;padding:18px;background:#f1f5f8}.receipt-actions{display:flex;gap:8px;flex-wrap:wrap;margin:15px 0}.receipt-actions button{font-size:11px}.receipt-message{display:block;font-size:11px}.receipt-message textarea{display:block;width:100%;padding:10px;border:1px solid #dce5ed;border-radius:5px;margin:7px 0;font:12px/1.6 system-ui}.receipt-dialog .finance-dialog-head{margin-bottom:12px}.receipt-dialog .finance-help{font-size:10px}
@media(max-width:420px){.receipt-dialog{padding:10px;width:98vw}}
@media print{body>*:not(.receipt-overlay){display:none!important}.receipt-overlay{position:static!important;display:block!important;background:white!important;padding:0!important}.receipt-dialog{width:100%!important;max-height:none!important;overflow:visible!important;box-shadow:none!important;border:0!important;padding:0!important;background:white!important}.receipt-controls,.receipt-dialog>.finance-notice,.receipt-dialog>.finance-error{display:none!important}}
</style>
