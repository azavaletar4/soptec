-- SmartRayco — Fase 49: motivo de cierre de averias y si son imputables al
-- tecnico, para que el ranking de puntos (Fase 27) no penalice reincidencias
-- causadas por el cliente (ej. mascota, golpe) o por un factor externo (corte
-- de fibra troncal, corte electrico) que no dependen del trabajo del tecnico.

-- =========================================================
-- tickets: nuevas columnas
-- =========================================================

create type public.ticket_motivo_averia as enum (
  'bad_installation',    -- Mala instalacion
  'material_wear',       -- Deterioro de material
  'client_damage',       -- Dano provocado por el cliente (mascota, golpe...)
  'external_factor',     -- Factor externo (corte de fibra troncal, corte electrico...)
  'defective_equipment'  -- Equipo defectuoso
);

alter table public.tickets
  add column motivo_averia public.ticket_motivo_averia,
  add column imputable_a_tecnico boolean not null default true,
  add column observacion_cierre text,
  add column evidencia_url text;

comment on column public.tickets.evidencia_url is
  'Ruta dentro del bucket privado work-evidence (Fase 32), no una URL publica lista para usar — hay que firmarla al mostrarla, igual que el resto de fotos de cierre.';

-- imputable_a_tecnico se deriva del motivo en vez de dejarse elegir aparte,
-- para que ningun camino (app de Campo, TicketDetailView de oficina, un
-- cambio manual futuro) los pueda dejar inconsistentes. Mismo criterio que la
-- Fase 45 (validate_installation_completion): la regla de negocio vive en el
-- trigger, no solo en el frontend.
create or replace function public.set_ticket_imputabilidad()
returns trigger
language plpgsql
as $$
begin
  if new.motivo_averia in ('client_damage', 'external_factor') then
    new.imputable_a_tecnico := false;
  elsif new.motivo_averia is not null then
    new.imputable_a_tecnico := true;
  end if;
  return new;
end;
$$;

create trigger trg_tickets_imputabilidad
  before insert or update on public.tickets
  for each row execute procedure public.set_ticket_imputabilidad();

-- =========================================================
-- Ranking de tecnicos (Fase 27b/27c): la penalizacion por reincidencia ya no
-- cuenta una reincidencia cuando la averia que revela la falla repetida (t2)
-- quedo marcada como no imputable al tecnico — en ese caso la reincidencia no
-- dice nada sobre la calidad del trabajo del tecnico que resolvio la primera
-- averia (t1), y penalizarlo ahi seria injusto. No cambia a quien se penaliza
-- (quien resolvio t1) ni el resto de la formula (+10 instalacion, +5/+3 por
-- categoria, -5 por reincidencia) — solo agrega el filtro sobre t2.
-- =========================================================

create or replace function public.get_technician_ranking(p_month int, p_year int)
returns table (
  technician_id uuid,
  technician_name text,
  installations_count bigint,
  averias_count bigint,
  reconexiones_count bigint,
  reincidencias_count bigint,
  total_points bigint,
  ranking int
)
language sql
stable
security definer set search_path = public
as $$
  with period as (
    select
      make_date(p_year, p_month, 1) as start_date,
      (make_date(p_year, p_month, 1) + interval '1 month')::date as end_date
  ),
  installs as (
    select i.assigned_to as technician_id, count(*) as installations_count
    from public.installations i, period p
    where i.status = 'completed'
      and i.assigned_to is not null
      and i.completed_at >= p.start_date
      and i.completed_at < p.end_date
    group by i.assigned_to
  ),
  ticket_work as (
    select
      t.assigned_to as technician_id,
      count(*) filter (where t.category in ('no_service', 'slow_speed', 'equipment')) as averias_count,
      count(*) filter (where t.category = 'reconnection_relocation') as reconexiones_count,
      sum(
        case
          when t.category in ('no_service', 'slow_speed', 'equipment') then coalesce(t.points, 5)
          when t.category = 'reconnection_relocation' then coalesce(t.points, 3)
          else 0
        end
      ) as ticket_points
    from public.tickets t, period p
    where t.status in ('resolved', 'closed')
      and t.assigned_to is not null
      and coalesce(t.resolved_at, t.closed_at) >= p.start_date
      and coalesce(t.resolved_at, t.closed_at) < p.end_date
    group by t.assigned_to
  ),
  reincidencias as (
    select t1.assigned_to as technician_id, count(*) as reincidencias_count
    from public.tickets t1, period p
    where t1.status in ('resolved', 'closed')
      and t1.assigned_to is not null
      and t1.category in ('no_service', 'slow_speed', 'equipment')
      and coalesce(t1.resolved_at, t1.closed_at) >= p.start_date
      and coalesce(t1.resolved_at, t1.closed_at) < p.end_date
      and exists (
        select 1
        from public.tickets t2
        where t2.client_id = t1.client_id
          and t2.id <> t1.id
          and t2.category in ('no_service', 'slow_speed', 'equipment')
          and t2.created_at > coalesce(t1.resolved_at, t1.closed_at)
          and t2.created_at <= coalesce(t1.resolved_at, t1.closed_at) + interval '7 days'
          and t2.imputable_a_tecnico
      )
    group by t1.assigned_to
  ),
  combined as (
    select
      pr.id as technician_id,
      coalesce(pr.full_name, pr.email) as technician_name,
      coalesce(i.installations_count, 0) as installations_count,
      coalesce(tw.averias_count, 0) as averias_count,
      coalesce(tw.reconexiones_count, 0) as reconexiones_count,
      coalesce(r.reincidencias_count, 0) as reincidencias_count,
      (
        coalesce(i.installations_count, 0) * 10
        + coalesce(tw.ticket_points, 0)
        - coalesce(r.reincidencias_count, 0) * 5
      ) as total_points
    from public.profiles pr
    left join installs i on i.technician_id = pr.id
    left join ticket_work tw on tw.technician_id = pr.id
    left join reincidencias r on r.technician_id = pr.id
    where pr.role = 'TECNICO_RED'
      and (
        coalesce(i.installations_count, 0) + coalesce(tw.averias_count, 0)
        + coalesce(tw.reconexiones_count, 0) + coalesce(r.reincidencias_count, 0)
      ) > 0
  )
  select
    technician_id,
    technician_name,
    installations_count,
    averias_count,
    reconexiones_count,
    reincidencias_count,
    total_points,
    rank() over (order by total_points desc)::int as ranking
  from combined
  order by total_points desc, technician_name;
$$;

revoke all on function public.get_technician_ranking(int, int) from public;
grant execute on function public.get_technician_ranking(int, int) to authenticated;
