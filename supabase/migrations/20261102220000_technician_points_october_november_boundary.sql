-- CANDIDATA LOCAL -- sin aplicar en Supabase todavia.
-- Corrige un vacio real de produccion (RUT-2026-00118 y 11 ordenes mas, 4
-- tecnicos, 22 puntos atrapados -- verificado solo lectura contra
-- produccion antes de escribir esto): technician_point_contributions()
-- exigia order_created_at>=corte para el bucket oficial, ademas de
-- technical_completed_at y confirmed_at. Una orden CREADA la noche antes
-- del corte pero TERMINADA y CONFIRMADA ya en noviembre (patron real y
-- normal, no excepcional) nunca entraba al oficial por esa fecha de
-- creacion, y tampoco entraba al historico porque su finalizacion tecnica
-- ya es posterior al corte -- quedaba invisible para cualquier periodo.
--
-- La proteccion real contra "reabrir una orden de prueba de octubre para
-- que cuente como oficial" (motivo original de esta condicion, ver
-- 20261024200000) la da el trigger guard_final_work_order(): bloquea
-- CUALQUIER UPDATE/DELETE sobre una orden ya confirmada, sin excepcion,
-- independiente de cualquier fecha. order_created_at no agregaba ninguna
-- proteccion que ese trigger no ya diera; solo excluia trabajo real que
-- cruza la medianoche del corte. Se quita exclusivamente esa condicion;
-- technical_completed_at>=corte y confirmed_at>=corte (lo que de verdad
-- expresa "finalizacion efectiva + confirmacion administrativa") siguen
-- exactamente iguales -- ninguna orden terminada o confirmada antes del
-- corte pasa a oficial, y la union con el historico sigue siendo
-- mutuamente excluyente (nunca se cuenta dos veces la misma orden).
begin;
create or replace function public.technician_point_contributions(p_start timestamptz,p_end timestamptz)
returns table(technician_id uuid,job_type text,job_id uuid,occurred_at timestamptz,kind text,category text,crew_size bigint,points numeric)
language sql stable security definer set search_path=public as $$
  with official as materialized (
    select c.* from public.work_order_point_confirmations c
    where c.confirmed_at>=timestamptz '2026-11-01 00:00:00 America/Lima'
      and c.technical_completed_at>=timestamptz '2026-11-01 00:00:00 America/Lima'
      and c.confirmed_at>=p_start and c.confirmed_at<p_end
  ), crew as (
    select c.*, (member->>'technicianId')::uuid as technician_id,jsonb_array_length(c.crew)::bigint as crew_size,
      (member->>'points')::numeric as frozen_points,(member->>'recurrencePenalty')::numeric as frozen_penalty
    from official c cross join lateral jsonb_array_elements(c.crew) member
  )
  select * from public.technician_point_contributions_legacy(p_start,least(p_end,timestamptz '2026-11-01 00:00:00 America/Lima'))
  where p_start<timestamptz '2026-11-01 00:00:00 America/Lima'
  union all
  select c.technician_id,c.job_type,c.job_id,c.confirmed_at,'work',c.category,c.crew_size,c.frozen_points from crew c
  union all
  -- Descuento y partes congelados al confirmar; una nueva avería no los recalcula.
  select c.technician_id,c.job_type,c.job_id,c.confirmed_at,'recurrence',c.category,c.crew_size,c.frozen_penalty from crew c
  where c.frozen_penalty<>0;
$$;
revoke all on function public.technician_point_contributions(timestamptz,timestamptz) from public,anon,authenticated,service_role;
commit;
