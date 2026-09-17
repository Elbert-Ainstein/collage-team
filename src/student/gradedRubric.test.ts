// The graded-rubric breakdown a student reads must be the marking the grading
// screen actually made: same mark-to-question resolution, same award reading.

import { describe, expect, it } from "vitest";
import type { RubricItem, SubmissionMark } from "@/checkins/types";
import type { PointedQuestion } from "@/faculty/model";
import { gradedRubric } from "./gradedRubric";

const activity = { id: "combo", question_count: 3 };

const q = (id: string, label: string, position: number, points: number | null): PointedQuestion =>
  ({ id, activity_id: "combo", label, position, created_at: "", points }) as PointedQuestion;

const item = (id: string, description: string, deduction: number, question_label: string | null): RubricItem =>
  ({ id, activity_id: "combo", row_index: 0, description, deduction, is_custom: false, question_label, created_at: "" }) as RubricItem;

const mark = (rubric_item_id: string, question_id: string | null, question_index: number): SubmissionMark =>
  ({ id: `m-${rubric_item_id}`, result_id: "r1", question_index, question_id, rubric_item_id, created_at: "" }) as SubmissionMark;

const questions = [q("q1", "1", 0, 3), q("q2", "2", 1, 2)];
const items = [
  item("i-full", "Complete and correct", 0, "1"),
  item("i-steps", "Major steps missing", 2, "1"),
  item("i-units", "Missed the units", 1, "2"),
];

describe("gradedRubric", () => {
  it("pairs each question with its picked criterion, as an award out of its worth", () => {
    const rows = gradedRubric(activity, questions, items, [
      mark("i-steps", "q1", 0),
      mark("i-units", "q2", 1),
    ]);
    expect(rows).toEqual([
      { key: "q1", label: "Q1", criterion: "Major steps missing", deduction: 2, worth: 3, award: 1 },
      { key: "q2", label: "Q2", criterion: "Missed the units", deduction: 1, worth: 2, award: 1 },
    ]);
  });

  it("a question nobody marked reads as full marks, with nothing taken off", () => {
    const rows = gradedRubric(activity, questions, items, [mark("i-units", "q2", 1)]);
    expect(rows[0]).toEqual({ key: "q1", label: "Q1", criterion: null, deduction: 0, worth: 3, award: 3 });
  });

  it("no marks at all is no breakdown, not a page of empty rows", () => {
    expect(gradedRubric(activity, questions, items, [])).toEqual([]);
  });

  it("a question with no worth of its own shows the deduction alone", () => {
    const rows = gradedRubric(activity, [q("q1", "1", 0, null)], items, [mark("i-steps", "q1", 0)]);
    expect(rows[0]).toMatchObject({ deduction: 2, worth: null, award: null });
  });

  it("finds a pre-0026 mark by position, but only when it names no question", () => {
    // The position-keyed mark on index 0 belongs to q1; the id-keyed one wins on q2.
    const rows = gradedRubric(activity, questions, items, [
      mark("i-steps", null, 0),
      mark("i-units", "q2", 0), // stale index: must NOT be found by position
    ]);
    expect(rows[0].criterion).toBe("Major steps missing");
    expect(rows[1].criterion).toBe("Missed the units");
  });

  it("synthesises questions for an activity that has no rows, keyed by position", () => {
    const rows = gradedRubric(activity, [], items, [mark("i-steps", null, 1)]);
    expect(rows.map((r) => r.label)).toEqual(["Q1", "Q2", "Q3"]);
    expect(rows[1]).toMatchObject({ criterion: "Major steps missing", deduction: 2, worth: null });
  });

  it("orders by position, not by the order the rows arrived", () => {
    const rows = gradedRubric(activity, [questions[1], questions[0]], items, [mark("i-steps", "q1", 0)]);
    expect(rows.map((r) => r.label)).toEqual(["Q1", "Q2"]);
  });
});
