-- SmartRayco — Fase 43: categorias de Caja Chica pasan de una lista fija
-- (CHECK constraint) a una tabla propia editable — el usuario pidio poder
-- crear una categoria nueva desde el formulario y que quede disponible para
-- usarla despues en otros movimientos, igual criterio que "+ Nueva zona" en
-- la ficha del servicio (catalogs.createZone).
--
-- "Responsable" NO cambia de columna (sigue siendo caja_chica_movimientos.responsable,
-- texto libre) — lo que pidio el usuario ahi es que el FORMULARIO ofrezca un
-- select con el listado de usuarios del sistema en vez de escribir a mano,
-- reusando la policy ya existente "profiles_select_staff_for_assignment"
-- (Fase 6) que ya deja leer profiles de staff a ADMIN/SUPERADMIN — sin
-- cambios de esquema ni de permisos.

create table public.caja_chica_categorias (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null unique,
  permite_vehiculo  boolean not null default false,
  created_at        timestamptz not null default now()
);

insert into public.caja_chica_categorias (nombre, permite_vehiculo) values
  ('Delivery', false),
  ('Combustible / Flota', true),
  ('Servicios (agua/luz/internet)', false),
  ('Insumos', false),
  ('Otros', false)
on conflict (nombre) do nothing;

alter table public.caja_chica_categorias enable row level security;
create policy "caja_chica_categorias_admin_only"
  on public.caja_chica_categorias for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN'));

-- categoria_id reemplaza a categoria (texto con CHECK fijo) — se agrega,
-- se rellena a partir del valor viejo, y recien despues se exige not null
-- y se borra la columna vieja (la tabla es de la Fase 42, recien creada,
-- asi que esto no arriesga datos reales de produccion todavia).
alter table public.caja_chica_movimientos add column if not exists categoria_id uuid references public.caja_chica_categorias (id);

update public.caja_chica_movimientos m
set categoria_id = c.id
from public.caja_chica_categorias c
where m.categoria_id is null
  and c.nombre = case m.categoria
    when 'delivery' then 'Delivery'
    when 'combustible' then 'Combustible / Flota'
    when 'servicios' then 'Servicios (agua/luz/internet)'
    when 'insumos' then 'Insumos'
    when 'otros' then 'Otros'
  end;

alter table public.caja_chica_movimientos alter column categoria_id set not null;
alter table public.caja_chica_movimientos drop column categoria;
