import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser client keyed by the public anon key. Access is decided by row-level
// security against the signed-in user, not by the key — see
// supabase/migrations/0003_auth_owner_scoped.sql.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * How long a database or sign-in request may take before it is given up on.
 * fetch never times out on its own, so one read stuck behind a busy database
 * left a screen on "Loading…" for good; this turns it into an error the screen
 * can retry. Well past the 8s statement timeout Supabase gives signed-in
 * requests, so nothing that could still succeed is cut off. Storage is left
 * alone: a PDF or a recording on classroom wifi can honestly take longer.
 */
export const REQUEST_TIMEOUT_MS = 20_000;

export function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (init?.signal || href.includes("/storage/v1/")) return fetch(input, init);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error("The server took too long to answer.")), REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, signal: ctl.signal }).finally(() => clearTimeout(timer));
}

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
      global: { fetch: fetchWithTimeout },
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
