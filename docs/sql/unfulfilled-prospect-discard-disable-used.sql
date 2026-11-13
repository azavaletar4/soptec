-- Reversión conservadora tras uso: conservar evidencia y protecciones.
begin;
revoke execute on function public.discard_unfulfilled_client_prospect(uuid,timestamptz,text,boolean) from authenticated;
commit;
