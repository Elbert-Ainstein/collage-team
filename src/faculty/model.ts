// The derived numbers for the faculty Activities screens.
//
// Everything here is computed, never stored. The rule the design is emphatic
// about: the row view's progress caption and the column view's header count are
// THE SAME NUMBER, so they come from one function. Computing them separately is
// how they came to disagree in an earlier pass.

import type { ResultRow } from "@/checkins/data";
import { isCompletionMet } from "@/checkins/studentData";
import {
  isCompletion,
  SCOPE_OF,
  type Activity,
  type ActivityQuestion,
  type CheckIn,
  type CourseWeek,
  type RubricItem,
  type Scope,
  type Student,
  type Team,
} from "@/checkins/types";

/**
 * What the activity is out of — one number, chosen by faculty.
 *
 * The fallback is for a client that loaded a row before 0014 added the column:
 * the product it replaces is exactly what the migration backfills from, so the
 * two can never disagree about an existing activity.
 */
export function pointsTotal(
  a: Pick<Activity, "points_total" | "question_count" | "points_per_question">,
): number {
  if (a.points_total != null) return a.points_total;
  return a.question_count * a.points_per_question;
}

/** This activity's questions, in the order they are asked. */
export function questionsFor(
  activityId: string,
  questions: ActivityQuestion[],
): ActivityQuestion[] {
  return questions
    .filter((q) => q.activity_id === activityId)
    .sort((a, b) => a.position - b.position);
}

/**
 * How many questions there are, from the rows when they exist.
 *
 * Sub-questions count: each one is separately marked, so "12 questions" on an
 * activity with 10 questions and two sub-questions is the number of marks a
 * grader makes, which is what the word is doing on that screen. This is a
 * count of STRUCTURE and says nothing about points — those are the activity's.
 */
export function questionCount(a: Activity, questions?: ActivityQuestion[]): number {
  return questions && questions.length ? questions.length : a.question_count;
}

// ------------------------------------------------ what one question is worth
//
// An activity has ONE total and that stays true: points_total is what
// recompute_result_score subtracts from, and nothing below is derived from the
// questions. What 0034 adds is a question's OWN worth, because Kelly's combo is
// 20 points across six questions worth 3, 2, 3, 2, 5 and 5 — a shape the old
// "every question is an equal share of the total" reading cannot say at all.
//
// The identity that keeps the two facts agreeing:
//
//   score = total - sum(worth - award) = sum(award),  when the worths add to
//   the total
//
// So when her six add up to 20, a submission scores the sum of what she awarded
// it, question by question. When they do not add up, nothing is corrupt and
// nothing is rescaled — every score simply sits a constant off the sum of the
// awards, which is why `tallyQuestionPoints` says so out loud instead.

/** An activity_questions row from a database that has run 0034. */
export type PointedQuestion = ActivityQuestion & {
  /**
   * What this question is out of, or NULL for unset.
   *
   * Undefined means the same thing and arrives the same way `title` does on a
   * pre-0033 week: a client reading a database where the column is not there
   * yet. Unset is not zero — a question with no worth of its own has criteria
   * that deduct from the activity total, which is what every criterion in the
   * course has always done, so an activity nobody re-points cannot move.
   */
  points?: number | null;
};

/** Kill float dust, so a value survives a round trip through both directions. */
const exact = (n: number): number => Math.round(n * 1e6) / 1e6;

/**
 * What one question is out of.
 *
 * The fallback is the whole compatibility story: a question with no points of
 * its own is worth the activity total, because the activity total is the number
 * its criteria have always come off. Every activity that exists today has null
 * on every question, and every one of them reads here exactly as it did before.
 */
export function worthOf(
  activity: Pick<Activity, "points_total" | "question_count" | "points_per_question">,
  question?: PointedQuestion | null,
): number {
  const own = question?.points;
  return own == null ? pointsTotal(activity) : exact(own);
}

