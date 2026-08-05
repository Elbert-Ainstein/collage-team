import { describe, expect, it } from "vitest";
import { groupByWeek, pointsTotal, questionCount, questionsFor } from "@/faculty/model";
import type { Activity, ActivityQuestion, CourseWeek } from "@/checkins/types";
import type { ActivityStat } from "@/faculty/model";

const act = (id: string, week: number | null): Activity =>
  ({ id, week, position: 0, dates_label: null, type: "combo" } as unknown as Activity);
const wk = (week: number, dates: string | null = null): CourseWeek =>
  ({ id: `w${week}`, course_id: "c", week, dates_label: dates, created_at: "" });
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
});

// What an activity is out of decides every score released from it, so the
// fallback matters as much as the sum: every activity authored before questions
// became rows has a count and no rows, and must keep scoring exactly as it did.
describe("what an activity is out of", () => {
  const shaped = { question_count: 10, points_per_question: 5 };
  const q = (
    activity_id: string,
    label: string,
    points: number,
    position: number,
  ): ActivityQuestion => ({
    id: `${activity_id}-${label}`,
    activity_id,
    label,
    points,
    position,
    created_at: "",
  });

  it("multiplies the old shape when the activity has no questions", () => {
    expect(pointsTotal(shaped)).toBe(50);
    expect(pointsTotal(shaped, [])).toBe(50);
  });

  it("sums the questions once it has them, whatever they are each worth", () => {
    const qs = [q("a", "1", 5, 0), q("a", "2", 10, 1), q("a", "3", 1, 2)];
    expect(pointsTotal(shaped, qs)).toBe(16);
  });

  it("counts sub-questions as questions — each one is separately marked", () => {
    const qs = [q("a", "1", 5, 0), q("a", "1a", 2, 1), q("a", "2", 5, 2)];
    expect(questionCount({ ...shaped } as Activity, qs)).toBe(3);
    expect(questionCount({ ...shaped } as Activity, [])).toBe(10);
  });

  it("reads one activity's questions in the order they are asked", () => {
    const all = [q("b", "2", 5, 1), q("a", "1", 5, 0), q("b", "1", 5, 0)];
    expect(questionsFor("b", all).map((x) => x.label)).toEqual(["1", "2"]);
    expect(questionsFor("a", all)).toHaveLength(1);
  });

  it("is zero for an activity whose questions were all removed", () => {
    // Not the stale product: the rows are the truth once any exist, and an
    // empty list has to be distinguishable from "never had any".
    expect(pointsTotal(shaped, [])).toBe(50);
    expect(pointsTotal({ question_count: 1, points_per_question: 0 }, [])).toBe(0);
  });
});
