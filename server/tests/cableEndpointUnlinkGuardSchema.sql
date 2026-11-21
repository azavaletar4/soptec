-- Isolated fixture: minimal tables/constraints needed to exercise the
-- already-deployed map-removal RPCs plus this session's migration, not a
-- dump of production data. auth.uid()/current_user_role() mirror the real
-- project convention (current_user_role() is extracted verbatim from its
-- real migration by the test file, not reproduced here).
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create type public.user_role as enum ('SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION','CLIENTE');
create table public.profiles(id uuid primary key, role public.user_role, active boolean default true);

create table public.infra_elementos(id uuid primary key default gen_random_uuid(), name text, tipo text, map_removed_at timestamptz);
create table public.fo_cables(
  id uuid primary key default gen_random_uuid(), codigo text not null, tipo text, hilos_total integer not null default 12,
  metraje numeric, path jsonb not null default '[]'::jsonb,
  origen_olt_id uuid, origen_infra_id uuid references public.infra_elementos(id),
  destino_olt_id uuid, destino_infra_id uuid references public.infra_elementos(id),
  is_active boolean not null default true, notes text,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  map_removed_at timestamptz
);
create table public.fo_hilo_estados(
  id uuid primary key default gen_random_uuid(), cable_id uuid not null references public.fo_cables(id),
  hilo_index integer not null, map_removed_at timestamptz, unique(cable_id, hilo_index)
);
create table public.fo_fusiones(
  id uuid primary key default gen_random_uuid(), infra_elemento_id uuid references public.infra_elementos(id),
  cable_a_id uuid references public.fo_cables(id), cable_b_id uuid references public.fo_cables(id),
  hilo_a_index integer, hilo_b_index integer, map_removed_at timestamptz
);
create table public.fo_nap_puertos(
  id uuid primary key default gen_random_uuid(), infra_elemento_id uuid references public.infra_elementos(id),
  fusion_id uuid, puerto_numero integer, client_id uuid, contract_id uuid, estado text
);
create table public.routines(id uuid primary key default gen_random_uuid(), nap_elemento_id uuid);

-- Reproduccion fiel de map_removal_snapshot / preview_map_removal tal como
-- estan HOY en produccion (confirmados leyendo pg_get_functiondef, solo
-- lectura, 21/11/2026) -- no forman parte del cambio de esta sesion, se
-- cargan tal cual para que remove_from_network_map (que si se modifica)
-- se ejercite contra su dependencia real, no una version inventada.
create or replace function public.map_removal_snapshot(p_kind text, p_id uuid, p_hilo integer default null::integer) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $function$
declare root jsonb; fusions jsonb; cables jsonb; threads jsonb; ports jsonb; orders jsonb; unexpected text;
begin
  if p_kind not in ('infra','cable','hilo') or p_kind is null then
    raise exception 'Tipo de elemento del mapa inválido.';
  end if;
  if p_kind in ('cable','hilo') then
    select format('%I.%I (%I)',n.nspname,t.relname,c.conname) into unexpected
    from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where c.contype='f' and c.confrelid in ('public.fo_cables'::regclass,'public.fo_hilo_estados'::regclass)
      and not (c.confrelid='public.fo_cables'::regclass and
        ((c.conrelid='public.fo_hilo_estados'::regclass and c.conkey=array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='cable_id')])
          or (c.conrelid='public.fo_fusiones'::regclass and c.conkey in
            (array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='cable_a_id')],
             array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='cable_b_id')]))))
    order by n.nspname,t.relname,c.conname limit 1;
    if unexpected is not null then raise exception 'Referencia externa que requiere tratamiento: %',unexpected; end if;
  end if;
  if p_kind='infra' then
    select to_jsonb(i) into root from public.infra_elementos i where id=p_id and map_removed_at is null;
  else
    select to_jsonb(c) into root from public.fo_cables c where id=p_id and map_removed_at is null;
    if p_kind='hilo' and (p_hilo is null or p_hilo<1 or p_hilo>(root->>'hilos_total')::integer) then raise exception 'Índice de hilo inválido.'; end if;
    if p_kind='hilo' and exists(select 1 from public.fo_hilo_estados where cable_id=p_id and hilo_index=p_hilo and map_removed_at is not null) then root=null; end if;
  end if;
  if root is null then raise exception using errcode='P0002',message='El elemento no existe o ya fue retirado del mapa. Actualiza la vista.'; end if;
  select coalesce(jsonb_agg(to_jsonb(f) order by id),'[]') into fusions from public.fo_fusiones f
    where (p_kind='infra' and infra_elemento_id=p_id)
      or (p_kind='cable' and (cable_a_id=p_id or cable_b_id=p_id))
      or (p_kind='hilo' and ((cable_a_id=p_id and hilo_a_index=p_hilo) or (cable_b_id=p_id and hilo_b_index=p_hilo)));
  select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') into cables from public.fo_cables c
    where (p_kind='infra' and (origen_infra_id=p_id or destino_infra_id=p_id)) or (p_kind<>'infra' and id=p_id);
  select coalesce(jsonb_agg(to_jsonb(h) order by id),'[]') into threads from public.fo_hilo_estados h
    where p_kind<>'infra' and cable_id=p_id and (p_kind='cable' or hilo_index=p_hilo);
  select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') into ports from public.fo_nap_puertos p
    where (p_kind='infra' and infra_elemento_id=p_id) or exists(select 1 from jsonb_array_elements(fusions) f
      where p.fusion_id=(f->>'id')::uuid or
        (p.infra_elemento_id=(f->>'infra_elemento_id')::uuid and p.puerto_numero=(f->>'puerto_nap')::integer and f->>'destino_tipo'='splitter_out'));
  select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') into orders from public.routines r where p_kind='infra' and nap_elemento_id=p_id;
  return jsonb_build_object('kind',p_kind,'id',p_id,'hilo',p_hilo,'root',root,'cables',cables,'fusiones',fusions,'hilos',threads,'puertos',ports,'ordenes',orders);
