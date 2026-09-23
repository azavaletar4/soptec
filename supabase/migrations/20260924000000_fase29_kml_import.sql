-- SmartRayco — Fase 29: importador de mapa de red desde KML/KMZ (Google Earth).
-- Cada importacion queda registrada en map_imports; los elementos NUEVOS que
-- crea (infra_elementos/fo_cables) se etiquetan con import_batch_id, lo que
-- permite deshacer una importacion completa borrando solo lo que ella creo
-- (los elementos ya existentes que solo se actualizaron NO se tocan al
-- deshacer). kml_ref (carpeta + nombre del placemark de origen) permite que
-- una futura re-subida del mismo KMZ actualizado reconozca los elementos ya
-- importados en vez de duplicarlos.

create table public.map_imports (
  id              uuid primary key default gen_random_uuid(),
  source_filename text not null,
  summary         jsonb not null default '{}'::jsonb,
  created_by      uuid references public.profiles (id) default auth.uid(),
  created_at      timestamptz not null default now()
);

alter table public.map_imports enable row level security;

create policy "map_imports_staff_only"
  on public.map_imports for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED'));

alter table public.infra_elementos
  add column if not exists kml_ref text,
  add column if not exists import_batch_id uuid references public.map_imports (id) on delete set null;

alter table public.fo_cables
  add column if not exists kml_ref text,
  add column if not exists import_batch_id uuid references public.map_imports (id) on delete set null;

create index if not exists idx_infra_elementos_kml_ref on public.infra_elementos (kml_ref);
create index if not exists idx_infra_elementos_import_batch on public.infra_elementos (import_batch_id);
create index if not exists idx_fo_cables_kml_ref on public.fo_cables (kml_ref);
create index if not exists idx_fo_cables_import_batch on public.fo_cables (import_batch_id);
