#!/usr/bin/env bash
# A local Supabase (Docker) with every migration in supabase/migrations applied,
# for scripts/dev-local.sh to point the app at. Never touches the live project.
#
#   scripts/local-db.sh          start it (applies migrations on first run)
#   scripts/local-db.sh reset    wipe it and apply every migration again
#   scripts/local-db.sh stop     stop the containers (data is kept)
#
# The stack's config lives in .localdev/ (gitignored) with an EMPTY migrations
# folder, so the CLI never applies anything itself: the migrations here were
# written to be pasted into the SQL editor of a project that already had the
# earlier ones, and a couple assume history a fresh database doesn't have.
set -euo pipefail
cd "$(dirname "$0")/.."

WORKDIR=.localdev
SERVICES="edge-runtime,logflare,vector,imgproxy,mailpit,postgres-meta,studio"
DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
sb() { npx --yes supabase@2 --workdir "$WORKDIR" "$@"; }

case "${1:-start}" in
  stop) sb stop; exit 0 ;;
  reset) sb db reset ;;
  start) sb start -x "$SERVICES" ;;
  *) echo "usage: $0 [start|reset|stop]" >&2; exit 2 ;;
esac

psql_() { psql "$DB_URL" -v ON_ERROR_STOP=1 -q "$@"; }

if [ "$(psql "$DB_URL" -tAc "select to_regclass('public.local_applied_migrations') is not null")" = "t" ] \
   && [ "${1:-start}" != "reset" ]; then
  applied_now=0
else
  psql_ -c "create table if not exists public.local_applied_migrations (name text primary key, at timestamptz default now())"
  applied_now=1
fi

for f in supabase/migrations/*.sql; do
  name="$(basename "$f")"
  done_already="$(psql "$DB_URL" -tAc "select 1 from public.local_applied_migrations where name = '$name'")"
  [ "$done_already" = "1" ] && continue

  # 0028 drops a trigger ON course_creators, a table only the live project ever
  # had. Give it an empty one to drop; 0028 removes the table itself.
  if [ "$name" = "0028_only_staff_make_courses.sql" ]; then
    psql_ -c "create table if not exists public.course_creators (id int)"
  fi

  echo "applying $name"
  psql_ -f "$f"
  psql_ -c "insert into public.local_applied_migrations (name) values ('$name')"
done

[ "$applied_now" = "1" ] && echo "All migrations applied."
echo "Local Supabase: http://127.0.0.1:54321  — now run scripts/dev-local.sh"
