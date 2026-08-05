// Data access for the faculty Activities design (supabase/migrations/0007).
//
// Sits alongside src/checkins/data.ts rather than replacing it: courses,
// students, teams, activities, check-ins and results are all still read through
// that module. What lives here is what 0007 added — weeks, rubric ladders,
// per-question marks and teaching fellows — plus the writes that have to keep
// two things in step.

import { requireSupabase } from "@/lib/supabaseClient";
import { countAll, countAllIn, dbError, selectAll, selectAllIn, tintFor } from "@/checkins/data";
import {
  type Activity,
  type ActivityQuestion,
  type Course,
  type CheckIn,
  type CourseTF,
  type CourseWeek,
  type FileRef,
  type RubricItem,
  type SubmissionMark,
} from "@/checkins/types";
import { pointsTotal } from "./model";

const db = () => requireSupabase();

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw dbError(res.error);
  return res.data as T;
}

// -------------------------------------------------------------------- weeks

export async function listWeeks(courseId: string): Promise<CourseWeek[]> {
  return selectAll<CourseWeek>((from, to) =>
    db().from("course_weeks").select("*").eq("course_id", courseId)
      .order("week").order("id")
      .range(from, to),
  );
}

/** Add the next week after the highest one that exists. */
export async function addWeek(courseId: string, datesLabel?: string): Promise<CourseWeek> {
  // Number off BOTH tables. course_weeks was added by 0007 with no backfill, so
  // on a course that predates it the table is empty while the activities
  // already occupy weeks 1..N — numbering off course_weeks alone returned "1",
  // inserted a week that was already on screen because an activity pointed at
  // it, and looked like the button did nothing. Pressing again just walked
  // invisibly up through the weeks that already existed.
  const [weeks, used] = await Promise.all([
    listWeeks(courseId),
    db()
      .from("activities")
      .select("week")
      .eq("course_id", courseId)
      .not("week", "is", null)
      .order("week", { ascending: false })
      .limit(1),
  ]);
  if (used.error) throw dbError(used.error);

  const highestUsed = ((used.data as { week: number | null }[] | null) ?? [])[0]?.week ?? 0;
  const next = Math.max(weeks.reduce((n, w) => Math.max(n, w.week), 0), highestUsed) + 1;
  const rows = unwrap(
    await db()
      .from("course_weeks")
      .insert({ course_id: courseId, week: next, dates_label: datesLabel ?? null })
      .select(),
  ) as CourseWeek[];
  return rows[0];
}

/**
 * Give every week an activity references a course_weeks row of its own.
 *
 * Without one a week renders (activities name it) but has no id, so it cannot
 * be dated or marked live — the controls simply are not there, which reads as
 * another dead button. Idempotent: 0007 declares unique (course_id, week), and
 * a duplicate is another caller having won the race.
 */
export async function backfillWeeks(courseId: string): Promise<number> {
  const [weeks, rows] = await Promise.all([
    listWeeks(courseId),
    db().from("activities").select("week").eq("course_id", courseId).not("week", "is", null),
  ]);
  if (rows.error) throw dbError(rows.error);

  const known = new Set(weeks.map((w) => w.week));
  const missing = Array.from(
    new Set(((rows.data as { week: number | null }[] | null) ?? []).map((r) => r.week)),
  ).filter((w): w is number => w != null && !known.has(w));
  if (!missing.length) return 0;

  const { error } = await db()
    .from("course_weeks")
    .insert(missing.map((week) => ({ course_id: courseId, week, dates_label: null })));
  if (error && !/duplicate key|23505/i.test(error.message)) throw dbError(error);
  return missing.length;
}

/**
 * Remove a week.
 *
 * Only the heading row goes: course_weeks has no cascade, and activities carry
 * their week as a plain number. So deleting a week that still has activities in
 * it would leave them rendering under a bare "Week 3" with no dates and no way
 * to get the row back — the caller refuses that case rather than this function
 * silently allowing it.
 */
