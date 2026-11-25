import {formatPen,penCents,penDecimal} from './financeMoney';
import {receiptDate,receiptMethods,type FinanceReceipt} from './financeReceipts';
export const COMMERCIAL_WHATSAPP='947747873';
export const RECEIPT_LEGEND='Constancia interna de pago. No constituye comprobante tributario.';
const monthNames=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
export function commercialPeriod(start:string,end:string):string{
 const first=/^(\d{4})-(\d{2})-(\d{2})$/.exec(start),last=/^(\d{4})-(\d{2})-(\d{2})$/.exec(end);
 if(!first||!last)return `${start} al ${end}`;
 const year=Number(first[1]),month=Number(first[2]),lastDay=new Date(Date.UTC(year,month,0)).getUTCDate();
 if(first[1]===last[1]&&first[2]===last[2]&&first[3]==='01'&&Number(last[3])===lastDay)return `${monthNames[month-1]} ${year}`;
 return `${first[3]}/${first[2]}/${first[1]} al ${last[3]}/${last[2]}/${last[1]}`;
}
/** Proyección de presentación. No altera el documento ni recalcula el libro. */
export function commercialReceipt(receipt:FinanceReceipt){
 const d=receipt.document;
 const periodBalance=d.periods.reduce((n,p)=>n+penCents(p.balanceAfter),0);
 const periods=d.periods.map(p=>({label:p.origin==='opening_balance'?`Saldo inicial al ${p.start.split('-').reverse().join('/')}`:commercialPeriod(p.start,p.end),balance:p.balanceAfter}));
 const credit=penCents(d.creditGenerated);
 const kind=receipt.reversal?'Pago revertido':d.promotion?'Promoción 3+1':d.kind==='parcial'?'Pago parcial':d.kind==='adelantado'?'Pago adelantado':'Pago completo';
 const concept=receipt.reversal?'Pago revertido':d.periods.some(p=>p.origin==='opening_balance')?'Pago de saldo inicial conciliado':d.promotion?'Tres mensualidades pagadas + cuarto mes gratis':d.kind==='parcial'?'Abono a mensualidad':!periods.length?'Anticipo para próximas mensualidades':d.kind==='adelantado'?'Pago anticipado de mensualidades':'Pago de mensualidad';
 return {number:d.number,business:'Comunicaciones Rayco',customer:d.metadata.client.name,subscriber:d.metadata.cintillo,
  service:d.metadata.plan||(d.metadata.service==='solo_iptv'?'IPTV':'Internet'),date:d.receivedDateOnly?new Date(d.receivedAt).toLocaleDateString('es-PE',{timeZone:'America/Lima'}):receiptDate(d.receivedAt),amount:formatPen(d.amount),
  method:receiptMethods[d.method]??d.method,kind,concept,periods,periodBalance:periods.length?formatPen(penDecimal(periodBalance)):null,
  // El agregado del contrato puede contener históricos no conciliados: no se
  // interpreta su diferencia como deuda real ni se consulta otra fuente.
  otherPeriodsDebt:null,
  advance:!receipt.reversal&&credit>0?formatPen(d.creditGenerated):null,
  freePeriod:d.promotion?commercialPeriod(d.promotion.start,d.promotion.end):null,
  reversed:!!receipt.reversal,legend:RECEIPT_LEGEND,phone:COMMERCIAL_WHATSAPP,
  synthetic:/EJEMPLO CON DATOS SINTETICOS/.test(d.notice)};
}
export type CommercialReceipt=ReturnType<typeof commercialReceipt>;
export function commercialReceiptMessage(receipt:FinanceReceipt):string{
 const r=commercialReceipt(receipt);if(r.reversed)throw Error('Pago revertido: no compartir como confirmación vigente.');
 return `${r.business}: recibimos tu ${r.kind.toLowerCase()} de ${r.amount}.${r.subscriber?` Código de cliente ${r.subscriber}.`:''} Servicio: ${r.service}. ${r.periods.length?`Período: ${r.periods.map(p=>p.label).join(', ')}.`:'Anticipo sin período asignado.'}${r.freePeriod?` Promoción: ${r.freePeriod} gratis.`:''}${r.periodBalance?` Saldo de los períodos al pagar: ${r.periodBalance}.`:''}${r.advance?` Anticipo a favor al pagar: ${r.advance}.`:''} Recibo ${r.number}. Gracias por tu preferencia. WhatsApp ${r.phone}. ${r.legend}`;
}
