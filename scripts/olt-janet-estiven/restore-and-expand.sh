#!/bin/sh
# Restauracion y verificacion AISLADA de Fase 168: nunca toca Cloud ni la VM
# (se ejecuta con --network none). Restaura /backup/completo.dump en un
# Postgres nuevo, descartable, dentro del mismo contenedor, y confirma que
# el esquema/datos/funciones/triggers/RLS/politicas/permisos relevantes
# llegaron intactos.
set -eu
export PGDATA=/var/lib/postgresql/data
initdb -U postgres -E UTF8 --locale=C.UTF-8 --auth=trust >/evidence/initdb.log 2>&1
pg_ctl -D "$PGDATA" -l /evidence/server.log -o "-c listen_addresses='' -c unix_socket_directories=/var/run/postgresql" -w start

# Los roles referenciados por las politicas RLS (authenticated/anon/service_role,
# etc.) viven FUERA del dump de la base (son objetos de CLUSTER, no de
# base de datos) -- se restauran primero desde roles.sql (pg_dumpall
# --roles-only --no-role-passwords) para que las politicas puedan crearse.
psql -h /var/run/postgresql -U postgres -d postgres -X -q -v ON_ERROR_STOP=0 \
  -f /backup/roles.sql >/evidence/roles-restore.log 2>/evidence/roles-restore-errors.log || true

pg_restore -h /var/run/postgresql -U postgres -d postgres --no-owner --no-privileges \
  /backup/completo.dump >/evidence/restore.log 2>/evidence/restore-errors.log || true
# Documenta errores de restauracion (ej. extensiones/roles exclusivos de
# Supabase que no existen fuera de su plataforma) sin ocultarlos ni
# reintentar -- es evidencia, no un fallo silencioso.
cp /evidence/restore-errors.log /evidence/restore-errors-copy.log 2>/dev/null || true

psql -h /var/run/postgresql -U postgres -d postgres -X -q -At -v ON_ERROR_STOP=1 >/evidence/verificacion.json <<'SQL'
SELECT json_build_object(
 'tablas_public', (select count(*) from pg_tables where schemaname='public'),
 'funciones_public', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
 'triggers_public', (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal),
 'politicas_rls', (select count(*) from pg_policies where schemaname='public'),
 'tablas_con_rls', (select count(*) from pg_tables t join pg_class c on c.relname=t.tablename join pg_namespace n on n.oid=c.relnamespace and n.nspname=t.schemaname where t.schemaname='public' and c.relrowsecurity),
 'instalaciones_count', (select count(*) from installations),
 'rechazos_materiales_count', (select count(*) from material_inventory_rejections),
 'rechazo_diego_presente', exists(select 1 from material_inventory_rejections where operation_id='5ac65134-f2bd-410c-848a-9d336180d8ca'),
 'validate_installation_completion_existe', to_regprocedure('public.validate_installation_completion()') is not null,
 'validate_installation_completion_md5', (select md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g')) from pg_proc where oid=to_regprocedure('public.validate_installation_completion()')),
 'assert_no_rejected_materials_existe', to_regprocedure('public.assert_no_rejected_materials(text,uuid)') is not null,
 'assert_no_rejected_materials_md5', (select md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g')) from pg_proc where oid=to_regprocedure('public.assert_no_rejected_materials(text,uuid)')),
 'grants_material_inventory_rejections', (select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='material_inventory_rejections')
);
SQL

mkdir -p /evidence/lab-current
psql -h /var/run/postgresql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 -f /backup/restore-target-acl.sql >/evidence/target-acl-restore.log 2>/evidence/target-acl-restore-errors.log
PGOPTIONS='-c default_transaction_read_only=off -c timezone=UTC -c extra_float_digits=0' psql -h /var/run/postgresql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 -f /candidate/scripts/olt-janet-estiven/execution/apply-guarded.sql >/evidence/expansion-lab.log 2>/evidence/expansion-lab-errors.log
pg_ctl -D "$PGDATA" -m fast -w stop
echo RESTORE_VERIFY_DONE
