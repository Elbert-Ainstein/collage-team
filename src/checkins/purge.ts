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
import { removeStudent, selectAll, selectAllIn } from "./data";
import { remove, type Bucket } from "./storage";

const db = () => requireSupabase();

async function removeAll(bucket: Bucket, paths: string[]): Promise<number> {
  // Loud, not silent. A half-swept activity is worth stopping for, and the
  // caller has not deleted the row yet — so stopping here loses nothing.
  const failed = await remove(bucket, paths);
  if (failed) throw new Error(failed.message);
  return paths.length;
}

/**
 * The ids of every result row hanging off an activity's check-ins.
 *
 * Paged and chunked, not a bare select. PostgREST caps a select at 1000 rows
 * SILENTLY, so a big section's results would come back truncated and the sweep
 * would quietly skip everything past the cap — leaving exactly the orphans this
 * module exists to prevent, with no error to say so.
 */
async function resultIdsFor(activityId: string): Promise<string[]> {
  const checkIns = await selectAll<{ id: string }>((from, to) =>
    db().from("check_ins").select("id").eq("activity_id", activityId).order("id").range(from, to),
  );
  if (!checkIns.length) return [];

  const results = await selectAllIn<{ id: string }>(
    checkIns.map((c) => c.id),
    (chunk, from, to) =>
      db().from("check_in_results").select("id").in("check_in_id", chunk).order("id").range(from, to),
  );
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

  const rows = await selectAllIn<{ path: string }>(ids, (chunk, from, to) =>
    db().from("submission_files").select("path").in("result_id", chunk).order("id").range(from, to),
  );
  if (!rows.length) return 0;

  return removeAll("submissions", rows.map((r) => r.path));
}

/** Every team photo filed under this activity. */
export async function deleteActivityResources(activityId: string): Promise<number> {
  const rows = await selectAll<{ path: string }>((from, to) =>
    db().from("team_resources").select("path").eq("activity_id", activityId).order("id").range(from, to),
  );
  if (!rows.length) return 0;

  return removeAll("resources", rows.map((r) => r.path));
}

/** Every team photo belonging to a team — for when a team or its set is removed. */
export async function deleteTeamResourceObjects(teamIds: string[]): Promise<number> {
  if (!teamIds.length) return 0;
  const rows = await selectAllIn<{ path: string }>(teamIds, (chunk, from, to) =>
    db().from("team_resources").select("path").in("team_id", chunk).order("id").range(from, to),
  );
  if (!rows.length) return 0;

  return removeAll("resources", rows.map((r) => r.path));
}

/**
 * Everything one student's own result rows point at: their PDFs and their audio.
 *
 * check_in_results cascades from students, and recordings and submission_files
 * cascade from that — so removing a student takes the rows and strands the
 * objects. Worse than stranded: both delete policies (0013's
 * can_remove_result_audio, 0015's) authorise by reading the result row that has
 * just gone, so nobody can ever remove them.
 *
 * TEAM results are deliberately untouched. Those belong to the team, not to the
 * person leaving it, and they survive the removal.
 */
export async function deleteStudentStorage(studentId: string): Promise<number> {
  const results = await selectAll<{ id: string }>((from, to) =>
    db().from("check_in_results").select("id")
      .eq("student_id", studentId).eq("subject_type", "student")
      .order("id").range(from, to),
  );
  if (!results.length) return 0;
  const ids = results.map((r) => r.id);

  const audio = await selectAllIn<{ path: string }>(ids, (chunk, from, to) =>
    db().from("recordings").select("path").in("result_id", chunk).order("id").range(from, to),
  );
  const pdfs = await selectAllIn<{ path: string }>(ids, (chunk, from, to) =>
    db().from("submission_files").select("path").in("result_id", chunk).order("id").range(from, to),
  );

  let n = 0;
  n += await removeAll("recordings", audio.map((r) => r.path));
  n += await removeAll("submissions", pdfs.map((r) => r.path));
  return n;
}

/**
 * Remove a student and everything of theirs, in the order that works.
 *
 * Sweep, then the row — never the reverse, for the reason at the top of this
 * file: both delete policies authorise by reading the result row, so once it has
 * cascaded away nobody can ever remove the objects it named.
 *
 * Shared because there are two ways a roster row goes — removed by hand on
 * Roster & teams, or cleared out by adding that person as a TF — and a second
 * copy of this ordering is a second chance to write it backwards.
 */
export async function removeStudentWithStorage(studentId: string): Promise<void> {
  await deleteStudentStorage(studentId);
  await removeStudent(studentId);
}

/**
 * The assignment document on `activities.files`.
 *
 * Reads the paths from the ROW, not from a caller's copy. A screen's `activity`
 * is a snapshot: the document may have been replaced from another tab since it
 * was fetched, and sweeping the stale path leaves the real object in a bucket
 * whose delete policy joins back to the activity row — so once the row goes,
 * nobody can ever remove it.
 */
export async function deleteActivityFiles(activityId: string): Promise<number> {
  const rows = await selectAll<{ files: { path?: string | null }[] | null }>((from, to) =>
    db().from("activities").select("files").eq("id", activityId).order("id").range(from, to),
  );
  const paths = (rows[0]?.files ?? [])
    .map((f) => f?.path)
    .filter((p): p is string => Boolean(p));
  if (!paths.length) return 0;
  return removeAll("activity-files", paths);
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
export async function purgeActivityStorage(activityId: string): Promise<PurgeCount> {
  // Sequential, not Promise.all: if one throws, the ones before it are already
  // done and the row is still there, so a retry is safe and finishes the job.
  const submissions = await deleteActivitySubmissions(activityId);
  const resources = await deleteActivityResources(activityId);
  const files = await deleteActivityFiles(activityId);
  return { submissions, resources, files };
}
