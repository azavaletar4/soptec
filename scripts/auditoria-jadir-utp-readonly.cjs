// Diagnostico de solo lectura para el caso Jadir/UTP (auditoria operativa 2026-11-01).
// Mismo patron ya usado: corre dentro del contenedor backend real en la VM via SSH,
// nunca trae credenciales a este contexto. No escribe nada.
const cp=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const program=`
import {supabaseAdmin} from './server/src/lib/supabaseAdmin.ts';
const out={};
// 1) Tecnico Jadir (TECNICO_RED activo)
const {data:techs,error:te}=await supabaseAdmin.from('profiles').select('id,role,active').ilike('full_name','%Jadir%');
out.techsFound=techs?.length??null; out.techsError=te?.code??null;
out.techs=techs?.map(t=>({idPrefix:t.id.slice(0,8),role:t.role,active:t.active}))??[];
const jadirId = techs && techs.length===1 ? techs[0].id : null;
out.singleTech = !!jadirId;
// 2) Productos UTP en catalogo
const {data:prods,error:pe}=await supabaseAdmin.from('inventory_products').select('id,name,unit,is_active,is_serialized,current_stock').ilike('name','%UTP%');
out.productsError=pe?.code??null;
out.products=prods?.map(p=>({idPrefix:p.id.slice(0,8),name:p.name,unit:p.unit,active:p.is_active,serialized:p.is_serialized,currentStock:p.current_stock}))??[];
const utpIds = prods?.map(p=>p.id) ?? [];
if (jadirId && utpIds.length){
 // 3) Custodia actual de Jadir para cada producto UTP
 const {data:custody,error:ce}=await supabaseAdmin.from('technician_material_custody').select('product_id,quantity,updated_at').eq('technician_id',jadirId).in('product_id',utpIds);
 out.custodyError=ce?.code??null;
 out.custody=custody?.map(c=>({productIdPrefix:c.product_id.slice(0,8),quantity:c.quantity,updatedAt:c.updated_at}))??[];
 // 4) Eventos de custodia (historial delivery/consumption/...) para Jadir+UTP
 const {data:events,error:ee}=await supabaseAdmin.from('technician_material_custody_events').select('product_id,event_type,quantity,created_at,source_movement_id').eq('technician_id',jadirId).in('product_id',utpIds).order('created_at',{ascending:true});
 out.eventsError=ee?.code??null;
 out.events=events?.map(e=>({productIdPrefix:e.product_id.slice(0,8),type:e.event_type,quantity:e.quantity,at:e.created_at,hasSourceMovement:!!e.source_movement_id}))??[];
 // 5) Movimientos de egreso de 25 (cualquier unidad) en productos UTP creados por Jadir
 const {data:moves,error:me}=await supabaseAdmin.from('inventory_movements').select('id,product_id,movement_type,quantity,created_at,installation_id,ticket_id,created_by').eq('created_by',jadirId).in('product_id',utpIds).order('created_at',{ascending:true});
 out.movesError=me?.code??null;
 out.moves=moves?.map(m=>({idPrefix:m.id.slice(0,8),productIdPrefix:m.product_id.slice(0,8),type:m.movement_type,quantity:m.quantity,at:m.created_at,jobType:m.installation_id?'installation':(m.ticket_id?'ticket':null)}))??[];
 // 6) Rechazos pendientes/historicos de Jadir para accion consume/kit (cualquier producto, filtramos UTP por payload)
 const {data:rejections,error:re}=await supabaseAdmin.from('material_inventory_rejections').select('operation_id,job_type,job_id,action,payload,message,status,created_at,resolved_at').eq('actor_id',jadirId).in('action',['consume','kit']);
 out.rejectionsError=re?.code??null;
 out.rejections=rejections?.map(r=>{
  const payloadStr=JSON.stringify(r.payload||{});
  const mentionsUtp = utpIds.some(id=>payloadStr.includes(id));
  return mentionsUtp ? {jobType:r.job_type,jobIdPrefix:r.job_id.slice(0,8),action:r.action,quantity:r.payload?.quantity ?? (r.payload?.items?? null),status:r.status,createdAt:r.created_at,resolvedAt:r.resolved_at,message:r.message} : null;
 }).filter(Boolean) ?? [];
}
console.log(JSON.stringify(out));
`;
const r=cp.spawnSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=15','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'],{input:String.raw`import subprocess,json,pathlib
d=json.loads(subprocess.check_output(['docker','inspect','smartrayco-backend-1'],text=True))[0]
net=next(iter(d['NetworkSettings']['Networks']))
envfile='/opt/smartrayco-staging/frontend-consolidado-tr069-27fa249-6cc2b1f09b/backend-env-private'
p=subprocess.run(['docker','run','--rm','--network',net,'--env-file',envfile,'smartrayco-backend-wifitrial:27fa249b4ddb','node','--import','tsx','--input-type=module','-e',${JSON.stringify(program)}],capture_output=True,text=True)
print(json.dumps({'code':p.returncode,'stdout':p.stdout.strip(),'stderr':p.stderr[-1500:]}))
`,encoding:'utf8',timeout:60000,windowsHide:true});
if(r.status!==0){console.error('SSH_FAILED',r.stderr);process.exitCode=1;}else{
 console.log(r.stdout);
 fs.writeFileSync('docs/AUDITORIA-JADIR-UTP-READONLY-20261101.json', r.stdout.trim()+'\n');
}
