-- CANDIDATO LOCAL, SIN APLICAR. Regla operativa aprobada por el usuario
-- (caso real: Diego Villanueva Bernabe, CTR-2026-00727, 2026-10-21):
-- los errores de registro/saldo/custodia de MATERIALES NO SERIALIZADOS
-- (Patchcord, Roseta Óptica, Conector Óptico, Drop, etc.) NO deben
-- bloquear el cierre técnico de una Alta/Avería/Rutina. Los EQUIPOS
-- SERIALIZADOS (ONT/TV Box por serie/MAC) siguen fuera de esta tabla y
-- de este candidato por completo -- su propia validación (asignación por
-- unidad, custodia, correspondencia con el servicio) no se toca.
--
-- CAUSA RAIZ del bloqueo real: assert_no_rejected_materials (Fase 165
-- etapa 2, 20261019170000) bloquea el cierre mientras exista CUALQUIER
-- fila 'pending' en material_inventory_rejections para la orden -- sin
-- distinguir si el material en cuestión es serializado o no (hoy nunca
-- lo es: campo_inventory_operation_f165_impl exige `not product.is_serialized`
-- para las acciones 'consume'/'kit'/'correct', las únicas que pueden
-- insertar en esta tabla -- ver 20261019160000). La corrección de
-- 20261020130000 (reusar el MISMO operation_id con cantidad corregida)
-- solo resuelve la fila cuando el reintento reutiliza esa clave; si el
-- reintento del técnico generó un operation_id NUEVO (p.ej. estado local
-- perdido entre intentos), la fila original queda 'pending' para
-- siempre aunque el material ya haya quedado registrado por otra vía --
-- bloqueando el cierre sin que quede nada pendiente en los hechos. El
-- diseño anterior ya preveía esto como "revisión administrativa"
-- (cancel_rejected_material_operation); la regla nueva evita que el
-- técnico quede bloqueado en campo mientras esa revisión no ocurre.
--
-- CORRECCIÓN: assert_no_rejected_materials deja de bloquear -- pasa a
-- ser un no-op. No se toca ninguna otra pieza de Fase 165: la tabla
-- material_inventory_rejections, su RLS de solo lectura, el registro
-- del rechazo (execute_tracked_material_inventory), la corrección por
-- misma clave y cancel_rejected_material_operation (anulación
-- administrativa explícita, con motivo) siguen exactamente igual --
-- el rechazo se CONSERVA tal cual para que administración lo revise y
-- regularice, simplemente deja de impedir que el técnico cierre. Los 4
-- triggers de guard_rejected_material_closure (work_order_closures,
-- installations, tickets, routines) siguen llamando a esta función --
-- con el cuerpo vacío, dejan de bloquear sin que haya que tocarlos ni
-- desconectarlos.
begin;
do $$ begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.assert_no_rejected_materials(text,uuid)')
  and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g'))='3ecf94d3f4f0f8c004b8208acb98592d') then
  raise exception 'assert_no_rejected_materials difiere de la version revisada; detener y comparar';
 end if;
end $$;

create or replace function public.assert_no_rejected_materials(p_job_type text,p_job_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 -- Fase 166: un rechazo de material NO serializado pendiente ya no
 -- bloquea el cierre (regla operativa aprobada) -- queda registrado en
 -- material_inventory_rejections para advertencia/anulación
 -- administrativa (InventarioCustodiaView.vue, InstalacionDetailView.vue),
 -- nunca silenciado ni anulado automáticamente.
 perform 1;
end $$;
commit;
