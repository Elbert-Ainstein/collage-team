import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser client keyed by the public anon key. Access is decided by row-level
// security against the signed-in user, not by the key — see
// supabase/migrations/0003_auth_owner_scoped.sql.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        // Keep the session across reloads and tabs, and refresh it before it
        // expires. (An earlier build set persistSession:false, from before the
        // app had accounts — that signed the user out on every page load.)
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
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
