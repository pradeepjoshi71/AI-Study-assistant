#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE ROLE repl_user WITH REPLICATION LOGIN PASSWORD 'repl_password';
EOSQL

echo "host replication repl_user 0.0.0.0/0 md5" >> "$PGDATA/pg_hba.conf"
