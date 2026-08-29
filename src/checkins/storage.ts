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

/**
 * When a screen holding signed links should mint fresh ones.
 *
 * Four fifths of the life, so a re-sign lands with time to spare rather than in
 * the same second the old one dies. Three screens sit on signed links for
 * longer than an hour — the rubric builder, the activity page and a student's
 * assignment — and each of them wrote this number down separately until they
 * did not agree.
 */
export const RESIGN_MS = Math.round(SIGNED_SECONDS * 1000 * 0.8);

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

export interface RemoveOutcome {
  /** The paths the SERVER says went. Not the ones that were asked for. */
  deleted: string[];
  failure: StorageFailure | null;
}

/**
 * Remove objects, in chunks, and report which ones actually went.
 *
 * Chunked because a term's worth of paths in one request blows the URL, and
 * because a partial failure should stop rather than silently skip: the caller
 * is about to delete the rows that name these, and after that nothing can find
 * them again.
 *
 * Reporting because "no error" is not "deleted". The DELETE endpoint runs an
 * RLS-FILTERED delete and answers 200 with the list of objects it removed — a
 * path the policy refuses is simply absent from that list, with nothing raised
 * anywhere. A caller that is about to delete the rows naming these objects has
 * to read the list; reading only the error tells it the request succeeded,
 * which was never the question.
 */
export async function removeReturningDeleted(
  bucket: Bucket,
  paths: string[],
): Promise<RemoveOutcome> {
  const deleted: string[] = [];
  for (let i = 0; i < paths.length; i += 100) {
    const { data, error } = await db().storage.from(bucket).remove(paths.slice(i, i + 100));
    if (error) return { deleted, failure: { message: error.message } };
    // `name` here is the whole path inside the bucket — this endpoint returns
    // the object rows it deleted, not the leaf names that list() reports.
    for (const object of data ?? []) deleted.push(object.name);
  }
  return { deleted, failure: null };
}

/**
 * Remove objects and say only whether the request failed.
 *
 * Kept because every caller outside the course-clearing sweep deletes ONE path
 * belonging to a row it is holding, and there is nothing they could do with the
 * list that they do not already know. Anything deleting in bulk before deleting
 * rows wants removeReturningDeleted.
 */
export async function remove(bucket: Bucket, paths: string[]): Promise<StorageFailure | null> {
  return (await removeReturningDeleted(bucket, paths)).failure;
}

/**
 * Is this object still in the bucket?
 *
 * The question a delete response cannot answer: a path missing from it was
 * either refused or already gone, and both look identical. This asks the bucket
 * itself, and fails CLOSED — a network drop or a 5xx reads as "still there",
 * because the expensive mistake is deciding an object went when it did not.
 */
export async function stillThere(bucket: Bucket, path: string): Promise<boolean> {
  try {
    const { data } = await db().storage.from(bucket).exists(path);
    return data;
  } catch {
    // exists() only swallows the 400/404 that means "not there". Everything
    // else lands here, and none of it is evidence of anything.
    return true;
  }
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
