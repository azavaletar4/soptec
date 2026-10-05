-- SmartRayco — Fase 105: galeria de fotos de serie de equipos (Modem/ONU,
-- TV Box, Mesh, Otro) — un cliente puede tener varios dispositivos a la vez,
-- el slot unico de client_photos (unique (contract_id, category), Fase 38b)
-- no alcanzaba: subir una foto nueva de "equipment_sticker" borraba a la
-- anterior.
--
-- No hizo falta tocar work_order_photos (ya es una galeria libre sin
-- restriccion de unicidad, Fase 32) — el tecnico codifica el tipo de equipo
-- directo en category ('equipment_sticker__modem', '..._tv_box', etc, string
-- libre). Solo se necesita una tabla nueva para el lado "ya aprobado", sin
-- unique — es una galeria real, no un slot.

create type public.equipment_photo_type as enum ('modem', 'tv_box', 'mesh', 'otro');

create table public.client_equipment_photos (
  id             uuid primary key default gen_random_uuid(),
  contract_id    uuid not null references public.service_contracts (id) on delete cascade,
  client_id      uuid not null references public.clients (id) on delete cascade,
  equipment_type public.equipment_photo_type not null default 'modem',
  storage_path   text not null,
  status         text not null default 'approved' check (status in ('pending_approval', 'approved', 'rejected')),
  -- de que visita vino (null si un admin la agrego directo desde la Ficha del Cliente).
  job_type       text check (job_type in ('ticket', 'installation')),
  job_id         uuid,
  uploaded_by    uuid references public.profiles (id) default auth.uid(),
  created_at     timestamptz not null default now()
);

create index idx_client_equipment_photos_contract on public.client_equipment_photos (contract_id);

alter table public.client_equipment_photos enable row level security;

-- Mismo criterio que client_photos_staff_only (Fase 3c): todo el personal interno.
create policy "client_equipment_photos_staff_only"
  on public.client_equipment_photos for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));
