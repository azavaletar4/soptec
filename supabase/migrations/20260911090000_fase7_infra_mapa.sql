-- SmartRayco — Fase 7: elementos pasivos de red (NAPs, splitters, mangas,
-- armarios, postes, camaras) para la capa de infraestructura del mapa
-- (extiende /mapa, ya existente desde la Fase 9 — no crea un mapa nuevo).
-- Adaptado del doc de curso 07-infraestructura.md (proyecto de referencia):
-- se quita tenant_id (single-tenant, igual que el resto del proyecto) y
-- coordenadas double precision (mismo tipo que clients.latitude/longitude,
-- Fase 3c) en vez de DECIMAL con precision fija.

create table public.infra_elementos (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  tipo        text not null default 'caja_nap'
              check (tipo in ('caja_nap', 'splitter', 'manga', 'armario', 'poste', 'camara', 'otro')),
  potencia    text,                  -- ej: "-15 dBm" (texto libre, no siempre medible)
  spliteo     text,                  -- ej: "1:8"
  is_active   boolean not null default true,
  photo_path  text,                  -- storage_path en el bucket infra-photos (privado, url firmada)
  latitude    double precision,
  longitude   double precision,
  notes       text,
  created_by  uuid references public.profiles (id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.infra_elementos enable row level security;

-- Mismo criterio que installations/client_photos: todo el staff interno.
create policy "infra_elementos_staff_only"
  on public.infra_elementos for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

create trigger trg_infra_elementos_updated_at
  before update on public.infra_elementos
  for each row execute procedure public.set_updated_at();

create index idx_infra_elementos_tipo on public.infra_elementos (tipo);

-- Coordenadas para la capa de MikroTik en el mapa (la OLT ya tiene lat/lng
-- dentro de extra_params jsonb, ver Fase 4 — no hace falta migracion ahi).
alter table public.mikrotik_devices add column if not exists latitude double precision;
alter table public.mikrotik_devices add column if not exists longitude double precision;

-- Bucket privado para fotos de elementos pasivos (mismo patron que
-- client-photos, Fase 3c).
insert into storage.buckets (id, name, public)
values ('infra-photos', 'infra-photos', false)
on conflict (id) do nothing;

create policy "infra_photos_storage_staff_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'infra-photos'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION')
  );

create policy "infra_photos_storage_staff_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'infra-photos'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION')
  );

create policy "infra_photos_storage_staff_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'infra-photos'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION')
  );

create policy "infra_photos_storage_staff_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'infra-photos'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION')
  );
