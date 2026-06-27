#!/bin/sh
set -e

until pg_isready -h postgres -p 5432 -U postgres; do
  echo "Waiting for primary database..."
  sleep 1
done

if [ ! -s /var/lib/postgresql/data/PG_VERSION ]; then
  echo "Database not initialized. Running pg_basebackup..."
  rm -rf /var/lib/postgresql/data/*
  pg_basebackup -h postgres -D /var/lib/postgresql/data -U repl_user -v -P -R -X stream
  chmod 700 /var/lib/postgresql/data
fi

echo "Starting replica in hot standby mode..."
exec postgres -c hot_standby=on
