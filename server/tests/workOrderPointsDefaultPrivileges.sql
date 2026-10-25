-- Test-only Supabase ACL model, based on the 2026-10-25 read-only catalog.
-- Apply as postgres BEFORE candidate migrations. BYPASSRLS does not bypass ACL.
alter role service_role bypassrls;
grant usage on schema auth to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to anon, authenticated, service_role;