export async function deleteWeek(id: string): Promise<void> {
  const { error } = await db().from("course_weeks").delete().eq("id", id);
  if (error) throw dbError(error);
}

export async function setWeekDates(id: string, datesLabel: string | null): Promise<void> {
  const { error } = await db().from("course_weeks").update({ dates_label: datesLabel }).eq("id", id);
  if (error) throw dbError(error);
}

export async function setLiveWeek(courseId: string, week: number | null): Promise<void> {
  const { error } = await db().from("courses").update({ live_week: week }).eq("id", courseId);
  if (error) throw dbError(error);
}

// ------------------------------------------------------- questions & points

/**
 * Set what an activity is out of.
 *
 * check_ins.max_points is written in the same call: the student view renders it
 * directly, so leaving it stale would show students a total the gradebook
 * disagrees with. Changing points_total also fires 0014's trigger, which
 * re-scores every submission already marked against it.
 */
export async function setActivityPoints(activityId: string, total: number): Promise<void> {
  const points = Math.max(0, total);
  const { error } = await db()
    .from("activities")
    .update({ points_total: points })
    .eq("id", activityId);
  if (error) throw dbError(error);

  const { error: e2 } = await db()
    .from("check_ins")
    .update({ max_points: points })
    .eq("activity_id", activityId);
  if (e2) throw dbError(e2);
}

// --------------------------------------------------------------- questions
//
// Structure only. What an activity is out of is one number on the activity
// (setActivityPoints above); these rows say what its questions are called and
// what order they come in, and criteria hang off them.

export async function listQuestions(activityId: string): Promise<ActivityQuestion[]> {
  return selectAll<ActivityQuestion>((from, to) =>
    db().from("activity_questions").select("*").eq("activity_id", activityId)
      .order("position").order("label")
      .range(from, to),
  );
}

/** Every question on a course's activities, for the screens that show totals. */
export async function listQuestionsFor(activityIds: string[]): Promise<ActivityQuestion[]> {
  if (!activityIds.length) return [];
  return selectAllIn<ActivityQuestion>(activityIds, (chunk, from, to) =>
    db().from("activity_questions").select("*").in("activity_id", chunk)
      .order("position").order("label")
      .range(from, to),
  );
}

/**
 * The activity's questions, seeding them from the old shape the first time.
 *
 * An activity authored before 0014 says "10 questions" as a count and has no
 * rows; opening the rubric writes those ten questions down, so what faculty
 * then edit is the same activity they had. Seeding on READ rather than at
 * creation is what lets activities that already exist arrive here intact.
 *
 * `canSeed` matters for the same reason it does on the ladder: writing these is
 * owner-only, so a teaching fellow gets what is there rather than an error.
 */
export async function ensureQuestions(
  activity: Activity,
  canSeed = true,
): Promise<ActivityQuestion[]> {
  const existing = await listQuestions(activity.id);
  if (existing.length || !canSeed) return existing;

  // Zero is what an activity created since 0014 carries, and it means what it
  // says: no questions until someone writes one. Only a legacy count seeds.
  const count = activity.question_count;
  if (count <= 0) return [];
  const rows = Array.from({ length: count }, (_, i) => ({
    activity_id: activity.id,
    label: String(i + 1),
    position: i,
  }));
  const inserted = unwrap(
    await db().from("activity_questions").insert(rows).select(),
  ) as ActivityQuestion[];
  return (inserted ?? []).sort((a, b) => a.position - b.position);
}

/**
 * Add a question, or a sub-question of one.
 *
 * `after` places it: a sub-question goes directly under its parent rather than
 * at the end, and everything below shifts down. Position is what
 * submission_marks records against, so this renumbers rather than leaving gaps.
 */
export async function addQuestion(
  activityId: string,
  rows: ActivityQuestion[],
  label: string,
  after?: ActivityQuestion,
): Promise<ActivityQuestion[]> {
  const at = after ? after.position + 1 : rows.length;
  const inserted = unwrap(
    await db()
      .from("activity_questions")
      .insert({ activity_id: activityId, label, position: at })
      .select()
      .single(),
  ) as ActivityQuestion;

  const next = [...rows.slice(0, at), inserted, ...rows.slice(at)];
  await renumber(next);
  return next.map((q, i) => ({ ...q, position: i }));
}

