#!/bin/sh
# Only a disposable container: no network, read-only backup, tmpfs database.
# Adaptado de fase161-restore-isolated.sh para el respaldo pre-migracion IPTV
# (misma logica de restauracion atomica aislada; solo cambia el chequeo final).
set -eu
export PGDATA=/tmp/restore-db PGHOST=/tmp PGUSER=postgres PGDATABASE=postgres
trap 'pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true' EXIT
for ext in pg_stat_statements pgcrypto supabase_vault; do
  test -r "$(pg_config --sharedir)/extension/$ext.control" || { echo "BLOCKED_EXTENSION=$ext"; exit 20; }
done
echo EXTENSION_CONTROLS_OK
initdb -D "$PGDATA" -A trust --no-locale --encoding=UTF8 >/tmp/init.log 2>&1
pg_ctl -D "$PGDATA" -l /tmp/server.log -o "-k /tmp -c listen_addresses='' -c shared_preload_libraries=pg_stat_statements,pg_cron -c cron.database_name=postgres -c max_connections=20" -w start >/tmp/start.log 2>&1
echo ISOLATED_ENGINE_STARTED
pg_restore --list /backup/completo.dump >/tmp/toc
pg_restore --schema-only --file=/tmp/schema.sql /backup/completo.dump 2>/tmp/schema.err
# pg_dump excludes global roles. Reconstruct only names as NOLOGIN placeholders.
{ awk '!/^;/ && NF {print $NF}' /tmp/toc
  sed -n -E '/^(GRANT|REVOKE) / { s/.* (TO|FROM) (.*);/\2/; s/ WITH GRANT OPTION$//; p; }; /^ALTER DEFAULT PRIVILEGES / { s/.*FOR ROLE ([^ ]+).*/\1/; p; }' /tmp/schema.sql | tr ',' '\n'
} | sed 's/^[[:space:]"]*//; s/[[:space:]"]*$//' | sort -u | while read -r role; do
  case "$role" in postgres|PUBLIC|pg_*|'') continue ;; esac
  case "$role" in *[!a-zA-Z0-9_]*) continue ;; esac
  printf 'CREATE ROLE "%s" NOLOGIN;\n' "$role"
done >/tmp/roles.sql
psql -X -q -v ON_ERROR_STOP=1 -f /tmp/roles.sql >/tmp/roles.out 2>/tmp/roles.err
echo PLACEHOLDER_ROLES_CREATED
# Only this networkless, disposable cluster: event trigger owners must be superusers.
psql -X -q -v ON_ERROR_STOP=1 -c 'ALTER ROLE supabase_admin SUPERUSER NOLOGIN;' >/tmp/admin-role.out 2>/tmp/admin-role.err
echo ISOLATED_SUPABASE_ADMIN_SUPERUSER_NOLOGIN
# No --no-owner, --no-acl, filters, or ignored errors; a failure rolls back all.
if pg_restore --exit-on-error --single-transaction --dbname=postgres /backup/completo.dump >/tmp/restore.out 2>/tmp/restore.err; then
  echo RESTORE_EXIT=0
else
  echo RESTORE_BLOCKED_ATOMIC_ROLLBACK
  # Only the first server error, never SQL, COPY context, details or row values.
  sed -n '/pg_restore: error: could not execute query: ERROR:/ { s/"[^"]*"/"[identifier]"/g; s/'"'"'[^'"'"']*'"'"'/'"'"'[redacted]'"'"'/g; p; q; }' /tmp/restore.err
  # Identify the failing catalog object using TOC description, without row data.
  sed -n '/pg_restore: from TOC entry/ { s/pg_restore: from TOC entry /FAILED_TOC=/; p; q; }' /tmp/restore.err
  exit 30
