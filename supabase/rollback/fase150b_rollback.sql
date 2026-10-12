-- SmartRayco — ROLLBACK de Fase 150b (hotfix enum en
-- track_job_work_session). NO es una migración de avance — vive fuera de
-- supabase/migrations/ a propósito, para que ninguna herramienta la
-- aplique por error junto a las demás. Ejecutar a mano, solo si Fase 150b
-- ya se aplicó y hace falta revertirla.
--
-- Restaura EXACTAMENTE la definición de track_job_work_session() tal como
-- quedó en Fase 150 (migración 20261012140000) — mismo texto literal.
-- ADVERTENCIA: esa versión es la que tiene el bug "invalid input value for
-- enum routine_status/installation_status" al completar una Rutina o una
-- Alta — solo revertir si Fase 150b introdujo un problema distinto y hace
-- falta volver al estado anterior mientras se investiga. Idempotente.

create or replace function public.track_job_work_session()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_job_type text := tg_argv[0];
begin
  if new.status is distinct from old.status then
    if new.status = 'in_progress' and old.status <> 'in_progress' then
      if not exists (
        select 1 from public.job_work_sessions
        where job_type = v_job_type and job_id = new.id and ended_at is null
      ) then
        insert into public.job_work_sessions (job_type, job_id, started_at)
        values (v_job_type, new.id, now());
      end if;
    elsif old.status = 'in_progress' and new.status <> 'in_progress' then
      update public.job_work_sessions
      set ended_at = now(),
          end_reason = case
            when new.status in ('completed', 'resolved', 'closed') then 'finished'
            when new.status = 'cancelled' then 'cancelled_order'
            else 'paused'
          end
      where job_type = v_job_type and job_id = new.id and ended_at is null;
    end if;
  end if;
  return new;
end;
$$;
