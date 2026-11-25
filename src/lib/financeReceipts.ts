import {formatPen} from './financeMoney';
export interface ReceiptDocument {
 version:number;number:string;business:string;paymentId:string;receivedAt:string;amount:string;method:string;reference:string|null;
 collectorId:string;kind:'parcial'|'completo'|'adelantado';inAdvance:boolean;applied:string;creditGenerated:string;contractBalanceAfter:string;notice:string;receivedDateOnly?:boolean;
 metadata:{client:{name:string;document:string|null};contract:string;cintillo:string|null;service:string;plan:string|null;monthlyFee?:string|number|null;zone:string|null;collector:string;currency:string;timezone:string};
 periods:{invoiceId:string;invoice:string;start:string;end:string;amount:string;applied:string;balanceAfter:string;origin?:string}[];
 promotion?:{invoice:string;start:string;end:string;discount:string|number};
}
export interface FinanceReceipt {document:ReceiptDocument;reversal:{at:string;by:string;reason:string}|null}
export const receiptMethods:Record<string,string>={cash:'Efectivo',yape:'Yape',plin:'Plin',transfer:'Transferencia',other:'Otros'};
export const receiptDate=(value:string)=>new Date(value).toLocaleString('es-PE',{timeZone:'America/Lima'});
export function receiptLines(receipt:FinanceReceipt):string[]{
 const d=receipt.document,m=d.metadata;
 return [receipt.reversal?'PAGO REVERTIDO — SIN VALIDEZ COMO CONFIRMACIÓN VIGENTE':'CONSTANCIA DE PAGO RECIBIDO',
  `Fecha del pago (Perú): ${receiptDate(d.receivedAt)}`,
  `Cliente: ${m.client.name}`,`Documento: ${m.client.document||'No registrado'}`,
  `Contrato: ${m.contract} · Cintillo: ${m.cintillo||'No registrado'}`,`PON / zona original: ${m.zone||'Sin zona registrada'}`,
  `Servicio: ${m.service==='solo_iptv'?'IPTV':'Paquete Internet'} · Plan original: ${m.plan||'No registrado'}`,
  ...(m.monthlyFee!=null?[`Mensualidad original: ${formatPen(m.monthlyFee)}`]:[]),
  `Tipo: ${{parcial:'Pago parcial',completo:'Pago completo',adelantado:'Pago adelantado'}[d.kind]}${d.inAdvance?' · Períodos futuros':''}`,
  `IMPORTE RECIBIDO: ${formatPen(d.amount)}`,`Método: ${receiptMethods[d.method]??d.method}`,
  `Operación: ${d.reference||'Sin referencia de efectivo'}`,`Administrador responsable: ${m.collector}`,
  'PERÍODOS CON APLICACIÓN MONETARIA AL COBRAR',
  ...(d.periods.length?d.periods.flatMap(p=>[`${p.start} al ${p.end} · ${p.invoice}`,`Aplicado ${formatPen(p.applied)} · Saldo de esa factura entonces ${formatPen(p.balanceAfter)}`]):['Anticipo sin período asignado al momento del cobro.']),
  ...(d.promotion?[`PROMOCIÓN: ${d.promotion.start} al ${d.promotion.end} · ${d.promotion.invoice}`,`Cuarto mes gratuito: descuento ${formatPen(d.promotion.discount)}. Dinero recibido por ese mes: S/ 0.00.`]:[]),
  `Total aplicado al cobrar: ${formatPen(d.applied)}`,`Anticipo generado por este pago: ${formatPen(d.creditGenerated)}`,
  `Saldo del contrato al cobrar: ${formatPen(d.contractBalanceAfter)}`,
  'Los saldos corresponden al momento original. Aplicaciones posteriores de anticipos se consultan en el historial.',
  ...(receipt.reversal?[`REVERSO: ${receiptDate(receipt.reversal.at)} · Actor: ${receipt.reversal.by}`,`Motivo: ${receipt.reversal.reason}`]:['Gracias por confiar en Comunicaciones Rayco.']),
  d.notice,`Identificador de pago: ${d.paymentId}`];
}
export function receiptMessage(receipt:FinanceReceipt):string{
 if(receipt.reversal)throw Error('Pago revertido: no compartir como confirmación vigente.');
 const d=receipt.document,period=d.periods.length?d.periods.map(p=>`${p.start} al ${p.end}`).join('; '):'anticipo sin período asignado';
 return `Comunicaciones Rayco confirma la recepción de ${formatPen(d.amount)} (${d.kind==='parcial'?'pago parcial':d.kind==='adelantado'?'pago adelantado':'pago completo'}) para el contrato ${d.metadata.contract}. Período: ${period}. Constancia interna ${d.number}. Saldo del contrato al cobrar: ${formatPen(d.contractBalanceAfter)}. Gracias por su preferencia. Esta constancia no es un comprobante tributario.`;
}
export function receiptFilename(receipt:FinanceReceipt):string{return `${receipt.document.number}${receipt.reversal?'-REVERTIDO':''}.pdf`;}
