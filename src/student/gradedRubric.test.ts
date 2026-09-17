// The graded-rubric breakdown a student reads must be the marking the grading
// screen actually made: same mark-to-question resolution, same award reading,
// same ladder per question.

import { describe, expect, it } from "vitest";
import type { RubricItem, SubmissionMark } from "@/checkins/types";
import type { PointedQuestion } from "@/faculty/model";
import { gradedQuestions } from "./gradedRubric";

const activity = { id: "combo", question_count: 3, points_total: 20, points_per_question: 0 };

const q = (id: string, label: string, position: number, points: number | null): PointedQuestion =>
  ({ id, activity_id: "combo", label, position, created_at: "", points }) as PointedQuestion;

const item = (id: string, description: string, deduction: number, question_label: string | null, row_index = 0): RubricItem =>
  ({ id, activity_id: "combo", row_index, description, deduction, is_custom: false, question_label, created_at: "" }) as RubricItem;

const mark = (rubric_item_id: string, question_id: string | null, question_index: number): SubmissionMark =>
  ({ id: `m-${rubric_item_id}`, result_id: "r1", question_index, question_id, rubric_item_id, created_at: "" }) as SubmissionMark;

const questions = [q("q1", "Problem 1: At Home Effort", 0, 3), q("q2", "2", 1, 2)];
const items = [
  item("i-full", "Complete and correct", 0, "Problem 1: At Home Effort", 2),
  item("i-steps", "Major steps missing", 2, "Problem 1: At Home Effort", 0),
  item("i-units", "Missed the units", 1, "2", 0),
];

describe("gradedQuestions", () => {
  it("pairs each question with its picked rung, as an award out of its worth", () => {
    const rows = gradedQuestions(activity, questions, items, [
      mark("i-steps", "q1", 0),
      mark("i-units", "q2", 1),
    ]);
    expect(rows.map((r) => [r.label, r.award, r.worth, r.picked?.id])).toEqual([
      ["Problem 1: At Home Effort", 1, 3, "i-steps"],
      ["Question 2", 1, 2, "i-units"],
    ]);
  });

  it("carries the question's whole ladder, in rubric order, with the pick flagged", () => {
    const rows = gradedQuestions(activity, questions, items, [mark("i-steps", "q1", 0)]);
    // Only q1's rungs, sorted by row_index, awards read under q1's worth of 3.
    expect(rows[0].ladder.map((r) => [r.item.id, r.award, r.picked])).toEqual([
      ["i-steps", 1, true],
      ["i-full", 3, false],
    ]);
  });

  it("a shared pre-0012 rung appears on every question, read against the activity total", () => {
    const shared = item("i-shared", "Handed in on time", 0, null, 9);
    const rows = gradedQuestions(activity, questions, [...items, shared], [mark("i-steps", "q1", 0)]);
    expect(rows[0].ladder.map((r) => r.item.id)).toContain("i-shared");
    expect(rows[1].ladder.map((r) => r.item.id)).toContain("i-shared");
    expect(rows[0].ladder.find((r) => r.item.id === "i-shared")?.award).toBe(20);
  });

  it("a question nobody marked reads as full marks, with no rung picked", () => {
    const rows = gradedQuestions(activity, questions, items, [mark("i-units", "q2", 1)]);
    expect(rows[0]).toMatchObject({ picked: null, deduction: 0, worth: 3, award: 3 });
  });

  it("no marks at all is no breakdown, not a page of empty rows", () => {
    expect(gradedQuestions(activity, questions, items, [])).toEqual([]);
  });

  it("finds a pre-0026 mark by position, but only when it names no question", () => {
    const rows = gradedQuestions(activity, questions, items, [
      mark("i-steps", null, 0),
      mark("i-units", "q2", 0), // stale index: must NOT be found by position
    ]);
    expect(rows[0].picked?.id).toBe("i-steps");
    expect(rows[1].picked?.id).toBe("i-units");
  });

  it("synthesises questions for an activity that has no rows, keyed by position", () => {
    const rows = gradedQuestions(activity, [], items, [mark("i-steps", null, 1)]);
    expect(rows.map((r) => r.label)).toEqual(["Question 1", "Question 2", "Question 3"]);
    expect(rows[1]).toMatchObject({ deduction: 2, worth: null, award: null });
    expect(rows[1].picked?.id).toBe("i-steps");
  });

  it("orders by position, not by the order the rows arrived", () => {
    const rows = gradedQuestions(activity, [questions[1], questions[0]], items, [mark("i-steps", "q1", 0)]);
    expect(rows.map((r) => r.key)).toEqual(["q1", "q2"]);
  });
});