fi
psql -X -q -A -t -v ON_ERROR_STOP=1 <<'SQL'
BEGIN READ ONLY;
SELECT 'CRITICAL_TABLE='||t||';rows='|| (xpath('/row/n/text()',query_to_xml(format('SELECT count(*) AS n FROM public.%I',t),false,true,'')))[1]::text FROM unnest(ARRAY['clients','profiles','service_contracts','tickets','installations','routines','job_assignees','job_work_sessions','inventory_products','inventory_units','campo_inventory_operations','routine_inventory_operations','material_inventory_rejections']) t;
SELECT 'EXTENSION='||extname||';version='||extversion FROM pg_extension ORDER BY extname;
SELECT 'RLS='||c.relname||';enabled='||c.relrowsecurity||';policies='||(SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)||';acl_present='||(c.relacl IS NOT NULL) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(ARRAY['clients','profiles','service_contracts','tickets','installations','routines','job_assignees','job_work_sessions']) ORDER BY c.relname;
SELECT 'FUNCTION='||p.oid::regprocedure::text||';security_definer='||p.prosecdef||';acl_present='||(p.proacl IS NOT NULL) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('current_user_role','validate_installation_completion','inventory_order_read','assert_material_closure_ready');
SELECT 'UNVALIDATED_CONSTRAINTS='||count(*) FROM pg_constraint WHERE NOT convalidated;
SELECT 'UNVALIDATED_CONSTRAINT='||conrelid::regclass::text||'.'||conname::text||';type='||contype::text FROM pg_constraint WHERE NOT convalidated;
DO $verify$
DECLARE r record; violations bigint; predicate text; joins text;
BEGIN
  FOR r IN SELECT * FROM pg_constraint WHERE NOT convalidated LOOP
    IF r.contype='c' THEN
      EXECUTE format('SELECT count(*) FROM %s WHERE NOT (%s)', r.conrelid::regclass, pg_get_expr(r.conbin,r.conrelid)) INTO violations;
    ELSIF r.contype='f' AND r.confmatchtype='s' THEN
      SELECT string_agg(format('s.%I IS NOT NULL',a.attname),' AND '), string_agg(format('s.%I = t.%I',a.attname,b.attname),' AND ')
      INTO predicate,joins FROM unnest(r.conkey,r.confkey) k(src,dst) JOIN pg_attribute a ON a.attrelid=r.conrelid AND a.attnum=k.src JOIN pg_attribute b ON b.attrelid=r.confrelid AND b.attnum=k.dst;
      EXECUTE format('SELECT count(*) FROM %s s WHERE %s AND NOT EXISTS (SELECT 1 FROM %s t WHERE %s)',r.conrelid::regclass,predicate,r.confrelid::regclass,joins) INTO violations;
    ELSE
      RAISE EXCEPTION 'UNVALIDATED_CONSTRAINT_REQUIRES_MANUAL_CHECK';
    END IF;
    IF violations<>0 THEN RAISE EXCEPTION 'UNVALIDATED_CONSTRAINT_HAS_VIOLATIONS count=%',violations; END IF;
  END LOOP;
END $verify$;
SELECT 'UNVALIDATED_CONSTRAINT_DATA_CHECK=PASS';
SELECT 'INVALID_INDEXES='||count(*) FROM pg_index WHERE NOT indisvalid OR NOT indisready;
SELECT 'EVENT_TRIGGERS='||count(*)||';owned_by_supabase_admin='||count(*) FILTER (WHERE evtowner='supabase_admin'::regrole) FROM pg_event_trigger;
SELECT 'PUBLIC_FUNCTIONS='||count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace;
SELECT 'GRANT='||table_name||';role='||grantee||';privilege='||privilege_type FROM information_schema.table_privileges WHERE table_schema='public' AND table_name=ANY(ARRAY['clients','profiles','service_contracts','tickets','installations','routines','job_assignees','job_work_sessions']) AND grantee IN ('anon','authenticated','service_role') ORDER BY table_name,grantee,privilege_type;
SELECT 'VAULT_ENCRYPTED_ROWS='||count(*) FROM vault.secrets;
SELECT 'RESTORED_IPTV_COLUMN_ABSENT='||(NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='installations' AND column_name='iptv_policy_version'));
SELECT 'RESTORED_COMPLETION_TRIGGER_MD5='||md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^'||chr(10)||']*','','g'),'[[:space:]]','','g')) FROM pg_proc WHERE oid=to_regprocedure('public.validate_installation_completion()');
ROLLBACK;
SQL
echo RESTORE_VERIFIED_WITH_GLOBAL_ROLE_AND_EXTERNAL_KEY_LIMITATIONS
psql -X -qAt -v ON_ERROR_STOP=1 <<'SQL'
set timezone='UTC';
begin read only;
\o /tmp/fingerprints.json
select json_build_object(
 'clients_count',(select count(*) from public.clients),'clients_md5',(select md5(string_agg(md5(to_jsonb(c)::text),'' order by id)) from public.clients c),
 'contracts_count',(select count(*) from public.service_contracts),'contracts_md5',(select md5(string_agg(md5(to_jsonb(c)::text),'' order by id)) from public.service_contracts c),
 'installations_count',(select count(*) from public.installations),'installations_md5',(select md5(string_agg(md5(to_jsonb(c)::text),'' order by id)) from public.installations c));
\o
rollback;
SQL
cat /tmp/fingerprints.json > /evidence/restore-fingerprints.json
echo RESTORE_VERIFIED_WITH_GLOBAL_ROLE_AND_EXTERNAL_KEY_LIMITATIONS
