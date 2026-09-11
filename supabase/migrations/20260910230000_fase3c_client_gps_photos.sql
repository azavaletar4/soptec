-- SmartRayco — coordenadas GPS y fotos de instalacion por cliente.
--
-- GPS: se guarda directo en clients (lat/lng simples) — no se justifica una
-- tabla de direcciones aparte todavia (ver comentario "direccion simple" de
-- la Fase 3). Fotos: un slot fijo por categoria (fachada, hoja de servicio,
-- posicion del modem) — subir una nueva reemplaza a la anterior, no es una
-- galeria. Bucket privado en Supabase Storage; se sirven con URLs firmadas.

alter table public.clients add column latitude double precision;
alter table public.clients add column longitude double precision;

create type public.client_photo_category as enum ('facade', 'service_sheet', 'modem_position');

create table public.client_photos (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients (id) on delete cascade,
  category     public.client_photo_category not null,
  storage_path text not null,
  uploaded_by  uuid references public.profiles (id) default auth.uid(),
  created_at   timestamptz not null default now(),
  unique (client_id, category)
);

alter table public.client_photos enable row level security;

-- Mismo criterio que clients_staff_only (Fase 2): todo el personal interno.
create policy "client_photos_staff_only"
  on public.client_photos for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

-- Bucket privado para las fotos.
insert into storage.buckets (id, name, public)
values ('client-photos', 'client-photos', false)
on conflict (id) do nothing;

create policy "client_photos_storage_staff_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'client-photos'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION')
  );

create policy "client_photos_storage_staff_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'client-photos'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION')
  );

create policy "client_photos_storage_staff_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'client-photos'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION')
  );

create policy "client_photos_storage_staff_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'client-photos'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION')
  );
