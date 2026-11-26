import {penCents,penDecimal} from './financeMoney';
export const CASH_METHODS=['cash','yape','plin','transfer','other'] as const;
export type CashMethod=typeof CASH_METHODS[number];
export interface MixedPaymentPart {method:CashMethod;amount:string;reference?:string}
const METHOD_LABELS:Record<string,string>={cash:'Efectivo',yape:'Yape',plin:'Plin',transfer:'Transferencia',other:'Otros'};
export const cashMethodLabel=(method:string)=>METHOD_LABELS[method]??method;
export function validateMixedParts(input:unknown):{parts:MixedPaymentPart[];totalCents:number}{
 if(!Array.isArray(input)||input.length<2||input.length>5)throw Error('Selecciona entre dos y cinco medios de pago.');
 const seen=new Set<string>();let totalCents=0;
 const parts=input.map((r:MixedPaymentPart)=>{
  if(!r||!CASH_METHODS.includes(r.method)||seen.has(r.method))throw Error('Cada medio debe aparecer una sola vez.');
  seen.add(r.method);const cents=penCents(r.amount);if(cents<=0)throw Error('El importe de cada medio debe ser mayor a cero.');
  const reference=String(r.reference??'').trim();if(r.method!=='cash'&&(!reference||reference.length>100))throw Error('Registra el número de operación de cada medio digital.');
  totalCents+=cents;return {method:r.method,amount:penDecimal(cents),reference};
 });return {parts,totalCents};
}
export interface CashMovement {id:string;tipo:string;monto:number|string;finance_kind?:string;source_movement_id?:string|null}
export function operatingExpenseCents(m:CashMovement,all:ReadonlyMap<string,CashMovement>):number{
 const kind=m.finance_kind??'manual';if(kind==='manual'&&m.tipo==='egreso')return penCents(String(m.monto));
 const original=m.source_movement_id?all.get(m.source_movement_id):null;
 return kind==='movement_reversal'&&(original?.finance_kind??'manual')==='manual'&&original?.tipo==='egreso'?-penCents(String(m.monto)):0;
}
export interface CashClosure {id:string;day:string;counted_cash:string|number;expected_cash:string|number;difference:string|number;created_at:string;reopened_at:string|null;reason:string}
export interface CashDaily {day:string;enabled:boolean;expectedCashCollections:string|number;linkedCashCollections:string|number;unmatchedCash:string|number;openingCash:string|number;closingCash:string|number;operatingExpenses:string|number;ownerWithdrawals:string|number;methods:{method:CashMethod;received:string|number;reversed:string|number;net:string|number}[]|null;collectors:{id:string;name:string;method:CashMethod;received:string|number}[]|null;closures:CashClosure[]}