/**
 * A ladder is WRITTEN as awards and STORED as deductions.
 *
 * Kelly writes "+1 pt — work is mostly complete, but major steps are missing".
 * The database holds a deduction, because score = points_total - sum of deductions.
 * On her 3-point At Home Effort question that "+1" is a deduction of 2; the
 * identical "+1" on her 2-point Mark-up question is a deduction of 1. Which is
 * why the worth passed in is the QUESTION's and never the activity's.
 *
 * Both directions live here and only here. Every grade in the course goes
 * through this subtraction, and an off-by-one is an off-by-one on eighty
 * transcripts.
 */
export function deductionForAward(worth: number, award: number): number {
  return exact(worth - award);
}

/** The same conversion read backwards: what a stored deduction awards. */
export function awardForDeduction(worth: number, deduction: number): number {
  return exact(worth - deduction);
}

/**
 * Whether an award is one this question can actually give.
 *
 * Neither direction above clamps, throws, or rounds into range, so a caller
 * asks this BEFORE saving. Quietly pulling an out-of-range award back to the
 * question's worth would silently rewrite what she typed, and she would find
 * out from a transcript.
 *
 * Note what this deliberately does NOT reject: two rungs awarding the same
 * points. Her Mark-up ladder has two different +1s, on purpose — two failures
 * she scores the same — and they map to the same deduction, which is harmless
 * because a mark stores the ROW it was picked from, never its value.
 */
export function awardFits(worth: number, award: number): boolean {
  return Number.isFinite(award) && award >= 0 && award <= worth;
}

/** The question a criterion is written under. Null is 0012's shared ladder. */
export function questionForItem(
  item: Pick<RubricItem, "question_label">,
  questions: PointedQuestion[],
): PointedQuestion | null {
  if (item.question_label == null) return null;
  return questions.find((q) => q.label === item.question_label) ?? null;
}

/**
 * What a stored criterion awards, read under its own question's worth.
 *
 * A criterion on the shared ladder has no question, so it is read against the
 * activity total — the number it has always deducted from.
 */
export function awardOfItem(
  activity: Pick<Activity, "points_total" | "question_count" | "points_per_question">,
  item: Pick<RubricItem, "question_label" | "deduction">,
  questions: PointedQuestion[],
): number {
  return awardForDeduction(worthOf(activity, questionForItem(item, questions)), item.deduction);
}

/** Where an activity's questions stand against its total. */
export type PointsBalance =
  /** No question declares a worth. Every activity in the course today. */
  | "unset"
  /** Some do and some do not, which is what typing the sixth one looks like. */
  | "partial"
  | "balanced"
  | "over"
  | "under";

export interface QuestionPointsTally {
  /** What the activity is out of. Never derived from the questions. */
  total: number;
  /** The sum of the questions that declare a worth. */
  declared: number;
  /** How many questions declare one, and how many do not. */
  set: number;
  unset: number;
  balance: PointsBalance;
  /** What to tell faculty, or null when there is nothing to say. */
  note: string | null;
}

const pts = (n: number): string => String(exact(n));

/**
 * Add up what the questions are worth and compare it to the activity total.
 *
 * This is a real state faculty can reach by typing, and it is NOT an error: the
 * questions are not made to add up, points_total is not recomputed from them,
 * and no stored deduction is touched. Rescaling her numbers to fit would be a
 * silent regrade of everyone already marked, so the model reports the gap and
 * she decides which number was wrong.
 *
 * What the gap actually does, since the note has to be true: scores still come
 * off points_total, so a shortfall is points nobody can lose and an excess is
 * loss the floor at zero swallows. Either way every score moves by the same
 * constant, and no submission is scored from a number that is not on screen.
 */
