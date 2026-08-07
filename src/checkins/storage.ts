// The one place this app talks to a storage backend.
//
// WHY THIS EXISTS. Four modules — audio, submissions, resources, facultyData —
// each called `supabase.storage.from(...)` directly. That is fine until the
// backend changes, at which point it is four modules, four sets of error
// handling, and four chances to get authorisation subtly different. Everything
// goes through here now, so moving to R2/S3 is this file plus a route handler
// rather than a sweep of the codebase.
//
// WHAT MOVING WOULD ACTUALLY COST, written down while it is fresh:
//
//   Today, Postgres enforces access. `storage.objects` has RLS policies that
//   read the owning row's id out of the object PATH — recording_result_id(name),
//   resource_team_id(name) — and join back to check_in_results or teams. A
//   student physically cannot fetch another team's recording, because the
//   database refuses, not because the client declined to ask.
//
//   An external bucket has none of that. The equivalent is a server route that
//   verifies the caller's Supabase JWT, re-runs those same predicates against
//   the database, and only then mints a presigned URL. That is a new security
//   boundary, hand-written, guarding students' recorded voices and graded work.
//   It is a fine thing to build with time to test it. It is not a thing to
//   build in the four weeks before a live class.
//
//   So: the seam goes in now, the swap happens after the pilot.

import { requireSupabase } from "@/lib/supabaseClient";

/** Every bucket this app owns. Named here so the set is knowable from one place. */
export type Bucket = "recordings" | "submissions" | "resources" | "activity-files";

/** How long a signed link lives. Long enough to use, short enough that a copied one dies. */
export const SIGNED_SECONDS = 60 * 60;

const db = () => requireSupabase();

export interface StorageFailure {
  message: string;
}

/** Upload one object. Returns nothing; the caller owns the row that names it. */
export async function put(
  bucket: Bucket,
  path: string,
  body: Blob | File,
  contentType: string,
): Promise<StorageFailure | null> {
  const { error } = await db().storage.from(bucket).upload(path, body, {
    contentType,
    upsert: false,
  });
  return error ? { message: error.message } : null;
}

/**
 * Remove objects, in chunks.
 *
 * Chunked because a term's worth of paths in one request blows the URL, and
 * because a partial failure should stop rather than silently skip: the caller
 * is about to delete the rows that name these, and after that nothing can find
 * them again.
 */
export async function remove(bucket: Bucket, paths: string[]): Promise<StorageFailure | null> {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await db().storage.from(bucket).remove(paths.slice(i, i + 100));
    if (error) return { message: error.message };
  }
  return null;
}

/** A short-lived URL for one object. Every bucket in this app is private. */
export async function signedUrl(
  bucket: Bucket,
  path: string,
  seconds = SIGNED_SECONDS,
): Promise<{ url: string | null; error: StorageFailure | null }> {
  const res = await db().storage.from(bucket).createSignedUrl(path, seconds);
  if (res.error) return { url: null, error: { message: res.error.message } };
  return { url: res.data?.signedUrl ?? null, error: null };
}

/** Signed URLs for a set at once — one round trip, not one per thumbnail. */
export async function signedUrls(
  bucket: Bucket,
  paths: string[],
  seconds = SIGNED_SECONDS,
): Promise<{ urls: Map<string, string>; error: StorageFailure | null }> {
  const urls = new Map<string, string>();
  if (!paths.length) return { urls, error: null };

  const res = await db().storage.from(bucket).createSignedUrls(paths, seconds);
  if (res.error) return { urls, error: { message: res.error.message } };
  for (const row of res.data ?? []) {
    // A row per requested path; ones the backend could not sign come back with
    // an error and no URL, and are simply absent from the map. Callers render a
    // placeholder for a missing thumbnail rather than failing the whole grid.
    if (row.signedUrl && row.path) urls.set(row.path, row.signedUrl);
  }
  return { urls, error: null };
}
