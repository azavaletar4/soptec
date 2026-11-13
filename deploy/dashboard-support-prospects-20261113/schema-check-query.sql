select jsonb_build_object(
 'read_only',current_setting('transaction_read_only'),'at',now(),
 'tables',(select jsonb_agg(jsonb_build_object(
   'name',c.relname,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
   'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'nullable',not a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
   'constraints',(select jsonb_agg(jsonb_build_object('name',p.conname,'definition',pg_get_constraintdef(p.oid)) order by p.conname) from pg_constraint p where p.conrelid=c.oid),
   'indexes',(select jsonb_agg(jsonb_build_object('name',i.indexname,'definition',i.indexdef) order by i.indexname) from pg_indexes i where i.schemaname='public' and i.tablename=c.relname),
   'policies',(select jsonb_agg(jsonb_build_object('name',p.policyname,'permissive',p.permissive,'roles',p.roles,'cmd',p.cmd,'using',p.qual,'check',p.with_check) order by p.policyname) from pg_policies p where p.schemaname='public' and p.tablename=c.relname),
   'triggers',(select jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled,'function',t.tgfoid::regprocedure::text,'function_definition',pg_get_functiondef(t.tgfoid)) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)
 ) order by c.relname) from pg_class c where c.relnamespace='public'::regnamespace and c.relname in ('clients','service_contracts','installations')),
 'existing_proposal_functions',(select coalesce(jsonb_agg(p.oid::regprocedure::text),'[]'::jsonb) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('discard_unfulfilled_client_prospect','guard_unfulfilled_prospect_discard','guard_discarded_prospect_child'))
);
