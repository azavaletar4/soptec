import type { SupabaseClient } from '@supabase/supabase-js';
import type { FieldInventoryPage } from '../../../src/types/fieldInventory';
export class FieldInventoryError extends Error {
 constructor(public status: 400 | 403 | 409 | 500, message: string) { super(message); }
}
const uuid=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const views=['products','materials','assigned','pending','available','unit-context','linked','events','contracts'];
/** JWT solicitante: SQL autoriza cada lectura. Sin fallback a tablas generales. */
export async function readFieldInventory(db: SupabaseClient, actorId: string, input: {
 jobType: string; jobId: string; view: string; page?: string; productId?: string; unitId?: string; action?: string;
}) {
 const {jobType,jobId,view,productId,unitId,action}=input, page=Number(input.page??'0');
 if(!['installation','ticket','routine'].includes(jobType)||!uuid.test(jobId)||!views.includes(view)||
  !Number.isSafeInteger(page)||page<0||page>10000||(productId&&!uuid.test(productId))||(unitId&&!uuid.test(unitId))) {
  throw new FieldInventoryError(400,'La consulta de inventario no es válida.');
 }
 const {data,error}=await db.rpc('inventory_order_read',{
  p_job_type:jobType,p_job_id:jobId,p_view:view,p_page:page,
  p_product_id:productId??null,p_unit_id:unitId??null,p_action:action??null,
 });
 if(error){
  if(error.code==='42501')throw new FieldInventoryError(403,'No tienes acceso vigente al inventario de esta orden.');
  if(error.code==='22023')throw new FieldInventoryError(400,'La consulta de inventario no es válida.');
  if(error.code==='55P03')throw new FieldInventoryError(409,'Hay otra operación en curso. Puedes reintentarlo de forma segura.');
  throw new FieldInventoryError(500,'No se pudo consultar el inventario de la orden. Intenta nuevamente.');
 }
 const result=data as FieldInventoryPage<unknown>;
 if(!result||result.context?.actorId!==actorId||result.context.jobId!==jobId||result.context.jobType!==jobType||
  !Array.isArray(result.items)||result.items.length>100||(result.next!==null&&result.next!==page+1)) {
  throw new FieldInventoryError(500,'No se pudo confirmar el contexto de inventario.');
 }
 return result;
}
