-- PROTOTIPO LOCAL, NO ES UNA MIGRACIÓN DE APLICACIÓN NI DE CLOUD.
begin;
create role lab_sse_backend login nosuperuser nocreatedb nocreaterole noinherit;
create schema lab_sse;
revoke all on schema lab_sse from public;
grant usage on schema lab_sse to lab_sse_backend;
grant connect on database inventory_lab to lab_sse_backend;
create table lab_sse.scopes(job_type text not null check(job_type in ('installation','ticket')),job_id uuid not null,revision bigint not null default 0,primary key(job_type,job_id));
revoke all on lab_sse.scopes from public,anon,authenticated,service_role,lab_sse_backend;

create function lab_sse.guard(p_actor uuid,p_type text,p_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text; a boolean; s text; member_role text; rev bigint;
begin
 if session_user<>'lab_sse_backend' then raise exception 'Solo backend de laboratorio' using errcode='42501';end if;
 if p_actor is null or p_type not in ('installation','ticket') or p_id is null then
  raise exception 'Contexto no autorizado' using errcode='42501';end if;
 select revision into rev from lab_sse.scopes where job_type=p_type and job_id=p_id;
 if rev is null then raise exception 'Orden fuera de laboratorio' using errcode='42501';end if;
 select role::text,active into r,a from public.profiles where id=p_actor for share nowait;
 if not coalesce(a,false) or r not in ('TECNICO_RED','ADMIN','SUPERADMIN') then
  raise exception 'Usuario no autorizado' using errcode='42501';end if;
 if p_type='installation' then
  select status::text into s from public.installations where id=p_id for share nowait;
  if s is null or s not in ('pending','scheduled','in_progress') then raise exception 'Orden no autorizada' using errcode='42501';end if;
 else
  select status::text into s from public.tickets where id=p_id for share nowait;
  if s is null or s not in ('open','in_progress','rescheduled') then raise exception 'Orden no autorizada' using errcode='42501';end if;
 end if;
 if r='TECNICO_RED' then
  select role into member_role from public.job_assignees where job_type=p_type and job_id=p_id and technician_id=p_actor for share nowait;
  if member_role is null or member_role not in ('leader','support') then raise exception 'Sin asignación vigente' using errcode='42501';end if;
 end if;
 return jsonb_build_object('revision',rev,'pid',pg_backend_pid());
end;$$;

create function lab_sse.revisions() returns jsonb language sql security definer set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(jsonb_build_object('type',job_type,'id',job_id,'revision',revision)),'[]'::jsonb) from lab_sse.scopes
$$;
revoke all on function lab_sse.guard(uuid,text,uuid),lab_sse.revisions() from public,anon,authenticated,service_role;
grant execute on function lab_sse.guard(uuid,text,uuid),lab_sse.revisions() to lab_sse_backend;
create function lab_sse.is_admin(p_actor uuid) returns boolean language sql security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.profiles where id=p_actor and active and role in ('ADMIN','SUPERADMIN'))
$$;
create function lab_sse.bump(p_actor uuid,p_type text,p_id uuid) returns bigint
language plpgsql security definer set search_path=pg_catalog as $$
declare rev bigint;
begin
 if not lab_sse.is_admin(p_actor) then raise exception 'Solo ADMIN ficticio' using errcode='42501';end if;
 update lab_sse.scopes set revision=revision+1 where job_type=p_type and job_id=p_id returning revision into rev;
 if rev is null then raise exception 'Fuera de fixture' using errcode='42501';end if;
 return rev;
end;$$;
revoke all on function lab_sse.is_admin(uuid),lab_sse.bump(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function lab_sse.is_admin(uuid),lab_sse.bump(uuid,text,uuid) to lab_sse_backend;
-- El rol LOGIN no tiene contraseña y no puede autenticar por TCP/SCRAM. El
-- prototipo lo usa solo por socket Unix dentro del contenedor local fijo.
commit;
