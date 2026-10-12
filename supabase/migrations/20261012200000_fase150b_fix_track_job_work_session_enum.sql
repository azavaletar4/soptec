-- SmartRayco — Fase 150b: HOTFIX de produccion — "invalid input value for
-- enum routine_status: resolved" al completar una Rutina (y el mismo error
-- con installation_status al completar una Alta) desde App de Campo.
--
-- CAUSA RAIZ: public.track_job_work_session() (Fase 150, migracion
-- 20261012140000) se registra con el MISMO cuerpo de funcion en 3 triggers
-- distintos — tickets, installations, routines — pero su CASE para decidir
-- end_reason tiene:
--
--   when new.status in ('completed', 'resolved', 'closed') then 'finished'
--
-- `new.status` es de un tipo ENUM DISTINTO segun la tabla que dispare el
-- trigger (ticket_status / installation_status / routine_status).
-- Postgres necesita castear CADA literal del IN-list al tipo de new.status
-- para poder compararlos — y 'resolved'/'closed' NO existen en
-- installation_status ni en routine_status (confirmado via pg_enum: esos
-- dos solo tienen pending/scheduled/in_progress/completed/cancelled; solo
-- ticket_status tiene resolved/closed). El cast falla ANTES de evaluar nada
-- mas, apenas la orden sale de 'in_progress' hacia 'completed' (o hacia
-- cualquier otro estado) en installations/routines — por eso "Completar
-- rutina" y "Completar instalación" quedan rotos desde que se aplico Fase
-- 150, mientras que Averias (tickets, que si tiene 'resolved'/'closed')
-- nunca mostro el error.
--
-- Las demas comparaciones de la funcion (`new.status = 'in_progress'`,
-- `old.status = 'in_progress'`) son seguras porque 'in_progress' SI existe
-- en los 3 enums — no se tocan.
--
-- CORRECCION MINIMA: castear new.status a text antes de la comparacion
-- (`new.status::text in (...)`). Con ambos lados como texto plano, Postgres
-- ya no intenta castear los literales al enum de la tabla — la comparacion
-- funciona igual para los 3 tipos sin inventar valores nuevos ni tocar la
-- definicion de ningun enum. No cambia ninguna otra logica de la funcion:
-- misma deteccion de entrada/salida de 'in_progress', mismo
-- 'cancelled_order'/'paused' para los demas casos.
--
-- Esta migracion reemplaza (CREATE OR REPLACE) la misma funcion de Fase
-- 150 — no toca los triggers (siguen apuntando a la misma funcion, no hace
-- falta recrearlos) ni la tabla job_work_sessions. Idempotente.

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
      -- No duplica si por algun motivo ya hubiera una sesion abierta
      -- (no deberia pasar nunca con el flujo normal; el indice unico de
      -- arriba igual lo bloquearia con error si este chequeo fallara).
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
            -- Fase 150b: ::text evita que Postgres intente castear
            -- 'resolved'/'closed' al enum de installation_status/
            -- routine_status (no existen ahi) solo para poder comparar.
            when new.status::text in ('completed', 'resolved', 'closed') then 'finished'
            when new.status::text = 'cancelled' then 'cancelled_order'
            else 'paused'
          end
      where job_type = v_job_type and job_id = new.id and ended_at is null;
    end if;
  end if;
  return new;
end;
$$;
