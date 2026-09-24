-- SmartRayco — Fase 31b: subir el archivo del SOAT desde el computador
-- (en vez de solo pegar una URL) y liberar el campo "Area asignada", que
-- quedaba bloqueado por una regla de negocio que ya no se pide.
--
-- Idempotente: cubre tanto el caso en que la Fase 31 ya se aplico con el
-- esquema anterior (columna soat_archivo_url, constraint de asignacion
-- unica) como el caso en que se vuelve a correr todo el archivo de la
-- Fase 31 ya corregido (columna soat_archivo_path, sin esa constraint).

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vehiculos' and column_name = 'soat_archivo_url'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vehiculos' and column_name = 'soat_archivo_path'
  ) then
    alter table public.vehiculos rename column soat_archivo_url to soat_archivo_path;
  end if;
end
$$;

alter table public.vehiculos add column if not exists soat_archivo_path text;

comment on column public.vehiculos.soat_archivo_path is
  'Ruta dentro del bucket privado vehiculo-soat (no una URL publica) — se resuelve a URL firmada en el frontend.';

alter table public.vehiculos drop constraint if exists vehiculos_asignacion_unica;

-- Bucket privado para el PDF/foto del SOAT (mismo patron que infra-photos, Fase 7).
insert into storage.buckets (id, name, public)
values ('vehiculo-soat', 'vehiculo-soat', false)
on conflict (id) do nothing;

drop policy if exists "vehiculo_soat_storage_staff_select" on storage.objects;
create policy "vehiculo_soat_storage_staff_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'vehiculo-soat'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION')
  );

drop policy if exists "vehiculo_soat_storage_staff_insert" on storage.objects;
create policy "vehiculo_soat_storage_staff_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'vehiculo-soat'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION')
  );

drop policy if exists "vehiculo_soat_storage_staff_update" on storage.objects;
create policy "vehiculo_soat_storage_staff_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'vehiculo-soat'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION')
  );

drop policy if exists "vehiculo_soat_storage_staff_delete" on storage.objects;
create policy "vehiculo_soat_storage_staff_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'vehiculo-soat'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION')
  );
