import { describe, expect, it } from "vitest";
import { groupByWeek } from "@/faculty/model";
import type { Activity, CourseWeek } from "@/checkins/types";
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
