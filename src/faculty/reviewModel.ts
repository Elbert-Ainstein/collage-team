// What is waiting for the instructor to release.
//
// A teaching fellow's finish line is "sent for review" (0038): their marks are
// on the row, the score is computed, and the student still reads "Turned in".
// This gathers every such row across the course into groups the Review tab can
// list and release, with the grade spelled the way the student will see it —
// so what the instructor checks is what goes out, not a number they have to
// convert in their head.

import type { Activity, CheckIn } from "@/checkins/types";
import { isCompletionMet } from "@/checkins/studentData";
import type { ResultRow } from "@/checkins/data";
import type { FacultyData } from "./FacultyApp";
import { comboTotal, pointsTotal } from "./model";

export interface ReviewRow {
  checkIn: CheckIn;
  kind: "individual" | "team";
  subject: { id: string; name: string; tint: string | null };
  result: ResultRow;
  /** "24 / 30 pts", "Complete" or "Not complete" — as the student will read it. */
  grade: string;
  /**
   * A combo whose week still has an unmarked completion. Its 30 is not final,
   * and releasing it now sends a total that will move.
   */
  pending: boolean;
  /** The unmarked pieces behind `pending`, by label, for the warning. */
  unmarked: string[];
}

export interface ReviewGroup {
  activity: Activity;
  rows: ReviewRow[];
  /** Handed in and not yet sent: still on a TF's desk. */
  stillMarking: number;
}

const pts = (n: number): string => `${n} ${n === 1 ? "pt" : "pts"}`;

function gradeOf(
  activity: Activity,
  r: ResultRow,
  kind: "individual" | "team",
  data: FacultyData,
): Pick<ReviewRow, "grade" | "pending" | "unmarked"> {
  if (r.is_ci) {
    return { grade: isCompletionMet(r) ? "Complete" : "Not complete", pending: false, unmarked: [] };
  }
  const own = r.score ?? 0;
  const week =
    kind === "individual" && r.student_id
      ? comboTotal(activity, r.student_id, own, data.activities, data.checkIns, data.results)
      : null;
  if (!week) {
    return { grade: `${own} / ${pts(pointsTotal(activity))}`, pending: false, unmarked: [] };
  }
  const unmarked = week.auto.filter((p) => p.earned == null).map((p) => p.label);
  return {
    grade: `${week.earned ?? own} / ${pts(week.outOf)}`,
    pending: unmarked.length > 0,
    unmarked,
  };
}

/**
 * Every row sent for review, grouped by activity, newest week first.
 *
 * Only activities that have something waiting appear: this is a to-do list,
 * and an empty group is a line to read past on the way to the work.
 */
export function reviewGroups(data: FacultyData): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>();
  const checkInById = new Map(data.checkIns.map((c) => [c.id, c]));
  const activityById = new Map(data.activities.map((a) => [a.id, a]));
  const studentById = new Map(data.roster.map((s) => [s.id, s]));
  const teamById = new Map(data.teams.map((t) => [t.id, t]));

  for (const r of data.results) {
    if (r.status !== "needs_review") continue;
    const checkIn = checkInById.get(r.check_in_id);
    const activity = checkIn ? activityById.get(checkIn.activity_id) : undefined;
    if (!checkIn || !activity) continue;
    // A team row belongs to the team, whatever the check-in calls itself.
    const kind: "individual" | "team" = r.team_id ? "team" : "individual";
    const subject = r.team_id
      ? teamById.get(r.team_id)
      : r.student_id
        ? studentById.get(r.student_id)
        : undefined;
    if (!subject) continue;
    const tint = "avatar_tint" in subject ? (subject.avatar_tint ?? null) : null;

    const row: ReviewRow = {
      checkIn,
      kind,
      subject: { id: subject.id, name: subject.name, tint },
      result: r,
      ...gradeOf(activity, r, kind, data),
    };
    const group = groups.get(activity.id) ?? { activity, rows: [], stillMarking: 0 };
    groups.set(activity.id, { ...group, rows: [...group.rows, row] });
  }

  const checkInsOf = (activityId: string) =>
    new Set(data.checkIns.filter((c) => c.activity_id === activityId).map((c) => c.id));

  return [...groups.values()]
    .map((g) => {
      const ids = checkInsOf(g.activity.id);
      const stillMarking = data.results.filter(
        (r) => ids.has(r.check_in_id) && r.status === "submitted",
      ).length;
      const rows = [...g.rows].sort((a, b) => a.subject.name.localeCompare(b.subject.name));
      return { ...g, rows, stillMarking };
    })
    .sort(
      (a, b) =>
        (b.activity.week ?? -1) - (a.activity.week ?? -1) ||
        a.activity.position - b.activity.position ||
        a.activity.title.localeCompare(b.activity.title),
    );
}

/** How many are waiting, for the tab's badge. */
export function reviewCount(results: Pick<ResultRow, "status">[]): number {
  return results.filter((r) => r.status === "needs_review").length;
}
