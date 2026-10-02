-- SmartRayco — Fase 68: pasa el cliente de 'prospect' a 'active' en cuanto
-- queda vinculado a una ONT con señal real.
--
-- Hasta ahora clients.status se quedaba en 'prospect' para siempre salvo que
-- alguien lo cambiara a mano desde ClientDetailView.vue — no habia ninguna
-- automatizacion, aunque el cliente ya tuviera internet funcionando.
--
-- olt_onts.client_id (Fase 4) es exclusivo del backend (service_role,
-- RLS sin policies — ver comentario original) y se setea en los DOS unicos
-- lugares donde un admin "autoriza"/vincula una ONT a un cliente:
--   1. POST /:id/onts (registrar/autorizar una ONT nueva, olt.ts linea ~840)
--   2. PUT /:id/onts/:ontDbId/meta (vincular una ONT ya en la OLT a un
--      cliente existente, usado por ClientServiceDetailView.vue)
-- Un trigger en olt_onts cubre ambos casos de una sola vez, sin duplicar la
-- logica en cada endpoint.
--
-- Solo actua si el cliente sigue en 'prospect' — nunca reactiva a un
-- cliente 'suspended' (corte por deuda) o 'retired' solo porque se le toco/
-- reasigno la ONT por soporte tecnico.

create or replace function public.activate_client_on_ont_link()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.client_id is not null and (tg_op = 'INSERT' or old.client_id is distinct from new.client_id) then
    update public.clients
    set status = 'active'
    where id = new.client_id and status = 'prospect';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_olt_onts_activate_client on public.olt_onts;
create trigger trg_olt_onts_activate_client
  after insert or update of client_id on public.olt_onts
  for each row execute procedure public.activate_client_on_ont_link();
