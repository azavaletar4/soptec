-- PROPUESTA LOCAL: revierte sólo definiciones, no estados ni datos históricos.
begin;
drop trigger if exists contract_administrative_installation_guard on public.installations;
drop trigger if exists contract_administrative_guard on public.service_contracts;
drop function if exists public.contract_administrative_installation_guard();
drop function if exists public.contract_administrative_guard();
drop function if exists public.contract_cancel_administrative(uuid,timestamptz,boolean);
commit;
