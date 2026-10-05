-- SmartRayco — Fase 101: Rutinas (mantenimiento preventivo / peinado de
-- NAPs), 3er tipo de orden junto a Tickets (averias) e Installations
-- (altas). Reusa la infraestructura polimorfica que ya comparten esos dos
-- (job_assignees, work_order_photos, work_order_closures, Fase 32/94) en
-- vez de duplicarla — una rutina es "cuadrilla + fotos + cierre" igual que
-- un ticket, pero no necesariamente ligada a un cliente puntual (puede ser
-- una zona o una caja NAP).
--
-- Alcance V1 (decision explicita): NO incluye materiales/equipos
-- (inventory_movements/inventory_units usan columnas discretas ticket_id/
-- installation_id, no el patron generico job_type/job_id) — si hace falta
-- se agrega routine_id ahi en una fase siguiente, mismo mecanismo.
--
-- De paso se agregan scheduled_start_at/scheduled_end_at a tickets e
-- installations (nullable, sin usar todavia) para que el futuro tablero
-- Timeline/Calendario (Fase B) no necesite otra migracion sobre esas tablas.

-- =========================================================
-- 1) Tipos y tabla routines
-- =========================================================
create type public.routine_status as enum ('pending', 'scheduled', 'in_progress', 'completed', 'cancelled');
create type public.routine_category as enum ('peinado_nap', 'mantenimiento_preventivo', 'revision_zona', 'otro');

create table public.routines (
  id               uuid primary key default gen_random_uuid(),
  routine_number   text unique,
  title            text not null,
  description      text,
  category         public.routine_category not null default 'otro',
  zone_id          uuid references public.zones (id),
  nap_elemento_id  uuid references public.infra_elementos (id),
  -- Nullable a proposito: una rutina puede apuntar a una zona/caja NAP sin
  -- ser de UN cliente puntual (a diferencia de tickets/installations).
  client_id            uuid references public.clients (id),
  status               public.routine_status not null default 'pending',
  assigned_to          uuid references public.profiles (id),
  scheduled_date       date,
  scheduled_start_at   timestamptz,
  scheduled_end_at     timestamptz,
  closure_notes        text,
  created_by           uuid references public.profiles (id) default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  completed_at         timestamptz
);

create index idx_routines_status on public.routines (status);
create index idx_routines_assigned_to on public.routines (assigned_to);
create index idx_routines_zone on public.routines (zone_id) where zone_id is not null;
create index idx_routines_nap on public.routines (nap_elemento_id) where nap_elemento_id is not null;

-- Numeracion automatica RUT-YYYY-NNNNN, mismo patron que generate_ticket_number (Fase 6).
create table public.routine_number_counters (
  year       int primary key,
  last_value int not null default 0
);
alter table public.routine_number_counters enable row level security;

create or replace function public.generate_routine_number()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  current_year int := extract(year from now())::int;
  seq_value    int;
begin
  insert into public.routine_number_counters (year, last_value)
  values (current_year, 1)
  on conflict (year) do update
    set last_value = public.routine_number_counters.last_value + 1
  returning last_value into seq_value;

  return 'RUT-' || current_year::text || '-' || lpad(seq_value::text, 5, '0');
end;
$$;

create or replace function public.set_routine_number()
returns trigger
language plpgsql
as $$
begin
  if new.routine_number is null then
    new.routine_number := public.generate_routine_number();
  end if;
  return new;
end;
$$;

create trigger trg_routines_number
  before insert on public.routines
  for each row execute procedure public.set_routine_number();

create trigger trg_routines_updated_at
  before update on public.routines
  for each row execute procedure public.set_updated_at();

-- completed_at se marca solo la primera vez que entra a 'completed' (igual
-- criterio que set_ticket_status_timestamps, Fase 6).
create or replace function public.set_routine_status_timestamps()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_routines_status_timestamps
  before update on public.routines
  for each row execute procedure public.set_routine_status_timestamps();

-- =========================================================
-- 2) RLS routines — mismo criterio que tickets/installations (Fase 15/94):
-- todo el staff ve todas; crear/borrar es decision de despacho (nunca el
-- propio tecnico); un TECNICO_RED edita solo si es lider o apoyo de la
-- cuadrilla, y nunca si ya esta 'completed'.
-- =========================================================
alter table public.routines enable row level security;

create policy "routines_select_staff"
  on public.routines for select to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'));

create policy "routines_insert_admin"
  on public.routines for insert to authenticated
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE'));

create policy "routines_delete_admin"
  on public.routines for delete to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE'));

create policy "routines_update_staff"
  on public.routines for update to authenticated
  using (
    public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE')
    or (
      public.current_user_role() = 'TECNICO_RED'
      and status <> 'completed'
      and (
        assigned_to = auth.uid()
        or exists (
          select 1 from public.job_assignees ja
          where ja.job_type = 'routine' and ja.job_id = routines.id and ja.technician_id = auth.uid()
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
          where ja.job_type = 'routine' and ja.job_id = routines.id and ja.technician_id = auth.uid()
        )
      )
    )
  );

-- =========================================================
-- 3) Extender job_assignees / work_order_photos / work_order_closures para
-- aceptar job_type = 'routine' (constraints ya existentes, Fase 32/94).
-- =========================================================
alter table public.job_assignees drop constraint job_assignees_job_type_check;
alter table public.job_assignees add constraint job_assignees_job_type_check
  check (job_type in ('ticket', 'installation', 'routine'));

alter table public.work_order_photos drop constraint work_order_photos_job_type_check;
alter table public.work_order_photos add constraint work_order_photos_job_type_check
  check (job_type in ('ticket', 'installation', 'routine'));

alter table public.work_order_closures drop constraint work_order_closures_job_type_check;
alter table public.work_order_closures add constraint work_order_closures_job_type_check
  check (job_type in ('ticket', 'installation', 'routine'));

-- Extiende el trigger de sync lider->assigned_to (Fase 94) para tambien
-- escribir routines.assigned_to cuando job_type = 'routine'.
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
  elsif v_job_type = 'routine' then
    update public.routines set assigned_to = v_leader where id = v_job_id;
  end if;

  return coalesce(new, old);
end;
$$;

-- Una rutina puede no tener cliente (apunta a una zona o caja NAP) — el
-- cierre de campo (work_order_closures) exigia client_id not null porque
-- hasta ahora ticket/installation siempre tenian uno. Se relaja a nullable;
-- ticket/installation lo siguen mandando siempre (sin cambio de comportamiento).
alter table public.work_order_closures alter column client_id drop not null;

-- =========================================================
-- 4) Adelanto de columnas de horario para el futuro tablero Timeline (Fase
-- B) — nullable, sin usar todavia, solo para no tener que migrar de nuevo
-- las tablas en vivo cuando se construya esa vista.
-- =========================================================
alter table public.tickets add column if not exists scheduled_start_at timestamptz;
alter table public.tickets add column if not exists scheduled_end_at timestamptz;
alter table public.installations add column if not exists scheduled_start_at timestamptz;
alter table public.installations add column if not exists scheduled_end_at timestamptz;
