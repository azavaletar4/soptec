-- SmartRayco — Fase 137b: extiende la Fase 137 (un tecnico, un trabajo en
-- ejecucion a la vez) para cubrir tambien la REASIGNACION de cuadrilla, no
-- solo el "Iniciar" directo del propio tecnico.
--
-- Hueco que quedaba abierto en la Fase 137: el trigger de tickets/
-- installations/routines solo se activaba cuando la FILA DEL TRABAJO entra
-- a 'in_progress'. Pero un admin/soporte puede sumar a un tecnico a una
-- cuadrilla (job_assignees) de un trabajo que YA esta 'in_progress' — eso
-- nunca toca el status del trabajo (sigue 'in_progress', no cambia), asi
-- que el trigger de la Fase 137 no lo veia. Via CrewAssignEditor.vue
-- (store.addAssignee), self_assign_ticket/installation/routine (Fase
-- 98/118) y add_support_technician (Fase 121) — todos insertan en
-- job_assignees — un tecnico podia terminar sumado a un SEGUNDO trabajo ya
-- en curso sin que nada lo bloqueara.
--
-- DISEÑO:
-- 1) public.find_other_active_job(tecnico, tipo_a_excluir, id_a_excluir) —
--    la busqueda "¿este tecnico ya tiene OTRO trabajo in_progress?" se saca
--    a una funcion SQL compartida (antes vivia duplicada e inline dentro del
--    trigger de la Fase 137) para que los dos triggers (este y el de la
--    137) usen EXACTAMENTE la misma logica — evita que diverjan con el
--    tiempo si alguno se edita a futuro sin tocar el otro.
-- 2) enforce_single_active_job() (Fase 137) se reescribe para llamar a esa
--    funcion en vez de repetir las 3 consultas — mismo comportamiento,
--    menos codigo. Se agrega "order by technician_id" al loop de tecnicos
--    de la cuadrilla: con mas de 1 integrante, esto fija un ORDEN
--    DETERMINISTICO de adquisicion del advisory lock — necesario para que
--    dos ordenes de cuadrilla concurrentes (que comparten integrantes) no
--    puedan interbloquearse (deadlock) tomando los locks en orden opuesto.
-- 3) enforce_single_active_job_assignees() (nuevo) — trigger BEFORE INSERT
--    en job_assignees: si el trabajo al que se suma el tecnico YA esta
--    'in_progress' (sumarse a uno pendiente/programado NUNCA se bloquea,
--    punto 1 del pedido), toma el MISMO advisory lock por tecnico que ya
--    usa enforce_single_active_job() (misma clave: hashtext(technician_id))
--    — esto serializa correctamente contra una marcacion de "Iniciar"
--    concurrente del propio tecnico, sin necesitar logica aparte — y
--    busca con la misma funcion compartida si ese tecnico ya tiene otro
--    trabajo en curso. Cubre de una sola vez, sin tocarlos: addAssignee
--    (admin/soporte, CrewAssignEditor.vue), self_assign_ticket/
--    installation/routine, y add_support_technician — los 4 flujos de
--    insercion existentes en job_assignees, porque todos pasan por un
--    INSERT normal sobre esta tabla.
--
-- Revisado y NO se agrega guarda en UPDATE ni DELETE de job_assignees:
--   - UPDATE (setLeader, Fase 94) solo cambia el rol de alguien YA sumado a
--     ESE trabajo — no crea un vinculo tecnico-trabajo nuevo, asi que no
--     puede introducir el conflicto que esta fase previene (ya paso el
--     chequeo de INSERT cuando se sumo por primera vez).
--   - DELETE (removeAssignee) nunca necesita bloquearse por esta regla: si
--     se quita a un tecnico de un trabajo, deja de "participar" en el
--     segun este modelo de datos — por eso mismo puede sumarse despues a
--     otro sin problema, que es el comportamiento correcto (reasignacion
--     real), no un bypass.
--
-- Sigue sin existir una tabla de "cupos" que limpiar: todo se calcula en
-- vivo sobre tickets/installations/routines.status, igual que la Fase 137.

