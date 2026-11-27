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
export interface CashClosure {id:string;day:string;actor_id:string|null;counted_cash:string|number;expected_cash:string|number;difference:string|number;created_at:string;reopened_at:string|null;reopened_by:string|null;reopen_reason:string|null;reason:string}
export interface CashDaily {day:string;enabled:boolean;expectedCashCollections:string|number;linkedCashCollections:string|number;unmatchedCash:string|number;openingCash:string|number;closingCash:string|number;operatingExpenses:string|number;ownerWithdrawals:string|number;methods:{method:CashMethod;received:string|number;reversed:string|number;net:string|number}[]|null;collectors:{id:string;name:string;method:CashMethod;received:string|number}[]|null;closures:CashClosure[]}

// Fase 30.2 — "otros ingresos de efectivo" del día: movimientos manuales de
// tipo ingreso (nunca cobranzas de clientes ni compensaciones/reversos) —
// el aporte del propietario u otro ingreso en efectivo distinto a una
// cobranza. Se calcula en el frontend, sobre los movimientos ya cargados
// (nunca una fuente paralela), para no duplicar con linkedCashCollections.
export interface CashMovementForIncome {fecha:string;tipo:string;finance_kind?:string;monto:number|string}
export function otherCashIncomeCents(movs:readonly CashMovementForIncome[],day:string):number{
 return movs.filter((m)=>m.fecha===day&&m.tipo==='ingreso'&&(m.finance_kind??'manual')==='manual').reduce((n,m)=>n+penCents(String(m.monto)),0);
}

// Fase 30.2 — sustituye el UUID crudo de una cobranza/reversión por su
// recibo real cuando ya existe (finance_number_receipt es un trigger
// diferido: el recibo se asigna DESPUÉS de insertar el movimiento, así que
// la descripción guardada nunca lo alcanza a incluir — nunca se reescribe
// ese dato histórico, solo se mejora lo que se muestra).
export interface CashMovementForLabel {finance_kind?:string;descripcion:string;linked_payment?:{receipt_number:string|null}|null}
export function movimientoDisplayLabel(m:CashMovementForLabel):string{
 const kind=m.finance_kind??'manual';const receipt=m.linked_payment?.receipt_number;
 if(kind==='collection'&&receipt)return 'Cobranza · '+receipt;
 if(kind==='payment_reversal'&&receipt)return 'Reversión de cobranza · '+receipt;
 return m.descripcion;
}
