// Data access for the faculty Activities design (supabase/migrations/0007).
//
// Sits alongside src/checkins/data.ts rather than replacing it: courses,
// students, teams, activities, check-ins and results are all still read through
// that module. What lives here is what 0007 added — weeks, rubric ladders,
// per-question marks and teaching fellows — plus the writes that have to keep
// two things in step.

import { requireSupabase } from "@/lib/supabaseClient";
import {
  countAll,
  countAllIn,
  createActivity,
  dbError,
  listCheckIns,
  selectAll,
  selectAllIn,
  tintFor,
  updateActivity,
} from "@/checkins/data";
import { put, remove, removeReturningDeleted, signedUrls, stillThere } from "@/checkins/storage";
import {
  HIDDEN_INSTANT,
  type Activity,
  type ActivityQuestion,
  type Course,
  type CheckIn,
  type CourseTF,
  type CourseWeek,
  type FileRef,
  type RubricItem,
  type SubmissionMark,
  isCompletion,
} from "@/checkins/types";
import { humanBytes, refuseFile } from "./activityFiles";
import { deductionForAward, pointsTotal, type PointedQuestion } from "./model";
import { COMBO_TEMPLATE, type RubricTemplate } from "./comboRubric";
import { shareInFlight } from "./inFlight";

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
 * Rename a week, or hand it back to its number.
 *
 * The number is untouched: it is what activities point at and what orders the
 * page, so a rename can never move a week or strand what is in it. An empty
 * title is stored as NULL rather than "", so "use the number" is one state
 * rather than two that render the same.
 *
 * Needs 0033. A project without it gets a clear sentence rather than the raw
 * "column title does not exist", which is the same shape as the other
 * migration-gated writes in this file.
 */
export async function renameWeek(id: string, title: string | null): Promise<void> {
  const next = title?.trim() || null;
  const { error } = await db().from("course_weeks").update({ title: next }).eq("id", id);
  if (!error) return;
  if (/title/.test(error.message) && /does not exist|schema cache|could not find/i.test(error.message)) {
    throw new Error(
      "This project cannot name weeks yet — run supabase/migrations/0033_week_titles.sql " +
        "in the Supabase SQL editor.",
    );
  }
  throw dbError(error);
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

export async function listQuestions(activityId: string): Promise<PointedQuestion[]> {
  return selectAll<PointedQuestion>((from, to) =>
    db().from("activity_questions").select("*").eq("activity_id", activityId)
      .order("position").order("label")
      .range(from, to),
  );
}

/** Every question on a course's activities, for the screens that show totals. */
export async function listQuestionsFor(activityIds: string[]): Promise<PointedQuestion[]> {
  if (!activityIds.length) return [];
  try {
    return await selectAllIn<PointedQuestion>(activityIds, (chunk, from, to) =>
      db().from("activity_questions").select("*").in("activity_id", chunk)
        .order("position").order("label")
        .range(from, to),
    );
  } catch (e) {
    // A database that has not had 0014 run yet has no activity_questions table,
    // and this read happens inside the faculty app's main refresh — so the
    // missing table took the WHOLE Activities screen down to an error card with
    // nothing on it. Questions are an enhancement: every screen that uses them
    // already falls back to the old question_count shape when there are none.
    // So degrade to none and let the app work, rather than holding the course
    // hostage to a migration nobody has run.
    if (/activity_questions/.test(String((e as Error)?.message ?? e))) return [];
    throw e;
  }
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
): Promise<PointedQuestion[]> {
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
  ) as PointedQuestion[];
  return (inserted ?? []).sort((a, b) => a.position - b.position);
}

/**
 * Add a question, or a sub-question of one.
 *
 * `after` places it: a sub-question goes directly under its parent rather than
 * at the end, and everything below shifts down, so this renumbers rather than
 * leaving gaps. Marks survive that because 0026 keys them to the question's id;
 * while they were keyed to the position, adding a question mid-grading moved
 * every mark below it onto its neighbour.
 */
export async function addQuestion(
  activityId: string,
  rows: PointedQuestion[],
  label: string,
  after?: ActivityQuestion,
): Promise<PointedQuestion[]> {
  const at = after ? after.position + 1 : rows.length;
  const inserted = unwrap(
    await db()
      .from("activity_questions")
      .insert({ activity_id: activityId, label, position: at })
      .select()
      .single(),
  ) as PointedQuestion;

  const next = [...rows.slice(0, at), inserted, ...rows.slice(at)];
  await renumber(next);
  return next.map((q, i) => ({ ...q, position: i }));
}

