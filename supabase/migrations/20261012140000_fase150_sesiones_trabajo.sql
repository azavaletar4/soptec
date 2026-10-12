-- SmartRayco — Fase 150 (PROPUESTA, NO desplegada todavia): sesiones de
-- trabajo por orden (Averia/Alta/Rutina) para medir tiempo efectivo real,
-- distinto del "Tiempo de respuesta" (creacion -> atencion) que ya existe
-- en el Historico de Atendidos y que esta migracion NO toca.
--
-- PROBLEMA: no existe ninguna marca de "inicio de atencion" en el esquema
-- actual. Confirmado antes de escribir esto: tickets/installations/
-- routines no tienen started_at/in_progress_at, no hay tabla de auditoria
-- de cambios de estado, y `updated_at` NO sirve de proxy porque se pisa
-- con cualquier edicion posterior (ej. un admin cambia la prioridad
-- despues). El propio comentario del trigger de Fase 137
-- (enforce_single_active_job) ya documenta que "No existe un estado
-- 'pausado' en el esquema actual".
--
-- DISEÑO: una tabla de sesiones vinculada a cada ORDEN (no al tecnico —
-- una orden puede tener cuadrilla de varios tecnicos trabajando a la vez;
-- lo que se mide es cuanto tiempo estuvo la ORDEN en ejecucion, no
-- horas-hombre). Reutiliza los cambios de estado que YA EXISTEN y ya
-- representan inicio/fin real de atencion — no se agrega ningun boton
-- nuevo de "pausar" en la App de Campo, Fase 150 solo OBSERVA status:
--
--   - ENTRAR a 'in_progress' (desde cualquier otro estado) = abre una
--     sesion nueva. Cubre tanto "Iniciar Orden" del tecnico (self_assign_
--     ticket, boton "Iniciar Orden"/"Iniciar orden") como que un admin
--     reabra manualmente una orden a in_progress desde el Panel Web.
--   - SALIR de 'in_progress' hacia cualquier otro estado = cierra la
--     sesion abierta, con un motivo:
--       - hacia un cierre de exito (resolved/closed en tickets, completed
--         en instalaciones/rutinas) -> 'finished'.
--       - hacia 'cancelled' -> 'cancelled_order' (se cuenta el tiempo ya
--         trabajado hasta la cancelacion, no se descarta — es trabajo
--         real que se hizo).
--       - hacia cualquier otro estado (scheduled/pending/open/
--         rescheduled) -> 'paused'. Es el caso real de "el tecnico dejo
--         la orden sin terminar" (ej. Cliente Ausente en tickets, Fase
--         102; o un admin regresa el estado manualmente desde el Panel
--         Web). Si despues vuelve a 'in_progress', se abre una sesion
--         NUEVA — sumar solo sesiones CERRADAS excluye automaticamente el
--         hueco de la pausa, sin necesidad de restarlo a mano.
--
-- NO es lo mismo que `asistencia_registros` (Fase 117/135) — esa es la
-- jornada diaria COMPLETA del tecnico (entrada/salida/almuerzo), esto es
-- POR ORDEN. No se mezclan ni se cruzan en ninguna consulta.
--
-- Una orden completada/cancelada SIN haber pasado nunca por 'in_progress'
-- (ej. un admin la completa directo desde el Panel Web) queda con CERO
-- filas en esta tabla — el frontend debe mostrar "No registrado", nunca
-- inventar un tiempo. Los trabajos historicos (anteriores a este
-- despliegue) tambien quedan asi: no hay backfill posible, no se inventan
-- eventos que no ocurrieron.
--
-- Idempotente: permite re-ejecutar el archivo completo sin error.

create table if not exists public.job_work_sessions (
  id         uuid primary key default gen_random_uuid(),
  job_type   text not null check (job_type in ('ticket', 'installation', 'routine')),
  job_id     uuid not null,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  end_reason text check (end_reason in ('finished', 'cancelled_order', 'paused')),
  created_at timestamptz not null default now()
);

create index if not exists idx_job_work_sessions_job on public.job_work_sessions (job_type, job_id);

-- A lo sumo UNA sesion abierta por orden a la vez — refuerza a nivel de BD
-- lo que ya garantiza el trigger de abajo (cinturon y tirantes: si algo
-- insertara directo sin pasar por el trigger, este indice lo bloquea con
-- un error claro en vez de dejar datos inconsistentes).
create unique index if not exists idx_job_work_sessions_one_open
  on public.job_work_sessions (job_type, job_id)
  where ended_at is null;

alter table public.job_work_sessions enable row level security;

-- Mismo criterio de lectura que tickets/installations/routines/
-- job_assignees: todo el staff interno ve todo. Sin policy de insert/
-- update/delete para NINGUN rol — solo el trigger (security definer)
-- escribe aca, para que ni el frontend ni un tecnico con acceso directo a
-- la API puedan fabricar o alterar una sesion.
drop policy if exists "job_work_sessions_select_staff" on public.job_work_sessions;
create policy "job_work_sessions_select_staff"
  on public.job_work_sessions for select to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

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

drop trigger if exists trg_track_work_session on public.tickets;
create trigger trg_track_work_session
  after update on public.tickets
  for each row execute procedure public.track_job_work_session('ticket');

drop trigger if exists trg_track_work_session on public.installations;
create trigger trg_track_work_session
  after update on public.installations
  for each row execute procedure public.track_job_work_session('installation');

drop trigger if exists trg_track_work_session on public.routines;
create trigger trg_track_work_session
  after update on public.routines
  for each row execute procedure public.track_job_work_session('routine');