export function tallyQuestionPoints(
  activity: Pick<Activity, "points_total" | "question_count" | "points_per_question">,
  questions: PointedQuestion[],
): QuestionPointsTally {
  const total = pointsTotal(activity);
  const scored = questions.filter((q) => q.points != null);
  const declared = exact(scored.reduce((n, q) => n + (q.points ?? 0), 0));
  const set = scored.length;
  const unset = questions.length - set;

  if (set === 0) {
    return { total, declared: 0, set: 0, unset, balance: "unset", note: null };
  }

  const base = { total, declared, set, unset };
  if (unset > 0) {
    return {
      ...base,
      balance: "partial",
      note:
        `${set} of these ${questions.length} questions are worth points. A criterion on one of ` +
        `the other ${unset} comes off the activity's ${pts(total)} instead.`,
    };
  }
  if (declared > total) {
    return {
      ...base,
      balance: "over",
      note:
        `Your questions add up to ${pts(declared)} points and the activity is out of ` +
        `${pts(total)}. Scores still come off the ${pts(total)}, so a submission reaches 0 with ` +
        `${pts(declared - total)} points still to lose.`,
    };
  }
  if (declared < total) {
    return {
      ...base,
      balance: "under",
      note:
        `Your questions add up to ${pts(declared)} points and the activity is out of ` +
        `${pts(total)}. Scores still come off the ${pts(total)}, so a submission that loses ` +
        `every point still scores ${pts(total - declared)}.`,
    };
  }
  return { ...base, balance: "balanced", note: null };
}

/** "50 pts", or "Completion" for the types that are marked rather than scored. */
export function pointsLabel(a: Activity): string {
  return isCompletion(a) ? "Completion" : `${pointsTotal(a)} pts`;
}

/** Completion types are "marked"; point types are "graded". */
export function verbFor(a: Activity): "marked" | "graded" {
  return isCompletion(a) ? "marked" : "graded";
}

export interface ActivityStat {
  scope: Scope;
  /**
   * How many rows this activity is marked on.
   *
   * Scope decides it: a team activity is marked once per team, everything else
   * once per student. A `both` activity counts its INDIVIDUAL half here — it
   * also puts marks on team rows in the gradebook, but "9 of 16 graded" is a
   * statement about students, and one number cannot be both.
   */
  total: number;
  /** Marked and finished. */
  graded: number;
  /** Handed in, still waiting on a mark. */
  waiting: number;
  /** Handed in at all — graded plus waiting. */
  submitted: number;
  verb: "marked" | "graded";
  /** "9 of 16 graded · 5 waiting" — exactly what both views print. */
  caption: string;
}

const isScored = (r: Pick<ResultRow, "status">) => r.status === "scored";
const isIn = (r: Pick<ResultRow, "status">) =>
  r.status === "submitted" || r.status === "needs_review" || r.status === "scored";

/**
 * The one derived object. `checkIns` and `results` may cover the whole course;
 * this narrows to the activity itself.
 */
export function statFor(
  activity: Activity,
  checkIns: CheckIn[],
  results: ResultRow[],
  roster: Student[],
  teams: Team[],
): ActivityStat {
  const scope = SCOPE_OF[activity.type];
  const verb = verbFor(activity);
  const total = scope === "team" ? teams.length : roster.length;

  // A `both` activity owns two check-ins; its progress is the individual half.
  const kind = scope === "team" ? "team" : "individual";
  const ids = new Set(
    checkIns.filter((c) => c.activity_id === activity.id && c.kind === kind).map((c) => c.id),
  );
  const mine = results.filter((r) => ids.has(r.check_in_id));

  const graded = mine.filter(isScored).length;
  const submitted = mine.filter(isIn).length;
  const waiting = Math.max(submitted - graded, 0);

  const caption =
    total === 0
      ? `Nothing to ${verb}`
      : waiting > 0
        ? `${graded} of ${total} ${verb} · ${waiting} waiting`
        : `${graded} of ${total} ${verb}`;

  return { scope, total, graded, waiting, submitted, verb, caption };
}

