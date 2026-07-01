#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE ROLE ${POSTGRES_REPLICATION_USER:-repl_user} WITH REPLICATION LOGIN PASSWORD '${POSTGRES_REPLICATION_PASSWORD:-repl_password}';
EOSQL

echo "host replication ${POSTGRES_REPLICATION_USER:-repl_user} 0.0.0.0/0 md5" >> "$PGDATA/pg_hba.conf"

