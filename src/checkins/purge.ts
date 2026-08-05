// Taking an activity's files with it when it goes.
//
// A foreign key cascades ROWS. It does nothing at all to storage objects. So
// every bucket this app writes to needs an explicit sweep before the rows that
// name its objects disappear, or the files are left orphaned: unreachable
// through the app, invisible in any listing it drives, and still counted
// against storage.
//
// audio.ts already does this for `recordings`. This is the same job for the
// three buckets added since:
//
//   submissions    (0015) the student's handed-in PDF
//   resources      (0017) the team's photos
//   activity-files (0012) the assignment document
//
// The last one is not merely orphaned — it is UNREACHABLE. Its only write
// policy joins back to the activity row, so once the activity is gone the
// predicate can never be true again and nobody can ever delete the object. That
// makes ordering load-bearing: sweep, then delete the row. Never the reverse.
//
// Removal permission on submissions and resources comes from
// supabase/migrations/0018_purge_on_delete.sql.

import { requireSupabase } from "@/lib/supabaseClient";
import { dbError } from "./data";

const db = () => requireSupabase();

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw dbError(res.error);
  return res.data as T;
}

/** storage.remove takes a list; chunk it so a term's worth cannot blow the request. */
async function removeAll(bucket: string, paths: string[]): Promise<number> {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await db().storage.from(bucket).remove(paths.slice(i, i + 100));
    // Loud, not silent. A half-swept activity is worth stopping for, and the
    // caller has not deleted the row yet — so stopping here loses nothing.
    if (error) throw new Error(error.message);
  }
  return paths.length;
}

/** The ids of every result row hanging off an activity's check-ins. */
async function resultIdsFor(activityId: string): Promise<string[]> {
  const checkIns =
    (unwrap(await db().from("check_ins").select("id").eq("activity_id", activityId)) as
      | { id: string }[]
      | null) ?? [];
  if (!checkIns.length) return [];

  const results =
    (unwrap(
      await db().from("check_in_results").select("id")
        .in("check_in_id", checkIns.map((c) => c.id)),
    ) as { id: string }[] | null) ?? [];
  return results.map((r) => r.id);
}

/**
 * Every handed-in PDF on this activity. Driven off the ROWS rather than the
 * path prefix — the prefix is pinned by 0015, but the rows are the authority on
 * what exists, and one landing under an unexpected prefix should still go.
 */
export async function deleteActivitySubmissions(activityId: string): Promise<number> {
  const ids = await resultIdsFor(activityId);
  if (!ids.length) return 0;

  const rows =
    (unwrap(
      await db().from("submission_files").select("path").in("result_id", ids),
    ) as { path: string }[] | null) ?? [];
  if (!rows.length) return 0;

  return removeAll("submissions", rows.map((r) => r.path));
}

/** Every team photo filed under this activity. */
export async function deleteActivityResources(activityId: string): Promise<number> {
  const rows =
    (unwrap(
      await db().from("team_resources").select("path").eq("activity_id", activityId),
    ) as { path: string }[] | null) ?? [];
  if (!rows.length) return 0;

  return removeAll("resources", rows.map((r) => r.path));
}

/** Every team photo belonging to a team — for when a team or its set is removed. */
export async function deleteTeamResourceObjects(teamIds: string[]): Promise<number> {
  if (!teamIds.length) return 0;
  const rows =
    (unwrap(
      await db().from("team_resources").select("path").in("team_id", teamIds),
    ) as { path: string }[] | null) ?? [];
  if (!rows.length) return 0;

  return removeAll("resources", rows.map((r) => r.path));
}

/**
 * The assignment document on `activities.files`.
 *
 * Takes the paths rather than the id: after the row is gone there is nothing
 * left to read them from, and reading them first is the entire point.
 */
export async function deleteActivityFiles(paths: (string | null | undefined)[]): Promise<number> {
  const real = paths.filter((p): p is string => Boolean(p));
  if (!real.length) return 0;
  return removeAll("activity-files", real);
}

export interface PurgeCount {
  submissions: number;
  resources: number;
  files: number;
}

/**
 * Sweep every bucket for one activity. Call BEFORE deleting the row.
 *
 * Audio is not here: audio.ts owns the `recordings` bucket and its own sweep,
 * and the delete sites call both. Splitting it would mean two answers to which
 * module removes a recording.
 */
export async function purgeActivityStorage(
  activityId: string,
  filePaths: (string | null | undefined)[] = [],
): Promise<PurgeCount> {
  // Sequential, not Promise.all: if one throws, the ones before it are already
  // done and the row is still there, so a retry is safe and finishes the job.
  const submissions = await deleteActivitySubmissions(activityId);
  const resources = await deleteActivityResources(activityId);
  const files = await deleteActivityFiles(filePaths);
  return { submissions, resources, files };
}
