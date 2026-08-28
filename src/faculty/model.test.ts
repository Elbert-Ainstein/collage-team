import { describe, expect, it } from "vitest";
import { groupByWeek, pointsTotal, questionCount, questionsFor } from "@/faculty/model";
import type { Activity, ActivityQuestion, CourseWeek } from "@/checkins/types";
import type { ActivityStat } from "@/faculty/model";

const act = (id: string, week: number | null): Activity =>
  ({ id, week, position: 0, dates_label: null, type: "combo" } as unknown as Activity);
const wk = (week: number, dates: string | null = null, title: string | null = null): CourseWeek =>
  ({ id: `w${week}`, course_id: "c", week, title, dates_label: dates, created_at: "" });
const stats = new Map<string, ActivityStat>();

describe("week groups", () => {
  it("shows a week that has no activities in it", () => {
    const g = groupByWeek([act("a", 1)], [wk(1), wk(2)], stats);
    expect(g.map((x) => x.label)).toEqual(["Week 2", "Week 1"]);
    expect(g[0].activities).toHaveLength(0);
  });

  it("still shows a week that exists only because an activity names it", () => {
    // The live database: course_weeks empty, activities on weeks 1-3.
    const g = groupByWeek([act("a", 1), act("b", 3)], [], stats);
    expect(g.map((x) => x.label)).toEqual(["Week 3", "Week 1"]);
  });

  it("gives a week its id so it can be dated, and null when there is no row", () => {
    const g = groupByWeek([act("a", 2)], [wk(1)], stats);
    expect(g.find((x) => x.week === 1)?.id).toBe("w1");
    expect(g.find((x) => x.week === 2)?.id).toBeNull();
  });

  it("keeps unscheduled activities last", () => {
    const g = groupByWeek([act("a", null), act("b", 2)], [wk(2)], stats);
    expect(g.map((x) => x.label)).toEqual(["Week 2", "Unscheduled"]);
  });

  // 0033. The number still orders the page and still says where an activity
  // lives; a title only changes what the week is CALLED.
  it("calls a week by its title when it has one", () => {
    const g = groupByWeek([act("a", 3)], [wk(3, null, "Momentum")], stats);
    expect(g[0].label).toBe("Momentum");
    expect(g[0].title).toBe("Momentum");
    expect(g[0].week).toBe(3);
  });

  it("falls back to the number, and reports no title, when there is none", () => {
    const g = groupByWeek([act("a", 3)], [wk(3)], stats);
    expect(g[0].label).toBe("Week 3");
    expect(g[0].title).toBeNull();
  });

  // A project that has not run 0033 has no column, so the field arrives
  // undefined rather than null. It must read as "no title", not crash.
  it("survives a database without the title column", () => {
    const noColumn = { id: "w4", course_id: "c", week: 4, dates_label: null, created_at: "" } as CourseWeek;
    const g = groupByWeek([act("a", 4)], [noColumn], stats);
    expect(g[0].label).toBe("Week 4");
    expect(g[0].title).toBeNull();
  });

  // Whitespace is not a name. Seeding an editor from it would show an empty box
  // over a week whose heading had stopped saying anything.
  it("treats a whitespace title as no title", () => {
    const g = groupByWeek([act("a", 5)], [wk(5, null, "   ")], stats);
    expect(g[0].label).toBe("Week 5");
    expect(g[0].title).toBeNull();
  });

  it("renaming a week does not move it — the number still orders the page", () => {
    const g = groupByWeek([act("a", 1), act("b", 2)], [wk(1, null, "Zebra"), wk(2, null, "Alpha")], stats);
    expect(g.map((x) => x.label)).toEqual(["Alpha", "Zebra"]);
    expect(g.map((x) => x.week)).toEqual([2, 1]);
  });
});

// What an activity is out of decides every score released from it.
describe("what an activity is out of", () => {
  const q = (activity_id: string, label: string, position: number): ActivityQuestion => ({
    id: `${activity_id}-${label}`,
    activity_id,
    label,
    position,
    created_at: "",
  });

  it("is the one number faculty chose", () => {
    expect(pointsTotal({ points_total: 40, question_count: 10, points_per_question: 5 })).toBe(40);
  });

  it("is zero when that is what they chose — not a fallback to the old product", () => {
    expect(pointsTotal({ points_total: 0, question_count: 10, points_per_question: 5 })).toBe(0);
  });

  it("falls back to the old product only for a row loaded before the column existed", () => {
    // A client holding a pre-0014 row. The migration backfills exactly this
    // product, so the two can never disagree about an existing activity.
    const legacy = { question_count: 10, points_per_question: 5 } as unknown as Parameters<
      typeof pointsTotal
    >[0];
    expect(pointsTotal(legacy)).toBe(50);
  });

  it("counts questions as structure, with no bearing on the points", () => {
    const qs = [q("a", "1", 0), q("a", "1a", 1), q("a", "2", 2)];
    const activity = { question_count: 10 } as Activity;
    expect(questionCount(activity, qs)).toBe(3);
    expect(questionCount(activity, [])).toBe(10);
  });

  it("reads one activity's questions in the order they are asked", () => {
    const all = [q("b", "2", 1), q("a", "1", 0), q("b", "1", 0)];
    expect(questionsFor("b", all).map((x) => x.label)).toEqual(["1", "2"]);
    expect(questionsFor("a", all)).toHaveLength(1);
  });
});
