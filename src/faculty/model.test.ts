import { describe, expect, it } from "vitest";
import {
  awardFits,
  awardForDeduction,
  awardOfItem,
  deductionForAward,
  groupByWeek,
  pointsTotal,
  questionCount,
  questionsFor,
  tallyQuestionPoints,
  worthOf,
} from "@/faculty/model";
import type { Activity, ActivityQuestion, CourseWeek, RubricItem } from "@/checkins/types";
import type { ActivityStat, PointedQuestion } from "@/faculty/model";

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

// A ladder is written as awards and stored as deductions. This conversion is
// the one every grade in the course goes through, so it is tested against the
// rubric it exists for: Kelly's combo, 20 points over six questions worth 3, 2,
// 3, 2, 5 and 5.
describe("awards and deductions", () => {
  const combo = { points_total: 20, question_count: 0, points_per_question: 0 };

  const pq = (label: string, position: number, points: number | null): PointedQuestion => ({
    id: `q${position}`,
    activity_id: "combo",
    label,
    position,
    created_at: "",
    points,
  });

  const kelly = [
    pq("CP1 At Home Effort", 0, 3),
    pq("CP1 Mark-up", 1, 2),
    pq("CP2 At Home Effort", 2, 3),
    pq("CP2 Mark-up", 3, 2),
    pq("Tutorial Screen 1", 4, 5),
    pq("Tutorial Screen 2", 5, 5),
  ];

  it("turns her At Home Effort ladder, out of 3, into deductions", () => {
    const worth = worthOf(combo, kelly[0]);
    expect(worth).toBe(3);
    expect([0, 1, 2, 3].map((award) => deductionForAward(worth, award))).toEqual([3, 2, 1, 0]);
  });

  it("turns the same +1 into a different deduction on a 2-point question", () => {
    // The whole reason the conversion takes the QUESTION's worth and not the
    // activity's: "+1" is a deduction of 2 on At Home Effort and of 1 on Mark-up.
    expect(deductionForAward(worthOf(combo, kelly[0]), 1)).toBe(2);
    expect(deductionForAward(worthOf(combo, kelly[1]), 1)).toBe(1);
  });

  it("keeps two rungs that award the same points, because she wrote two", () => {
    // Her Mark-up ladder has two +1 rungs — two different failures she scores
    // the same. They map to one deduction, which is harmless: a mark stores the
    // ROW it was picked from, never the value.
    const worth = worthOf(combo, kelly[1]);
    expect(deductionForAward(worth, 1)).toBe(deductionForAward(worth, 1));
    expect(awardForDeduction(worth, 1)).toBe(1);
  });

  it("reads back exactly, in both directions, including half points", () => {
    for (const worth of [2, 3, 5, 20]) {
      for (const award of [0, 0.5, 1, 2.5, worth]) {
        expect(awardForDeduction(worth, deductionForAward(worth, award))).toBe(award);
      }
    }
    // 3 - 0.1 is 2.9000000000000004 in floating point, and that is a deduction
    // that would be stored and shown.
    expect(deductionForAward(3, 0.1)).toBe(2.9);
  });

  it("scores a balanced rubric as the sum of what was awarded", () => {
    // score = total - sum(worth - award). The identity the whole design rests
    // on: when her six questions add up to 20, a submission scores its awards.
    const awards = [2, 1, 3, 2, 4, 5];
    const taken = kelly.reduce(
      (n, q, i) => n + deductionForAward(worthOf(combo, q), awards[i]),
      0,
    );
    expect(20 - taken).toBe(17);
    expect(17).toBe(awards.reduce((a, b) => a + b, 0));
  });

  it("leaves a question with no points behaving exactly as it does today", () => {
    // Every question in the course right now. Its criteria come off the
    // activity total, which is the number they have always come off.
    const unset = pq("1", 0, null);
    expect(worthOf(combo, unset)).toBe(20);
    expect(worthOf(combo, undefined)).toBe(20);
    // A row read from a database that has not run 0034 has no key at all.
    const preMigration = { id: "x", activity_id: "combo", label: "1", position: 0, created_at: "" };
    expect(worthOf(combo, preMigration)).toBe(20);
    // Which is to say: a deduction of 2 still means a deduction of 2.
    expect(deductionForAward(worthOf(combo, unset), 18)).toBe(2);
  });

  it("treats zero points as a real answer, not as unset", () => {
    expect(worthOf(combo, pq("1", 0, 0))).toBe(0);
    expect(deductionForAward(0, 0)).toBe(0);
  });

  it("refuses an award the question cannot give, rather than rounding it in", () => {
    expect(awardFits(3, 3)).toBe(true);
    expect(awardFits(3, 0)).toBe(true);
    expect(awardFits(3, 4)).toBe(false);
    expect(awardFits(3, -1)).toBe(false);
    expect(awardFits(3, Number.NaN)).toBe(false);
    // The conversion itself does not clamp: a caller checks first, so nothing
    // silently rewrites what she typed.
    expect(deductionForAward(3, 4)).toBe(-1);
  });

  it("reads a stored criterion under its own question", () => {
    const item = (questionLabel: string | null, deduction: number) =>
      ({ question_label: questionLabel, deduction }) as RubricItem;
    expect(awardOfItem(combo, item("CP1 At Home Effort", 2), kelly)).toBe(1);
    expect(awardOfItem(combo, item("CP1 Mark-up", 2), kelly)).toBe(0);
    // 0012's shared ladder belongs to no question, so it reads against the
    // activity total — the number it deducts from.
    expect(awardOfItem(combo, item(null, 2), kelly)).toBe(18);
    // A criterion whose question was renamed out from under it does the same.
    expect(awardOfItem(combo, item("gone", 2), kelly)).toBe(18);
  });
});