/** "9 to grade" / "Nothing to grade" for a week heading or the sidebar. */
export function toGradeLabel(n: number): string {
  return n > 0 ? `${n} to grade` : "Nothing to grade";
}

/** Every activity in a week, plus the week's own outstanding count. */
export interface WeekGroup {
  week: number | null;
  /**
   * The course_weeks row behind this group, when there is one.
   *
   * Null for the unscheduled group, and for a week that exists only because an
   * activity points at it — those have no row to hang dates on, so the caller
   * has nothing to offer an editor for.
   */
  id: string | null;
  label: string;
  /**
   * What the week was NAMED, as opposed to what it is called. Null when it is
   * running on its number — `label` has already resolved that, and an editor
   * seeded from `label` would make the number look like typed text.
   */
  title: string | null;
  dates: string | null;
  activities: Activity[];
  waiting: number;
}

/**
 * One group per KNOWN week — the union of course_weeks and the weeks activities
 * name — not one group per week that already holds something.
 *
 * Grouping over activities alone is what made "New week" look like a dead
 * button: the insert succeeded and then had nowhere to appear, so a week only
 * became visible once it stopped being empty.
 */
export function groupByWeek(
  activities: Activity[],
  weeks: CourseWeek[],
  stats: Map<string, ActivityStat>,
): WeekGroup[] {
  const byWeek = new Map<number | null, Activity[]>();
  for (const w of weeks) if (!byWeek.has(w.week)) byWeek.set(w.week, []);
  for (const a of activities) {
    const key = a.week ?? null;
    const list = byWeek.get(key);
    if (list) list.push(a);
    else byWeek.set(key, [a]);
  }

  // course_weeks is unique on (course_id, week), so first wins is the only row.
  const rowFor = new Map<number, CourseWeek>();
  for (const w of weeks) if (!rowFor.has(w.week)) rowFor.set(w.week, w);

  const groups: WeekGroup[] = [];
  for (const [week, list] of byWeek) {
    const row = week == null ? undefined : rowFor.get(week);
    groups.push({
      week,
      id: row?.id ?? null,
      // The week's own title when it has one (0033), the number otherwise. The
      // number is still what orders the page and what activities point at — a
      // title only changes what it is CALLED.
      label:
        week == null
          ? "Unscheduled"
          : (row?.title?.trim() || `Week ${week}`),
      title: row?.title?.trim() || null,
      dates:
        week == null
          ? null
          : (row?.dates_label ?? list.find((a) => a.dates_label)?.dates_label ?? null),
      activities: list.slice().sort((x, y) => x.position - y.position),
      waiting: list.reduce((n, a) => n + (stats.get(a.id)?.waiting ?? 0), 0),
    });
  }

  // Newest week first; unscheduled last.
  groups.sort((a, b) => {
    if (a.week == null) return 1;
    if (b.week == null) return -1;
    return b.week - a.week;
  });
  return groups;
}

// ------------------------------------------------------------- the gradebook

export type CellState =
  | "graded"
  | "turned_in"
  | "late"
  | "complete"
  /** Marked, and the answer was no — not the same cell as an unmarked one. */
  | "not_complete"
  | "not_started"
  | "excused"
  | "discussing"
  | "na";

export interface Cell {
  state: CellState;
  /** The score to print, when the state is `graded`. */
  score: number | null;
  result: ResultRow | null;
  checkIn: CheckIn | null;
}

/**
 * One cell of the column view: an activity crossed with a subject.
 *
 * Scope decides whether the cell exists at all — a team activity has nothing to
 * say about a student row — and which of the activity's check-ins answers for
 * it. This is what lets one activity be one column while still marking both
 * team and student rows for `both` scope.
 */
