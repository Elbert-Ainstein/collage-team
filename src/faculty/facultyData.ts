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
  QUESTION_SHAPE,
  type Activity,
  type Course,
  type ActivityType,
  type CheckIn,
  type CourseTF,
  type CourseWeek,
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
  const weeks = await listWeeks(courseId);
  const next = weeks.reduce((n, w) => Math.max(n, w.week), 0) + 1;
  const rows = unwrap(
    await db()
      .from("course_weeks")
      .insert({ course_id: courseId, week: next, dates_label: datesLabel ?? null })
      .select(),
  ) as CourseWeek[];
  return rows[0];
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
 * Change an activity's question shape.
 *
 * check_ins.max_points is written from the same numbers in the same call: the
 * student view renders max_points directly, so leaving it stale would show
 * students a total the gradebook disagrees with.
 */
export async function setQuestionShape(
  activityId: string,
  count: number,
  per: number,
): Promise<void> {
  const { error } = await db()
    .from("activities")
    .update({ question_count: count, points_per_question: per })
    .eq("id", activityId);
  if (error) throw dbError(error);

  const total = count * per;
  const { error: e2 } = await db()
    .from("check_ins")
    .update({ max_points: total })
    .eq("activity_id", activityId);
  if (e2) throw dbError(e2);
}

/** The defaults for a type, used when an activity is created. */
export function shapeFor(type: ActivityType): { count: number; per: number } {
  return QUESTION_SHAPE[type];
}

// ------------------------------------------------------------ rubric ladders

/**
 * The default deduction ladder, which depends on what one question is worth:
 * a six-step ladder for 5-pt questions, three steps for 2-pt, and
 * complete/missing for 1-pt.
 */
export function defaultLadder(pointsPerQuestion: number): { description: string; deduction: number }[] {
  if (pointsPerQuestion >= 5) {
    return [
      { description: "Correct, with a thorough, well-reasoned argument.", deduction: 0 },
      { description: "Correct and argued, but the reasoning is thin.", deduction: 1 },
      { description: "Correct, but no real argument — little evidence of effort.", deduction: 2 },
      { description: "Incorrect, though it shows genuine effort or insight.", deduction: 3 },
      { description: "Incorrect and shows little effort.", deduction: 4 },
      { description: "Missing, or too sketchy to evaluate.", deduction: 5 },
    ];
  }
  if (pointsPerQuestion >= 2) {
    return [
      { description: "Correct and clearly explained.", deduction: 0 },
      { description: "On the right track, with a gap in the reasoning.", deduction: 1 },
      { description: "Incorrect or missing.", deduction: 2 },
    ];
  }
  return [
    { description: "Complete.", deduction: 0 },
    { description: "Missing or incomplete.", deduction: 1 },
  ];
}

export async function listRubric(activityId: string): Promise<RubricItem[]> {
  return selectAll<RubricItem>((from, to) =>
    db().from("rubric_items").select("*").eq("activity_id", activityId)
      .order("row_index").order("id")
      .range(from, to),
  );
}

/**
 * The activity's ladder, seeding the default one the first time it is opened.
 *
 * Seeding on read rather than on activity creation means activities that
 * predate this migration get a ladder the moment someone grades them.
 *
 * `canSeed` matters: writing rubric_items is owner-only, so a teaching fellow
 * opening an activity nobody has set criteria for would have the insert
 * rejected. Returning empty lets the caller say so; attempting it left the
 * grading screen on "Loading the ladder…" with no way forward.
 */
export async function ensureRubric(activity: Activity, canSeed = true): Promise<RubricItem[]> {
  const existing = await listRubric(activity.id);
  if (existing.length) return existing;
  if (!canSeed) return [];

  const rows = defaultLadder(activity.points_per_question).map((r, i) => ({
    activity_id: activity.id,
    row_index: i,
    description: r.description,
    deduction: r.deduction,
    is_custom: false,
  }));
  const inserted = unwrap(await db().from("rubric_items").insert(rows).select()) as RubricItem[];
  return (inserted ?? []).sort((a, b) => a.row_index - b.row_index);
}

export async function updateRubricItem(
  id: string,
  patch: { description?: string; deduction?: number },
): Promise<void> {
  const { error } = await db().from("rubric_items").update(patch).eq("id", id);
  if (error) throw dbError(error);
}

export async function addRubricItem(
  activityId: string,
  afterRows: RubricItem[],
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
        scale: activity.points_per_question * activity.question_count > 0 ? "points" : "ci",
        max_points: pointsTotal(activity),
        posted: activity.posted,
        position: kind === "team" ? 1 : 0,
      })
      .select(),
  ) as CheckIn[];
  return rows[0];
}
