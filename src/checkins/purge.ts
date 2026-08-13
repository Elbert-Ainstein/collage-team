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
import { countAllIn, dbError, removeStudent, selectAll, selectAllIn } from "./data";
import { removeReturningDeleted, stillThere, type Bucket } from "./storage";

const db = () => requireSupabase();

async function removeAll(bucket: Bucket, paths: string[]): Promise<number> {
  // Loud, not silent. A half-swept activity is worth stopping for, and the
  // caller has not deleted the row yet — so stopping here loses nothing.
  const { deleted, failure } = await removeReturningDeleted(bucket, paths);
  if (failure) throw new Error(failure.message);

  const went = new Set(deleted);
  const missing = paths.filter((p) => !went.has(p));
  if (!missing.length) return paths.length;

  // A path the server did not list is one of two things, and the response says
  // the same nothing about both: RLS refused the delete, or the object is
  // already gone because an earlier run swept it and died before deleting the
  // rows. Treating them alike is not an option — call them all failures and a
  // resumed run can never finish, call them all successes and a refused object
  // gets its row deleted underneath it, which is the one way this feature
  // strands data forever.
  //
  // So ask the bucket. Still there means refused, and stopping is the only safe
  // answer while the row that carries the only permission to remove it is still
  // standing. Not there means an earlier pass already took it, and re-sweeping
  // a gone path is a no-op — which is exactly what makes this resumable.
  //
  // One HEAD per unaccounted path: none at all on a normal run, and a burst on
  // a resumed one. Cheap next to the alternative.
  const refused: string[] = [];
  for (const path of missing) {
    if (await stillThere(bucket, path)) refused.push(path);
  }
  if (refused.length) {
    const named = refused.slice(0, 5).join(", ");
    throw new Error(
      `The database refused to delete ${refused.length} object${refused.length === 1 ? "" : "s"} ` +
        `in ${bucket}, so the rows naming them have been left alone and you can run this again. ` +
        `Still there: ${named}${refused.length > 5 ? ` and ${refused.length - 5} more` : ""}.`,
    );
  }
  return paths.length;
}

/**
 * The ids of every result row hanging off these activities' check-ins.
 *
 * Takes a list rather than one id so the whole-course sweep at the bottom of
 * this file can reuse it instead of keeping a second copy of the same walk —
 * and so a year's activities cost one chunked query rather than one per week.
 *
 * Paged and chunked, not a bare select. PostgREST caps a select at 1000 rows
 * SILENTLY, so a big section's results would come back truncated and the sweep
 * would quietly skip everything past the cap — leaving exactly the orphans this
 * module exists to prevent, with no error to say so.
 */
