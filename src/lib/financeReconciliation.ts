import JSZip from 'jszip';
import {penCents,penDecimal} from './financeMoney';
export type ImportKind='payment'|'advance'|'discount'|'exemption'|'promotion'|'opening_debt'|'opening_credit'|'link';
export interface ImportRow {
 key:string;sheet:string;row:number;column:string;zoneId:string;contractCode:string;subscriber:string;customer:string;contractId:string;
 kind:ImportKind;period:string;amount:string;receivedOn:string;method:string;reference:string;collectorId:string;reason:string;reviewed:boolean;
 invoiceId:string;invoiceIds:string[];periodStart:string;periodEnd:string;dueOn:string;asOf:string;fee:string;expectedDue:string;paymentId:string;sourceAmount:string;
}
export interface SheetCell {value:string;colored:boolean;formula:boolean;dateOnly:boolean}
export interface ImportSheet {name:string;headers:{column:string;label:string}[];rows:{number:number;cells:Record<string,SheetCell>}[]}
export interface WorkbookPreview {sheets:ImportSheet[];excludedColumns:number;blankCells:number}
export const TECHNICAL_HEADER=/(pppoe|contrase|password|clave|wi[ -]?fi|secret|token|usuario.*ppp|^mac$|serial.*(ont|onu)|ip.*admin)/i;
export const normalizeHeader=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
export function safeObservation(text:string):string{return /pppoe|password|contrase|secret|token|clave|wifi/i.test(text)?'[Información técnica excluida]':text.slice(0,180);}
export function exactAmount(value:string):string|null{
 const s=value.trim().replace(/^S\/?\.?\s*/i,'');
 if(!/^\d{1,8}(?:\.\d{1,2})?$/.test(s))return null;
 try{return penCents(s)>0?penDecimal(penCents(s)):null;}catch{return null;}
}
export function excelCivilDate(value:string,date1904=false):string|null{
 if(!/^\d+(\.\d+)?$/.test(value))return null;const serial=Math.floor(Number(value));
 if(!Number.isFinite(serial)||serial<1||serial>150000||(!date1904&&serial===60))return null;
 const base=Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:31);
 const date=new Date(base+(serial-(date1904||serial<60?0:1))*86400000);return date.toISOString().slice(0,10);
}
const monthMap:Record<string,number>={enero:1,ene:1,febrero:2,feb:2,marzo:3,mar:3,abril:4,abr:4,mayo:5,may:5,junio:6,jun:6,julio:7,jul:7,agosto:8,ago:8,septiembre:9,setiembre:9,sep:9,set:9,octubre:10,oct:10,noviembre:11,nov:11,diciembre:12,dic:12};
export function monthCandidate(header:string):number|null{return monthMap[normalizeHeader(header).replace(/\s+\d{4}$/,'')]??null;}
export function rowHint(cell:SheetCell):string{
 if(cell.formula)return 'Fórmula: verificar contra evidencia antes de usar el valor.';
 if(cell.colored)return 'Color presente: no prueba un pago; requiere revisión.';
 if(/3\s*\+\s*1|promo/i.test(cell.value))return 'Posible promoción: requiere cuatro períodos e importe recibido verificables.';
 if(/exon|gratis|libre/i.test(cell.value))return 'Posible exoneración: no es dinero recibido.';
 if(/adel|anticip/i.test(cell.value))return 'Posible anticipo: verificar fecha, importe y fuente.';
 if(!exactAmount(cell.value))return 'Anotación ambigua: no se interpreta como pago.';
 return '';
}
function xml(text:string):Document{
 if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('XML con declaraciones externas no admitido.');
 const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.getElementsByTagName('parsererror').length)throw Error('El archivo contiene XML inválido.');return doc;
}
const nodes=(root:Document|Element,name:string)=>Array.from(root.getElementsByTagNameNS('*',name));
/** XLSX estándar de Google Sheets. Nunca ejecuta fórmulas, macros o enlaces. */
export async function readFinanceWorkbook(bytes:ArrayBuffer):Promise<WorkbookPreview>{
 if(bytes.byteLength>10*1024*1024)throw Error('Máximo 10 MB por archivo XLSX.');
 const zip=await JSZip.loadAsync(bytes,{checkCRC32:false});const entries=Object.values(zip.files);
 const uncompressed=entries.reduce((n,e)=>n+Number((e as unknown as {_data?:{uncompressedSize?:number}})._data?.uncompressedSize??0),0);
 if(entries.length>500||uncompressed>40*1024*1024)throw Error('Archivo demasiado grande al descomprimir (máximo 40 MB/500 entradas).');
 if(zip.file('xl/vbaProject.bin'))throw Error('No se admiten macros. Exporta como .xlsx.');
 let inflatedBytes=0;
 const get=async(path:string)=>{const f=zip.file(path);if(!f)throw Error('Falta una parte requerida del XLSX.');const data=await new Promise<Uint8Array>((resolve,reject)=>{let size=0;const chunks:Uint8Array[]=[];const stream=(f as unknown as {internalStream(type:string):JSZip.JSZipStreamHelper<Uint8Array>}).internalStream('uint8array');stream.on('data',chunk=>{size+=chunk.length;inflatedBytes+=chunk.length;if(size>20*1024*1024||inflatedBytes>40*1024*1024){stream.pause();reject(Error('XML descomprimido demasiado grande.'));return;}chunks.push(chunk);}).on('error',reject).on('end',()=>{const out=new Uint8Array(size);let at=0;for(const c of chunks){out.set(c,at);at+=c.length;}resolve(out);}).resume();});return xml(new TextDecoder('utf-8',{fatal:true}).decode(data));};
 const workbook=await get('xl/workbook.xml'),rels=await get('xl/_rels/workbook.xml.rels');
 const date1904=nodes(workbook,'workbookPr')[0]?.getAttribute('date1904')==='1';
 const relation=new Map(nodes(rels,'Relationship').filter(r=>r.getAttribute('TargetMode')!=='External').map(r=>[r.getAttribute('Id'),r.getAttribute('Target')??'']));
 const shared=zip.file('xl/sharedStrings.xml')?nodes(await get('xl/sharedStrings.xml'),'si').map(s=>nodes(s,'t').map(t=>t.textContent??'').join('')):[];
 const styles=zip.file('xl/styles.xml')?await get('xl/styles.xml'):null;
 const formats=new Map(styles?nodes(styles,'numFmt').map(n=>[Number(n.getAttribute('numFmtId')),n.getAttribute('formatCode')??'']):[]);
 const xfs=styles?nodes(styles,'cellXfs').flatMap(n=>nodes(n,'xf')):[];
 const sheets:ImportSheet[]=[];let excludedColumns=0,blankCells=0,totalCells=0,totalRows=0;
 const sheetNodes=nodes(workbook,'sheet');if(sheetNodes.length>150)throw Error('Máximo 150 hojas por archivo.');
 for(const sheet of sheetNodes){
  const id=sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')??sheet.getAttribute('r:id');
  const target=relation.get(id)??'';const path=target.startsWith('/')?target.slice(1):'xl/'+target;
  if(!path.startsWith('xl/')||path.includes('..')||!path.endsWith('.xml'))throw Error('Relación de hoja no admitida.');
  const doc=await get(path),allRows=nodes(doc,'row');totalRows+=allRows.length;if(totalRows>10000)throw Error('Máximo 10000 filas por archivo.');
  const parsed=allRows.map((r,index)=>({number:Number(r.getAttribute('r')??index+1),cells:Object.fromEntries(nodes(r,'c').map(c=>{
   if(++totalCells>200000)throw Error('Máximo 200000 celdas por archivo.');
   const column=(c.getAttribute('r')??'').replace(/\d/g,'');if(!/^[A-Z]{1,3}$/.test(column))throw Error('Celda sin coordenada válida.');
   const type=c.getAttribute('t'),xf=xfs[Number(c.getAttribute('s')??0)],fmt=Number(xf?.getAttribute('numFmtId')??0);
   let value=nodes(c,'v')[0]?.textContent??'';
   if(type==='s'){const i=Number(value);if(!Number.isInteger(i)||i<0||i>=shared.length)throw Error('Índice de texto inválido.');value=shared[i]!;}
   if(type==='inlineStr')value=nodes(c,'t').map(t=>t.textContent??'').join('');
   const dateStyle=(fmt>=14&&fmt<=22)||(/[dy]/i.test((formats.get(fmt)??'').replace(/"[^"]*"|\[[^\]]*\]/g,'')));
   if(dateStyle&&type!=='s'&&type!=='inlineStr')value=excelCivilDate(value,date1904)??value;
   if(type==='d')value=value.slice(0,10);
   if(!value.trim())blankCells++;
   return [column,{value,formula:nodes(c,'f').length>0,colored:Number(xf?.getAttribute('fillId')??0)>1,dateOnly:dateStyle||type==='d'}];
  }))}));
  // Primera fila no vacía como encabezado. Si no corresponde, la vista previa
  // obliga a revisar el archivo; no se deduce un formato real desconocido.
  const first=parsed.find(r=>Object.values(r.cells).some(c=>c.value.trim()));if(!first)continue;
  const blocked=new Set(Object.entries(first.cells).filter(([,c])=>TECHNICAL_HEADER.test(normalizeHeader(c.value))).map(([column])=>column));excludedColumns+=blocked.size;
  const headers=Object.entries(first.cells).filter(([column,c])=>!blocked.has(column)&&c.value.trim()).map(([column,c])=>({column,label:c.value.slice(0,100)}));
  sheets.push({name:sheet.getAttribute('name')??'Hoja',headers,rows:parsed.filter(r=>r.number>first.number).map(r=>({number:r.number,cells:Object.fromEntries(Object.entries(r.cells).filter(([col])=>!blocked.has(col)).map(([col,c])=>[col,{...c,value:safeObservation(c.value)}]))}))});
 }
 return {sheets,excludedColumns,blankCells};
}
export interface SheetMapping {zoneId:string;contract:string;subscriber:string;customer:string;fee:string;date:string;method:string;reference:string;months:Record<string,string>;mode?:'matrix'|'ledger';amountColumn?:string;periodColumn?:string;observation?:string}
export function draftSheet(sheet:ImportSheet,mapping:SheetMapping):{rows:ImportRow[];warnings:Record<string,string>} {
 const result:ImportRow[]=[],warnings:Record<string,string>={};
 for(const row of sheet.rows)for(const [column,period] of mapping.mode==='ledger'?[[mapping.amountColumn??'',row.cells[mapping.periodColumn??'']?.value??'']]:Object.entries(mapping.months)){
  const cell=row.cells[column];if(!cell?.value.trim())continue;
  const get=(col:string)=>row.cells[col]?.value.trim()??'';
  const key=`${sheet.name}:${row.number}:${column}`;warnings[key]=[rowHint(cell),mapping.observation?safeObservation(get(mapping.observation)):''].filter(Boolean).join(' · ');
  result.push({key,sheet:sheet.name,row:row.number,column,zoneId:mapping.zoneId,contractCode:get(mapping.contract),subscriber:get(mapping.subscriber),customer:get(mapping.customer),contractId:'',
   kind:'payment',period,amount:exactAmount(cell.value)??'',receivedOn:get(mapping.date),method:get(mapping.method),reference:get(mapping.reference),collectorId:'',reason:'',reviewed:false,
   invoiceId:'',invoiceIds:[],periodStart:'',periodEnd:'',dueOn:'',asOf:'',fee:exactAmount(get(mapping.fee))??'',expectedDue:'',paymentId:'',sourceAmount:exactAmount(cell.value)??''});
 }
 return {rows:result,warnings};
}
export function importTotals(rows:ImportRow[]){const total={cash:0,debt:0,credit:0,discount:0,linked:0};for(const r of rows){const cents=penCents(r.amount);if(['payment','advance','promotion'].includes(r.kind))total.cash+=cents;else if(r.kind==='opening_debt')total.debt+=cents;else if(r.kind==='opening_credit')total.credit+=cents;else if(r.kind==='link')total.linked+=cents;else total.discount+=cents;}return Object.fromEntries(Object.entries(total).map(([k,v])=>[k,penDecimal(v)])) as Record<keyof typeof total,string>;}
