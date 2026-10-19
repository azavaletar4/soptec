#!/bin/sh
set -eu
if [ ! -s "$PGDATA/PG_VERSION" ]; then
 initdb -D "$PGDATA" -U supabase_admin --auth-local=trust --auth-host=scram-sha-256 --pwfile=/private/bootstrap.pass --locale=en_US.UTF-8 --encoding=UTF8 >/tmp/init.log 2>&1
 printf '\nhost all all 0.0.0.0/0 scram-sha-256\n' >>"$PGDATA/pg_hba.conf"
fi
exec postgres -D "$PGDATA" -k /tmp -c listen_addresses='*' -c shared_preload_libraries=pg_stat_statements -c max_connections=80 -c timezone=UTC -c extra_float_digits=0