/**
 * Set what ONE question is out of, or null to leave it unset.
 *
 * Two things this deliberately does not do.
 *
 * It does not touch points_total, and it does not make the questions add up to
 * it. What an activity is out of is still one number faculty chose and still
 * the only number recompute_result_score subtracts from; when the questions do
 * not sum to it, model.tallyQuestionPoints says so and she decides which number
 * was wrong. Deriving the total from the questions here would re-score every
 * submission on the activity from a keystroke, through 0014's rescore trigger.
 *
 * It does not rescale the criteria written under the question either. The
 * ladder is STORED as deductions, so re-pointing a question from 3 to 5 leaves
 * a deduction of 2 meaning "+3" where it used to mean "+1". That is a real
 * shift in meaning and she has to see it, but rewriting those deductions to
 * preserve the awards would move the score of everyone already marked — no
 * score may move on a keystroke, so the ladder is re-read in awards
 * (model.awardOfItem) and she fixes it there.
 */
export async function setQuestionPoints(id: string, points: number | null): Promise<void> {
  const value = points == null ? null : Math.max(0, points);
  const { data, error } = await db()
    .from("activity_questions")
    .update({ points: value })
    .eq("id", id)
    .select("id");
  if (error) {
    // 0034 is the migration that adds the column. Unlike the read in
    // listQuestionsFor, this cannot degrade to "no points" — she typed a
    // number and it has to either be stored or be refused out loud.
    if (/'?points'?/.test(error.message) && /column|schema cache/i.test(error.message)) {
      throw new Error(
        "Points per question need migration 0034 — this database hasn't had it run yet. Until " +
          "then every question shares the activity's total.",
      );
    }
    throw dbError(error);
  }
  if (!data || data.length === 0) {
    throw new Error(
      "That question was not saved — only the instructor who owns this course can change the " +
        "rubric.",
    );
  }
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
 *
 * Any mark left on this question — one picked from the shared ladder, which no
 * criterion delete reaches — goes with the question row itself, by 0026's
 * cascade. That delete fires the rescore trigger, so the points come back
 * rather than staying deducted for a question nobody can see.
 */
export async function deleteQuestion(
  activityId: string,
  question: ActivityQuestion,
  rows: PointedQuestion[],
): Promise<PointedQuestion[]> {
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

/**
 * Fill a blank rubric from a template.
 *
 * REFUSES to touch an activity that already has a question or a criterion, and
 * that refusal is the whole safety story: this runs from a dropdown and from
 * opening the builder, so the one thing it must never do is overwrite a rubric
 * somebody wrote. Returns false in that case rather than throwing — "there was
 * already a rubric here" is the expected answer most times it is called.
 *
 * Points go on first because a rung is STORED as a deduction from its
 * question's worth, so the worths have to be true before anything is written
 * against them. And if the questions cannot carry their own points — a database
 * that has not had 0034 run — the whole thing is refused rather than half
 * written: every rung would silently deduct from the activity's 20 instead of
 * from its question's 3, which is a rubric that looks right and grades wrong.
 */
export async function seedRubricTemplate(
  activity: Activity,
  template: RubricTemplate,
): Promise<boolean> {
  const [questions, items] = await Promise.all([
    listQuestions(activity.id),
    listRubric(activity.id),
  ]);
  if (questions.length > 0 || items.length > 0) return false;

  // Only onto an activity nobody has priced. A total somebody typed is a
  // decision, and quietly replacing 25 with 20 because a template says so is
  // the same class of mistake as overwriting her criteria. When the two
  // disagree, tallyQuestionPoints says so on screen and she picks.
  if (pointsTotal(activity) === 0) {
    await setActivityPoints(activity.id, template.pointsTotal);
  }

  const seeded = await db()
    .from("activity_questions")
    .insert(
      template.questions.map((q, i) => ({
        activity_id: activity.id,
        label: q.label,
        position: i,
        points: q.points,
      })),
    )
    .select();
  if (seeded.error) {
    // Same test as setQuestionPoints, and the same reason it cannot degrade to
    // "no points": without the column every rung below would come off the
    // activity's 20 rather than its question's 3.
    if (/'?points'?/.test(seeded.error.message) && /column|schema cache/i.test(seeded.error.message)) {
      throw new Error(
        "The standard combo rubric needs migration 0034 — this database hasn't had it run yet. " +
          "Its questions are worth 3, 2, 3, 2, 5 and 5, and without that column they cannot say so.",
      );
    }
    throw dbError(seeded.error);
  }
  const inserted = (seeded.data ?? []) as PointedQuestion[];

  const rows = template.questions.flatMap((q) =>
    q.rungs.map((r) => ({
      question_label: q.label,
      description: r.description,
      deduction: deductionForAward(q.points, r.award),
    })),
  );

  if (rows.length) {
    const { error } = await db()
      .from("rubric_items")
      .insert(
        rows.map((r, i) => ({
          activity_id: activity.id,
          row_index: i,
          description: r.description,
          deduction: r.deduction,
          is_custom: true,
          question_label: r.question_label,
        })),
      );
    if (error) {
      // The questions went in and the ladders did not, which is the one state
      // worse than not seeding at all: six named questions with nothing under
      // them, and this function would refuse to try again because they exist.
      // They are seconds old and carry no marks, so taking them back is safe.
      await db()
        .from("activity_questions")
        .delete()
        .in("id", inserted.map((q) => q.id));
      throw dbError(error);
    }
  }

  return true;
}

/**
 * Hand a blank combo the course's rubric, from whichever screen reaches it first.
 *
 * Every combo in AP 50 is marked against the same rubric, so a new one should
 * arrive with it already written. This used to happen only on the Rubric page,
 * which meant a combo opened straight from grading — or from the student side —
 * was one 0-point question with nothing under it. The rule is the same
 * everywhere: a combo, marked for points, that nobody has priced, and that has
 * no question or criterion yet (seedRubricTemplate refuses otherwise). Only the
 * owner writes rubric_items, so a TF's visit changes nothing. True when it
 * wrote something and the caller should read the activity back.
 *
 * One seed per activity at a time: two screens, or one effect run twice by
 * strict mode, both read an empty rubric before either insert lands, and the
 * later insert then trips unique (activity_id, label).
 */
const seeding = new Map<string, Promise<boolean>>();

export function seedComboIfBlank(activity: Activity, canSeed: boolean): Promise<boolean> {
  if (
    !canSeed ||
    activity.type !== "combo" ||
    isCompletion(activity) ||
    pointsTotal(activity) !== 0
  ) {
    return Promise.resolve(false);
  }
  return shareInFlight(seeding, activity.id, () => seedRubricTemplate(activity, COMBO_TEMPLATE));
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

// -------------------------------------------------- duplicating an activity
//
// The course runs the same shape of work every week. What takes the time is the
// rubric — a ladder of criteria written per question — and rewriting it from
// scratch each week is the whole cost this section removes.

/**
 * An activity's questions, as rows belonging to a different activity.
 *
 * What each question is WORTH comes across too, and has to: duplicating Kelly's
 * combo without it would hand back six questions that no longer say 3, 2, 3, 2,
 * 5, 5, and the copied ladder — carried over as deductions — would then award
 * something else entirely on every one of them.
 *
 * The key is omitted rather than sent as null when the source row does not
 * carry it, which is how a row read from a database that has not run 0034
 * arrives. Sending a column that is not there fails the whole insert, and a
 * duplicate that works without points is worth more than one that refuses.
 */
export function copiedQuestions(
  activityId: string,
  questions: PointedQuestion[],
): { activity_id: string; label: string; position: number; points?: number | null }[] {
  return [...questions]
    .sort((a, b) => a.position - b.position)
    .map((q) => ({
      activity_id: activityId,
      label: q.label,
      position: q.position,
      ...("points" in q ? { points: q.points ?? null } : {}),
    }));
}

/**
 * A rubric, as rows belonging to a different activity.
 *
 * `question_label` is carried across verbatim, and that is the load-bearing
 * part: a criterion belongs to a question by its LABEL, not by an id (0012), so
 * the copied ladder only lines up with the copied questions because both keep
 * the labels they had. `is_custom` comes too — it decides whether a row can be
 * deleted again, and defaulting it would quietly freeze the copy's rubric.
 */
export function copiedRubric(
  activityId: string,
  rubric: RubricItem[],
): {
  activity_id: string;
  row_index: number;
  description: string;
  deduction: number;
  is_custom: boolean;
  question_label: string | null;
}[] {
  return [...rubric]
    .sort((a, b) => a.row_index - b.row_index)
    .map((r) => ({
      activity_id: activityId,
      row_index: r.row_index,
      description: r.description,
      deduction: r.deduction,
      is_custom: r.is_custom,
      question_label: r.question_label,
    }));
}

export interface DuplicatedActivity {
  activity: Activity;
  questions: number;
  criteria: number;
}

/**
 * Copy what an activity IS, and nothing about how it went.
 *
 * Carried over: the title and brief, its type, what it is out of, whether it is
 * marked for completion, the resubmit mode, every question, the whole rubric,
 * and its check-ins.
 *
 * Deliberately left behind:
 *
 *  - The dates. `dates_label`, `due_at` and the two per-scope due columns say
 *    when THIS run happens, which is the one thing that is different about the
 *    next one. A copied deadline in the past is worse than a blank one.
 *  - The attachments. `files` holds a storage PATH per attachment, and
 *    purgeActivityStorage removes the objects by those paths when an activity
 *    is deleted — so two rows naming one object means deleting either takes the
 *    other's attachment with it, unrecoverably: the bucket's delete policy joins
 *    back to the activity row, so once that row is gone nobody can ever remove
 *    or replace the object. Copying the bytes instead is a real feature; naming
 *    them twice is a trap. The week's documents are new files anyway.
 *  - Submissions, marks and released results. Those are the students' work.
 *
 * Created hidden, exactly like a new activity: a copy is a draft until its week
 * and dates are right, and the class must not see it in between.
 */
export async function duplicateActivity(
  source: Activity,
  into: { week: number; position: number },
): Promise<DuplicatedActivity> {
  const created = await createActivity({
    courseId: source.course_id,
    week: into.week,
    title: source.title,
    topic: source.topic ?? undefined,
    resubmitMode: source.resubmit_mode,
    sourceText: source.source_text ?? undefined,
    position: into.position,
    opensAt: HIDDEN_INSTANT,
  });

  // createActivity takes what a new activity needs; the rest of the shape is a
  // patch, the same two-step the New activity button makes. question_count 0 is
  // what stops anything seeding questions over the ones being copied in.
  const patch: Partial<Activity> = {
    type: source.type,
    points_total: source.points_total,
    question_count: 0,
  };
  // Only when the column answered: a client reading a database without 0019
  // gets undefined, and writing that back would fail against the older schema.
  if (source.completion != null) patch.completion = source.completion;
  await updateActivity(created.id, patch);

  const [questions, rubric, checkIns] = await Promise.all([
    listQuestions(source.id),
    listRubric(source.id),
    listCheckIns([source.id]),
  ]);

  const questionRows = copiedQuestions(created.id, questions);
  if (questionRows.length) {
    const { error } = await db().from("activity_questions").insert(questionRows);
    if (error) throw dbError(error);
  }

  const rubricRows = copiedRubric(created.id, rubric);
  if (rubricRows.length) {
    const { error } = await db().from("rubric_items").insert(rubricRows);
    if (error) throw dbError(error);
  }

  // Unposted, whatever the source was: posting is what puts work in front of
  // the class, and this copy is hidden.
  if (checkIns.length) {
    const { error } = await db()
      .from("check_ins")
      .insert(
        checkIns.map((c) => ({
          activity_id: created.id,
          label: c.label,
          kind: c.kind,
          phase: c.phase,
          scale: c.scale,
          max_points: c.max_points,
          position: c.position,
          posted: false,
        })),
      );
    if (error) throw dbError(error);
  }

  return {
    activity: { ...created, ...patch },
    questions: questionRows.length,
    criteria: rubricRows.length,
  };
}

// -------------------------------------------------- the activity's attachments
//
// 0012's `activity-files` bucket. Objects are named `<activity_id>/<file>` and
// every policy on the bucket reads that first segment, so the path is not a
// convenience here — an object stored under any other shape is reachable by
// nobody.
//
// An activity carries a LIST, added one attachment at a time and capped by the
// rules in activityFiles.ts. The column was always an array and every reader
// always typed it as one; what the list needed was not a migration but for the
// writes to stop treating `files` as a single slot.

const BUCKET = "activity-files";

/**
 * Strip a filename down to what can safely be a storage key.
 *
 * Supabase rejects a number of characters outright, and a name that survives
 * upload but not URL-encoding produces a signed URL for an object that is not
 * there — which reads as a corrupt file rather than a bad name.
 *
 * A name made entirely of characters this strips comes back empty, and a name
 * made of dots comes back as dots. Neither can produce a path segment that is
 * "." or "..", because objectPath always puts a timestamp in front of this —
 * which is also why the "document.pdf" fallback is unreachable in practice:
 * refuseFile has already insisted on an ASCII .pdf/.png/.jpg/.jpeg ending, and
 * that much always survives the sanitiser.
 */
function safeName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "document.pdf";
}

/** Where one attachment's bytes go. */
function objectPath(activityId: string, fileName: string): string {
  // Date.now() is not a key on its own. Attachments upload one at a time, but
  // each one is a round trip timed against a millisecond clock, and two tabs
  // share neither a queue nor a counter — while put() is upsert:false, so a
  // repeated name is a hard refusal partway through a batch rather than a
  // silent overwrite. The random tail is what makes the name unique; the
  // timestamp is what keeps a bucket listing readable.
  const tail = Math.random().toString(36).slice(2, 8);
  return `${activityId}/${Date.now()}-${tail}-${safeName(fileName)}`;
}

/**
 * The activity's attachments as the DATABASE has them this instant, or null if
 * the row has gone.
 *
 * Every write below re-reads before it rewrites. One column holds the whole
 * list, so a write is a read-modify-write of all of it: picking three files at
 * once and building three arrays from one snapshot keeps whichever lands last
 * and loses the other two.
 */
async function currentFiles(activityId: string): Promise<FileRef[] | null> {
  const res = await db().from("activities").select("files").eq("id", activityId).maybeSingle();
  if (res.error) throw dbError(res.error);
  const row = res.data as { files: FileRef[] | null } | null;
  return row ? row.files ?? [] : null;
}

const GONE = "That activity is no longer there.";

/** Run the row write, and take the object back out if it does not land. */
async function orRemoveObject<T>(path: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (e) {
    // The row is the record. An object no row names cannot be listed, opened or
    // removed through the app ever again — the bucket's own delete policy
    // resolves the activity from the path and finds nothing pointing back — so
    // if this take-back does not land, nothing will ever mention the object
    // again except the storage bill. Said out loud in the error rather than
    // swallowed: it is the only chance anybody has of knowing.
    //
    // Its own try, because the original failure is the one worth reporting and
    // a second one must not displace it.
    let stranded = false;
    try {
      stranded = Boolean(await remove(BUCKET, [path]));
    } catch {
      stranded = true;
    }
    if (stranded) {
      throw new Error(
        `${String((e as Error)?.message ?? e)} The file had already reached storage and could ` +
          `not be taken back out (${path}); it is now unreachable from this app.`,
      );
    }
    throw e;
  }
}

/**
 * Put one file in the bucket and name it on the row.
 *
 * Appending is the only thing any caller wants. DocumentPane's Replace is not a
 * placement — it adds the new attachment and then removes the one it was
 * showing, which is two ordinary operations in an order the screen chooses, and
 * means there is exactly one way an attachment reaches the bucket and one way
 * it leaves rather than two that can drift.
 */
async function attach(
  activity: Activity,
  file: File,
): Promise<{ ref: FileRef; files: FileRef[] }> {
  const held = activity.files ?? [];
  // Refused before the upload where possible: the format and size rules need
  // nothing from the database, and 20 MB is a long way to carry a file that was
  // never going to be allowed.
  const refused = refuseFile(file, held.length);
  if (refused) throw new Error(refused);

  const path = objectPath(activity.id, file.name);
  const failure = await put(BUCKET, path, file, file.type || "application/octet-stream");
  if (failure) {
    throw new Error(
      `That file was not uploaded: ${failure.message}. If this says the bucket is missing, run ` +
        "supabase/migrations/0012_rubric_questions_and_files.sql.",
    );
  }

  const ref: FileRef = {
    name: file.name,
    size: humanBytes(file.size),
    path,
    mime: file.type || undefined,
  };

  const files = await orRemoveObject(path, async () => {
    const live = await currentFiles(activity.id);
    if (!live) throw new Error(GONE);
    // The same rule again, against the count the database actually holds. The
    // snapshot the caller passed may be several uploads old by now, and the
    // limit is only a limit if the write enforces it.
    const late = refuseFile(file, live.length);
    if (late) throw new Error(late);

    const list = [...live, ref];
    // .select() so an RLS-filtered write is DETECTABLE. Writing activities is
    // owner-only; without this a teaching fellow's upload came back with no
    // error and no rows, the screen listed the attachment, and the bytes sat in
    // a bucket the row never named.
    const { data, error } = await db()
      .from("activities")
      .update({ files: list })
      .eq("id", activity.id)
      .select("id");
    if (error) throw dbError(error);
    if (!data || data.length === 0) {
      throw new Error(
        "That file was not attached — only the instructor who owns this course can change an " +
          "activity.",
      );
    }
    return list;
  });

  return { ref, files };
}

/**
 * Add one attachment. Returns the activity's whole new list.
 *
 * NOT safe to run twice at once. It reads the row, appends, and writes the
 * whole array back, so two overlapping calls interleave read/read/write/write
 * and the second silently drops the first's ref — leaving its object named by
 * nothing. Callers upload one file at a time; see ActivityDetail's `working`
 * ref for the guard. Two BROWSER TABS can still race this, which the column
 * cannot prevent without a version to compare against.
 */
export async function addActivityFile(activity: Activity, file: File): Promise<FileRef[]> {
  return (await attach(activity, file)).files;
}

/**
 * Drop one attachment. Returns the activity's whole new list.
 *
 * Addressed by the path that names its object. A ref written before 0012 has a
 * NAME and no path and so has no path to address it by; it is matched on its
 * name instead, and there is nothing in any bucket to delete afterwards. Pass
 * `ref.path ?? ref.name` and both kinds work.
 */
export async function removeActivityFileAt(activity: Activity, path: string): Promise<FileRef[]> {
  const live = await currentFiles(activity.id);
  if (!live) throw new Error(GONE);

  const next = live.filter((ref) => (ref.path ? ref.path !== path : ref.name !== path));
  // Nothing matched: somebody else already took it off, and re-writing the same
  // list to say so is a round trip that changes nothing.
  if (next.length === live.length) return live;

  // OBJECT FIRST, then the row — the same order purge.ts uses, and for a
  // sharper version of the same reason. The bucket's delete policy resolves the
  // activity from the path, so the delete is only ever authorised while the row
  // still names it; taking the ref off first and then failing to delete leaves
  // an object nothing names, which no screen can list and no policy will ever
  // authorise removing again. Doing it this way the failure is survivable
  // instead: the attachment stays in the list with a link that will not open,
  // and pressing Remove a second time finishes the job.
  //
  // "No error" is not "deleted". The DELETE endpoint runs RLS-FILTERED and
  // answers 200 with the list of objects it actually removed, so a refusal is
  // simply an absence — which is why this reads the list and then asks.
  if (live.some((ref) => ref.path === path)) {
    const { deleted, failure } = await removeReturningDeleted(BUCKET, [path]);
    if (failure) throw new Error(`That attachment was not removed: ${failure.message}`);
    if (!deleted.includes(path) && (await stillThere(BUCKET, path))) {
      throw new Error(
        "That attachment was not removed — only the instructor who owns this course can delete " +
          "an activity's files.",
      );
    }
  }

  const { data, error } = await db()
    .from("activities")
    .update({ files: next })
    .eq("id", activity.id)
    .select("id");
  if (error) throw dbError(error);
  if (!data || data.length === 0) {
    throw new Error(
      "That attachment was not removed — only the instructor who owns this course can change an " +
        "activity.",
    );
  }
  return next;
}

/**
 * A URL per attachment the browser can render from, in ONE round trip.
 *
 * Signed and short-lived, because the bucket is private: the policies decide
 * who may mint one, and the link itself expires rather than becoming a way
 * around them. Nothing is stored on the row.
 *
 * One request because supabase-js has a batch form — createSignedUrls, wrapped
 * as storage.signedUrls — and a page showing six attachments should not make
 * six serial calls to show them. Paths the backend refuses individually are
 * simply absent from the map, which costs that one attachment its viewer
 * rather than the whole set its links. So are refs with no path: a row written
 * before 0012 records a file NAME and nothing else, and there is nothing to
 * sign.
 */
export async function activityFileUrls(refs: FileRef[]): Promise<Map<string, string>> {
  const paths = [...new Set(refs.map((r) => r.path).filter((p): p is string => Boolean(p)))];
  if (!paths.length) return new Map();

  const { urls, error } = await signedUrls(BUCKET, paths);
  if (error) {
    const what = paths.length === 1 ? "That file" : "Those files";
    throw new Error(`${what} could not be opened: ${error.message}`);
  }
  return urls;
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
 * True when a write failed only because 0026 has not been run here.
 *
 * Keying marks by question is a fix, not a feature: a project still on 0025
 * has to keep grading — by position, with the shifting 0026 exists to stop —
 * rather than have every pick throw. Anything else is a real error.
 */
function needs0026(e: unknown): boolean {
  // Narrow on purpose: the column being MISSING is the only thing worth
  // retrying. A foreign key or duplicate that happens to name the column is a
  // real failure, and swallowing it would write the mark without its question.
  const m = String((e as Error)?.message ?? e);
  return /question_id/.test(m) && /does not exist|schema cache|could not find/i.test(m);
}

/**
 * The row a pick on this question already has, if any.
 *
 * Two lookups, because a mark can be older than the question's id. 0026
 * backfilled what it could, but a submission graded while its activity had NO
 * question rows was marked against a question the grading screen synthesised —
 * position, no id — and opening the rubric later writes those questions down
 * for real (ensureQuestions). Adopting that row instead of inserting beside it
 * is what stops one question deducting twice.
 */
async function markRowId(
  resultId: string,
  questionIndex: number,
  questionId: string,
): Promise<string | null> {
  const byQuestion = unwrap(
    await db()
      .from("submission_marks")
      .select("id")
      .eq("result_id", resultId)
      .eq("question_id", questionId)
      .limit(1),
  ) as { id: string }[] ?? [];
  if (byQuestion.length) return byQuestion[0].id;

  const byPosition = unwrap(
    await db()
      .from("submission_marks")
      .select("id")
      .eq("result_id", resultId)
      .is("question_id", null)
      .eq("question_index", questionIndex)
      .limit(1),
  ) as { id: string }[] ?? [];
  return byPosition.length ? byPosition[0].id : null;
}

/**
 * Pick a ladder row for one question of one submission.
 *
 * Keyed on the question's IDENTITY, because its POSITION moves: renumber()
 * above rewrites every position on an add or a delete, so a mark addressed by
 * index ends up under whichever question inherited that slot — deducting from a
 * question nobody marked, and invisible on the screen that made it.
 * question_index is still written so the two agree and so 0026's fallback stays
 * usable.
 *
 * `questionId` is null only where there is no question row to point at: the
 * grading screen synthesises questions for an activity that has none, and those
 * fall back to the index. That is safe for exactly the reason the index is not
 * safe elsewhere — an activity with no question rows has nothing to renumber.
 *
 * The score is NOT written here — a trigger recomputes it from every mark on
 * the row (0007). One writer, so the score cannot disagree with the marks.
 */
export async function setMark(
  resultId: string,
  questionIndex: number,
  rubricItemId: string,
  questionId: string | null = null,
): Promise<void> {
  if (questionId) {
    try {
      const existing = await markRowId(resultId, questionIndex, questionId);
      const { error } = existing
        ? await db()
            .from("submission_marks")
            // question_id written on the way past: the row may be one that was
            // keyed by position alone, and this is where it stops being.
            .update({
              rubric_item_id: rubricItemId,
              question_id: questionId,
              question_index: questionIndex,
            })
            .eq("id", existing)
        : await db().from("submission_marks").insert({
            result_id: resultId,
            question_index: questionIndex,
            question_id: questionId,
            rubric_item_id: rubricItemId,
          });
      if (error) throw dbError(error);
      return;
    } catch (e) {
      if (!needs0026(e)) throw e;
    }
  }

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

export async function clearMark(
  resultId: string,
  questionIndex: number,
  questionId: string | null = null,
): Promise<void> {
  if (questionId) {
    const { error } = await db()
      .from("submission_marks")
      .delete()
      .eq("result_id", resultId)
      .eq("question_id", questionId);
    if (error && !needs0026(error)) throw dbError(error);

    if (!error) {
      // And any row still keyed by position alone — the one markRowId adopts.
      // Left behind, it would go on deducting from a question the grader has
      // just cleared, with no tick anywhere to explain the missing points.
      const { error: e2 } = await db()
        .from("submission_marks")
        .delete()
        .eq("result_id", resultId)
        .is("question_id", null)
        .eq("question_index", questionIndex);
      if (e2) throw dbError(e2);
      return;
    }
  }

  // By index: the synthesised-question case, and every mark on a database that
  // has not had 0026 run, where there is no other key to delete by.
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
export async function releaseMark(
  resultId: string,
  completion: boolean,
  /** Only read when `completion`. False releases a NOT complete (0024). */
  met = true,
): Promise<void> {
  const { error } = await db()
    .from("check_in_results")
    .update({
      status: "scored",
      is_ci: completion,
      // Always written, never left to drift: a row re-released from Not
      // complete to Complete has to say so, and default-true would silently
      // upgrade it.
      ci_met: completion ? met : true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", resultId);
  if (error) throw dbError(error);
}

/** Release many at once. One call per row — see the note in GradingScreen. */
export async function releaseMany(
  rows: { id: string; met?: boolean }[],
  completion: boolean,
): Promise<{ released: number; failed: string[] }> {
  const failed: string[] = [];
  let released = 0;
  for (const r of rows) {
    try {
      await releaseMark(r.id, completion, r.met ?? true);
      released += 1;
    } catch {
      // Collected rather than thrown: one row refusing must not abandon the
      // twenty after it, and the caller says which ones did not go.
      failed.push(r.id);
    }
  }
  return { released, failed };
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
// getSession, not getUser. getUser() is a NETWORK CALL — auth-js issues
  // GET /user on every invocation with no cache (GoTrueClient _getUser) — and
  // four of them sat in series on the cold path, each returning a user the app
  // was already holding. getSession() reads local storage.
  //
  // Safe because the uid here only SHAPES a query, never authorises one. Every
  // request carries the JWT and Postgres re-derives auth.uid() from it, so a
  // tampered local session buys nothing: it just builds a query RLS refuses.
  const { data: auth } = await db().auth.getSession();
  const uid = auth.session?.user.id;
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

/**
 * Bring already-RELEASED marks into line when an activity's grading mode flips.
 *
 * is_ci is written per result at release time (releaseMark), from whatever the
 * activity said then. Flipping completion afterwards left those rows behind: a
 * student marked before the flip read "Complete" while one marked after read
 * "7 / 10", off the same activity, with nothing on either screen to explain the
 * difference.
 *
 * Only scored rows. A draft or a submission has no mark to restate, and the
 * guard in 0008 refuses a student-side write to a scored row anyway — this runs
 * as the owner, who may.
 */
export async function restampReleased(activityId: string, completion: boolean): Promise<number> {
  const checkIns = await selectAll<{ id: string }>((from, to) =>
    db().from("check_ins").select("id").eq("activity_id", activityId).order("id").range(from, to),
  );
  if (!checkIns.length) return 0;

  const scored = await selectAllIn<{ id: string }>(
    checkIns.map((c) => c.id),
    (chunk, from, to) =>
      db().from("check_in_results").select("id")
        .in("check_in_id", chunk).eq("status", "scored").eq("is_ci", !completion)
        .order("id").range(from, to),
  );
  if (!scored.length) return 0;

  for (let i = 0; i < scored.length; i += 100) {
    const chunk = scored.slice(i, i + 100).map((r) => r.id);
    const { error } = await db().from("check_in_results")
      .update({ is_ci: completion }).in("id", chunk);
    if (error) throw dbError(error);
  }
  return scored.length;
}

// ------------------------------------------------------------- account type
//
// profiles.role is 'faculty' or 'student' and 0006 PINS it: the own-profile
// UPDATE policy requires role to equal what it already is, so nobody writes it
// through the table. That is right — role is what stands between a student
// account and an instructor's gradebook. 0024 adds two narrow doors instead.

export type AccountRole = "faculty" | "student";

/**
 * What account type each person on this course signed up with.
 *
 * A course owner cannot read anybody else's profile row (0006 is own-row only),
 * so without this they cannot tell a mis-signed-up student from a correct one —
 * which makes "fix the wrong ones" impossible to even see. 0024's function
 * returns role and nothing else, for people on a course they own.
 *
 * Degrades to an empty map rather than throwing: knowing the account types is
 * an enhancement on the roster screen, and a database without 0024 should show
 * the roster rather than an error.
 */
export async function courseMemberRoles(courseId: string): Promise<Map<string, AccountRole>> {
  const { data, error } = await db().rpc("course_member_roles", { cid: courseId });
  if (error) {
    if (/course_member_roles|0024/.test(error.message)) return new Map();
    throw dbError(error);
  }
  const out = new Map<string, AccountRole>();
  for (const r of (data as { user_id: string; role: AccountRole }[]) ?? []) {
    out.set(r.user_id, r.role);
  }
  return out;
}

/**
 * Fix somebody's account type. Only for people on a course you own — 0024's
 * function enforces that, and refuses your own id, because an owner demoting
 * themselves locks them out of the course from a button meant to fix somebody
 * else's mistake.
 */
export async function setMemberRole(userId: string, role: AccountRole): Promise<void> {
  const { error } = await db().rpc("set_member_role", { target: userId, next_role: role });
  if (!error) return;
  if (/set_member_role|0024/.test(error.message)) {
    throw new Error(
      "This project cannot change account types yet — run " +
        "supabase/migrations/0024_not_complete_and_roles.sql in the Supabase SQL editor.",
    );
  }
  throw dbError(error);
}