export async function updateQuestion(id: string, patch: { label?: string }): Promise<void> {
  // .select() so an RLS-filtered write is DETECTABLE — the same trap the ladder
  // had: a teaching fellow's edit came back with no error and no rows, and the
  // screen kept a number the database had refused.
  const { data, error } = await db()
    .from("activity_questions")
    .update(patch)
    .eq("id", id)
    .select("id");
  if (error) throw dbError(error);
  if (!data || data.length === 0) {
    throw new Error(
      "That question was not saved — only the instructor who owns this course can change the " +
        "rubric.",
    );
  }
}

/**
 * Delete a question and the criteria written under it.
 *
 * The criteria go too because they are addressed by the question's LABEL: left
 * behind they would belong to a question that no longer exists, and the builder
 * would show them under a heading nobody can reach. Deleting a criterion
 * cascades its marks, which re-scores the submissions it was taken from — the
 * caller counts that first.
 */
export async function deleteQuestion(
  activityId: string,
  question: ActivityQuestion,
  rows: ActivityQuestion[],
): Promise<ActivityQuestion[]> {
  const { error: e1 } = await db()
    .from("rubric_items")
    .delete()
    .eq("activity_id", activityId)
    .eq("question_label", question.label);
  if (e1) throw dbError(e1);

  const { error } = await db().from("activity_questions").delete().eq("id", question.id);
  if (error) throw dbError(error);

  const next = rows.filter((q) => q.id !== question.id);
  await renumber(next);
  return next.map((q, i) => ({ ...q, position: i }));
}

/** Write positions 0..n-1, skipping the rows that already hold theirs. */
async function renumber(rows: ActivityQuestion[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].position === i) continue;
    const { error } = await db()
      .from("activity_questions")
      .update({ position: i })
      .eq("id", rows[i].id);
    if (error) throw dbError(error);
  }
}

// ------------------------------------------------------------ rubric ladders

export async function listRubric(activityId: string): Promise<RubricItem[]> {
  return selectAll<RubricItem>((from, to) =>
    db().from("rubric_items").select("*").eq("activity_id", activityId)
      .order("row_index").order("id")
      .range(from, to),
  );
}

/**
 * The activity's criteria.
 *
 * Nothing is seeded. Criteria used to arrive as a six-step ladder generated
 * from what one question was worth — there is no such number now, and a
 * generated ladder is a guess at how someone marks. They are written on the
 * rubric, per question, by the person who will mark against them.
 *
 * The `canSeed` argument is kept so callers need not change; it does nothing.
 */
export async function ensureRubric(activity: Activity, _canSeed = true): Promise<RubricItem[]> {
  return listRubric(activity.id);
}

export async function updateRubricItem(
  id: string,
  patch: { description?: string; deduction?: number },
): Promise<void> {
  // .select() so an RLS-filtered write is DETECTABLE. Writing rubric_items is
  // owner-only; without this a teaching fellow's edit came back with no error
  // and no rows, the screen kept the new number, and they went on to grade
  // against a deduction the database had refused — releasing a mark that was
  // not the one in front of them.
  const { data, error } = await db().from("rubric_items").update(patch).eq("id", id).select("id");
  if (error) throw dbError(error);
  if (!data || data.length === 0) {
    throw new Error(
      "That criterion was not saved — only the instructor who owns this course can change the " +
        "grading criteria.",
    );
  }
}

export async function addRubricItem(
  activityId: string,
  afterRows: RubricItem[],
  /**
   * Which question the new line belongs to. Omitted — or null — keeps the
   * pre-0012 behaviour: a line on the shared ladder, applying to every question.
   */
  questionLabel: string | null = null,
): Promise<RubricItem> {
  const next = afterRows.reduce((n, r) => Math.max(n, r.row_index), -1) + 1;
  const rows = unwrap(
    await db()
      .from("rubric_items")
      .insert({
        activity_id: activityId,
        row_index: next,
        description: "New criterion",
        deduction: 1,
        is_custom: true,
        question_label: questionLabel,
      })
      .select(),
  ) as RubricItem[];
  return rows[0];
}

