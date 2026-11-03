-- CANDIDATA LOCAL -- sin aplicar en Supabase todavia.
-- Soporta POST /:id/onts/:ontDbId/link (vincular una ONT ya existente en
-- olt_onts, importada por import-existing o no, a un cliente/contrato) y
-- registra traza de importaciones ("import", desde import-existing) y
-- vinculaciones ("link", desde esta ruta). Nunca toca la OLT. Verificado
-- en solo lectura antes de escribir esto: cero filas de olt_onts activas
-- comparten hoy el mismo contract_id, asi que el indice unico de abajo no
-- encontraria ningun conflicto existente al aplicarse.
begin;

create table public.olt_ont_link_audit (
  id uuid primary key default gen_random_uuid(),
  ont_id uuid not null,
  olt_device_id uuid not null references public.olt_devices(id) on delete cascade,
  action text not null check (action in ('import', 'link')),
  client_id uuid references public.clients(id),
  contract_id uuid references public.service_contracts(id),
  previous_client_id uuid,
  previous_contract_id uuid,
  serial text not null,
  position text not null,
  performed_by uuid not null references public.profiles(id),
  performed_at timestamptz not null default now()
);
create index olt_ont_link_audit_ont_id_idx on public.olt_ont_link_audit(ont_id);
create index olt_ont_link_audit_contract_id_idx on public.olt_ont_link_audit(contract_id);

alter table public.olt_ont_link_audit enable row level security;
revoke all on public.olt_ont_link_audit from public, anon, authenticated;
-- Solo lectura para staff admin -- la escritura real la hace unicamente el
-- backend (supabaseAdmin, service_role) desde las rutas ya validadas;
-- nunca se expone un INSERT/UPDATE/DELETE directo a authenticated/anon.
create policy olt_ont_link_audit_admin_read on public.olt_ont_link_audit for select to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role::text in ('ADMIN', 'SUPERADMIN')));
grant select on public.olt_ont_link_audit to authenticated;

-- Ultima linea de defensa, a nivel de base, contra 2 ONTs activas
-- reclamando el mismo contrato a la vez -- ya sea por una condicion de
-- carrera entre 2 solicitudes simultaneas a /link, o por cualquier
-- escritura futura que no pase por esa validacion. Parcial: un contrato
-- puede repetirse libremente entre ONTs retiradas o sin contract_id.
create unique index olt_onts_contract_id_active_key on public.olt_onts (contract_id)
where retired_at is null and contract_id is not null;

commit;
