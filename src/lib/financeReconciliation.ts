import JSZip from 'jszip';
import {penCents,penDecimal} from './financeMoney';
export type ImportKind='payment'|'advance'|'discount'|'exemption'|'promotion'|'opening_debt'|'opening_credit'|'link';
export interface ImportRow {
 key:string;sheet:string;row:number;column:string;zoneId:string;contractCode:string;subscriber:string;customer:string;contractId:string;
 kind:ImportKind;period:string;amount:string;receivedOn:string;method:string;reference:string;collectorId:string;reason:string;reviewed:boolean;
 invoiceId:string;invoiceIds:string[];periodStart:string;periodEnd:string;dueOn:string;asOf:string;fee:string;expectedDue:string;paymentId:string;sourceAmount:string;
 /** Color real de relleno de la celda (hex, p.ej. "00FFFF"), o null sin color. Informativo únicamente — nunca decide la modalidad comercial por sí solo. */
 fillColor:string|null;
}
export interface SheetCell {value:string;colored:boolean;formula:boolean;dateOnly:boolean;fillColor:string|null}
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
/**
 * Lista los nombres de hoja de un XLSX sin parsear ninguna fila (solo lee
 * xl/workbook.xml) — barato, pensado para que el administrador elija qué
 * PON/hoja cargar ANTES de parsear datos, en archivos con muchas hojas
 * (una por PON) que de otro modo agotarían el tope de 10000 filas si se
 * sumaran todas.
 */
export async function listWorkbookSheetNames(bytes:ArrayBuffer):Promise<string[]>{
 if(bytes.byteLength>10*1024*1024)throw Error('Máximo 10 MB por archivo XLSX.');
 const zip=await JSZip.loadAsync(bytes,{checkCRC32:false});
 if(zip.file('xl/vbaProject.bin'))throw Error('No se admiten macros. Exporta como .xlsx.');
 const f=zip.file('xl/workbook.xml');if(!f)throw Error('Falta una parte requerida del XLSX.');
 const workbook=xml(await f.async('text'));
 return nodes(workbook,'sheet').map(s=>s.getAttribute('name')??'Hoja');
}
/**
 * XLSX estándar de Google Sheets. Nunca ejecuta fórmulas, macros o enlaces.
 * `onlySheetName`, si se indica, procesa ÚNICAMENTE esa hoja (ni siquiera
 * descomprime las demás) — el tope de 10000 filas/200000 celdas se evalúa
 * solo sobre ella, nunca acumulado contra hojas de otras PON en el mismo
 * archivo. Pensado para procesar un libro con una hoja por PON "hoja por
 * hoja" sin agotar el tope por hojas que no interesan en ese momento.
 */
export async function readFinanceWorkbook(bytes:ArrayBuffer,onlySheetName?:string):Promise<WorkbookPreview>{
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
 // Color real de relleno por fillId (null si el fill no declara un rgb
 // explícito — p.ej. color de tema — para nunca inventar un color que no
 // está escrito literalmente en el archivo).
 const fills=styles?nodes(styles,'fills').flatMap(n=>nodes(n,'fill')):[];
 const fillColors=fills.map(f=>{const fg=nodes(f,'fgColor')[0];const rgb=fg?.getAttribute('rgb');return rgb&&/^[0-9A-Fa-f]{6,8}$/.test(rgb)?rgb.slice(-6).toUpperCase():null;});
 const sheets:ImportSheet[]=[];let excludedColumns=0,blankCells=0,totalCells=0,totalRows=0;
 const allSheetNodes=nodes(workbook,'sheet');if(allSheetNodes.length>150)throw Error('Máximo 150 hojas por archivo.');
 const sheetNodes=onlySheetName===undefined?allSheetNodes:allSheetNodes.filter(s=>s.getAttribute('name')===onlySheetName);
 if(onlySheetName!==undefined&&!sheetNodes.length)throw Error('No se encontró la hoja indicada en el archivo.');
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
   const fillId=Number(xf?.getAttribute('fillId')??0);
   return [column,{value,formula:nodes(c,'f').length>0,colored:fillId>1,dateOnly:dateStyle||type==='d',fillColor:fillId>1?(fillColors[fillId]??null):null}];
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
/**
 * Deriva la abreviatura de PON desde el nombre oficial de la zona ("PON 6
 * - CM" -> "CM", "PON 20 -CB" -> "CB") para sugerir, nunca forzar, qué
 * hoja del Excel real corresponde a la PON ya elegida — el nombre de hoja
 * real en el archivo del propietario coincide con esta convención
 * (confirmado: SM, CM, SS, TS, PA, BO, REV, AR, SC, MI, CB, AO, B3-B7,
 * BAR1-BAR3). Cadena vacía si el nombre no sigue el patrón "PON N - XX".
 */
export function zoneSheetAbbreviation(zoneName:string):string{
 const m=/-\s*([A-Za-z0-9]+)\s*$/.exec(zoneName.trim());
 return m?m[1]!.toUpperCase():'';
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
   invoiceId:'',invoiceIds:[],periodStart:'',periodEnd:'',dueOn:'',asOf:'',fee:exactAmount(get(mapping.fee))??'',expectedDue:'',paymentId:'',sourceAmount:exactAmount(cell.value)??'',fillColor:cell.fillColor});
 }
 return {rows:result,warnings};
}
/** Normaliza un código de cliente/contrato para cruzarlo entre el Excel y SmartRayco tolerando ceros a la izquierda y espacios ("001449" == "1449" == " 1449 "). Vacío si no hay nada comparable. */
export function normalizeContractCode(code:string):string{return code.trim().toUpperCase().replace(/^0+(?=\d)/,'');}
export interface ExcelContractHint {fee:string[];lastPeriod:string;periodsWithAmount:number;colorCounts:Record<string,number>;rowKeys:string[]}
/**
 * Agrupa las filas ya extraídas de una hoja (`rows.value` del asistente,
 * UNA celda por mes/contrato) por cintillo o código de contrato, para
 * mostrarle al administrador un resumen objetivo por contrato (mensualidad
 * vista en el Excel, último período con dato, colores reales vistos).
 * `colorCounts` expone el color real (hex) tal cual está en el archivo.
 * Confirmado con datos reales (muestreo de 4 hojas, fase 17): el color se
 * repite de forma estable en TODA la fila de un cliente (identidad +
 * todos sus meses) — es un indicador de modalidad por contrato, no una
 * marca por período; una celda suelta de otro color dentro de esa misma
 * fila es una marca operativa puntual de ese mes (ver
 * `suggestModalityFromColors`, que usa el color dominante, no cualquier
 * color).
 */