/**
 * How many submissions are currently marked with this ladder row.
 *
 * Deleting the row cascades those marks away, and the delete fires the rescore
 * trigger — so every student marked with it silently GAINS the points that
 * deduction was taking off. That is a regrade, and nobody should do it without
 * being told how many people it moves.
 */
export async function countMarksForRubricItem(id: string): Promise<number> {
  return countAll(
    db().from("submission_marks").select("id", { count: "exact", head: true })
      .eq("rubric_item_id", id),
  );
}

/** Work that would be destroyed with an activity: submissions, and how many are graded. */
export async function countWorkForActivity(
  activityId: string,
): Promise<{ submissions: number; graded: number }> {
  const cis = await selectAll<{ id: string }>((from, to) =>
    db().from("check_ins").select("id").eq("activity_id", activityId).order("id").range(from, to),
  );
  if (!cis.length) return { submissions: 0, graded: 0 };

  // Two server-side counts rather than one fetch-and-filter: the status split is
  // a filter the database can apply, and no number here can be a truncated one.
  const ids = cis.map((c) => c.id);
  const [submissions, graded] = await Promise.all([
    countAllIn(ids, (chunk) =>
      db().from("check_in_results").select("id", { count: "exact", head: true })
        .in("check_in_id", chunk).neq("status", "none"),
    ),
    countAllIn(ids, (chunk) =>
      db().from("check_in_results").select("id", { count: "exact", head: true })
        .in("check_in_id", chunk).eq("status", "scored"),
    ),
  ]);
  return { submissions, graded };
}

/** Work that would be destroyed with a student. */
export async function countWorkForStudent(studentId: string): Promise<number> {
  return countAll(
    db().from("check_in_results").select("id", { count: "exact", head: true })
      .eq("student_id", studentId).neq("status", "none"),
  );
}

/** Only faculty-added rows can go; the base ladder is fixed. */
export async function deleteRubricItem(id: string): Promise<void> {
  const { error } = await db().from("rubric_items").delete().eq("id", id).eq("is_custom", true);
  if (error) throw dbError(error);
}

/** Move a criterion onto a question, or off every question with null. */
export async function setRubricQuestion(id: string, questionLabel: string | null): Promise<void> {
  const { data, error } = await db()
    .from("rubric_items")
    .update({ question_label: questionLabel })
    .eq("id", id)
    .select("id");
  if (error) throw dbError(error);
  if (!data || data.length === 0) {
    throw new Error(
      "That criterion was not moved — only the instructor who owns this course can change the " +
        "grading criteria.",
    );
  }
}

// ------------------------------------------------------- the activity's file
//
// 0012's `activity-files` bucket. Objects are named `<activity_id>/<file>` and
// every policy on the bucket reads that first segment, so the path is not a
// convenience here — an object stored under any other shape is reachable by
// nobody.

const BUCKET = "activity-files";

/** Bytes -> "1.4 MB", for the FileRef that goes on the activity row. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * Strip a filename down to what can safely be a storage key.
 *
 * Supabase rejects a number of characters outright, and a name that survives
 * upload but not URL-encoding produces a signed URL for an object that is not
 * there — which reads as a corrupt file rather than a bad name.
 */
function safeName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "document.pdf";
}

/**
 * Put a file in the bucket and record it on the activity.
 *
 * One document per activity in this version: the new file REPLACES whatever was
 * listed, and the old object is removed after the row is updated. That order
 * matters — a failed delete leaves an orphan object, while a failed update
 * would leave the row pointing at bytes that are gone.
 */
