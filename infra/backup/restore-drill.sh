#!/bin/sh
# Proves the newest dump can be restored: it restores it into a scratch database, compares the
# number of tables and of recipes with the live database, and drops the scratch database.
set -eu

latest=$(ls -1 /backups/snapcook-*.dump 2>/dev/null | sort | tail -n 1)
if [ -z "$latest" ]; then
  echo "restore drill: FAILED, there is no dump to restore" >&2
  exit 1
fi

scratch="restore_drill_$(date -u +%Y%m%d%H%M%S)"
count() { psql --dbname="$1" --tuples-only --no-align --command="$2"; }
tables="select count(*) from information_schema.tables where table_schema = 'public'"
recipes="select count(*) from recipes"

createdb "$scratch"
trap 'dropdb --if-exists "$scratch"' EXIT
pg_restore --dbname="$scratch" --no-owner --exit-on-error "$latest"

live_tables=$(count "$PGDATABASE" "$tables")
drill_tables=$(count "$scratch" "$tables")
drill_recipes=$(count "$scratch" "$recipes")
if [ "$live_tables" != "$drill_tables" ]; then
  echo "restore drill: FAILED, $drill_tables tables restored and the live database has $live_tables" >&2
  exit 1
fi
echo "restore drill: ok, $latest restored with $drill_tables tables and $drill_recipes recipes"
