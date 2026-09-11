-- SmartRayco — Fase 6h: metadata de topologia fisica por ONT (zona/splitter)
-- y contacto directo, estilo SmartOLT (ver captura de referencia). Muchas
-- ONTs reales (importadas de la OLT, ver fase 4/bulk import) no tienen un
-- client_id vinculado todavia — estos campos permiten anotar zona, splitter,
-- nombre/direccion/contacto directo en la ONT sin necesitar un alta formal
-- de cliente primero.
--
-- "zone_id" reutiliza el catalogo de zonas ya existente (mismo usado por
-- clients/olt_devices) en vez de duplicar un campo de texto libre, para
-- mantener una sola taxonomia de zonas en toda la app.

alter table public.olt_onts add column if not exists zone_id uuid references public.zones (id) on delete set null;
alter table public.olt_onts add column if not exists splitter text;
alter table public.olt_onts add column if not exists splitter_port text;
alter table public.olt_onts add column if not exists address_comment text;
alter table public.olt_onts add column if not exists contact text;
alter table public.olt_onts add column if not exists latitude numeric(10, 7);
alter table public.olt_onts add column if not exists longitude numeric(10, 7);

create index if not exists idx_olt_onts_zone on public.olt_onts (zone_id) where zone_id is not null;