export async function uploadActivityFile(activity: Activity, file: File): Promise<FileRef> {
  const path = `${activity.id}/${Date.now()}-${safeName(file.name)}`;
  const { error } = await db().storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) {
    throw new Error(
      `That file was not uploaded: ${error.message}. If this says the bucket is missing, run ` +
        "supabase/migrations/0012_rubric_questions_and_files.sql.",
    );
  }

  const ref: FileRef = {
    name: file.name,
    size: humanSize(file.size),
    path,
    mime: file.type || undefined,
  };
  const { error: e2 } = await db()
    .from("activities")
    .update({ files: [ref] })
    .eq("id", activity.id);
  if (e2) {
    // The row is the record; an object nothing points at is litter, not data.
    await db().storage.from(BUCKET).remove([path]);
    throw dbError(e2);
  }

  const stale = (activity.files ?? []).map((f) => f.path).filter((p): p is string => Boolean(p));
  if (stale.length) await db().storage.from(BUCKET).remove(stale);
  return ref;
}

/** Take the file off the activity, then off the bucket. */
export async function removeActivityFile(activity: Activity): Promise<void> {
  const { error } = await db().from("activities").update({ files: [] }).eq("id", activity.id);
  if (error) throw dbError(error);
  const paths = (activity.files ?? []).map((f) => f.path).filter((p): p is string => Boolean(p));
  if (paths.length) await db().storage.from(BUCKET).remove(paths);
}

/**
 * A URL the browser can render the document from.
 *
 * Signed and short-lived, because the bucket is private: the policies decide
 * who may mint one, and the link itself expires rather than becoming a way
 * around them. Null when the row predates 0012 and carries only a file NAME.
 */
export async function activityFileUrl(ref: FileRef | null | undefined): Promise<string | null> {
  if (!ref?.path) return null;
  const { data, error } = await db().storage.from(BUCKET).createSignedUrl(ref.path, 60 * 60);
  if (error) throw new Error(`That file could not be opened: ${error.message}`);
  return data?.signedUrl ?? null;
}

// -------------------------------------------------------------------- marks

export async function listMarks(resultIds: string[]): Promise<SubmissionMark[]> {
  if (!resultIds.length) return [];
  return selectAllIn<SubmissionMark>(resultIds, (chunk, from, to) =>
    db().from("submission_marks").select("*").in("result_id", chunk)
      .order("id")
      .range(from, to),
  );
}

/**
 * Pick a ladder row for one question of one submission.
 *
 * The score is NOT written here — a trigger recomputes it from every mark on
 * the row (0007). One writer, so the score cannot disagree with the marks.
 */
export async function setMark(
  resultId: string,
  questionIndex: number,
  rubricItemId: string,
): Promise<void> {
  const existing = unwrap(
    await db()
      .from("submission_marks")
      .select("id")
      .eq("result_id", resultId)
      .eq("question_index", questionIndex)
      .limit(1),
  ) as { id: string }[] ?? [];

  const { error } = existing.length
    ? await db().from("submission_marks").update({ rubric_item_id: rubricItemId }).eq("id", existing[0].id)
    : await db()
        .from("submission_marks")
        .insert({ result_id: resultId, question_index: questionIndex, rubric_item_id: rubricItemId });
  if (error) throw dbError(error);
}

export async function clearMark(resultId: string, questionIndex: number): Promise<void> {
  const { error } = await db()
    .from("submission_marks")
    .delete()
    .eq("result_id", resultId)
    .eq("question_index", questionIndex);
  if (error) throw dbError(error);
}

export async function setFeedback(resultId: string, feedback: string): Promise<void> {
  const { error } = await db()
    .from("check_in_results")
    .update({ feedback: feedback || null })
    .eq("id", resultId);
  if (error) throw dbError(error);
}

/**
 * Mark a submission finished, so it leaves the "waiting" count.
 *
 * `is_ci` has to be set here rather than left false: Challenge and Amplify are
 * described to the instructor as completion-marked everywhere in the UI, and
 * the gradebook only renders a ✓ (and the student only reads "Complete") when
 * the row says so. Without it those two types were labelled "Completion" and
 * then reported as a raw point score.
 */
