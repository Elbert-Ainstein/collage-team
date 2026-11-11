// Is there a newer build than the one this tab is running?
//
// Collage is one client page on top of Supabase: a tab opened last week is
// still running last week's code against this week's database. That is how a
// student came to type into a text box for a select-multiple question — her
// page predated 0056 — and have every answer refused. The build id is baked in
// at build time (next.config.mjs), into the page and into /api/version alike,
// so a fresh load always agrees with the server and a stale tab doesn't.

/** Which build this code is. "dev" where there is no id to go by, and then nothing is ever newer. */
export const BUILD_ID: string = process.env.NEXT_PUBLIC_BUILD_ID || "dev";

const VERSION_URL = "/api/version";

/**
 * The build the server is on, or null if it can't be asked right now. Offline,
 * mid-deploy or an answer that isn't one is no news, not a newer build: the
 * worst a miss costs is a check later.
 */
export async function fetchServerBuild(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(VERSION_URL, { cache: "no-store" });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const build = typeof body === "object" && body !== null ? (body as { build?: unknown }).build : undefined;
    return typeof build === "string" && build !== "" ? build : null;
  } catch {
    return null;
  }
}

/** Is the server on a build other than `mine`? Never, where either side has no id. */
export function isNewerBuild(mine: string, server: string | null): boolean {
  return mine !== "dev" && server !== null && server !== "dev" && server !== mine;
}