export function groupExcelRowsByContract(rows:ImportRow[]):Map<string,ExcelContractHint>{
 const map=new Map<string,ExcelContractHint>();
 for(const r of rows){
  const key=normalizeContractCode(r.subscriber)||normalizeContractCode(r.contractCode);if(!key)continue;
  const cur=map.get(key)??{fee:[],lastPeriod:'',periodsWithAmount:0,colorCounts:{},rowKeys:[]};
  if(r.fee&&!cur.fee.includes(r.fee))cur.fee.push(r.fee);
  if(r.period&&r.period>cur.lastPeriod)cur.lastPeriod=r.period;
  if(r.amount)cur.periodsWithAmount++;
  if(r.fillColor)cur.colorCounts[r.fillColor]=(cur.colorCounts[r.fillColor]??0)+1;
  cur.rowKeys.push(r.key);
  map.set(key,cur);
 }
 return map;
}
/** Busca el cruce de un contrato de SmartRayco (por cintillo, luego por número de contrato) dentro del mapa ya agrupado del Excel. */
export function findExcelHint(map:Map<string,ExcelContractHint>,clientCode:string,contractNumber:string):ExcelContractHint|null{
 return map.get(normalizeContractCode(clientCode))??map.get(normalizeContractCode(contractNumber))??null;
}
export type ModalitySuggestion='adelantado'|'cumplido'|null;
/**
 * Clasifica un color de relleno (hex) según la convención ya confirmada
 * por el propietario (fase 18): celeste/cian/azul (azul predominante,
 * rojo bajo) = adelantado; verde (verde predominante, rojo y azul bajos)
 * = cumplido. Cualquier otro color (amarillo, naranja, blanco...) no
 * clasifica — son las marcas operativas puntuales de una celda de mes,
 * nunca la modalidad del contrato.
 */
export function classifyModalityColor(hex:string):ModalitySuggestion{
 if(!/^[0-9A-Fa-f]{6}$/.test(hex))return null;
 const r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16);
 if(b>r&&b>=g&&b>0)return'adelantado';
 if(g>r&&g>b)return'cumplido';
 return null;
}
/**
 * Sugiere la modalidad comercial de un contrato a partir del color
 * DOMINANTE de sus celdas en el Excel (el que más se repite en toda su
 * fila) — confirmado con datos reales que ese color es estable por
 * contrato, mientras que un color distinto en 1-2 celdas sueltas es una
 * marca operativa de ese período puntual, no la modalidad. Nunca es
 * definitivo: `confidence:'ambiguous'` (color dominante no reconocido, o
 * no alcanza mayoría clara) nunca sugiere nada, y aun con
 * `confidence:'clear'` la persona debe confirmar o corregir —
 * `modality` solo PRELLENA el campo, nunca lo bloquea ni lo oculta.
 */
export function suggestModalityFromColors(colorCounts:Record<string,number>):{modality:ModalitySuggestion;dominantColor:string|null;confidence:'clear'|'ambiguous'}{
 const entries=Object.entries(colorCounts).sort((a,b)=>b[1]-a[1]);
 if(!entries.length)return{modality:null,dominantColor:null,confidence:'ambiguous'};
 const [dominantColor,dominantCount]=entries[0]!;
 const total=entries.reduce((s,[,n])=>s+n,0);
 const classified=classifyModalityColor(dominantColor);
 const clear=classified!==null&&dominantCount/total>0.5;
 return{modality:clear?classified:null,dominantColor,confidence:clear?'clear':'ambiguous'};
}
export function importTotals(rows:ImportRow[]){const total={cash:0,debt:0,credit:0,discount:0,linked:0};for(const r of rows){const cents=penCents(r.amount);if(['payment','advance','promotion'].includes(r.kind))total.cash+=cents;else if(r.kind==='opening_debt')total.debt+=cents;else if(r.kind==='opening_credit')total.credit+=cents;else if(r.kind==='link')total.linked+=cents;else total.discount+=cents;}return Object.fromEntries(Object.entries(total).map(([k,v])=>[k,penDecimal(v)])) as Record<keyof typeof total,string>;}
