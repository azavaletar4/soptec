// HTTP de loopback, datos sintéticos persistentes y ningún proxy ni cliente BD.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
export const csp="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
export function startLab(preparedFile,port=4176){
 const config=JSON.parse(fs.readFileSync(preparedFile,'utf8')),folder=path.dirname(preparedFile);
 const stateFile=path.join(folder,'synthetic-server.json'),eventsFile=path.join(folder,'events.jsonl');
 const state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{orders:{},events:[],writes:0,lostResponses:0};
 const save=()=>fs.writeFileSync(stateFile,JSON.stringify(state,null,2)+'\n');
 const event=data=>fs.appendFileSync(eventsFile,JSON.stringify({at:new Date().toISOString(),...data})+'\n');
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Security-Policy',csp);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  // Cada petición LAB termina su conexión: quitar adb reverse debe cortar
  // realmente el siguiente envío, sin túneles keep-alive todavía abiertos.
  res.setHeader('Connection','close');
  const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
  try{
   if(!/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host??''))return reply(403,{error:'LOOPBACK_HOST_ONLY'});
   const url=new URL(req.url,'http://127.0.0.1');
   if(req.method==='GET'&&url.pathname==='/lab/state')return reply(200,state);
   if(req.method==='POST'&&url.pathname==='/lab/transport'){
    if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return reply(403,{error:'SAME_ORIGIN_ONLY'});
    let text='';for await(const chunk of req){text+=chunk;if(text.length>150000)return reply(413,{error:'BODY_LIMIT'});}
    const input=JSON.parse(text),{action,id}=input;
    if(typeof id!=='string'||!/^LAB-[a-zA-Z0-9-]{1,80}$/.test(id))return reply(400,{error:'SYNTHETIC_ID_REQUIRED'});
    const order=state.orders[id]??={id,client_id:'LAB-client',contract_id:'LAB-contract-'+id,status:'in_progress',iptv_policy_version:1,iptv_installation_mode:null};
    if(action==='read')return reply(200,{data:order,error:null});
    if(action==='preflight'){
     // Transporte controlado: no sustituye la certificación SQL previa.
     if(!input.args.p_mode)return reply(200,{data:null,error:{code:'PIP06',message:'Selecciona modalidad IPTV (fixture sintético)'}});
     if(input.rejectRayco&&input.args.p_mode==='rayco_tv_box')return reply(200,{data:null,error:{code:'PIP07',message:'TV Box Rayco exige serie/MAC y custodia (respuesta sintética)'}});
     return reply(200,{data:{valid:true,installationId:id,clientId:order.client_id,contractId:order.contract_id,mode:input.args.p_mode,operationId:input.args.p_operation_id,payloadHash:input.args.p_payload_hash,materialChecked:true},error:null});
    }
    if(action==='update'){
     if(order.status==='completed')return reply(409,{error:'ORDER_ALREADY_COMPLETED'});
     if(!input.patch.closure_operation_id||!input.patch.closure_payload_hash)return reply(400,{error:'RECEIPT_REQUIRED'});
     Object.assign(order,input.patch);state.writes++;save();event({kind:'closure',id,operationId:order.closure_operation_id,hash:order.closure_payload_hash});
     if(input.loseResponse){state.lostResponses++;save();res.destroy();return;}
     return reply(200,{data:order,error:null});
    }
    if(action==='evidence'){event({kind:'device-evidence',id,result:input.result});return reply(200,{recorded:true});}
    return reply(400,{error:'ACTION_NOT_ALLOWED'});
   }
   if(req.method!=='GET')return reply(405,{error:'METHOD_NOT_ALLOWED'});
   const relative=decodeURIComponent(url.pathname).replace(/^\//,'')||'scripts/android-iptv-lab/lab.html';
   const file=path.resolve(config.web,relative);
   if(!file.startsWith(path.resolve(config.web)+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return reply(404,{error:'NOT_FOUND'});
   const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.png':'image/png'}[path.extname(file)]??'application/octet-stream';
   res.writeHead(200,{'Content-Type':type});res.end(fs.readFileSync(file));
  }catch(error){event({kind:'error',message:error.message});if(!res.destroyed)reply(500,{error:error.message});}
 });
 return new Promise(resolve=>server.listen(port,'127.0.0.1',()=>resolve({server,port:server.address().port,config,state,save})));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const lab=await startLab(process.argv[2]);console.log(JSON.stringify({ready:true,port:lab.port,loopbackOnly:true,sourceCommit:lab.config.sourceCommit,productionWrites:0}));
}
