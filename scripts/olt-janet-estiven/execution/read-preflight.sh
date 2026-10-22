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
psql -X -q -At --no-password -v ON_ERROR_STOP=1 <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
\o /out/catalog-before.private.json
\i /scripts/catalog.sql
\o /out/extra-before.private.json
\i /scripts/extra-catalog.sql
\o /out/ledger-before.json
\i /scripts/ledger-read.sql
ROLLBACK;
SQL
