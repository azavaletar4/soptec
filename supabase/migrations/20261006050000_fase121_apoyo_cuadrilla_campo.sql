-- SmartRayco — Fase 121: trabajo en cuadrilla (Lider + Apoyos) desde la App
-- de Campo.
--
-- job_assignees (Fase 94/98/101/118) ya modela lider/apoyo y ya es la fuente
-- de verdad de quien puede operar una orden — tickets_update_staff/
-- installations_update_staff/routines_update_staff YA dejan escribir la
-- orden a CUALQUIER integrante de la cuadrilla (no solo a assigned_to), y
-- work_order_photos/work_order_closures/inventory_movements/client_photos/
-- client_equipment_photos ya son de staff en general (sin filtrar por
-- cuadrilla) — es decir, un apoyo YA PODIA escribir evidencia/materiales/
-- cierre en el servidor. Lo unico que faltaba:
--   1) una forma de que el propio LIDER agregue un apoyo desde la App de
--      Campo (job_assignees_write_dispatch, Fase 94, solo deja escribir ahi
--      a SUPERADMIN/ADMIN/SOPORTE — a proposito, para que un tecnico no se
--      auto-asigne como apoyo de cualquier cosa). Se resuelve con una
--      funcion SECURITY DEFINER angosta, mismo patron que self_assign_*.
--   2) que un apoyo (sin ser el "assigned_to" que refleja solo al lider)
--      vea la orden en su propia App de Campo — eso es trabajo de frontend
--      (campoStore.trabajos), no de RLS.

create or replace function public.add_support_technician(p_job_type text, p_job_id uuid, p_technician_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if public.current_user_role() <> 'TECNICO_RED' then
    raise exception 'Solo un tecnico de red puede agregar apoyo a una cuadrilla';
  end if;
  if p_job_type not in ('ticket', 'installation', 'routine') then
    raise exception 'Tipo de orden invalido';
  end if;

  -- Solo quien YA es parte de la cuadrilla (lider o apoyo) puede sumar a
  -- alguien mas — evita que cualquier tecnico se inserte en ordenes ajenas.
  if not exists (
    select 1 from public.job_assignees
    where job_type = p_job_type and job_id = p_job_id and technician_id = v_uid
  ) then
    raise exception 'Solo un integrante de la cuadrilla puede agregar apoyo';
  end if;

  insert into public.job_assignees (job_type, job_id, technician_id, role)
  values (p_job_type, p_job_id, p_technician_id, 'support')
  on conflict (job_type, job_id, technician_id) do nothing;
end;
$$;

revoke all on function public.add_support_technician(text, uuid, uuid) from public;
grant execute on function public.add_support_technician(text, uuid, uuid) to authenticated;

-- Realtime (postgres_changes): para que si un apoyo sube una foto o agrega
-- un material desde su celular, la pantalla del resto de la cuadrilla se
-- actualice sola, sin recargar. Respeta las policies de SELECT ya
-- existentes (staff en general) — no expone nada que un fetch normal no
-- pudiera leer ya. Unica tabla en la publicacion hasta ahora: profiles
-- (Fase 115b).
alter publication supabase_realtime add table public.job_assignees;
alter publication supabase_realtime add table public.work_order_photos;
alter publication supabase_realtime add table public.inventory_movements;
alter publication supabase_realtime add table public.inventory_units;