create or replace function public.find_other_active_job(p_technician_id uuid, p_exclude_job_type text, p_exclude_job_id uuid)
returns table (job_type text, job_id uuid, job_number text)
language sql
stable
security definer set search_path = public
as $$
  select 'ticket', t.id, t.ticket_number
    from public.tickets t
    where t.status = 'in_progress'
      and (p_exclude_job_type <> 'ticket' or t.id <> p_exclude_job_id)
      and exists (
        select 1 from public.job_assignees ja
        where ja.job_type = 'ticket' and ja.job_id = t.id and ja.technician_id = p_technician_id
      )
  union all
  select 'installation', i.id, null
    from public.installations i
    where i.status = 'in_progress'
      and (p_exclude_job_type <> 'installation' or i.id <> p_exclude_job_id)
      and exists (
        select 1 from public.job_assignees ja
        where ja.job_type = 'installation' and ja.job_id = i.id and ja.technician_id = p_technician_id
      )
  union all
  select 'routine', r.id, r.routine_number
    from public.routines r
    where r.status = 'in_progress'
      and (p_exclude_job_type <> 'routine' or r.id <> p_exclude_job_id)
      and exists (
        select 1 from public.job_assignees ja
        where ja.job_type = 'routine' and ja.job_id = r.id and ja.technician_id = p_technician_id
      )
  limit 1;
$$;

revoke all on function public.find_other_active_job(uuid, text, uuid) from public;

create or replace function public.enforce_single_active_job()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_job_type text := tg_argv[0];
  v_tech uuid;
  v_conflict record;
begin
  if new.status is distinct from old.status and new.status = 'in_progress' then
    for v_tech in
      select ja.technician_id from public.job_assignees ja
      where ja.job_type = v_job_type and ja.job_id = new.id
      order by ja.technician_id
    loop
      perform pg_advisory_xact_lock(hashtext(v_tech::text));

      select * into v_conflict from public.find_other_active_job(v_tech, v_job_type, new.id);
      if found then
        raise exception 'Ya tienes un ticket en ejecución: % % — debes finalizarla antes de iniciar otra atención.',
          case v_conflict.job_type when 'ticket' then 'Avería' when 'installation' then 'Alta' else 'Rutina' end,
          coalesce(v_conflict.job_number, '#' || left(v_conflict.job_id::text, 8))
          using errcode = 'P0001', hint = v_conflict.job_type || ':' || v_conflict.job_id;
      end if;
    end loop;
  end if;

  return new;
end;
$$;

create or replace function public.enforce_single_active_job_assignees()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_target_status text;
  v_conflict record;
begin
  if new.job_type = 'ticket' then
    select status into v_target_status from public.tickets where id = new.job_id;
  elsif new.job_type = 'installation' then
    select status into v_target_status from public.installations where id = new.job_id;
  else
    select status into v_target_status from public.routines where id = new.job_id;
  end if;

  -- Sumarse a un trabajo pendiente/programado/abierto nunca se bloquea —
  -- solo importa cuando ya esta EN CURSO.
  if v_target_status = 'in_progress' then
    perform pg_advisory_xact_lock(hashtext(new.technician_id::text));

    select * into v_conflict from public.find_other_active_job(new.technician_id, new.job_type, new.job_id);
    if found then
      raise exception 'Este técnico ya tiene un trabajo en ejecución: % % — no puede sumarse a otro en curso hasta finalizarlo.',
        case v_conflict.job_type when 'ticket' then 'Avería' when 'installation' then 'Alta' else 'Rutina' end,
        coalesce(v_conflict.job_number, '#' || left(v_conflict.job_id::text, 8))
        using errcode = 'P0001', hint = v_conflict.job_type || ':' || v_conflict.job_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_job_assignees_single_active_job on public.job_assignees;
create trigger trg_job_assignees_single_active_job
  before insert on public.job_assignees
  for each row execute function public.enforce_single_active_job_assignees();
