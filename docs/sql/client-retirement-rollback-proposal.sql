-- REVERSIÓN DE LA PROPUESTA, NO EJECUTADA EN PRODUCCIÓN.
-- Requiere revisar definiciones/propietarios y restaurar primero backend/frontend
-- compatibles o bloquear bajas durante el cambio. No revierte bajas comerciales.
begin;
drop trigger client_retirement_guard_client on public.clients;
drop trigger client_retirement_guard_contract on public.service_contracts;
drop trigger client_retirement_guard_installation on public.installations;
drop policy client_retirement_update_guard on public.clients;
drop policy client_retirement_insert_guard on public.clients;
drop function public.client_retirement_guard_client();
drop function public.client_retirement_guard_child();
drop function public.client_retire_atomic(uuid,text,uuid[],boolean);
drop function public.client_retirement_preview(uuid);
drop function public.client_retirement_write_allowed(uuid,public.client_status);
drop function public.client_retirement_actor_admin();
commit;
