-- SOLO LECTURA, para despues de una aplicacion FUTURA autorizada. No ejecutar migracion aqui.
WITH functions(signature,hash,private) AS (VALUES
 ('public.check_routine_inventory_receipt(uuid,uuid)','01bcfddcff820c2c7df8737f6d520d37',true),
 ('public.guard_routine_inventory_movement()','f761ed3845cb6afb32e9e6eafc858ab9',true),
 ('public.guard_routine_inventory_unit()','16eb56b7a4520f765dd65190bdb6bd4d',true),
 ('public.guard_routine_inventory_event()','641d3b1921a609d8342833c1a6eaafb0',true),
 ('public.apply_routine_inventory_event(public.inventory_unit_events)','0d446d088bca97fcf4fd18a4c8da6d9a',true),
 ('public.routine_inventory_operation(uuid,uuid,text,jsonb)','e453cb545001f13fb373d2a1569725c7',false)
), checks AS (
 SELECT 'Funcion '||e.signature AS control,p.oid IS NOT NULL AND p.prosecdef
 AND md5(regexp_replace(regexp_replace(replace(p.prosrc,E'\r',''),'--[^\n]*','','g'),'[[:space:]]','','g'))=e.hash
 AND regexp_replace(array_to_string(p.proconfig,','),'[[:space:]]','','g') LIKE '%search_path=pg_catalog,public,pg_temp%'
 AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
 AND NOT coalesce((SELECT has_function_privilege(r.oid,p.oid,'EXECUTE') FROM pg_roles r WHERE rolname='anon'),true)
 AND NOT coalesce((SELECT has_function_privilege(r.oid,p.oid,'EXECUTE') FROM pg_roles r WHERE rolname='service_role'),true)
 AND coalesce((SELECT has_function_privilege(r.oid,p.oid,'EXECUTE')=(NOT e.private) FROM pg_roles r WHERE rolname='authenticated'),false) AS ok,
 format('existe=%s; hash esperado=%s; SECURITY DEFINER=%s; search_path=%s; ACL=%s',p.oid IS NOT NULL,e.hash,p.prosecdef,p.proconfig,p.proacl) AS evidencia
 FROM functions e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 UNION ALL
 SELECT 'Dispatcher y saldo Fase151 '||e.signature,p.oid IS NOT NULL AND p.prosecdef
 AND md5(regexp_replace(regexp_replace(replace(p.prosrc,E'\r',''),'--[^\n]*','','g'),'[[:space:]]','','g'))=e.hash,
 'Cuerpo exacto normalizado, sin invocar funcion' FROM (VALUES
 ('public.apply_inventory_unit_event()','b7769fa47a1f4afd77b62ef8f4378341'),('public.apply_inventory_movement()','47f06a8c88924da4d678c27477dfcb2f')) e(signature,hash)
 LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 UNION ALL
 SELECT 'Comprobantes privados',c.oid IS NOT NULL AND c.relrowsecurity AND NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=c.oid)
 AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0)
 AND NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role') AND has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
 format('RLS=%s; ACL=%s',c.relrowsecurity,c.relacl) FROM (SELECT to_regclass('public.routine_inventory_operations') AS oid) x LEFT JOIN pg_class c ON c.oid=x.oid
 UNION ALL
 SELECT 'Guarda '||e.name,exists(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass('public.'||e.rel)
 AND t.tgname=e.name AND t.tgfoid=to_regprocedure(e.fn) AND t.tgenabled IN ('O','A') AND t.tgtype=31 AND t.tgqual IS NULL),
 'BEFORE INSERT/UPDATE/DELETE, por fila, habilitado, sin WHEN' FROM (VALUES
 ('inventory_movements','fase162_inventory_movement_guard','public.guard_routine_inventory_movement()'),
 ('inventory_units','fase162_inventory_unit_guard','public.guard_routine_inventory_unit()'),
 ('inventory_unit_events','fase162_inventory_event_guard','public.guard_routine_inventory_event()')) e(rel,name,fn)
 UNION ALL
 SELECT 'Trigger legacy '||e.rel,exists(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass('public.'||e.rel)
 AND t.tgfoid=to_regprocedure(e.fn) AND t.tgenabled IN ('O','A') AND t.tgtype=7 AND t.tgqual IS NULL AND NOT t.tgisinternal),
 'BEFORE INSERT por fila, habilitado, sin WHEN; no desactivado' FROM (VALUES
 ('inventory_movements','public.apply_inventory_movement()'),('inventory_unit_events','public.apply_inventory_unit_event()')) e(rel,fn)
 UNION ALL
 SELECT 'Indice '||e.name,coalesce(i.indisvalid AND i.indisready AND i.indisunique=e.unique_index,false),coalesce(pg_get_indexdef(i.indexrelid),'AUSENTE')
 FROM (VALUES ('idx_inventory_movements_routine',false),('idx_inventory_events_routine',false),('idx_inventory_units_routine',false),('idx_routine_inventory_single_reversal',true)) e(name,unique_index)
 LEFT JOIN pg_index i ON i.indexrelid=to_regclass('public.'||e.name)
 UNION ALL
 SELECT 'FK '||e.rel||'.'||e.col,exists(SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
 WHERE c.conrelid=to_regclass('public.'||e.rel) AND c.contype='f' AND c.confrelid=to_regclass('public.'||e.target) AND a.attname=e.col AND c.confdeltype='r' AND c.convalidated),
 'FK validada ON DELETE RESTRICT hacia '||e.target FROM (VALUES
 ('routine_inventory_operations','routine_id','routines'),('routine_inventory_operations','actor_id','profiles'),
 ('inventory_movements','routine_id','routines'),('inventory_movements','operation_id','routine_inventory_operations'),
 ('inventory_unit_events','routine_id','routines'),('inventory_unit_events','operation_id','routine_inventory_operations'),('inventory_units','routine_id','routines')) e(rel,col,target)
)
SELECT control,CASE WHEN coalesce(ok,false) THEN 'OK' ELSE 'BLOQUEADO' END AS resultado,evidencia FROM checks
UNION ALL SELECT 'RESULTADO FINAL',CASE WHEN bool_and(coalesce(ok,false)) THEN 'INSTALACION ESTRUCTURAL OK' ELSE 'BLOQUEADO' END,
coalesce(string_agg(control,'; ') FILTER(WHERE NOT coalesce(ok,false)),'Comparar tambien definiciones de indices, RLS/ACL legacy y snapshot de filas/stock anterior. No invocar movimientos reales para esta comprobacion.') FROM checks;
