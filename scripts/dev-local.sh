#!/usr/bin/env bash
# The app on http://localhost:5181 against a LOCAL Supabase (Docker), never the
# live project. .env.local is left alone: values exported here win over it.
#
#   scripts/local-db.sh
#   scripts/dev-local.sh
#
# A fresh database from every migration: scripts/local-db.sh reset
set -euo pipefail
cd "$(dirname "$0")/.."

status="$(npx --yes supabase@2 --workdir .localdev status -o env 2>/dev/null)" || {
  echo "Local Supabase isn't running. Start it with:" >&2
  echo "  scripts/local-db.sh" >&2
  exit 1
}
val() { printf '%s\n' "$status" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p" | head -1; }

export NEXT_PUBLIC_SUPABASE_URL="$(val API_URL)"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$(val ANON_KEY)"
export NEXT_DIST_DIR=".next-local"

echo "App:      http://localhost:5181"
echo "Supabase: $NEXT_PUBLIC_SUPABASE_URL (local)"
exec npx next dev -p 5181
