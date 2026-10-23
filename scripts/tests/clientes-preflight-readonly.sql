-- Exclusivamente Clientes/contratos/altas y Prospectos. Sin DDL ni DML.
begin isolation level repeatable read read only;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
with facts as (
 select c.status,
  (select count(*) from public.service_contracts s where s.client_id=c.id) services,
  exists(select 1 from public.service_contracts s where s.client_id=c.id and s.status='active') active,
  exists(select 1 from public.service_contracts s where s.client_id=c.id and s.status='suspended') suspended,
  exists(select 1 from public.service_contracts s where s.client_id=c.id and s.status='cancelled') cancelled,
  exists(select 1 from public.installations i where i.client_id=c.id and i.status in ('pending','scheduled','in_progress')) pending,
  jsonb_build_object('status',c.status,
    'service_contracts',coalesce((select jsonb_agg(jsonb_build_object('status',s.status)) from public.service_contracts s where s.client_id=c.id),'[]'),
    'installations',coalesce((select jsonb_agg(jsonb_build_object('status',i.status)) from public.installations i where i.client_id=c.id),'[]')) lifecycle
 from public.clients c
), classified as (
 select *,not pending and not active and not suspended and (services>0 or status='retired') retired from facts
)
select jsonb_build_object('kind','snapshot','read_only',current_setting('transaction_read_only'),'at',now(),
 'counts',jsonb_build_object('registered',count(*),'currentSection',count(*) filter(where not retired),
 'subscribers',count(*) filter(where not retired and services>0),'retired',count(*) filter(where retired),
 'withoutCurrentService',count(*) filter(where not retired and services=0),
 'active',count(*) filter(where not retired and active),
 'suspended',count(*) filter(where not retired and suspended),
 'suspendedOnly',count(*) filter(where not retired and not active and suspended),
 'pendingInstallation',count(*) filter(where pending),
 'clientStatusProspect',count(*) filter(where status='prospect'),
 'prospectWithoutService',count(*) filter(where status='prospect' and services=0),
 'multipleServices',count(*) filter(where services>=2),
 'mixedActiveCancelled',count(*) filter(where active and cancelled),
 'mixedActiveExcluded',count(*) filter(where active and services>=2 and retired),
 'retiredInSubscribers',count(*) filter(where retired and not retired and services>0)),
 'commercialProspects',(select coalesce(jsonb_object_agg(estado,n),'{}') from (select estado,count(*) n from public.prospects group by estado)p),
 'followups',(select count(*) from public.prospect_followups),
 'rows',coalesce(jsonb_agg(lifecycle),'[]')) from classified;

select jsonb_build_object('kind','rls_catalog','read_only',current_setting('transaction_read_only'),
 'tables',(select jsonb_agg(jsonb_build_object('table',relname,'rls',relrowsecurity,'force',relforcerowsecurity))
  from pg_class where relnamespace='public'::regnamespace and relname in ('clients','service_contracts','installations','prospects','prospect_followups')),
 'policies',(select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname='public' and tablename in ('clients','service_contracts','installations','prospects','prospect_followups')),
 'constraints',(select jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid))) from pg_constraint
  where conrelid in ('public.clients'::regclass,'public.prospects'::regclass,'public.prospect_followups'::regclass) and contype in ('f','u')),
 'roleFunction',(select pg_get_functiondef('public.current_user_role()'::regprocedure)),
 'availableActors',(select jsonb_object_agg(role,n) from (select role,count(*) n from public.profiles where active group by role)p));

-- Un actor real por rol, claims sólo locales; no login, cambios de sesión persistentes ni escrituras.
select format($q$
 set local role authenticated;
 set local request.jwt.claim.sub=%L;
 set local request.jwt.claims=%L;
 select jsonb_build_object('kind','rls_actor','read_only',current_setting('transaction_read_only'),
 'role',public.current_user_role(),'clients',(select count(*) from public.clients),
 'contracts',(select count(*) from public.service_contracts),'installations',(select count(*) from public.installations),
 'prospects',(select count(*) from public.prospects),'followups',(select count(*) from public.prospect_followups),
 'activeMultiVisible',(select count(*) from public.clients c where (select count(*) from public.service_contracts s where s.client_id=c.id)>=2 and exists(select 1 from public.service_contracts s where s.client_id=c.id and s.status='active')));
 reset role;
 $q$,id::text,jsonb_build_object('sub',id,'role','authenticated')::text)
from (select distinct on (role) id,role from public.profiles where active
 and role in ('ADMIN','SUPERADMIN','SOPORTE','FACTURACION','TECNICO_RED') order by role,id)p
\gexec
set local role anon;
select jsonb_build_object('kind','rls_anon','read_only',current_setting('transaction_read_only'),
 'clients',(select count(*) from public.clients),'prospects',(select count(*) from public.prospects),
 'followups',(select count(*) from public.prospect_followups));
reset role;
rollback;
