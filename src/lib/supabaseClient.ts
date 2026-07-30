import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// v1 (no auth): a single browser client keyed by the public anon key. It stays
// null until .env.local is filled in (see supabase/SETUP.md), so the app can
// render an "connect your database" state instead of crashing.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: { persistSession: false },
    })
  : null;

/** Narrowing helper: throws a clear error if called before config is present. */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Copy .env.local.example to .env.local and " +
        "set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see supabase/SETUP.md).",
    );
  }
  return supabase;
}
