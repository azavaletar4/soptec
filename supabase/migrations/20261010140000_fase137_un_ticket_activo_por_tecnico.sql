-- SmartRayco — Fase 137: un tecnico solo puede tener UN ticket/alta/rutina en
-- ejecucion (status='in_progress') a la vez, global a los 3 tipos.
--
-- Hasta ahora "Iniciar" (self_assign_ticket al tomar una averia libre, o el
-- boton "Iniciar Orden"/"Iniciar orden" de CampoDashboardView.vue /
-- OperacionesHoyView.vue) era un UPDATE plano de status, sin ninguna
-- comprobacion cruzada: un tecnico podia tener 2+ atenciones "en curso" al
-- mismo tiempo (2 pestañas, Panel Web + App de Campo, o simplemente iniciar
-- otra sin terminar la anterior). Confirmado revisando todo el codigo: no
-- existia ninguna restriccion de este tipo, ni en frontend ni en backend.
--
-- DISEÑO: un solo trigger BEFORE UPDATE en tickets/installations/routines
-- (reusa job_assignees, Fase 94/101/121, para saber quien esta asignado,
-- incluida cuadrilla/apoyo — no solo el lider) que se activa SOLO al ENTRAR
-- a 'in_progress' (old.status distinto de new.status). Por cada tecnico
-- asignado al job:
--   1. pg_advisory_xact_lock(hashtext(tecnico)) — serializa cualquier otro
--      intento de "iniciar" del MISMO tecnico mientras dura esta
--      transaccion (2 dispositivos/pestañas no pueden colarse entre el
--      chequeo y el update). Se libera solo al terminar la transaccion
--      (commit o rollback), nunca hay que liberarlo a mano. Sin este lock,
--      dos UPDATE concurrentes sobre DOS FILAS DISTINTAS no se bloquean
--      entre si (cada uno solo toma el lock de fila de su propio id), asi
--      que ambos podrian leer "sin conflicto" antes de que el otro
--      confirme — el advisory lock por tecnico cierra esa carrera.
--   2. Busca en vivo (no hay tabla de cupos que desincronizar) si ese
--      tecnico ya tiene OTRO ticket/alta/rutina con status='in_progress' —
--      si lo encuentra, aborta con un mensaje legible + un HINT
--      "job_type:job_id" para que el frontend arme el link "Ver ticket
--      activo" sin tener que parsear el mensaje.
-- No hace falta "liberar" nada al salir de in_progress (resuelto, cerrado,
-- completado, cancelado, reprogramado): el chequeo siempre lee el estado
-- REAL de las 3 tablas, nunca una copia que se pueda desincronizar.
--
-- Cubre automaticamente, sin tocarlos: self_assign_ticket (pone in_progress
-- al tomar una averia libre, Fase 98), el boton "Iniciar Orden"/"Iniciar
-- orden" de ambas pantallas, y el reabrir manual de TicketDetailView.vue
-- (admin) — las 3 rutas hacen un UPDATE normal de status sobre la fila.
--
-- Los estados "pendiente", "asignado" o "programado" (open/rescheduled en
-- tickets; pending/scheduled en installations/routines) nunca bloquean nada
-- — el chequeo solo mira status='in_progress'. No existe un estado
-- "pausado" en el esquema actual (TicketStatus/InstallationStatus/
-- RoutineStatus no lo tienen) — si se agrega a futuro, debe decidirse
-- explicitamente si ocupa el cupo o no; con el diseño actual NO lo ocuparia
-- (solo 'in_progress' cuenta), que es el comportamiento mas simple y seguro
-- por defecto.

create or replace function public.enforce_single_active_job()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_job_type text := tg_argv[0];
  v_tech uuid;
  v_conflict_type text;
  v_conflict_id uuid;
  v_conflict_number text;
begin
  if new.status is distinct from old.status and new.status = 'in_progress' then
    for v_tech in
      select ja.technician_id from public.job_assignees ja
      where ja.job_type = v_job_type and ja.job_id = new.id
    loop
      perform pg_advisory_xact_lock(hashtext(v_tech::text));

      v_conflict_type := null;
      v_conflict_id := null;
      v_conflict_number := null;

      select t.id, t.ticket_number into v_conflict_id, v_conflict_number
        from public.tickets t
        where t.status = 'in_progress'
          and (v_job_type <> 'ticket' or t.id <> new.id)
          and exists (
            select 1 from public.job_assignees ja2
            where ja2.job_type = 'ticket' and ja2.job_id = t.id and ja2.technician_id = v_tech
          )
        limit 1;
      if found then v_conflict_type := 'ticket'; end if;

      if v_conflict_type is null then
        select i.id into v_conflict_id
          from public.installations i
          where i.status = 'in_progress'
            and (v_job_type <> 'installation' or i.id <> new.id)
            and exists (
              select 1 from public.job_assignees ja2
              where ja2.job_type = 'installation' and ja2.job_id = i.id and ja2.technician_id = v_tech
            )
          limit 1;
        if found then v_conflict_type := 'installation'; end if;
      end if;

      if v_conflict_type is null then
        select r.id, r.routine_number into v_conflict_id, v_conflict_number
          from public.routines r
          where r.status = 'in_progress'
            and (v_job_type <> 'routine' or r.id <> new.id)
            and exists (
              select 1 from public.job_assignees ja2
              where ja2.job_type = 'routine' and ja2.job_id = r.id and ja2.technician_id = v_tech
            )
          limit 1;
        if found then v_conflict_type := 'routine'; end if;
      end if;

      if v_conflict_type is not null then
        raise exception 'Ya tienes un ticket en ejecución: % % — debes finalizarla antes de iniciar otra atención.',
          case v_conflict_type when 'ticket' then 'Avería' when 'installation' then 'Alta' else 'Rutina' end,
          coalesce(v_conflict_number, '#' || left(v_conflict_id::text, 8))
          using errcode = 'P0001', hint = v_conflict_type || ':' || v_conflict_id;
      end if;
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_tickets_single_active_job on public.tickets;
create trigger trg_tickets_single_active_job
  before update on public.tickets
  for each row execute function public.enforce_single_active_job('ticket');

drop trigger if exists trg_installations_single_active_job on public.installations;
create trigger trg_installations_single_active_job
  before update on public.installations
  for each row execute function public.enforce_single_active_job('installation');

drop trigger if exists trg_routines_single_active_job on public.routines;
create trigger trg_routines_single_active_job
  before update on public.routines
  for each row execute function public.enforce_single_active_job('routine');