async function resultIdsFor(activityIds: string[]): Promise<string[]> {
  if (!activityIds.length) return [];
  const checkIns = await selectAllIn<{ id: string }>(activityIds, (chunk, from, to) =>
    db().from("check_ins").select("id").in("activity_id", chunk).order("id").range(from, to),
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
  const ids = await resultIdsFor([activityId]);
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

/**
 * Every team photo belonging to a team — for when a team or its set is removed.
 *
 * Every ACTIVITY's, deliberately: team_resources cascades from teams, so the
 * rows go whatever week they were filed under, and a sweep narrowed to the
 * activity on screen would strand the rest. Whatever warns before calling this
 * has to count the same way, or it promises less than it takes.
 */
export async function deleteTeamResourceObjects(teamIds: string[]): Promise<number> {
  if (!teamIds.length) return 0;
  const rows = await selectAllIn<{ path: string }>(teamIds, (chunk, from, to) =>
    db().from("team_resources").select("path").in("team_id", chunk).order("id").range(from, to),
  );
  if (!rows.length) return 0;

  return removeAll("resources", rows.map((r) => r.path));
}

/**
 * Everything a team's own result rows point at: its audio and any PDFs.
 *
 * Easy to miss, because a team looks like it only owns photos. It does not:
 * ensureTeamResult gives the team a check_in_results row with
 * subject_type='team' for the Recorder to hang takes on, teams cascades into
 * that row, and recordings cascades out of it. So deleting a team takes all
 * three tables and leaves the audio objects behind — and 0013's
 * can_remove_result_audio authorises by joining back to the result row that has
 * just gone, so after the delete nobody can ever remove them. Sweep first.
 */
export async function deleteTeamStorage(teamIds: string[]): Promise<number> {
  if (!teamIds.length) return 0;
  const results = await selectAllIn<{ id: string }>(teamIds, (chunk, from, to) =>
    db().from("check_in_results").select("id")
      .in("team_id", chunk).eq("subject_type", "team")
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

// ---------------------------------------------------------------------------
// Clearing a finished year.
//
// Everything above takes one thing away and sweeps after it. This takes a whole
// course's MEDIA away and leaves the course standing: the grades, the written
// answers, the marks, the roster and the teams all stay, and only the objects —
// and the rows whose only job is to name an object — go.
//
// Which means the ordering at the top of this file matters more here than
// anywhere else, not less. Doing it backwards on one activity strands a handful
// of files; doing it backwards on a year strands ~22 GB that nobody, ever, can
// remove again, because every one of these buckets authorises a delete by
// joining back to the row.
//
// Faculty-triggered only. Nothing in here runs itself.

/**
 * The three buckets a year's media lives in.
 *
 * `activity-files` is excluded by construction rather than by care. That bucket
 * holds the INSTRUCTOR's assignment document — what they reuse next year, and
 * kilobytes of it — and clearing it would be the worst thing this feature could
 * do. Written as an Exclude so a later edit that tries to sweep it does not
 * compile.
 */
export type ClearBucket = Exclude<Bucket, "activity-files">;

export type ClearStep = "scan" | "objects" | "rows";

export interface ClearProgress {
  bucket: ClearBucket;
  step: ClearStep;
  /** How many of this step are behind us. */
  done: number;
  /** How many this step has to get through; 0 while scanning, when it is not known yet. */
  total: number;
}

export type ClearProgressFn = (progress: ClearProgress) => void;

export interface BucketArtifacts {
  /** Objects in the bucket, counted from the rows that name them. */
  objects: number;
  /**
   * Total size, or null when nothing records it.
   *
   * Only `team_resources` has a size_bytes column. `recordings` stores a
   * duration and `submission_files` stores a page count, and neither can be
   * turned into bytes. The only client-side way to get a real number for those
   * two is to walk the bucket a prefix at a time — {course}/{activity}/{result}
   * is three levels, so thousands of list requests to fill in one line of a
   * confirmation dialog. So they report a count and no bytes. A dialog that
   * says "4,102 recordings" is honest; one that says "about 9 GB" from a
   * guessed average is not, and this dialog is the last thing between someone
   * and a year of their students' work.
   */
  bytes: number | null;
  /** Of `objects`, how many have no recorded size — all of them where bytes is null. */
  unsized: number;
}

export interface CourseArtifacts {
  recordings: BucketArtifacts;
  submissions: BucketArtifacts;
  resources: BucketArtifacts;
  /** Which page answers which question. Rows only; there is no object behind one. */
  submissionPages: number;
  /** When this course was cleared, if it has been. */
  clearedAt: string | null;
}

export interface ClearOutcome {
  /** What THIS run removed. A run that resumes a half-finished one reports only its own share. */
  recordings: number;
  submissions: number;
  resources: number;
  submissionPages: number;
  /** When the course was first cleared — an earlier run's date if this one resumed it. */
  clearedAt: string;
}

interface Artifact {
  id: string;
  path: string;
}

/**
 * Every result row on a course, reached the only way that proves it is the
 * course's: activities -> check_ins -> check_in_results.
 *
 * There is no course_id on check_in_results to shortcut with, and inventing one
 * — say, going at recordings by path prefix — would either miss rows or reach
 * another course's. Recordings and submissions both hang off a result, so this
 * one walk feeds both.
 */
async function courseResultIds(courseId: string): Promise<string[]> {
  const activities = await selectAll<{ id: string }>((from, to) =>
    db().from("activities").select("id").eq("course_id", courseId).order("id").range(from, to),
  );
  return resultIdsFor(activities.map((a) => a.id));
}

/**
 * Every team on a course: courses -> team_sets -> teams.
 *
 * team_resources carries an activity_id as well, and going at it that way would
 * find almost the same rows — but a photo belongs to a TEAM, the team is what
 * the storage policy authorises against (resource_team_id reads the team out of
 * segment 3 of the path), and 0020 lets a team set outlive the activity it was
 * made for. Going through teams is the join that matches what may be deleted.
 */
async function courseTeamIds(courseId: string): Promise<string[]> {
  const sets = await selectAll<{ id: string }>((from, to) =>
    db().from("team_sets").select("id").eq("course_id", courseId).order("id").range(from, to),
  );
  if (!sets.length) return [];
  const teams = await selectAllIn<{ id: string }>(sets.map((s) => s.id), (chunk, from, to) =>
    db().from("teams").select("id").in("team_set_id", chunk).order("id").range(from, to),
  );
  return teams.map((t) => t.id);
}

/**
 * What clearing this course would destroy.
 *
 * This is what the confirmation shows, so it is counted the same way the sweep
 * finds things — same joins, same helpers — rather than estimated. If the two
 * ever disagree, the dialog is lying about what the button does.
 */
export async function previewCourseArtifacts(courseId: string): Promise<CourseArtifacts> {
  const resultIds = await courseResultIds(courseId);
  const teamIds = await courseTeamIds(courseId);

  const recordings = await countAllIn(resultIds, (chunk) =>
    db().from("recordings").select("id", { count: "exact", head: true }).in("result_id", chunk),
  );
  const submissions = await countAllIn(resultIds, (chunk) =>
    db().from("submission_files").select("id", { count: "exact", head: true }).in("result_id", chunk),
  );
  const submissionPages = await countAllIn(resultIds, (chunk) =>
    db().from("submission_pages").select("id", { count: "exact", head: true }).in("result_id", chunk),
  );

  // Read, not counted: this is the one bucket whose rows record a size, and the
  // only way to add sizes up is to have them in hand.
  const photos = await selectAllIn<{ size_bytes: number | null }>(teamIds, (chunk, from, to) =>
    db().from("team_resources").select("size_bytes").in("team_id", chunk).order("id").range(from, to),
  );
  let bytes = 0;
  let unsized = 0;
  for (const photo of photos) {
    // Nullable since 0017, so old rows predate anything filling it in. Counted
    // separately rather than treated as zero, which would quietly shrink the
    // total the dialog promises.
    if (typeof photo.size_bytes === "number") bytes += photo.size_bytes;
    else unsized++;
  }

  const rows = await selectAll<{ artifacts_cleared_at: string | null }>((from, to) =>
    db().from("courses").select("artifacts_cleared_at").eq("id", courseId).order("id").range(from, to),
  );

  return {
    recordings: { objects: recordings, bytes: null, unsized: recordings },
    submissions: { objects: submissions, bytes: null, unsized: submissions },
    resources: { objects: photos.length, bytes, unsized },
    submissionPages,
    clearedAt: rows[0]?.artifacts_cleared_at ?? null,
  };
}

/**
 * How many paths go up in one request.
 *
 * The storage call already chunks at 100, so this is not what keeps the URL
 * short — it is what makes the screen move. Handing a year to it in one call
 * reports nothing until the last request lands, which is several minutes of a
 * button that looks hung while it is quietly deleting things.
 */
const SWEEP_CHUNK = 100;

/** Counts up across chunks so a caller can hand the same ticker to several passes. */
function ticker(
  bucket: ClearBucket,
  step: ClearStep,
  total: number,
  onProgress?: ClearProgressFn,
): (n: number) => void {
  let done = 0;
  return (n) => {
    done += n;
    onProgress?.({ bucket, step, done, total });
  };
}

async function sweepObjects(
  bucket: ClearBucket,
  paths: string[],
  tick: (n: number) => void,
): Promise<void> {
  for (let i = 0; i < paths.length; i += SWEEP_CHUNK) {
    const chunk = paths.slice(i, i + SWEEP_CHUNK);
    await removeAll(bucket, chunk);
    tick(chunk.length);
  }
}

async function deleteRows(table: string, ids: string[], tick: (n: number) => void): Promise<void> {
  for (let i = 0; i < ids.length; i += SWEEP_CHUNK) {
    const chunk = ids.slice(i, i + SWEEP_CHUNK);
    const { error } = await db().from(table).delete().in("id", chunk);
    if (error) throw dbError(error);
    tick(chunk.length);
  }
}

/**
 * Write the date, but only the first time.
 *
 * Filtered on the column still being null so a second run — a retry after a
 * failure, or someone pressing the button again — finishes the job without
 * moving the date the course was actually cleared on. When the filter matches
 * nothing there was already a date, and that one is the answer — unless the
 * re-read comes back null too, which means the update was not skipped but
 * FILTERED, and there is no date to report. Inventing one here would put a
 * clearing date on screen that the database has never held.
 */
async function stampCleared(courseId: string): Promise<string> {
  const now = new Date().toISOString();
  const res = await db()
    .from("courses")
    .update({ artifacts_cleared_at: now })
    .eq("id", courseId)
    .is("artifacts_cleared_at", null)
    .select("artifacts_cleared_at");
  if (res.error) throw dbError(res.error);

  const written = (res.data as { artifacts_cleared_at: string }[] | null) ?? [];
  if (written.length) return written[0].artifacts_cleared_at;

  const rows = await selectAll<{ artifacts_cleared_at: string | null }>((from, to) =>
    db().from("courses").select("artifacts_cleared_at").eq("id", courseId).order("id").range(from, to),
  );
  const already = rows[0]?.artifacts_cleared_at;
  if (!already) {
    throw new Error(
      "The files are gone, but the date they were cleared on didn't save — the update was " +
        "accepted and changed nothing, which is what a permission filter looks like. The course " +
        "still reads as not cleared. Running this again is safe.",
    );
  }
  return already;
}

/**
 * Clear a finished course's media. The grades stay.
 *
 * Bucket by bucket, and within each one the objects before the rows — for the
 * reason at the top of this file, which is at its sharpest here: every delete
 * policy on these three buckets authorises by joining back to the row
 * (can_remove_result_audio, can_remove_team_resource), so a row deleted first
 * takes the only permission that could ever have removed its object with it.
 *
 * RESUMABLE, and by construction rather than by bookkeeping. Nothing records
 * how far it got; each pass simply asks what is still there. A bucket whose
 * rows are gone reads back empty and costs one query, and re-removing a path
 * whose object has already gone is not an error at the storage API — so a run
 * that died halfway through the recordings picks up exactly where it stopped,
 * and a run on an already-cleared course does nothing and says so.
 *
 * check_in_results is never touched. The written answer, the score, the
 * feedback and the CI flag are the record of the year; only what pointed at a
 * file goes. Neither is `activity-files` — see ClearBucket.
 */
export async function clearCourseArtifacts(
  courseId: string,
  onProgress?: ClearProgressFn,
): Promise<ClearOutcome> {
  const resultIds = await courseResultIds(courseId);
  const teamIds = await courseTeamIds(courseId);

  onProgress?.({ bucket: "recordings", step: "scan", done: 0, total: 0 });
  const audio = await selectAllIn<Artifact>(resultIds, (chunk, from, to) =>
    db().from("recordings").select("id,path").in("result_id", chunk).order("id").range(from, to),
  );
  await sweepObjects("recordings", audio.map((r) => r.path),
    ticker("recordings", "objects", audio.length, onProgress));
  await deleteRows("recordings", audio.map((r) => r.id),
    ticker("recordings", "rows", audio.length, onProgress));

  onProgress?.({ bucket: "submissions", step: "scan", done: 0, total: 0 });
  const pdfs = await selectAllIn<Artifact>(resultIds, (chunk, from, to) =>
    db().from("submission_files").select("id,path").in("result_id", chunk).order("id").range(from, to),
  );
  // The page-to-question mapping has no object of its own, but it is a set of
  // page numbers inside a pdf that is about to stop existing. Found through the
  // RESULTS rather than through submission_files, so a run that died after the
  // file rows went still finds it on the way back through.
  const pages = await selectAllIn<{ id: string }>(resultIds, (chunk, from, to) =>
    db().from("submission_pages").select("id").in("result_id", chunk).order("id").range(from, to),
  );
  await sweepObjects("submissions", pdfs.map((r) => r.path),
    ticker("submissions", "objects", pdfs.length, onProgress));
  // One ticker across both tables: to the person watching this is a single
  // stretch of tidying up after the PDFs, not two.
  const submissionRows = ticker("submissions", "rows", pdfs.length + pages.length, onProgress);
  await deleteRows("submission_files", pdfs.map((r) => r.id), submissionRows);
  await deleteRows("submission_pages", pages.map((r) => r.id), submissionRows);

  onProgress?.({ bucket: "resources", step: "scan", done: 0, total: 0 });
  const photos = await selectAllIn<Artifact>(teamIds, (chunk, from, to) =>
    db().from("team_resources").select("id,path").in("team_id", chunk).order("id").range(from, to),
  );
  await sweepObjects("resources", photos.map((r) => r.path),
    ticker("resources", "objects", photos.length, onProgress));
  await deleteRows("team_resources", photos.map((r) => r.id),
    ticker("resources", "rows", photos.length, onProgress));

  // Count what is left before writing the date, and do not trust "no error" as
  // proof. A delete that RLS filters out removes nothing and reports NOTHING —
  // which is exactly how submission_pages behaved until 0027 widened its policy
  // for the owner, and how any future policy change would behave too. The date
  // is what tells the screen to stop offering this, so it may only be written
  // once the course really is empty.
  const left = await previewCourseArtifacts(courseId);
  if (left.recordings.objects || left.submissions.objects
    || left.resources.objects || left.submissionPages) {
    throw new Error(
      "Some files are still there after the sweep, so the course hasn't been marked cleared. " +
        "Run it again — if the same ones are left, the database is refusing those deletes " +
        "rather than failing them.",
    );
  }

  return {
    recordings: audio.length,
    submissions: pdfs.length,
    resources: photos.length,
    submissionPages: pages.length,
    clearedAt: await stampCleared(courseId),
  };
}