export async function releaseMark(resultId: string, completion: boolean): Promise<void> {
  const { error } = await db()
    .from("check_in_results")
    .update({ status: "scored", is_ci: completion, updated_at: new Date().toISOString() })
    .eq("id", resultId);
  if (error) throw dbError(error);
}

// ---------------------------------------------------------------------- TFs

export async function listTFs(courseId: string): Promise<CourseTF[]> {
  return selectAll<CourseTF>((from, to) =>
    db().from("course_tfs").select("*").eq("course_id", courseId)
      .order("position").order("id")
      .range(from, to),
  );
}

export async function addTF(
  courseId: string,
  input: { name: string; email: string | null },
  atPosition: number,
): Promise<CourseTF> {
  const rows = unwrap(
    await db()
      .from("course_tfs")
      .insert({
        course_id: courseId,
        name: input.name,
        email: input.email ? input.email.trim().toLowerCase() : null,
        avatar_tint: tintFor(input.name),
        position: atPosition,
      })
      .select(),
  ) as CourseTF[];
  return rows[0];
}

export async function addTFs(
  courseId: string,
  people: { name: string; email?: string }[],
  atPosition: number,
): Promise<void> {
  if (!people.length) return;
  const rows = people.map((p, i) => ({
    course_id: courseId,
    name: p.name,
    email: p.email ? p.email.trim().toLowerCase() : null,
    avatar_tint: tintFor(p.name),
    position: atPosition + i,
  }));
  const { error } = await db().from("course_tfs").insert(rows);
  if (error) throw dbError(error);
}

export async function removeTF(id: string): Promise<void> {
  const { error } = await db().from("course_tfs").delete().eq("id", id);
  if (error) throw dbError(error);
}

/** Course-wide, exactly as the design specifies — never per person. */
export async function setTFPermissions(
  courseId: string,
  perms: { tf_can_grade?: boolean; tf_can_checkin?: boolean },
): Promise<void> {
  const { error } = await db().from("courses").update(perms).eq("id", courseId);
  if (error) throw dbError(error);
}

/**
 * The courses this account is a teaching fellow on.
 *
 * How the app knows someone is a TF at all: there is no 'tf' role, because
 * profiles.role is chosen by the person signing up and so cannot be a boundary.
 * Being a TF is a fact about the course's roster of fellows, not about them.
 */
export async function myTFCourses(): Promise<Course[]> {
  const { data: auth } = await db().auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return [];

  const rows =
    (unwrap(await db().from("course_tfs").select("course_id").eq("user_id", uid)) as
      | { course_id: string }[]
      | null) ?? [];
  if (!rows.length) return [];

  const ids = Array.from(new Set(rows.map((r) => r.course_id)));
  return (
    (unwrap(await db().from("courses").select("*").in("id", ids).order("code")) as Course[]) ?? []
  );
}

/** Attach this account to any TF rows carrying its address. */
export async function claimTFRows(): Promise<number> {
  const { data, error } = await db().rpc("claim_tf_rows");
  if (error) throw dbError(error);
  return (data as number) ?? 0;
}

// ------------------------------------------------------------------ helpers

/**
 * The check-in an activity uses for a given subject kind, creating it if the
 * activity has none. Folding check-in creation in here is what lets the
 * Check-ins tab go away without students losing anything to submit against.
 */
export async function ensureCheckIn(
  activity: Activity,
  kind: "individual" | "team",
  existing: CheckIn[],
): Promise<CheckIn> {
  const found = existing.find((c) => c.activity_id === activity.id && c.kind === kind);
  if (found) return found;

  const rows = unwrap(
    await db()
      .from("check_ins")
      .insert({
        activity_id: activity.id,
        label: kind === "team" ? "tRAT" : "iRAT",
        kind,
        scale: pointsTotal(activity) > 0 ? "points" : "ci",
        max_points: pointsTotal(activity),
        posted: activity.posted,
        position: kind === "team" ? 1 : 0,
      })
      .select(),
  ) as CheckIn[];
  return rows[0];
}
