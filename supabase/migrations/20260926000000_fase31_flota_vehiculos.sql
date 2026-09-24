-- SmartRayco — Fase 31: Gestion de Flota y Mantenimiento Vehicular.
--
-- Vehiculos (autos/motos) usados por el personal tecnico, con control de
-- SOAT y de mantenimiento preventivo/correctivo. El semaforo (rojo/amarillo/
-- verde) de vencimiento de SOAT y de proximo mantenimiento se calcula al
-- vuelo en el frontend a partir de estas fechas/kilometrajes (mismo criterio
-- que el resto de la app: ver fillClass en ZonasView, isLowStock en
-- InventarioProductoView) — no se persiste un "estado" que se desactualice
-- solo con el paso del tiempo.
--
-- mantenimientos_historial es el libro de intervenciones (Kardex de
-- mantenimiento): se inserta, nunca se edita ni se borra (una correccion se
-- hace con un registro nuevo), y cada insercion actualiza automaticamente
-- el resumen en vehiculos (fecha/tipo de ultimo mantenimiento, kilometraje
-- actual) via trigger — mismo patron que apply_inventory_movement (Fase 11).

do $$
begin
  if not exists (select 1 from pg_type where typname = 'vehiculo_tipo') then
    create type public.vehiculo_tipo as enum ('auto', 'moto');
  end if;
  if not exists (select 1 from pg_type where typname = 'vehiculo_estado') then
    create type public.vehiculo_estado as enum ('activo', 'mantenimiento', 'inactivo');
  end if;
  if not exists (select 1 from pg_type where typname = 'mantenimiento_tipo') then
    create type public.mantenimiento_tipo as enum ('preventivo', 'correctivo');
  end if;
end
$$;

create table if not exists public.vehiculos (
  id                          uuid primary key default gen_random_uuid(),
  tipo                        public.vehiculo_tipo not null,
  placa                       text not null unique,
  marca                       text not null,
  modelo                      text,
  tecnico_id                  uuid references public.profiles (id) on delete set null,
  area                        text,
  estado                      public.vehiculo_estado not null default 'activo',

  soat_fecha_emision          date,
  soat_fecha_vencimiento      date,
  soat_aseguradora            text,
  soat_archivo_path           text, -- ruta dentro del bucket privado 'vehiculo-soat' (Fase 31b), no una URL publica

  kilometraje_actual          numeric(10, 1) not null default 0,
  fecha_ultimo_mantenimiento  date,
  tipo_ultimo_mantenimiento   public.mantenimiento_tipo,
  proximo_mantenimiento_fecha date,
  proximo_mantenimiento_km    numeric(10, 1),

  notes                       text,
  created_by                  uuid references public.profiles (id) default auth.uid(),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists idx_vehiculos_tecnico on public.vehiculos (tecnico_id);
create index if not exists idx_vehiculos_estado on public.vehiculos (estado);
create index if not exists idx_vehiculos_soat_vencimiento on public.vehiculos (soat_fecha_vencimiento);
create index if not exists idx_vehiculos_proximo_mantenimiento on public.vehiculos (proximo_mantenimiento_fecha);

drop trigger if exists trg_vehiculos_updated_at on public.vehiculos;
create trigger trg_vehiculos_updated_at
  before update on public.vehiculos
  for each row execute procedure public.set_updated_at();

create table if not exists public.mantenimientos_historial (
  id            uuid primary key default gen_random_uuid(),
  vehiculo_id   uuid not null references public.vehiculos (id) on delete cascade,
  fecha         date not null default current_date,
  tipo          public.mantenimiento_tipo not null,
  descripcion   text,
  costo         numeric(10, 2),
  taller        text,
  kilometraje   numeric(10, 1),
  created_by    uuid references public.profiles (id) default auth.uid(),
  created_at    timestamptz not null default now()
);

create index if not exists idx_mantenimientos_vehiculo on public.mantenimientos_historial (vehiculo_id, fecha desc);

-- Refleja en el vehiculo el ultimo mantenimiento registrado (por fecha, no
-- por orden de insercion, para tolerar cargas retroactivas del historial) y
-- sube el kilometraje actual si el del servicio es mayor al que ya tenia.
create or replace function public.apply_mantenimiento_historial()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.vehiculos
  set
    fecha_ultimo_mantenimiento = greatest(coalesce(fecha_ultimo_mantenimiento, new.fecha), new.fecha),
    tipo_ultimo_mantenimiento = case
      when new.fecha >= coalesce(fecha_ultimo_mantenimiento, new.fecha) then new.tipo
      else tipo_ultimo_mantenimiento
    end,
    kilometraje_actual = greatest(kilometraje_actual, coalesce(new.kilometraje, 0)),
    updated_at = now()
  where id = new.vehiculo_id;

  return new;
end;
$$;

drop trigger if exists trg_mantenimientos_apply on public.mantenimientos_historial;
create trigger trg_mantenimientos_apply
  after insert on public.mantenimientos_historial
  for each row execute procedure public.apply_mantenimiento_historial();

alter table public.vehiculos enable row level security;
alter table public.mantenimientos_historial enable row level security;

-- Mismo criterio que infra_elementos/clients: todo el staff interno puede
-- gestionar la flota (no es exclusivo de un rol).
drop policy if exists "vehiculos_staff_only" on public.vehiculos;
create policy "vehiculos_staff_only"
  on public.vehiculos for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

drop policy if exists "mantenimientos_historial_staff_only" on public.mantenimientos_historial;
create policy "mantenimientos_historial_staff_only"
  on public.mantenimientos_historial for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));
