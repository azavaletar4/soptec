-- Backend-only transactional assignment: if the destination is full, the
-- previous assignment remains intact. Contract and NAP locks serialize RPC callers.
create or replace function public.assign_provisioning_nap(
  p_nap_id uuid, p_contract_id uuid, p_client_id uuid
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_capacity integer;
  v_id uuid;
  v_number integer;
begin
  perform 1 from public.service_contracts where id = p_contract_id and client_id = p_client_id for update;
  if not found then raise exception 'Contrato y cliente no coinciden'; end if;
  select coalesce(puertos_total, 16) into v_capacity from public.infra_elementos
    where id = p_nap_id and tipo = 'caja_nap' for update;
  if not found or v_capacity < 1 then raise exception 'NAP invalida'; end if;

  select id into v_id from public.fo_nap_puertos
    where infra_elemento_id = p_nap_id and contract_id = p_contract_id
      and client_id = p_client_id and estado = 'ocupado' limit 1;
  if v_id is not null then return v_id; end if;

  select n into v_number from generate_series(1, v_capacity) n
    where not exists (select 1 from public.fo_nap_puertos p
      where p.infra_elemento_id = p_nap_id and p.puerto_numero = n and p.estado <> 'libre')
    order by n limit 1;
  if v_number is null then raise exception 'La caja NAP esta llena'; end if;

  select id into v_id from public.fo_nap_puertos where infra_elemento_id = p_nap_id and puerto_numero = v_number for update;
  if v_id is null then
    insert into public.fo_nap_puertos(infra_elemento_id, puerto_numero, estado, client_id, contract_id)
      values (p_nap_id, v_number, 'ocupado', p_client_id, p_contract_id) returning id into v_id;
  else
    update public.fo_nap_puertos set estado = 'ocupado', client_id = p_client_id, contract_id = p_contract_id
      where id = v_id and estado = 'libre';
    if not found then raise exception 'El puerto NAP fue ocupado por otra solicitud'; end if;
  end if;
  update public.fo_nap_puertos set estado = 'libre', client_id = null, contract_id = null
    where contract_id = p_contract_id and id <> v_id;
  return v_id;
end;
$$;
revoke all on function public.assign_provisioning_nap(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.assign_provisioning_nap(uuid, uuid, uuid) to service_role;
-- Restrict the earlier history RPC explicitly as well.
revoke all on function public.append_provisioning_step(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.append_provisioning_step(uuid, text, text, text) to service_role;
