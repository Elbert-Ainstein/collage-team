// What the Review tab lists: every row sent for review, spelled as the
// student will read it, and grouped by activity.

import { describe, expect, it } from "vitest";
import type { Activity } from "@/checkins/types";
import type { FacultyData } from "./FacultyApp";
import { reviewCount, reviewGroups } from "./reviewModel";

const combo = {
  id: "combo", course_id: "c1", week: 3, title: "Week 3 Combo", type: "combo",
  stage: 2, position: 1, completion: false, question_count: 6, points_total: 20,
} as unknown as Activity;
const tutorial = {
  id: "tut", course_id: "c1", week: 3, title: "Tutorial", type: "challenge",
  stage: 2, position: 0, completion: true, question_count: 1, points_total: 5,
} as unknown as Activity;
const team = {
  id: "trat", course_id: "c1", week: 2, title: "tRAT", type: "challenge",
  stage: 2, position: 0, completion: false, question_count: 2, points_total: 10,
} as unknown as Activity;

function data(over: Partial<FacultyData> = {}): FacultyData {
  return {
    activities: [combo, tutorial, team],
    roster: [
      { id: "s1", name: "Ada Lovelace", avatar_tint: "a" },
      { id: "s2", name: "Ben Bo", avatar_tint: null },
    ],
    teams: [{ id: "t1", name: "Team 1", members: [] }],
    checkIns: [
      { id: "ci-combo", activity_id: "combo", kind: "individual", max_points: 20 },
      { id: "ci-tut", activity_id: "tut", kind: "individual", max_points: null },
      { id: "ci-team", activity_id: "trat", kind: "team", max_points: 10 },
    ],
    results: [
      { id: "r1", check_in_id: "ci-combo", student_id: "s1", team_id: null, status: "needs_review", score: 18, is_ci: false, feedback: "Nice work" },
      { id: "r2", check_in_id: "ci-combo", student_id: "s2", team_id: null, status: "submitted", score: null, is_ci: false },
      { id: "r3", check_in_id: "ci-tut", student_id: "s1", team_id: null, status: "needs_review", score: null, is_ci: true, ci_met: false },
      { id: "r4", check_in_id: "ci-team", student_id: null, team_id: "t1", status: "needs_review", score: 7, is_ci: false },
      { id: "r5", check_in_id: "ci-team", student_id: null, team_id: "t1", status: "scored", score: 7, is_ci: false },
    ],
    ...over,
  } as unknown as FacultyData;
}

describe("reviewGroups", () => {
  it("groups what was sent for review by activity, newest week first", () => {
    const groups = reviewGroups(data());
    expect(groups.map((g) => g.activity.id)).toEqual(["tut", "combo", "trat"]);
    expect(groups.map((g) => g.rows.map((r) => r.subject.name))).toEqual([
      ["Ada Lovelace"],
      ["Ada Lovelace"],
      ["Team 1"],
    ]);
  });

  it("spells a completion as Complete or Not complete, sent as it was marked", () => {
    const tut = reviewGroups(data()).find((g) => g.activity.id === "tut")!;
    expect(tut.rows[0].grade).toBe("Not complete");
    expect(tut.rows[0].pending).toBe(false);
  });

  it("a combo reads out of the week's 30, and says when that is not final", () => {
    const g = reviewGroups(data()).find((a) => a.activity.id === "combo")!;
    // 18 of its own, the tutorial is sent but not released, so it adds nothing yet.
    expect(g.rows[0].grade).toBe("18 / 25 pts");
    expect(g.rows[0].pending).toBe(true);
    expect(g.rows[0].unmarked).toEqual(["Tutorial completion"]);

    const released = data({
      results: data().results.map((r) => (r.id === "r3" ? { ...r, status: "scored", ci_met: true } : r)),
    });
    const g2 = reviewGroups(released).find((a) => a.activity.id === "combo")!;
    expect(g2.rows[0].grade).toBe("23 / 25 pts");
    expect(g2.rows[0].pending).toBe(false);
  });

  it("a team row is the team's, out of the activity's points", () => {
    const g = reviewGroups(data()).find((a) => a.activity.id === "trat")!;
    expect(g.rows[0].kind).toBe("team");
    expect(g.rows[0].grade).toBe("7 / 10 pts");
  });

  it("counts what is handed in and not yet sent as still being marked", () => {
    const g = reviewGroups(data()).find((a) => a.activity.id === "combo")!;
    expect(g.stillMarking).toBe(1);
    expect(reviewGroups(data({ results: [] }))).toEqual([]);
  });

  it("counts every row waiting, for the badge", () => {
    expect(reviewCount(data().results)).toBe(3);
  });
});
