begin isolation level repeatable read read only;
set local statement_timeout='15s';
set local lock_timeout='2s';
select jsonb_build_object(
 'read_only',current_setting('transaction_read_only'),'at',now(),
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl,
   'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'nullable',not a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
   'policies',(select jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'roles',(select jsonb_agg(case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end) from unnest(p.polroles)r),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))) from pg_policy p where p.polrelid=c.oid),
   'triggers',(select jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text)) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)
 ) order by c.relname) from pg_class c where c.relnamespace='public'::regnamespace and c.relname in ('prospects','prospect_followups','prospect_conversion_receipts','clients','tickets','routines','installations')),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'definition',pg_get_functiondef(p.oid),'md5',md5(pg_get_functiondef(p.oid))) order by p.proname) from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' and p.proname in ('current_user_role','convert_prospect_with_installation','set_updated_at','discard_prospect','guard_prospect_disposition','guard_prospect_followup')),
 'prospect_enums',(select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid='public.prospect_estado'::regtype),
 'commercial_prospects',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'estado',p.estado,'created_at',p.created_at,'updated_at',p.updated_at,'converted_client_id',p.converted_client_id,
   'receipt',(select to_jsonb(r) from public.prospect_conversion_receipts r where r.prospect_id=p.id),
   'contracts',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'status',c.status)),'[]'::jsonb) from public.service_contracts c where c.client_id=p.converted_client_id),
   'installations',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'status',i.status)),'[]'::jsonb) from public.installations i where i.client_id=p.converted_client_id),
   'followups',(select count(*) from public.prospect_followups f where f.prospect_id=p.id)
 ) order by p.created_at),'[]'::jsonb) from public.prospects p),
 'client_lifecycle_inputs',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'status',c.status,
   'service_contracts',(select coalesce(jsonb_agg(jsonb_build_object('status',s.status)),'[]'::jsonb) from public.service_contracts s where s.client_id=c.id),
   'installations',(select coalesce(jsonb_agg(jsonb_build_object('status',i.status)),'[]'::jsonb) from public.installations i where i.client_id=c.id))),'[]'::jsonb) from public.clients c),
 'support_states',(select jsonb_agg(x order by x.kind,x.status,x.priority) from (
   select 'ticket' as kind,status::text,priority::text,count(*) as amount from public.tickets group by status,priority
   union all select 'routine',status::text,priority::text,count(*) from public.routines group by status,priority
   union all select 'installation',status::text,priority::text,count(*) from public.installations group by status,priority
 )x),
 'active_orders',(select coalesce(jsonb_agg(x order by x.kind,x.created_at),'[]'::jsonb) from (
   select 'ticket' as kind,id,ticket_number as number,status::text,priority::text,created_at,assigned_to from public.tickets where status::text in ('open','in_progress','rescheduled')
   union all select 'routine',id,routine_number,status::text,priority::text,created_at,assigned_to from public.routines where status::text in ('pending','scheduled','in_progress')
   union all select 'installation',id,null,status::text,priority::text,created_at,assigned_to from public.installations where status::text in ('pending','scheduled','in_progress')
 )x),
 'staff_count',(select jsonb_object_agg(role,amount) from (select role::text,count(*) as amount from public.profiles where active group by role)x)
);
rollback;
