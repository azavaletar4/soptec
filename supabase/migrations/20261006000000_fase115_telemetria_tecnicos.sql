-- Fase 115: telemetria de campo (bateria + GPS) para las tarjetas de
-- "Tecnicos activos" en Operaciones de Hoy.
--
-- Vive en profiles (no en una tabla aparte) porque es "estado actual" de
-- UNA fila por tecnico, no un historial — mismo criterio que profiles.phone
-- (Fase 24). Si mas adelante hace falta un historial de recorridos, esa si
-- seria una tabla nueva append-only; esto no lo es.
--
-- profiles_update_admin_only (Fase 2) le niega a un tecnico escribir su
-- propia fila — correcto para rol/datos administrativos, pero bloquea el
-- autoreporte de telemetria. Se resuelve IGUAL que self_assign_ticket/
-- return_ticket (Fase 98/99): una funcion SECURITY DEFINER bien angosta
-- (solo estas 3 columnas, solo la propia fila), en vez de abrir la RLS de
-- UPDATE en profiles a cualquier staff.

alter table public.profiles add column if not exists battery_level smallint;
alter table public.profiles add column if not exists latitude numeric;
alter table public.profiles add column if not exists longitude numeric;
alter table public.profiles add column if not exists last_ping_at timestamptz;

alter table public.profiles add constraint profiles_battery_level_range
  check (battery_level is null or (battery_level >= 0 and battery_level <= 100));

create or replace function public.update_own_telemetry(
  p_battery_level smallint,
  p_latitude numeric,
  p_longitude numeric
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_battery_level is not null and (p_battery_level < 0 or p_battery_level > 100) then
    raise exception 'battery_level fuera de rango (0-100)';
  end if;

  update public.profiles
  set battery_level = coalesce(p_battery_level, battery_level),
      latitude = coalesce(p_latitude, latitude),
      longitude = coalesce(p_longitude, longitude),
      last_ping_at = now()
  where id = auth.uid();
end;
$$;

revoke all on function public.update_own_telemetry(smallint, numeric, numeric) from public;
grant execute on function public.update_own_telemetry(smallint, numeric, numeric) to authenticated;
