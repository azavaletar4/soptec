-- SmartRayco — Fase 32: App de Campo para tecnicos (movil-first).
--
-- No se crea una tabla "unificada" de trabajos: installations y tickets
-- siguen siendo las fuentes de verdad (altas y averias respectivamente), la
-- app de campo simplemente las combina en el frontend en una sola bandeja.
-- Lo que si es nuevo es el "cierre de trabajo en campo" (GPS del cierre,
-- serial de ONT leido por QR, notas, firma de conformidad) y su evidencia
-- fotografica — comun a ambos tipos de trabajo, por eso vive en tablas
-- separadas referenciadas por (job_type, job_id) en vez de agregar columnas
-- distintas a installations y a tickets.
--
-- work_order_photos es una galeria libre (sin slot fijo por categoria, a
-- diferencia de client_photos) porque una averia puede visitarse mas de una
-- vez y cada cierre debe conservar sus propias fotos.

create table public.work_order_closures (
  id             uuid primary key default gen_random_uuid(),
  job_type       text not null check (job_type in ('installation', 'ticket')),
  job_id         uuid not null,
  client_id      uuid not null references public.clients (id) on delete cascade,
  latitude       double precision,
  longitude      double precision,
  ont_serial     text,
  closure_notes  text,
  signature_path text,
  closed_by      uuid references public.profiles (id) default auth.uid(),
  created_at     timestamptz not null default now(),
  unique (job_type, job_id)
);

create index idx_work_order_closures_client on public.work_order_closures (client_id);

create table public.work_order_photos (
  id           uuid primary key default gen_random_uuid(),
  job_type     text not null check (job_type in ('installation', 'ticket')),
  job_id       uuid not null,
  category     text not null,
  storage_path text not null,
  uploaded_by  uuid references public.profiles (id) default auth.uid(),
  created_at   timestamptz not null default now()
);

create index idx_work_order_photos_job on public.work_order_photos (job_type, job_id);

alter table public.work_order_closures enable row level security;
alter table public.work_order_photos enable row level security;

-- Mismo criterio que installations/tickets: todo el personal interno puede
-- registrar y ver cierres de campo (no es exclusivo de un rol).
create policy "work_order_closures_staff_only"
  on public.work_order_closures for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

create policy "work_order_photos_staff_only"
  on public.work_order_photos for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

-- Bucket privado para fotos de cierre y firma de conformidad.
insert into storage.buckets (id, name, public)
values ('work-evidence', 'work-evidence', false)
on conflict (id) do nothing;

create policy "work_evidence_storage_staff_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'work-evidence'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION')
  );

create policy "work_evidence_storage_staff_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'work-evidence'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION')
  );

create policy "work_evidence_storage_staff_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'work-evidence'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION')
  );

create policy "work_evidence_storage_staff_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'work-evidence'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION')
  );

-- Foto del medidor de potencia PON, agregada al set fijo de client_photos
-- (fachada/hoja de servicio/posicion del modem/caja NAP) para el cierre de
-- instalaciones — ver fase12b para el precedente de agregar una categoria.
alter type public.client_photo_category add value if not exists 'pon_power';
