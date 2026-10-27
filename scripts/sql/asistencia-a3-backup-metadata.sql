begin read only;
set local timezone='UTC';
with target_tables as (
 select c.oid,c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relname=any(array[
 'company_settings','feriados','asistencia_registros','asistencia_solicitudes','asistencia_solicitud_eventos','asistencia_novedades','asistencia_horarios_personales','asistencia_config_eventos'])
), functions as (
 select p.* from pg_proc p where p.pronamespace='public'::regnamespace and
 (p.proname like 'asistencia_%' or p.proname like 'mark_attendance_%' or p.proname in ('current_user_role','set_updated_at','distancia_metros'))
), fingerprints as (
 select 'company_settings' as name,count(*) as rows,md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) as md5 from company_settings r union all
 select 'feriados',count(*),md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) from feriados r union all
 select 'asistencia_registros',count(*),md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) from asistencia_registros r union all
 select 'asistencia_solicitudes',count(*),md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) from asistencia_solicitudes r union all
 select 'asistencia_solicitud_eventos',count(*),md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) from asistencia_solicitud_eventos r union all
 select 'asistencia_novedades',count(*),md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) from asistencia_novedades r union all
 select 'asistencia_horarios_personales',count(*),md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) from asistencia_horarios_personales r union all
 select 'asistencia_config_eventos',count(*),md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) from asistencia_config_eventos r
)
select json_build_object(
 'read_only',current_setting('transaction_read_only'),'checked_at',now(),'a3_absent',to_regclass('public.asistencia_intercambios') is null,
 'tables',(select json_agg(row_to_json(f) order by name) from fingerprints f),
 'functions',(select json_agg(json_build_object('name',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'body_md5',md5(regexp_replace(p.prosrc,'\s','','g')),'acl',p.proacl) order by p.proname) from functions p),
 'function_acl_sql',(select string_agg(format('GRANT %s ON FUNCTION %s TO %s%s;',a.privilege_type,p.oid::regprocedure,case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end,case when a.is_grantable then ' WITH GRANT OPTION' else '' end),E'\n') from functions p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a),
 'roles',(select json_agg(distinct name) from (
  select pg_get_userbyid(a.grantee) as name from functions p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>0 union
  select pg_get_userbyid(a.grantee) from target_tables t join pg_class c on c.oid=t.oid cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee<>0
 ) roles),
 'enums',(select json_object_agg(name,labels) from (
  select t.typname name,json_agg(e.enumlabel order by e.enumsortorder) labels from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typnamespace='public'::regnamespace and t.typname in ('user_role','asistencia_estado') group by t.typname
 ) enums),
 'profiles',(select json_agg(json_build_object('id',id,'role',role,'active',active,'full_name',full_name,'email',email)) from profiles),
 'triggers',(select json_agg(json_build_object('table',t.relname,'name',g.tgname,'definition',pg_get_triggerdef(g.oid))) from target_tables t join pg_trigger g on g.tgrelid=t.oid where not g.tgisinternal),
 'policies',(select json_agg(row_to_json(p)) from pg_policies p where schemaname='public' and tablename in (select relname from target_tables))
);
rollback;
