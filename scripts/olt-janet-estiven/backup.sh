#!/bin/sh
# Respaldo logico completo de Fase 168 (previo a desplegar Fase 166/167).
# Solo lectura contra Supabase Cloud: una unica transaccion
# REPEATABLE READ READ ONLY, snapshot exportado y reusado por pg_dump para
# que el dump sea consistente con la foto exacta de esa transaccion. Nunca
# escribe en Cloud -- ROLLBACK explicito al final, nunca COMMIT.
set -eu
IFS= read -r CERT
printf %s "$CERT" | base64 -d >/tmp/ca.pem
IFS= read -r PGHOST
IFS= read -r PGPORT
IFS= read -r PGDATABASE
IFS= read -r PGUSER
IFS= read -r PGPASSWORD
export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD
export PGSSLMODE=verify-full PGSSLROOTCERT=/tmp/ca.pem PGCONNECT_TIMEOUT=10 PGCLIENTENCODING=UTF8
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=5000 -c timezone=UTC -c search_path=pg_catalog,public'

test ! -e /out/completo.dump
test ! -e /out/roles.sql
test ! -e /out/snapshot-info.json

psql -X -q -At --no-password -v ON_ERROR_STOP=1 <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT pg_export_snapshot() AS backup_snapshot \gset
\setenv BACKUP_SNAPSHOT :backup_snapshot
\o /out/snapshot-info.json
SELECT json_build_object(
 'snapshot_at', now(), 'server_version', current_setting('server_version'),
 'database', current_database(), 'snapshot_id', :'backup_snapshot',
 'validate_installation_completion_md5', (select md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g')) from pg_proc where oid=to_regprocedure('public.validate_installation_completion()')),
 'assert_no_rejected_materials_md5', (select md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g')) from pg_proc where oid=to_regprocedure('public.assert_no_rejected_materials(text,uuid)')),
 'table_count', (select count(*) from pg_tables where schemaname='public'),
 'function_count', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
 'policy_count', (select count(*) from pg_policies where schemaname='public')
);
\o
\! pg_dumpall --no-password --roles-only --no-role-passwords >/out/roles.sql 2>/out/roles-export-errors.log
\if :SHELL_ERROR
 \quit 3
\endif
\! pg_dump --no-password --format=custom --lock-wait-timeout=5000 --snapshot="$BACKUP_SNAPSHOT" --file=/out/completo.dump 2>/out/dump-errors.log
\if :SHELL_ERROR
 \quit 3
\endif
ROLLBACK;
SQL

test -s /out/completo.dump
pg_restore --list /out/completo.dump >/out/inventario.txt
pg_restore --file=/dev/null /out/completo.dump 2>/out/archive-check-errors.log
