-- Read-only release gate. Real actors are impersonated only inside this DB
-- transaction; no account, session, job or inventory changes are made.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='3s';
DO $gate$
DECLARE actor record; other_job record; result jsonb; personal jsonb; custody jsonb;
 period text; own_period text; expected numeric; actual numeric; technicians int:=0;
 staff int:=0; denied boolean; field_count int;
BEGIN
 IF has_function_privilege('anon','public.get_technician_ranking(int,int)','EXECUTE')
 OR has_function_privilege('anon','public.get_technician_period_ranking(text,date)','EXECUTE')
 OR has_function_privilege('anon','public.my_field_progress()','EXECUTE')
 OR has_function_privilege('anon','public.my_field_job_points(text,uuid)','EXECUTE')
 OR has_function_privilege('anon','public.my_inventory_custody()','EXECUTE')
 OR has_function_privilege('authenticated','public.technician_point_contributions(timestamptz,timestamptz)','EXECUTE')
 OR has_function_privilege('authenticated','public.technician_ranking_between(timestamptz,timestamptz)','EXECUTE') THEN
  RAISE EXCEPTION 'RELEASE_ACL_GATE_FAILED';
 END IF;
 EXECUTE 'SET LOCAL ROLE anon';
 denied:=false;
 BEGIN PERFORM public.get_technician_period_ranking('day',NULL); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 EXECUTE 'RESET ROLE';
 IF NOT denied THEN RAISE EXCEPTION 'ANON_EXECUTED_RANKING'; END IF;
 FOR actor IN SELECT id,role FROM public.profiles WHERE active AND role IN ('TECNICO_RED','ADMIN','SUPERADMIN','SOPORTE') ORDER BY role,id LOOP
  SELECT c.job_type,c.job_id INTO other_job FROM public.technician_point_contributions('2000-01-01','2101-01-01') c
   WHERE c.technician_id<>actor.id AND NOT EXISTS(SELECT 1 FROM public.technician_point_contributions('2000-01-01','2101-01-01') own WHERE own.technician_id=actor.id AND own.job_type=c.job_type AND own.job_id=c.job_id) LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub',actor.id::text,true);
  PERFORM set_config('request.jwt.claims','{}',true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  FOREACH period IN ARRAY ARRAY['day','week','month'] LOOP
   result:=public.get_technician_period_ranking(period,NULL);
   IF result->>'timezone'<>'America/Lima'
    OR (result->>'start')::timestamptz<>(date_trunc(period,now() AT TIME ZONE 'America/Lima') AT TIME ZONE 'America/Lima') THEN RAISE EXCEPTION 'PERU_PERIOD_BOUNDARY_FAILED'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(result->'ranking') r WHERE
     (SELECT count(*) FROM jsonb_object_keys(r))<>9 OR
     r-ARRAY['technician_id','technician_name','installations_count','averias_count','reconexiones_count','rutinas_count','reincidencias_count','total_points','ranking']<>'{}'::jsonb) THEN RAISE EXCEPTION 'SHARED_FIELDS_NOT_ALLOWLISTED'; END IF;
   IF actor.role='TECNICO_RED' THEN
    personal:=public.my_field_progress();
    own_period:=CASE period WHEN 'day' THEN 'today' ELSE period END;
    expected:=(personal->'periods'->own_period->>'points')::numeric;
    SELECT coalesce((SELECT (r->>'total_points')::numeric FROM jsonb_array_elements(result->'ranking') r WHERE r->>'technician_id'=actor.id::text),0) INTO actual;
    IF expected IS DISTINCT FROM actual THEN RAISE EXCEPTION 'PERSONAL_SHARED_POINTS_DIFFER'; END IF;
   END IF;
  END LOOP;
  IF actor.role='TECNICO_RED' THEN
   custody:=public.my_inventory_custody();
   IF other_job.job_id IS NOT NULL AND public.my_field_job_points(other_job.job_type,other_job.job_id) IS NOT NULL THEN RAISE EXCEPTION 'FOREIGN_JOB_EXPOSED'; END IF;
   SELECT count(*) INTO field_count FROM public.technician_material_custody WHERE technician_id<>auth.uid();
   IF field_count<>0 THEN RAISE EXCEPTION 'FOREIGN_MATERIAL_RLS_FAILED'; END IF;
   EXECUTE 'RESET ROLE';
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(custody->'units') u JOIN public.inventory_units i ON i.id=(u->>'id')::uuid WHERE i.custody_technician_id IS DISTINCT FROM actor.id)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(custody->'materials') m WHERE NOT EXISTS(SELECT 1 FROM public.technician_material_custody c WHERE c.technician_id=actor.id AND c.product_id=(m->'product'->>'id')::uuid))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(personal->'contributions') e WHERE NOT EXISTS(SELECT 1 FROM public.technician_point_contributions('2000-01-01','2101-01-01') c WHERE c.technician_id=actor.id AND c.job_type=e->>'jobType' AND c.job_id=(e->>'jobId')::uuid)) THEN RAISE EXCEPTION 'PERSONAL_SCOPE_FAILED'; END IF;
   technicians:=technicians+1;
  ELSE
   EXECUTE 'RESET ROLE';staff:=staff+1;
  END IF;
 END LOOP;
 IF technicians<2 THEN RAISE EXCEPTION 'INSUFFICIENT_TECHNICIANS_FOR_ISOLATION'; END IF;
 RAISE NOTICE 'READ_ONLY_ACCESS_GATE_PASS; technicians=%; staff=%; anon_denied=true',technicians,staff;
END $gate$;
SELECT json_build_object('read_only',current_setting('transaction_read_only'),'access_gate','PASS','timezone','America/Lima');
ROLLBACK;
