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
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=2000 -c timezone=UTC -c extra_float_digits=0'

psql -X -q -At --no-password -v ON_ERROR_STOP=1 -f /scripts/apply-guarded.sql
psql -X -q -At --no-password -v ON_ERROR_STOP=1 <<'SQL'
BEGIN READ ONLY;
\o /out/catalog-readback.private.json
\i /scripts/catalog.sql
\o /out/extra-readback.private.json
\i /scripts/extra-catalog.sql
\o /out/ledger-readback.json
\i /scripts/ledger-read.sql
\o /out/commit-confirmed.json
select json_build_object('status','COMMITTED_EXPANSION_ONLY','version','20261021170000','readOnlyVerification',current_setting('transaction_read_only'),'at',clock_timestamp());
ROLLBACK;
SQL