export function cellFor(
  activity: Activity,
  subject: { kind: "student" | "team"; id: string },
  checkIns: CheckIn[],
  results: ResultRow[],
  liveWeek: number | null,
): Cell {
  const scope = SCOPE_OF[activity.type];
  const applies =
    scope === "both" ? true : scope === "team" ? subject.kind === "team" : subject.kind === "student";
  if (!applies) return { state: "na", score: null, result: null, checkIn: null };

  const wanted = subject.kind === "team" ? "team" : "individual";
  const checkIn =
    checkIns.find((c) => c.activity_id === activity.id && c.kind === wanted) ?? null;
  if (!checkIn) return { state: "na", score: null, result: null, checkIn: null };

  const result =
    results.find(
      (r) =>
        r.check_in_id === checkIn.id &&
        (subject.kind === "team" ? r.team_id === subject.id : r.student_id === subject.id),
    ) ?? null;

  return {
    state: stateOf(result, activity, liveWeek),
    score: result && result.status === "scored" && !result.is_ci ? result.score : null,
    result,
    checkIn,
  };
}

function stateOf(
  r: ResultRow | null,
  activity: Activity,
  liveWeek: number | null,
): CellState {
  if (!r || r.status === "none") {
    // Past its week with nothing handed in is late, not merely unstarted.
    const past = liveWeek != null && activity.week != null && activity.week < liveWeek;
    return past ? "late" : "not_started";
  }
  switch (r.status) {
    case "scored":
      if (!r.is_ci) return "graded";
      return isCompletionMet(r) ? "complete" : "not_complete";
    case "submitted":
      return "turned_in";
    case "needs_review":
      // No glyph of its own in the design; it is work that is in and unmarked.
      return "turned_in";
    case "discussing":
      return "discussing";
    case "excused":
      return "excused";
    case "draft":
      return "not_started";
    default:
      return "not_started";
  }
}

/**
 * Every student's percentage, computed once.
 *
 * The gradebook's Total column and the Teams tab's team averages both read this
 * array. Computing them separately produced numbers that disagreed.
 */
export function studentPercents(
  activities: Activity[],
  roster: Student[],
  checkIns: CheckIn[],
  results: ResultRow[],
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const s of roster) {
    let earned = 0;
    let possible = 0;
    for (const a of activities) {
      if (SCOPE_OF[a.type] === "team") continue;
      const ci = checkIns.find((c) => c.activity_id === a.id && c.kind === "individual");
      if (!ci) continue;
      const r = results.find((x) => x.check_in_id === ci.id && x.student_id === s.id);
      if (!r || r.status !== "scored") continue;
      // What the check-in is out of, which the data layer keeps equal to the
      // sum of the activity's questions. Reading the activity's own count x
      // points here would disagree with it the moment a question is re-pointed,
      // and max_points is also the number the student was shown.
      // A completion mark carries no points, so it cannot move a percentage.
      // Not even a Not complete: this figure is out of the points on offer, and
      // a completion check-in puts none on offer. Whether a missed completion
      // SHOULD cost a student here is a real question, but it is a change to
      // how everyone's total reads, not a bug — so it is not made in passing.
      if (r.is_ci) continue;
      earned += r.score ?? 0;
      possible += ci.max_points ?? pointsTotal(a);
    }
    out.set(s.id, possible > 0 ? Math.round((earned / possible) * 100) : null);
  }
  return out;
}

/** A team's average of its members' percentages, from the same array. */
export function teamPercent(
  memberIds: string[],
  percents: Map<string, number | null>,
): number | null {
  const vals = memberIds.map((id) => percents.get(id)).filter((v): v is number => v != null);
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/**
 * Where a row lands when it moves into a week: after everything already there.
 *
 * `position` orders activities WITHIN a week, so an activity arriving from
 * another week carries a number that means nothing here — two rows can share
 * it, and the order they come out in is then arbitrary.
 */
export function nextPositionIn(activities: Activity[], week: number | null): number {
  let top = -1;
  for (const a of activities) {
    if ((a.week ?? null) !== week) continue;
    if (a.position > top) top = a.position;
  }
  return top + 1;
}
