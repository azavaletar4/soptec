-- SmartRayco — Fase 94: cuadrilla (multiples tecnicos) en Tickets e
-- Instalaciones, con reparto de puntos del ranking en partes iguales.
--
-- DISEÑO: se agrega job_assignees (job_type/job_id — mismo patron
-- polimorfico que work_order_photos/work_order_closures, Fase 32) en vez de
-- un array de UUIDs en tickets/installations: permite guardar un rol
-- (lider/apoyo) por integrante y reusar la misma tabla para ambos tipos de
-- orden.
--
-- tickets.assigned_to / installations.assigned_to NO se eliminan: quedan
-- como espejo del lider de la cuadrilla (sincronizados por trigger desde
-- job_assignees) para no reescribir toda la RLS/App de Campo/reportes que
-- ya dependen de esa columna. Lo nuevo es que ahora CUALQUIER integrante de
-- la cuadrilla (no solo el lider) puede operar el ticket/instalacion — se
-- extiende la RLS de update para incluirlos (abajo).

-- =========================================================
-- 1) Tabla job_assignees
-- =========================================================
create table public.job_assignees (
  job_type      text not null check (job_type in ('ticket', 'installation')),
  job_id        uuid not null,
  technician_id uuid not null references public.profiles (id) on delete cascade,
  role          text not null default 'support' check (role in ('leader', 'support')),
  created_at    timestamptz not null default now(),
  primary key (job_type, job_id, technician_id)
);

create index idx_job_assignees_job on public.job_assignees (job_type, job_id);
create index idx_job_assignees_technician on public.job_assignees (technician_id);

-- Maximo 1 lider por orden (el resto queda como 'support').
create unique index idx_job_assignees_one_leader
  on public.job_assignees (job_type, job_id)
  where role = 'leader';

alter table public.job_assignees enable row level security;

-- Ver la cuadrilla: mismo criterio amplio que tickets/installations/
-- work_order_* (todo el staff interno ve todo). Armar/editar la cuadrilla
-- (insert/update/delete) es una decision de despacho — solo
-- SUPERADMIN/ADMIN/SOPORTE, nunca el propio tecnico (evita que se
-- auto-asigne apoyo, se quite de una orden, o se nombre lider).
create policy "job_assignees_select_staff"
  on public.job_assignees for select to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

create policy "job_assignees_write_dispatch"
  on public.job_assignees for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE'));

-- =========================================================
-- 2) Backfill: el assigned_to que ya existe se vuelve el "lider" de su
-- cuadrilla de 1 solo integrante — el ranking historico no cambia (ver
-- punto 5: con cuadrilla de tamaño 1 la formula da exactamente lo mismo
-- que antes).
-- =========================================================
insert into public.job_assignees (job_type, job_id, technician_id, role)
select 'ticket', id, assigned_to, 'leader' from public.tickets where assigned_to is not null;

insert into public.job_assignees (job_type, job_id, technician_id, role)
select 'installation', id, assigned_to, 'leader' from public.installations where assigned_to is not null;

-- =========================================================
-- 3) Trigger: job_assignees -> tickets/installations.assigned_to.
-- job_assignees es la fuente de verdad de la cuadrilla; assigned_to queda
-- como espejo de lectura rapida del lider (lo usan RLS, App de Campo y
-- ReportesView tal como estaban, sin tocarlos).
-- =========================================================
create or replace function public.sync_assigned_to_from_job_assignees()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_job_type text := coalesce(new.job_type, old.job_type);
  v_job_id uuid := coalesce(new.job_id, old.job_id);
  v_leader uuid;
begin
  select technician_id into v_leader
  from public.job_assignees
  where job_type = v_job_type and job_id = v_job_id and role = 'leader'
  limit 1;

  if v_job_type = 'ticket' then
    update public.tickets set assigned_to = v_leader where id = v_job_id;
  elsif v_job_type = 'installation' then
    update public.installations set assigned_to = v_leader where id = v_job_id;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger trg_job_assignees_sync_leader
  after insert or update or delete on public.job_assignees
  for each row execute procedure public.sync_assigned_to_from_job_assignees();

-- =========================================================
-- 4) RLS de update de tickets/installations: se extiende (no se reemplaza)
-- para que cualquier integrante de la cuadrilla pueda operar la orden, no
-- solo el lider/assigned_to. Se preservan las restricciones ya existentes
-- (Fase 88: TECNICO_RED no cierra tickets; Fase 70: no toca una instalacion
-- ya 'completed').
-- =========================================================
drop policy if exists "tickets_update_staff" on public.tickets;
create policy "tickets_update_staff"
  on public.tickets for update to authenticated
  using (
    public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE')
    or (
      public.current_user_role() = 'TECNICO_RED'
      and (
        assigned_to = auth.uid()
        or exists (
          select 1 from public.job_assignees ja
          where ja.job_type = 'ticket' and ja.job_id = tickets.id and ja.technician_id = auth.uid()
        )
      )
    )
  )
  with check (
    public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE')
    or (
      public.current_user_role() = 'TECNICO_RED'
      and (
        assigned_to = auth.uid()
        or exists (
          select 1 from public.job_assignees ja
          where ja.job_type = 'ticket' and ja.job_id = tickets.id and ja.technician_id = auth.uid()
        )
      )
      and status <> 'closed'
    )
  );

