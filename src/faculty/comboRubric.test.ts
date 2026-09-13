import { describe, expect, it } from "vitest";
import { COMBO_TEMPLATE, templateDeclared } from "@/faculty/comboRubric";
import { awardForDeduction, deductionForAward } from "@/faculty/model";

// This template is written once and then graded against eighty times a week, so
// what is checked here is arithmetic, not wording: the six questions adding to
// what the activity is set to, and every rung converting to a deduction that
// reads back as the award it was written as.

describe("the standard combo rubric", () => {
  it("adds up to what it sets the combo to", () => {
    expect(templateDeclared(COMBO_TEMPLATE)).toBe(COMBO_TEMPLATE.pointsTotal);
    expect(COMBO_TEMPLATE.pointsTotal).toBe(20);
  });

  // Two challenge problems, each marked for effort and mark-up, then the two
  // tutorial screens out of 5. The week's Amplify and Challenge completions
  // are NOT here — comboTotal adds those on from their own pages, to make 30.
  it("is the six questions the combo itself marks, worth 3, 2, 3, 2, 5, 5", () => {
    expect(COMBO_TEMPLATE.questions.map((q) => [q.label, q.points])).toEqual([
      ["Challenge Problem 1: At Home Effort", 3],
      ["Challenge Problem 1: Mark-up", 2],
      ["Challenge Problem 2: At Home Effort", 3],
      ["Challenge Problem 2: Mark-up", 2],
      ["Tutorial Screen 1", 5],
      ["Tutorial Screen 2", 5],
    ]);
  });

  // The rung says "+1"; the row stores a deduction. A rung that does not
  // survive the round trip is a mark worth something other than what it reads.
  it("stores every rung as a deduction that reads back as its award", () => {
    for (const q of COMBO_TEMPLATE.questions) {
      for (const rung of q.rungs) {
        const stored = deductionForAward(q.points, rung.award);
        expect(stored).toBeGreaterThanOrEqual(0);
        expect(stored).toBeLessThanOrEqual(q.points);
        expect(awardForDeduction(q.points, stored)).toBe(rung.award);
      }
    }
  });

  // The same "+1" is a deduction of 2 on the 3-point question and of 1 on the
  // 2-point one, which is the whole reason a question carries its own worth.
  it("reads the same award differently under different questions", () => {
    const effort = COMBO_TEMPLATE.questions[0];
    const markup = COMBO_TEMPLATE.questions[1];
    expect(deductionForAward(effort.points, 1)).toBe(2);
    expect(deductionForAward(markup.points, 1)).toBe(1);
  });

  // Two rungs award +1 on purpose — two different ways of falling short that
  // she scores the same. A mark stores the ROW, so they stay distinguishable.
  it("keeps both of the Mark-up ladder's +1 rungs", () => {
    const markup = COMBO_TEMPLATE.questions[1];
    expect(markup.rungs.filter((r) => r.award === 1)).toHaveLength(2);
    expect(new Set(markup.rungs.map((r) => r.description)).size).toBe(markup.rungs.length);
  });

  it("gives every rung a top and a bottom rung to sit between", () => {
    for (const q of COMBO_TEMPLATE.questions) {
      if (!q.rungs.length) continue;
      expect(Math.min(...q.rungs.map((r) => r.award))).toBe(0);
      expect(Math.max(...q.rungs.map((r) => r.award))).toBe(q.points);
    }
  });

  // Every question arrives with something to pick: a question with no rungs
  // is one the grader cannot mark until somebody writes them.
  it("gives every question a ladder", () => {
    for (const q of COMBO_TEMPLATE.questions) expect(q.rungs.length).toBeGreaterThan(0);
  });

  // The two screens are marked against one ladder, six rungs from 0 to 5.
  it("marks both tutorial screens on the same six-rung ladder", () => {
    const [s1, s2] = COMBO_TEMPLATE.questions.slice(4);
    expect(s1.rungs).toEqual(s2.rungs);
    expect(s1.rungs.map((r) => r.award)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("gives no two questions the same name, which the database forbids", () => {
    const labels = COMBO_TEMPLATE.questions.map((q) => q.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
