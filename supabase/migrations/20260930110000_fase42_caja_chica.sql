-- SmartRayco — Fase 42: Caja Chica (gastos/ingresos menores en efectivo de
-- la operacion diaria: delivery, combustible, servicios de oficina,
-- insumos, etc.).
--
-- Saldo = suma de todos los movimientos (ingresos - egresos), sin un campo
-- de "monto inicial" separado — fondear la caja es simplemente registrar un
-- movimiento tipo 'ingreso' (ej. categoria 'otros', descripcion "Apertura/
-- fondeo de caja"). Todo el historial queda en una sola tabla auditable.
--
-- "Cierre de caja" (arqueo con historial de saldos cerrados) queda
-- deliberadamente FUERA de esta fase — evaluado, no construido, pedido
-- explicito del usuario para no sobre-alcanzar esta entrega.
--
-- responsable es texto libre (no un select de usuarios del sistema):
-- GET /api/users esta restringido a SUPERADMIN unicamente
-- (server/src/routes/users.ts), y Caja Chica tambien la usa ADMIN — un
-- texto libre evita ese choque de permisos.
--
-- vehiculo_id es opcional: solo se completa cuando la categoria es
-- 'combustible' y se quiere vincular el gasto a un vehiculo real de Flota
-- (Fase 31, tabla vehiculos).
--
-- Restringido a SUPERADMIN/ADMIN (pedido explicito, mismo criterio que
-- descuentos_compensacion de la Fase 34).

create table public.caja_chica_movimientos (
  id                uuid primary key default gen_random_uuid(),
  fecha             date not null default current_date,
  tipo              text not null check (tipo in ('ingreso', 'egreso')),
  categoria         text not null check (categoria in ('delivery', 'combustible', 'servicios', 'insumos', 'otros')),
  monto             numeric(10, 2) not null check (monto > 0),
  descripcion       text not null,
  responsable       text not null,
  vehiculo_id       uuid references public.vehiculos (id) on delete set null,
  comprobante_path  text,
  created_by        uuid references public.profiles (id) default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_caja_chica_movimientos_fecha on public.caja_chica_movimientos (fecha desc);

comment on column public.caja_chica_movimientos.comprobante_path is
  'Ruta dentro del bucket privado caja-chica-comprobantes (no una URL publica) — se resuelve a URL firmada en el frontend.';

alter table public.caja_chica_movimientos enable row level security;

create policy "caja_chica_movimientos_admin_only"
  on public.caja_chica_movimientos for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN'));

-- Bucket privado para la foto/PDF del comprobante (mismo patron que
-- vehiculo-soat, Fase 31b).
insert into storage.buckets (id, name, public)
values ('caja-chica-comprobantes', 'caja-chica-comprobantes', false)
on conflict (id) do nothing;

drop policy if exists "caja_chica_storage_admin_select" on storage.objects;
create policy "caja_chica_storage_admin_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'caja-chica-comprobantes'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN')
  );

drop policy if exists "caja_chica_storage_admin_insert" on storage.objects;
create policy "caja_chica_storage_admin_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'caja-chica-comprobantes'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN')
  );

drop policy if exists "caja_chica_storage_admin_update" on storage.objects;
create policy "caja_chica_storage_admin_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'caja-chica-comprobantes'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN')
  );

drop policy if exists "caja_chica_storage_admin_delete" on storage.objects;
create policy "caja_chica_storage_admin_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'caja-chica-comprobantes'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN')
  );