end $function$;

create or replace function public.preview_map_removal(p_kind text, p_id uuid, p_hilo integer default null::integer) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $function$
declare s jsonb;
begin
  if public.current_user_role() is distinct from 'SUPERADMIN' then raise exception using errcode='42501',message='Solo SUPERADMIN puede eliminar elementos del mapa.'; end if;
  s=public.map_removal_snapshot(p_kind,p_id,p_hilo);
  return jsonb_build_object('token',md5(s::text),'id',p_id,'kind',p_kind,'hilo',p_hilo,
    'clientes',(select count(distinct p->>'client_id') from jsonb_array_elements(s->'puertos') p),
    'asignaciones',(select count(*) from jsonb_array_elements(s->'puertos') p where p->>'client_id' is not null or p->>'contract_id' is not null or p->>'estado' in ('ocupado','reservado')),
    'ordenes',jsonb_array_length(s->'ordenes'),
    'conexiones',case when p_kind='infra' then (select count(*) from jsonb_array_elements(s->'cables') c where c->>'map_removed_at' is null)
      when p_kind='cable' then
        ((s->'root'->>'origen_infra_id' is not null or s->'root'->>'origen_olt_id' is not null)::integer
        +(s->'root'->>'destino_infra_id' is not null or s->'root'->>'destino_olt_id' is not null)::integer)
      else 0 end,
    'empalmes',(select count(*) from jsonb_array_elements(s->'fusiones') f where f->>'map_removed_at' is null));
end $function$;

-- remove_from_network_map ANTES de esta sesion (sin la limpieza de
-- origen/destino colgantes) -- se carga aqui para que la primera prueba
-- demuestre el bug real; luego el test aplica la migracion de esta sesion
-- (CREATE OR REPLACE) y repite para confirmar la correccion.
create or replace function public.remove_from_network_map(p_kind text, p_id uuid, p_token text, p_hilo integer default null::integer) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $function$
declare s jsonb; at_time timestamptz=clock_timestamp(); fusion_ids uuid[];
begin
  if public.current_user_role() is distinct from 'SUPERADMIN' then raise exception using errcode='42501',message='Solo SUPERADMIN puede eliminar elementos del mapa.'; end if;
  perform set_config('lock_timeout','2s',true);
  lock table public.infra_elementos,public.fo_cables,public.fo_hilo_estados,public.fo_fusiones,public.fo_nap_puertos,public.routines in share row exclusive mode;
  s=public.map_removal_snapshot(p_kind,p_id,p_hilo);
  if p_token is distinct from md5(s::text) then raise exception using errcode='40001',message='Las relaciones cambiaron. Revisa de nuevo el resumen antes de confirmar.'; end if;
  select coalesce(array_agg((f->>'id')::uuid),'{}') into fusion_ids from jsonb_array_elements(s->'fusiones') f;
  update public.fo_fusiones set map_removed_at=at_time where id=any(fusion_ids) and map_removed_at is null;
  if p_kind='infra' then
    update public.infra_elementos set map_removed_at=at_time where id=p_id;
  elsif p_kind='cable' then
    update public.fo_cables set map_removed_at=at_time where id=p_id;
  else
    insert into public.fo_hilo_estados(cable_id,hilo_index,map_removed_at) values(p_id,p_hilo,at_time)
      on conflict(cable_id,hilo_index) do update set map_removed_at=excluded.map_removed_at;
  end if;
  return jsonb_build_object('id',p_id,'kind',p_kind,'hilo',p_hilo,'removedAt',at_time,'fusionIds',to_jsonb(fusion_ids),
    'thread',case when p_kind='hilo' then (select to_jsonb(h) from public.fo_hilo_estados h where cable_id=p_id and hilo_index=p_hilo) end);
end $function$;

grant usage on schema public, auth to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
-- RLS/policy de fo_cables se crea DESPUES (en el test, tras cargar
-- current_user_role()) porque CREATE POLICY resuelve esa funcion al
-- crearse, a diferencia de un cuerpo plpgsql que solo se valida al llamarse.
