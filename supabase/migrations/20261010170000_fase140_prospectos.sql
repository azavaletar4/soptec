-- SmartRayco — Fase 140: modulo de Prospectos y seguimiento comercial.
--
-- DISEÑO: estructuras nuevas y separadas de clients/service_contracts — un
-- prospecto NO es un cliente (nunca tiene contrato, facturacion ni
-- servicios) hasta que se "convierte" explicitamente, creando un cliente
-- real por el flujo existente de ClientesView.vue. clients.status ya tenia
-- un valor 'prospect' (Fase 1) pero es solo una etiqueta de estado sin
-- historial de seguimiento ni campos comerciales — no se reutiliza ni se
-- toca aqui, para no mezclar prospectos con clientes activos.
--
-- Mismo criterio de roles que clients_staff_only (Fase 2): SUPERADMIN,
-- ADMIN, SOPORTE, FACTURACION — los mismos que ya pueden crear/editar
-- clientes (NOT_TECNICO en el router). TECNICO_RED no tiene vista comercial.
--
-- Telefono NUNCA es unique: un duplicado se avisa en el frontend (igual
-- patron que duplicateClient en ClientesView.vue para el DNI), nunca se
-- bloquea — dos prospectos legitimos pueden compartir celular (ej. pareja,
-- oficina).

create type public.prospect_estado as enum (
  'interesado', 'por_contactar', 'en_negociacion', 'no_interesado', 'convertido'
);

create table public.prospects (
  id                 uuid primary key default gen_random_uuid(),
  full_name          text not null check (full_name <> ''),
  phone              text not null check (phone <> ''),
  zone_id            uuid references public.zones (id),
  address            text,
  plan_interes_id    uuid references public.plans (id),
  canal_contacto     text not null default 'otro',
  estado             public.prospect_estado not null default 'por_contactar',
  observaciones      text,
  proximo_seguimiento date,
  -- Se completa SOLO al convertir (punto 8/9 del pedido) — referencia de
  -- auditoria hacia el cliente real creado, nunca al reves.
  converted_client_id uuid references public.clients (id),
  created_by         uuid references public.profiles (id) default auth.uid(),
  updated_by         uuid references public.profiles (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index idx_prospects_estado on public.prospects (estado);
create index idx_prospects_proximo_seguimiento on public.prospects (proximo_seguimiento);
create index idx_prospects_phone on public.prospects (phone);

create trigger trg_prospects_updated_at
  before update on public.prospects
  for each row execute procedure public.set_updated_at();

-- prospect_followups — bitacora de seguimiento (un prospecto puede tener
-- muchos), mismo patron que ticket_comments (Fase 6): nunca se borra desde
-- la app (sin funcion de delete), conserva el historial completo.
create table public.prospect_followups (
  id           uuid primary key default gen_random_uuid(),
  prospect_id  uuid not null references public.prospects (id) on delete cascade,
  fecha        timestamptz not null default now(),
  author_id    uuid references public.profiles (id) default auth.uid(),
  notas        text not null check (notas <> ''),
  created_at   timestamptz not null default now()
);

create index idx_prospect_followups_prospect_id on public.prospect_followups (prospect_id);

alter table public.prospects enable row level security;
alter table public.prospect_followups enable row level security;

create policy "prospects_comercial_staff"
  on public.prospects for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE', 'FACTURACION'));

create policy "prospect_followups_comercial_staff"
  on public.prospect_followups for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE', 'FACTURACION'));
