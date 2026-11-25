import {receiptBrandLogo} from './receiptBrand';
import {commercialReceipt} from './commercialReceipt';
import {buildCommercialPdf} from './commercialReceiptPdf';
import {type FinanceReceipt} from './financeReceipts';
const ascii=(s:string)=>new TextEncoder().encode(s);
// Compatibilidad con pruebas históricas. El recibo comercial NO llama este
// helper: makeReceiptPdf usa texto/vector y rasteriza solamente el logo.
export function pdfFromJpegPages(pages:{bytes:Uint8Array;width:number;height:number}[]):Uint8Array{
 if(!pages.length)throw Error('El PDF requiere una página.');
 const chunks:Uint8Array[]=[],offsets:number[]=[0];let size=0;
 const add=(v:Uint8Array)=>{chunks.push(v);size+=v.byteLength;};
 const object=(id:number,content:Uint8Array[])=>{offsets[id]=size;add(ascii(`${id} 0 obj\n`));content.forEach(add);add(ascii('\nendobj\n'));};
 add(ascii('%PDF-1.4\n%Rayco\n'));
 object(1,[ascii('<< /Type /Catalog /Pages 2 0 R >>')]);
 object(2,[ascii(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] >>`)]);
 pages.forEach((p,i)=>{const id=3+i*3,commands=ascii('q 595.28 0 0 841.89 0 0 cm /Im0 Do Q');
  object(id,[ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${id+1} 0 R >> >> /Contents ${id+2} 0 R >>`)]);
  object(id+1,[ascii(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`),p.bytes,ascii('\nendstream')]);
  object(id+2,[ascii(`<< /Length ${commands.length} >>\nstream\n`),commands,ascii('\nendstream')]);
 });
 const xref=size;add(ascii(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`));
 offsets.slice(1).forEach(n=>add(ascii(`${String(n).padStart(10,'0')} 00000 n \n`)));
 add(ascii(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
 const out=new Uint8Array(size);let cursor=0;for(const c of chunks){out.set(c,cursor);cursor+=c.length;}return out;
}
export async function makeReceiptPdf(receipt:FinanceReceipt,_legacyLogoUrl?:string):Promise<Blob>{
 if(!receiptBrandLogo){const pdf=buildCommercialPdf(commercialReceipt(receipt),null);return new Blob([pdf.slice().buffer],{type:'application/pdf'});}
 const image=new Image();image.src=receiptBrandLogo;await image.decode();
 const canvas=document.createElement('canvas');const ratio=image.naturalWidth/image.naturalHeight;canvas.width=Math.max(1,Math.round(Math.min(800,200*ratio)));canvas.height=Math.max(1,Math.round(canvas.width/ratio));
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('No se pudo preparar el logo del recibo.');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
 const jpg=canvas.toDataURL('image/jpeg',0.88).split(',')[1]??'';
 const logo={bytes:Uint8Array.from(atob(jpg),c=>c.charCodeAt(0)),width:canvas.width,height:canvas.height};
 const pdf=buildCommercialPdf(commercialReceipt(receipt),logo);return new Blob([pdf.slice().buffer],{type:'application/pdf'});
}
