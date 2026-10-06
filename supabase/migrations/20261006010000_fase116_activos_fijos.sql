-- SmartRayco — Fase 116: Activos Fijos y Herramientas asignados a tecnicos.
--
-- Control de equipamiento no consumible entregado al personal de campo
-- (celulares corporativos, herramientas, indumentaria/EPP) — a diferencia de
-- inventory_products (consumibles/equipos de red con Kardex de entrada-
-- salida, Fase 11), un activo fijo es 1:1 con un responsable mientras esta
-- "en uso" y no descuenta ningun stock. El % de vida util restante y el
-- costo depreciado sugerido para reposicion (baja por perdida/dano) se
-- calculan al vuelo en el frontend a partir de fecha_entrega + vida_util_
-- meses + costo_compra (mismo criterio que el semaforo de SOAT/mantenimiento
-- de vehiculos, Fase 31) — no se persiste un numero que se desactualice solo
-- con el paso del tiempo.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'activo_categoria') then
    create type public.activo_categoria as enum ('celular', 'herramienta', 'epp');
  end if;
  if not exists (select 1 from pg_type where typname = 'activo_estado') then
    create type public.activo_estado as enum ('nuevo', 'en_uso_bueno', 'en_uso_desgastado', 'danado', 'baja');
  end if;
end
$$;

create table if not exists public.activos_tecnicos (
  id                    uuid primary key default gen_random_uuid(),
  categoria             public.activo_categoria not null,
  codigo                text not null unique, -- IMEI del celular o codigo interno de la herramienta/EPP
  nombre                text not null,
  modelo                text,
  costo_compra          numeric(10, 2) not null default 0,
  fecha_compra          date,
  vida_util_meses       integer not null default 12,
  tecnico_id            uuid references public.profiles (id) on delete set null,
  fecha_entrega         date, -- null = todavia en bodega, no entregado a ningun tecnico
  estado                public.activo_estado not null default 'nuevo',
  cargo_documento_path  text, -- ruta dentro del bucket privado 'activos-cargos', no una URL publica
  notas                 text,
  created_by            uuid references public.profiles (id) default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_activos_tecnicos_tecnico on public.activos_tecnicos (tecnico_id);
create index if not exists idx_activos_tecnicos_categoria on public.activos_tecnicos (categoria);
create index if not exists idx_activos_tecnicos_estado on public.activos_tecnicos (estado);

drop trigger if exists trg_activos_tecnicos_updated_at on public.activos_tecnicos;
create trigger trg_activos_tecnicos_updated_at
  before update on public.activos_tecnicos
  for each row execute procedure public.set_updated_at();

comment on column public.activos_tecnicos.cargo_documento_path is
  'Ruta dentro del bucket privado activos-cargos (no una URL publica) — se resuelve a URL firmada en el frontend.';
comment on column public.activos_tecnicos.vida_util_meses is
  'Vida util estimada en meses desde fecha_entrega (ej. 12 EPP, 24 herramientas, 36 celulares) — el % restante y el costo depreciado se calculan en el frontend.';

alter table public.activos_tecnicos enable row level security;

-- Mismo criterio que vehiculos/infra_elementos: todo el staff interno puede
-- gestionar los activos (no es exclusivo de un rol) — el router del panel ya
-- oculta este modulo a TECNICO_RED (grupo NOT_TECNICO, igual que Inventario).
drop policy if exists "activos_tecnicos_staff_only" on public.activos_tecnicos;
create policy "activos_tecnicos_staff_only"
  on public.activos_tecnicos for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

-- Bucket privado para el cargo de recepcion firmado (PDF o foto), mismo
-- patron que vehiculo-soat (Fase 31b).
insert into storage.buckets (id, name, public)
values ('activos-cargos', 'activos-cargos', false)
on conflict (id) do nothing;

drop policy if exists "activos_cargos_storage_staff_select" on storage.objects;
create policy "activos_cargos_storage_staff_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'activos-cargos'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION')
  );

drop policy if exists "activos_cargos_storage_staff_insert" on storage.objects;
create policy "activos_cargos_storage_staff_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'activos-cargos'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION')
  );

drop policy if exists "activos_cargos_storage_staff_update" on storage.objects;
create policy "activos_cargos_storage_staff_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'activos-cargos'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION')
  );

drop policy if exists "activos_cargos_storage_staff_delete" on storage.objects;
create policy "activos_cargos_storage_staff_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'activos-cargos'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION')
  );
