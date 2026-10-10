-- Reuses the same transactional allocator as ONU provisioning. Historical rows
-- and nullable legacy contracts are untouched. Apply only after review.
create or replace function public.assign_contract_nap(
  p_nap_id uuid, p_contract_id uuid, p_client_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  v_role := public.current_user_role()::text;
  if v_role is null or v_role not in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION') then
    raise exception 'No tienes permisos para asignar una NAP' using errcode = '42501';
  end if;
  return public.assign_provisioning_nap(p_nap_id, p_contract_id, p_client_id);
end;
$$;
revoke all on function public.assign_contract_nap(uuid, uuid, uuid) from public, anon;
grant execute on function public.assign_contract_nap(uuid, uuid, uuid) to authenticated;
