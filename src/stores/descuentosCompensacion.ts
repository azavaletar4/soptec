import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import { penCents, penDecimal } from '@/lib/financeMoney';
import type { DescuentoCompensacion, DescuentoCompensacionCriterio } from '@/types/domain';
const SELECT='*, clients(id, first_name, last_name)';
export const useDescuentosCompensacionStore=defineStore('descuentosCompensacion',()=>{
  const loading=ref(false);
  const attempts=new Map<string,string>();
  async function createIndividual(clientId:string,monto:number,motivo:string,contractId?:string){
    const key=JSON.stringify([clientId,contractId,monto,motivo]);
    const request=attempts.get(key)??crypto.randomUUID();attempts.set(key,request);
    const {data,error}=await supabase.rpc('finance_schedule_compensation',{
      p_operation_id:request,p_client_id:clientId,p_contract_id:contractId??null,
      p_amount:penDecimal(penCents(monto)),p_reason:motivo,
    });
    if(error)throw error;
    return data as unknown as DescuentoCompensacion;
  }
  async function createMasivo(params:{criterio:DescuentoCompensacionCriterio;criterioId:string;motivo:string;monto?:number;porcentaje?:number}){
    const {data,error}=await supabase.rpc('crear_descuento_compensacion_masivo',{
      p_criterio:params.criterio,p_criterio_id:params.criterioId,p_motivo:params.motivo,
      p_monto:params.monto===undefined?null:penDecimal(penCents(params.monto)),p_porcentaje:params.porcentaje??null,
    });
    if(error)throw error;
    return (Array.isArray(data)?data[0]:data) as {lote_id:string;clientes_afectados:number};
  }
  async function fetchPendientesByClient(clientId:string){loading.value=true;try{
    const {data,error}=await supabase.from('descuentos_compensacion').select(SELECT).eq('client_id',clientId).order('created_at',{ascending:false});
    if(error)throw error;return (data??[]) as unknown as DescuentoCompensacion[];
  }finally{loading.value=false;}}
  async function cancelar(id:string){
    const {error}=await supabase.rpc('finance_cancel_compensation',{p_id:id,p_reason:'Cancelación administrativa de compensación pendiente desde ficha'});
    if(error)throw error;
  }
  return {loading,createIndividual,createMasivo,fetchPendientesByClient,cancelar};
});