drop policy if exists "installations_update_staff" on public.installations;
create policy "installations_update_staff"
  on public.installations for update to authenticated
  using (
    public.current_user_role() in ('SUPERADMIN', 'ADMIN')
    or (
      public.current_user_role() = 'TECNICO_RED'
      and status <> 'completed'
      and (
        assigned_to = auth.uid()
        or exists (
          select 1 from public.job_assignees ja
          where ja.job_type = 'installation' and ja.job_id = installations.id and ja.technician_id = auth.uid()
        )
      )
    )
  )
  with check (
    public.current_user_role() in ('SUPERADMIN', 'ADMIN')
    or (
      public.current_user_role() = 'TECNICO_RED'
      and (
        assigned_to = auth.uid()
        or exists (
          select 1 from public.job_assignees ja
          where ja.job_type = 'installation' and ja.job_id = installations.id and ja.technician_id = auth.uid()
        )
      )
    )
  );

-- =========================================================
-- 5) Ranking: reparte instalaciones (+10) y puntos de ticket (+5/+3 o el
-- manual de t.points, Fase 27c) en partes iguales entre los integrantes de
-- la cuadrilla de CADA orden. Los conteos (installations_count,
-- averias_count, reconexiones_count, reincidencias_count) NO se dividen —
-- cada integrante se lleva credito completo de haber trabajado esa orden;
-- solo el puntaje se reparte. Con cuadrilla de 1 (el caso historico, via el
-- backfill del punto 2) el resultado es identico al de antes de esta fase.
-- =========================================================
drop function if exists public.get_technician_ranking(int, int);

create function public.get_technician_ranking(p_month int, p_year int)
returns table (
  technician_id uuid,
  technician_name text,
  installations_count bigint,
  averias_count bigint,
  reconexiones_count bigint,
  reincidencias_count bigint,
  total_points numeric,
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
  install_jobs as (
    select i.id, i.assigned_to
    from public.installations i, period p
    where i.status = 'completed'
      and i.completed_at >= p.start_date
      and i.completed_at < p.end_date
  ),
  install_crew as (
    select ij.id as job_id, coalesce(ja.technician_id, ij.assigned_to) as technician_id,
           count(*) over (partition by ij.id) as crew_size
    from install_jobs ij
    left join public.job_assignees ja on ja.job_type = 'installation' and ja.job_id = ij.id
    where coalesce(ja.technician_id, ij.assigned_to) is not null
  ),
  installs as (
    select technician_id,
      count(*) as installations_count,
      sum(10.0 / greatest(crew_size, 1)) as install_points
    from install_crew
    group by technician_id
  ),
  ticket_jobs as (
    select t.id, t.assigned_to, t.category, t.points
    from public.tickets t, period p
    where t.status in ('resolved', 'closed')
      and coalesce(t.resolved_at, t.closed_at) >= p.start_date
      and coalesce(t.resolved_at, t.closed_at) < p.end_date
  ),
  ticket_crew as (
    select tj.id as job_id, tj.category, tj.points,
      coalesce(ja.technician_id, tj.assigned_to) as technician_id,
      count(*) over (partition by tj.id) as crew_size
    from ticket_jobs tj
    left join public.job_assignees ja on ja.job_type = 'ticket' and ja.job_id = tj.id
    where coalesce(ja.technician_id, tj.assigned_to) is not null
  ),
  ticket_work as (
    select
      technician_id,
      count(*) filter (where category in ('no_service', 'slow_speed', 'equipment')) as averias_count,
      count(*) filter (where category = 'reconnection_relocation') as reconexiones_count,
      sum(
        case
          when category in ('no_service', 'slow_speed', 'equipment') then coalesce(points, 5)
          when category = 'reconnection_relocation' then coalesce(points, 3)
          else 0
        end / greatest(crew_size, 1)
      ) as ticket_points
    from ticket_crew
    group by technician_id
  ),
  reincidencia_jobs as (
    select t1.id, t1.assigned_to
    from public.tickets t1, period p
    where t1.status in ('resolved', 'closed')
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
  ),
  reincidencia_crew as (
    select rj.id as job_id, coalesce(ja.technician_id, rj.assigned_to) as technician_id,
      count(*) over (partition by rj.id) as crew_size
    from reincidencia_jobs rj
    left join public.job_assignees ja on ja.job_type = 'ticket' and ja.job_id = rj.id
    where coalesce(ja.technician_id, rj.assigned_to) is not null
  ),
  reincidencias as (
    select technician_id,
      count(*) as reincidencias_count,
      sum(5.0 / greatest(crew_size, 1)) as reincidencia_penalty
    from reincidencia_crew
    group by technician_id
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
        coalesce(i.install_points, 0)
        + coalesce(tw.ticket_points, 0)
        - coalesce(r.reincidencia_penalty, 0)
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
    round(total_points, 1) as total_points,
    rank() over (order by total_points desc)::int as ranking
  from combined
  order by total_points desc, technician_name;
$$;

revoke all on function public.get_technician_ranking(int, int) from public;
grant execute on function public.get_technician_ranking(int, int) to authenticated;
