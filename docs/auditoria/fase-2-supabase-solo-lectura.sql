-- SmartRayco / fase 2 / comprobacion previa a 136d.
-- Ejecutar en el SQL Editor del proyecto Supabase real ya utilizado por el panel.
-- Solo catalogos y versiones de migraciones. No consulta filas de clientes,
-- credenciales o contratos. No invoca ninguna RPC NAP, ni crea objetos.
-- Devuelve un unico resultado JSON; conservarlo para completar la auditoria.

BEGIN TRANSACTION READ ONLY;

WITH expected_functions(signature) AS (
  VALUES
    ('public.current_user_role()'),
    ('public.append_provisioning_step(uuid,text,text,text)'),
    ('public.assign_provisioning_nap(uuid,uuid,uuid)'),
    ('public.assign_contract_nap(uuid,uuid,uuid)')
), functions AS (
  SELECT e.signature, p.*, n.nspname, l.lanname,
         owner_role.rolname AS owner_name,
         owner_role.rolsuper AS owner_is_superuser,
         owner_role.rolbypassrls AS owner_bypasses_rls
  FROM expected_functions e
  LEFT JOIN pg_catalog.pg_proc p ON p.oid = pg_catalog.to_regprocedure(e.signature)
  LEFT JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  LEFT JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  LEFT JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = p.proowner
), expected_columns(table_name, column_name, expected_pg_type) AS (
  VALUES
    ('profiles','id','uuid'), ('profiles','role','user_role'), ('profiles','active','bool'),
    ('service_contracts','id','uuid'), ('service_contracts','client_id','uuid'),
    ('service_contracts','mikrotik_device_id','uuid'),
    ('service_contracts','pppoe_username','text'), ('service_contracts','mikrotik_profile','text'),
    ('infra_elementos','id','uuid'), ('infra_elementos','tipo','text'), ('infra_elementos','puertos_total','int4'),
    ('fo_nap_puertos','id','uuid'), ('fo_nap_puertos','infra_elemento_id','uuid'),
    ('fo_nap_puertos','puerto_numero','int4'), ('fo_nap_puertos','estado','text'),
    ('fo_nap_puertos','client_id','uuid'), ('fo_nap_puertos','contract_id','uuid'),
    ('olt_provisioning_operations','id','uuid'), ('olt_provisioning_operations','idempotency_key','text'),
    ('olt_provisioning_operations','olt_device_id','uuid'), ('olt_provisioning_operations','serial','text'),
    ('olt_provisioning_operations','frame','int4'), ('olt_provisioning_operations','slot','int4'),
    ('olt_provisioning_operations','port','int4'), ('olt_provisioning_operations','onu_id','int4'),
    ('olt_provisioning_operations','client_id','uuid'), ('olt_provisioning_operations','contract_id','uuid'),
    ('olt_provisioning_operations','requested','jsonb'), ('olt_provisioning_operations','status','text'),
    ('olt_provisioning_operations','steps','jsonb'), ('olt_provisioning_operations','ont_db_id','uuid'),
    ('olt_provisioning_operations','error','text'), ('olt_provisioning_operations','created_at','timestamptz'),
    ('olt_provisioning_operations','updated_at','timestamptz'),
    ('olt_onts','id','uuid'), ('olt_onts','client_id','uuid'), ('olt_onts','contract_id','uuid'),
    ('olt_onts','olt_device_id','uuid'), ('olt_onts','frame','int4'), ('olt_onts','slot','int4'),
    ('olt_onts','port','int4'), ('olt_onts','ont_id','int4')
), columns_checked AS (
  SELECT e.*, c.oid AS table_oid, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
         a.attnum, a.attnotnull, a.atthasdef, t.typname AS actual_pg_type,
         pg_catalog.format_type(a.atttypid,a.atttypmod) AS formatted_type
  FROM expected_columns e
  LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = e.table_name
  LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attname = e.column_name
    AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
), affected_tables AS (
  SELECT c.* FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('profiles','service_contracts','infra_elementos','fo_nap_puertos','olt_provisioning_operations','olt_onts')
)
SELECT jsonb_build_object(
  'context', jsonb_build_object(
    'checked_at', now(), 'database', current_database(), 'sql_role', current_user,
    'transaction_read_only', current_setting('transaction_read_only'),
    'server_version', current_setting('server_version'),
    'scope', 'metadata only; no NAP RPC execution; no business records'
  ),
  'migration_ledger', jsonb_build_object(
    'ledger_exists', pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
    'expected_versions', jsonb_build_array('20261009100000','20261009110000','20261009120000'),
    'new_version_not_to_apply', '20261009130000',
    -- This built-in executes the fixed SELECT only if the ledger exists.
    -- Only versions are returned; migration statements may contain sensitive
    -- historical content and are deliberately excluded.
    'matching_versions_xml', CASE
      WHEN pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
        pg_catalog.query_to_xml(
          $ledger$SELECT version::text AS version
          FROM supabase_migrations.schema_migrations
          WHERE version::text IN ('20261009100000','20261009110000','20261009120000','20261009130000')
          ORDER BY version::text$ledger$, true, false, '')::text
      ELSE NULL END
  ),
  'functions', (
    SELECT jsonb_agg(jsonb_build_object(
      'signature', signature, 'exists', oid IS NOT NULL,
      'result_type', CASE WHEN oid IS NOT NULL THEN pg_catalog.pg_get_function_result(oid) END,
      'language', lanname, 'owner', owner_name, 'owner_superuser', owner_is_superuser,
      'owner_bypassrls', owner_bypasses_rls, 'security_definer', prosecdef,
      'settings', proconfig, 'definition', CASE WHEN oid IS NOT NULL THEN pg_catalog.pg_get_functiondef(oid) END,
      'active_word_in_body_only_not_semantic_proof', CASE WHEN proname = 'current_user_role'
        THEN prosrc ~* '\mactive\M' ELSE NULL END
    ) ORDER BY signature) FROM functions
  ),
  'columns', (
    SELECT jsonb_agg(jsonb_build_object(
      'table', table_name, 'column', column_name, 'table_exists', table_oid IS NOT NULL,
      'column_exists', attnum IS NOT NULL, 'expected_pg_type', expected_pg_type,
      'actual_pg_type', actual_pg_type, 'formatted_type', formatted_type,
      'type_matches', actual_pg_type = expected_pg_type, 'not_null', attnotnull,
      'has_default_without_showing_value', atthasdef, 'rls_enabled', relrowsecurity,
      'rls_forced', relforcerowsecurity
    ) ORDER BY table_name,column_name) FROM columns_checked
  ),
  'constraints', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table', c.relname, 'constraint', con.conname, 'kind', con.contype,
      'validated', con.convalidated, 'deferrable', con.condeferrable,
      'definition', pg_catalog.pg_get_constraintdef(con.oid,true)
    ) ORDER BY c.relname,con.conname),'[]'::jsonb)
    FROM affected_tables c JOIN pg_catalog.pg_constraint con ON con.conrelid = c.oid
  ),
  'indexes', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table', c.relname, 'unique', i.indisunique, 'valid', i.indisvalid,
      'definition', pg_catalog.pg_get_indexdef(i.indexrelid)
    ) ORDER BY c.relname,i.indexrelid),'[]'::jsonb)
    FROM affected_tables c JOIN pg_catalog.pg_index i ON i.indrelid = c.oid
  ),
  'triggers', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table', c.relname, 'name', tg.tgname, 'enabled', tg.tgenabled,
      'function', tg.tgfoid::regprocedure::text
    ) ORDER BY c.relname,tg.tgname),'[]'::jsonb)
    FROM affected_tables c JOIN pg_catalog.pg_trigger tg ON tg.tgrelid = c.oid WHERE NOT tg.tgisinternal
  ),
  'effective_function_permissions', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'signature', f.signature, 'role', roles.rolname,
      'schema_usage', pg_catalog.has_schema_privilege(roles.oid,'public','USAGE'),
      'execute', pg_catalog.has_function_privilege(roles.oid,f.oid,'EXECUTE')
    ) ORDER BY f.signature,roles.rolname),'[]'::jsonb)
    FROM functions f CROSS JOIN pg_catalog.pg_roles roles
    WHERE f.oid IS NOT NULL AND roles.rolname IN ('anon','authenticated','service_role')
  ),
  'function_acl_including_public_and_inherited_defaults', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'signature', f.signature, 'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END,
      'grantor', grantor.rolname, 'privilege', acl.privilege_type, 'grantable', acl.is_grantable
    ) ORDER BY f.signature,acl.grantee),'[]'::jsonb)
    FROM functions f
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) acl
    LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
    LEFT JOIN pg_catalog.pg_roles grantor ON grantor.oid = acl.grantor
    WHERE f.oid IS NOT NULL
  ),
  'current_sql_role_table_permissions_for_future_definer_owner_review', (
    SELECT jsonb_agg(jsonb_build_object(
      'table', c.relname, 'select', pg_catalog.has_table_privilege(current_user,c.oid,'SELECT'),
      'insert', pg_catalog.has_table_privilege(current_user,c.oid,'INSERT'),
      'update', pg_catalog.has_table_privilege(current_user,c.oid,'UPDATE')
    ) ORDER BY c.relname) FROM affected_tables c
  ),
  'row_security_policies', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table', tablename, 'policy', policyname, 'roles', roles, 'command', cmd,
      'using', qual, 'with_check', with_check
    ) ORDER BY tablename,policyname),'[]'::jsonb)
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('profiles','service_contracts','infra_elementos','fo_nap_puertos','olt_provisioning_operations','olt_onts')
  ),
  'user_role_enum', (
    SELECT coalesce(jsonb_agg(e.enumlabel ORDER BY e.enumsortorder),'[]'::jsonb)
    FROM pg_catalog.pg_enum e JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'user_role'
  )
) AS smartrayco_phase2_read_only_audit;

COMMIT;

-- Interpretation (manual review; this script never changes permissions):
-- 1. 136/136b/136c versions should be present in the ledger. A missing version
--    does not imply a missing object if SQL was previously applied manually.
-- 2. current_user_role must filter profiles by auth.uid() AND active=true (or
--    an equivalent expression); the active-word flag alone proves nothing.
-- 3. assign_provisioning_nap(uuid,uuid,uuid) must return uuid, lock contract/NAP,
--    reserve destination before release, and raise on failure in one transaction.
-- 4. Verify PK/FK, unique infra_elemento_id+puerto_numero, status checks, triggers,
--    nullable historical contract_id fields, and owners/RLS from the results.
-- 5. Existing backend NAP/history RPCs should be executable by service_role,
--    not anon/authenticated/PUBLIC, per 136c. current_user_role is intentionally
--    used by authenticated staff policies; do not blanket-revoke its access.
-- 6. 136d is NOT applied here. Its future wrapper owner must have privileges
--    to execute the allocator and access its tables. Its role/active checks
--    must match the actual current_user_role and preserve auth.uid() semantics.
