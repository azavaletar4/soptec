import type {CommercialReceipt} from './commercialReceipt';
const encoder=new TextEncoder();
const specials:Record<string,number>={'€':128,'‚':130,'ƒ':131,'„':132,'…':133,'†':134,'‡':135,'ˆ':136,'‰':137,'Š':138,'‹':139,'Œ':140,'Ž':142,'‘':145,'’':146,'“':147,'”':148,'•':149,'–':150,'—':151,'˜':152,'™':153,'š':154,'›':155,'œ':156,'ž':158,'Ÿ':159};
export function pdfTextHex(text:string):string{
 return Array.from(text).map(c=>{const n=specials[c]??c.codePointAt(0)!;if(n>255||n<32)throw Error('Para conservar todos los caracteres de este nombre, usa Imprimir y Guardar como PDF.');return n.toString(16).padStart(2,'0');}).join('').toUpperCase();
}
const lower=[556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500];
const upper=[667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611];
const symbolWidths:Record<string,number>={' ':278,'\u00a0':278,'.':278,',':278,':':278,';':278,'/':278,'-':333,'–':556,'—':1000,'(':333,')':333,'+':584,'·':278,'?':556};
function width(text:string,size:number,bold=false){return Array.from(text).reduce((sum,c)=>{const normalized=c.normalize('NFD').replace(/[\u0300-\u036f]/g,'');const code=normalized.charCodeAt(0);return sum+(code>=97&&code<=122?lower[code-97]!:code>=65&&code<=90?upper[code-65]!:code>=48&&code<=57?556:symbolWidths[c]??900);},0)*size/1000*(bold?1.06:1);}
function wrap(text:string,size:number,limit:number,bold=false){
 const lines:string[]=[];let line='';
 for(const word of text.replace(/[\r\n\t]+/g,' ').split(/\s+/)){
  if(line&&width(line+' '+word,size,bold)>limit){lines.push(line);line='';}
  if(width(word,size,bold)>limit){for(const c of word){if(line&&width(line+c,size,bold)>limit){lines.push(line);line='';}line+=c;}}
  else line+=(line?' ':'')+word;
 }if(line)lines.push(line);return lines.length?lines:[''];
}
type Text={type:'text';x:number;y:number;size:number;value:string;bold?:boolean;color?:string};
type Rect={type:'rect';x:number;y:number;w:number;h:number;color:string};
type Draw=Text|Rect|{type:'logo';x:number;y:number;w:number;h:number}|{type:'check';x:number;y:number;reversed:boolean};
type Page={draw:Draw[];height:number};
const navy='0.063 0.176 0.286',sky='0.19 0.73 0.90',muted='0.36 0.47 0.56',red='0.65 0.22 0.20';
export function commercialPdfLayout(v:CommercialReceipt,logoAspect?:number):Page[]{
 const pages:Page[]=[];let draw:Draw[]=[],y=0;
 const text=(value:string,x:number,top:number,size=11,bold=false,color=navy)=>draw.push({type:'text',value,x,y:top,size,bold,color});
 const center=(value:string,top:number,size:number,bold=false,color=navy)=>text(value,(360-width(value,size,bold))/2,top,size,bold,color);
 const rect=(x:number,top:number,w:number,h:number,color:string)=>draw.push({type:'rect',x,y:top,w,h,color});
 function header(first:boolean){
  draw=[];rect(0,0,360,79,'1 1 1');rect(0,79,360,3,sky);
  if(logoAspect){const w=Math.min(190,48*logoAspect),h=w/logoAspect;draw.push({type:'logo',x:22,y:16+(48-h)/2,w,h});}
  else{text('COMUNICACIONES',24,21,8,false,muted);text('RAYCO',23,34,23,true,navy);}
  text('RECIBO',247,22,7,false,muted);text(v.number,224,36,7.3,true,navy);
  if(first){rect(0,82,360,122,v.reversed?'1 0.95 0.94':'0.94 0.98 0.99');rect(112,96,136,22,v.reversed?'0.98 0.88 0.86':'0.87 0.95 0.98');draw.push({type:'check',x:123,y:103,reversed:v.reversed});text(v.reversed?'Pago revertido':'Pago recibido',141,101,9.5,true,v.reversed?red:'0.08 0.41 0.55');center(v.amount,130,36,true);center(v.kind,176,10,false,muted);if(v.reversed)center('No confirma un pago vigente.',190,8,false,red);y=221;}
  else{text(`${v.kind} · Continuación`,18,94,9,true,v.reversed?red:muted);y=120;}
 }
 const finish=()=>{const height=Math.max(430,y+92);pages.push({draw,height});};
 function ensure(space:number){if(y+space>660){finish();header(false);}}
 function field(label:string,value:string,size=11,bold=false){const lines=wrap(value,size,312,bold);ensure(14+lines.length*(size+3)+13);text(label,24,y,7.5,false,muted);y+=13;for(const line of lines){text(line,24,y,size,bold);y+=size+3;}y+=12;}
 function pair(a:string,av:string,b:string,bv:string){const left=wrap(av,10,145),right=wrap(bv,10,145),height=Math.max(left.length,right.length)*14;ensure(height+28);text(a,24,y,7.5,false,muted);text(b,188,y,7.5,false,muted);y+=13;left.forEach((s,n)=>text(s,24,y+n*14,10));right.forEach((s,n)=>text(s,188,y+n*14,10));y+=height+14;}
 function total(label:string,value:string,color=navy){ensure(31);text(label,24,y+4,9);text(value,336-width(value,13,true),y,13,true,color);y+=29;}
 header(true);field('CLIENTE',v.customer,16,true);if(v.subscriber)field('CÓDIGO DE CLIENTE',v.subscriber,10,true);
 field('SERVICIO',v.service);pair('FECHA DE PAGO · PERÚ',v.date,'MÉTODO DE PAGO',v.method);field('CONCEPTO',v.concept,10);
 ensure(28);rect(24,y,312,0.7,'0.87 0.92 0.95');y+=15;text(v.periods.length?(v.reversed?'Períodos afectados por la reversión':v.kind==='Pago parcial'?'PERÍODO DEL ABONO':'PERÍODOS PAGADOS'):'PERÍODO',24,y,7.5,false,muted);y+=16;
 if(v.periods.length)for(const p of v.periods){const lines=wrap(p.label,10,300);ensure(lines.length*14+5);lines.forEach(line=>{text(line,24,y,10);y+=14;});y+=3;}
 else{ensure(19);text('Por asignar a próximas mensualidades',24,y,10);y+=22;}
 if(v.freePeriod){const rows=wrap(`${v.freePeriod} · GRATIS (3+1)`,10,290,true);ensure(rows.length*15+13);rect(24,y,312,rows.length*15+10,'0.91 0.97 0.99');rows.forEach((line,n)=>text(line,31,y+5+n*15,10,true,'0.08 0.46 0.59'));y+=rows.length*15+18;}
 if(v.periodBalance)total(v.periods.length===1?'Saldo pendiente del período':'Saldo pendiente de los períodos',v.periodBalance);
 if(v.advance)total('Anticipo a favor',v.advance,'0.08 0.46 0.59');
 if(v.periodBalance||v.advance){ensure(16);text(v.reversed?'Los saldos mostrados corresponden al pago original.':'Saldos al momento del pago.',24,y,7,false,muted);y+=17;}
 finish();pages.forEach((p,n)=>{draw=p.draw;const footer=p.height-78;rect(0,footer,360,78,'0.97 0.98 0.99');center('Gracias por confiar en Rayco.',footer+12,10,true);center(`¿Te ayudamos? WhatsApp ${v.phone}`,footer+29,9,false,'0.08 0.46 0.59');center(v.legend,footer+48,6.5,false,muted);if(v.synthetic)center('EJEMPLO · DATOS SINTÉTICOS',footer+62,6,false,muted);if(pages.length>1)text(`${n+1}/${pages.length}`,330,footer+63,6,false,muted);});return pages;
}
export function buildCommercialPdf(view:CommercialReceipt,logo:{bytes:Uint8Array;width:number;height:number}|null):Uint8Array{
 const pages=commercialPdfLayout(view,logo?logo.width/logo.height:undefined),chunks:Uint8Array[]=[],offsets:number[]=[0];let length=0;
 const add=(b:Uint8Array)=>{chunks.push(b);length+=b.length;};
 const ascii=(s:string)=>encoder.encode(s);
 const object=(id:number,parts:Uint8Array[])=>{offsets[id]=length;add(ascii(`${id} 0 obj\n`));parts.forEach(add);add(ascii('\nendobj\n'));};
 // Mapa explícito para copiar/extractar fielmente letras españolas y CP1252.
 const used=new Map<number,string>();for(const p of pages)for(const d of p.draw)if(d.type==='text')for(const c of d.value){const hex=pdfTextHex(c);used.set(parseInt(hex,16),c);}
 const maps=[...used].sort((a,b)=>a[0]-b[0]).map(([code,char])=>`<${code.toString(16).padStart(2,'0')}> <${char.codePointAt(0)!.toString(16).padStart(4,'0')}>`);
 const cmap=ascii(`/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Rayco) /Ordering (Unicode) /Supplement 0 >> def /CMapName /RaycoUnicode def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange\n${Array.from({length:Math.ceil(maps.length/100)},(_,n)=>{const batch=maps.slice(n*100,n*100+100);return `${batch.length} beginbfchar\n${batch.join('\n')}\nendbfchar`;}).join('\n')}\nendcmap CMapName currentdict /CMap defineresource pop end end`);
 add(ascii('%PDF-1.4\n%RaycoVector\n'));
 object(1,[ascii('<< /Type /Catalog /Pages 2 0 R >>')]);
 object(2,[ascii(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,n)=>`${7+n*2} 0 R`).join(' ')}] >>`)]);
 object(3,[ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode 5 0 R >>')]);
 object(4,[ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding /ToUnicode 5 0 R >>')]);
 object(5,[ascii(`<< /Length ${cmap.length} >>\nstream\n`),cmap,ascii('\nendstream')]);
 if(logo)object(6,[ascii(`<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.bytes.length} >>\nstream\n`),logo.bytes,ascii('\nendstream')]);else object(6,[ascii('<< >>')]);
 pages.forEach((p,n)=>{
  const id=7+n*2;const commands=p.draw.map(d=>{
   if(d.type==='rect')return `${d.color} rg ${d.x} ${p.height-d.y-d.h} ${d.w} ${d.h} re f`;
   if(d.type==='logo')return `q ${d.w} 0 0 ${d.h} ${d.x} ${p.height-d.y-d.h} cm /Logo Do Q`;
   if(d.type==='check'){const yy=p.height-d.y;const path=d.reversed?`${d.x} ${yy+1} m ${d.x+8} ${yy-7} l S ${d.x+8} ${yy+1} m ${d.x} ${yy-7} l S`:`${d.x} ${yy-2} m ${d.x+3} ${yy-6} l ${d.x+9} ${yy+1} l S`;return `${d.reversed?red:'0.08 0.41 0.55'} RG 1.4 w ${path}`;}
   return `BT /${d.bold?'F2':'F1'} ${d.size} Tf ${d.color??navy} rg 1 0 0 1 ${d.x.toFixed(2)} ${(p.height-d.y-d.size).toFixed(2)} Tm <${pdfTextHex(d.value)}> Tj ET`;
  }).join('\n');const stream=ascii(commands);
  object(id,[ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 ${p.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${logo?'/Logo 6 0 R':''} >> >> /Contents ${id+1} 0 R >>`)]);
  object(id+1,[ascii(`<< /Length ${stream.length} >>\nstream\n`),stream,ascii('\nendstream')]);
 });
 const xref=length;add(ascii(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`));offsets.slice(1).forEach(n=>add(ascii(`${String(n).padStart(10,'0')} 00000 n \n`)));
 add(ascii(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
 const result=new Uint8Array(length);let position=0;for(const c of chunks){result.set(c,position);position+=c.length;}return result;
}