describe("questions against the activity total", () => {
  const combo = { points_total: 20, question_count: 0, points_per_question: 0 };
  const q = (position: number, points: number | null): PointedQuestion => ({
    id: `q${position}`,
    activity_id: "combo",
    label: String(position),
    position,
    created_at: "",
    points,
  });

  it("says nothing about an activity where no question is pointed", () => {
    const t = tallyQuestionPoints(combo, [q(0, null), q(1, null)]);
    expect(t.balance).toBe("unset");
    expect(t.note).toBeNull();
    expect(t.total).toBe(20);
  });

  it("says nothing when Kelly's six add up", () => {
    const t = tallyQuestionPoints(combo, [3, 2, 3, 2, 5, 5].map((p, i) => q(i, p)));
    expect(t.balance).toBe("balanced");
    expect(t.declared).toBe(20);
    expect(t.note).toBeNull();
  });

  it("tells her when they add up to less, and what that does to a score", () => {
    const t = tallyQuestionPoints(combo, [3, 2, 3, 2, 5].map((p, i) => q(i, p)));
    expect(t.balance).toBe("under");
    expect(t.declared).toBe(15);
    expect(t.note).toContain("still scores 5");
  });

  it("tells her when they add up to more", () => {
    const t = tallyQuestionPoints(combo, [3, 2, 3, 2, 5, 5, 5].map((p, i) => q(i, p)));
    expect(t.balance).toBe("over");
    expect(t.declared).toBe(25);
    expect(t.note).toContain("5 points still to lose");
  });

  it("names the half-typed rubric for what it is, rather than calling it short", () => {
    // Four of six entered. The sum is 10 out of 20 and that is not a mistake,
    // so it must not read as one.
    const half = [q(0, 3), q(1, 2), q(2, 3), q(3, 2), q(4, null), q(5, null)];
    const t = tallyQuestionPoints(combo, half);
    expect(t.balance).toBe("partial");
    expect(t.set).toBe(4);
    expect(t.unset).toBe(2);
  });

  it("never derives the total from the questions", () => {
    const t = tallyQuestionPoints(combo, [q(0, 100)]);
    expect(t.total).toBe(20);
  });
});
