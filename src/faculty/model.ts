// The derived numbers for the faculty Activities screens.
//
// Everything here is computed, never stored. The rule the design is emphatic
// about: the row view's progress caption and the column view's header count are
// THE SAME NUMBER, so they come from one function. Computing them separately is
// how they came to disagree in an earlier pass.

import {
  isCompletion,
  SCOPE_OF,
  type Activity,
  type ActivityQuestion,
  type CheckIn,
  type CheckInResult,
  type CourseWeek,
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

const isScored = (r: CheckInResult) => r.status === "scored";
const isIn = (r: CheckInResult) =>
  r.status === "submitted" || r.status === "needs_review" || r.status === "scored";

/**
 * The one derived object. `checkIns` and `results` may cover the whole course;
 * this narrows to the activity itself.
 */
export function statFor(
  activity: Activity,
  checkIns: CheckIn[],
  results: CheckInResult[],
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
      label: week == null ? "Unscheduled" : `Week ${week}`,
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
  | "not_started"
  | "excused"
  | "discussing"
  | "na";

export interface Cell {
  state: CellState;
  /** The score to print, when the state is `graded`. */
  score: number | null;
  result: CheckInResult | null;
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
  results: CheckInResult[],
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
  r: CheckInResult | null,
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
      return r.is_ci ? "complete" : "graded";
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
  results: CheckInResult[],
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
      // A completion mark carries no points, so it cannot move a percentage.
      if (r.is_ci) continue;
      earned += r.score ?? 0;
      // What the check-in is out of, which the data layer keeps equal to the
      // sum of the activity's questions. Reading the activity's own count x
      // points here would disagree with it the moment a question is re-pointed,
      // and max_points is also the number the student was shown.
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
