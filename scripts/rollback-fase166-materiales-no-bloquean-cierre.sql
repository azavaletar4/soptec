-- Revierte 20261021190000_fase166_materiales_no_bloquean_cierre.sql.
-- Rollback de comportamiento, no de datos: restaura
-- assert_no_rejected_materials a su version anterior (Fase 165 etapa 2,
-- 20261019170000) -- un rechazo 'pending' vuelve a bloquear el cierre de
-- la orden hasta corregirse (misma clave) o anularse administrativamente.
-- Las filas de material_inventory_rejections no se tocan (insert-only).
begin;
do $$ begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.assert_no_rejected_materials(text,uuid)')
  and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g'))='4201e9cb13b8b93d2ae80a0cc44035c2') then
  raise exception 'assert_no_rejected_materials difiere de la aplicada por el candidato Fase 166; detener y comparar antes de revertir';
 end if;
end $$;

create or replace function public.assert_no_rejected_materials(p_job_type text,p_job_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if exists(select 1 from public.material_inventory_rejections where job_type=p_job_type and job_id=p_job_id and status='pending') then
   raise exception 'No se puede cerrar la orden: hay material que no se registro por falta de custodia. Solicita la entrega y reintenta la operacion pendiente, o pide a administracion revisar un intento equivocado.' using errcode='P1651';
 end if;
end $$;
commit;
