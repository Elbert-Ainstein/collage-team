// What survives a duplicate, and in what shape.
//
// The rubric is the reason this feature exists, and it is also the part that can
// go wrong silently: a criterion belongs to a question by its LABEL (0012), not
// by an id. Copy the questions and renumber, or copy the ladder and drop the
// labels, and the new activity looks complete while every criterion marks
// nothing. So both mappers are pinned here — including the ids they must NOT
// carry over, which is what would make an insert collide with the original.

import { describe, expect, it } from "vitest";
import type { ActivityQuestion, RubricItem } from "@/checkins/types";
import { copiedQuestions, copiedRubric } from "./facultyData";

function question(id: string, label: string, position: number): ActivityQuestion {
  return { id, activity_id: "old", label, position, created_at: "" };
}

function criterion(
  id: string,
  rowIndex: number,
  questionLabel: string | null,
  over: Partial<RubricItem> = {},
): RubricItem {
  return {
    id,
    activity_id: "old",
    row_index: rowIndex,
    description: `criterion ${id}`,
    deduction: 1,
    is_custom: false,
    question_label: questionLabel,
    created_at: "",
    ...over,
  };
}

describe("copiedQuestions", () => {
  it("keeps the labels and their order, and belongs to the new activity", () => {
    const rows = copiedQuestions("new", [
      question("q1", "1", 0),
      question("q2", "2", 1),
      question("q3", "2a", 2),
    ]);

    expect(rows).toEqual([
      { activity_id: "new", label: "1", position: 0 },
      { activity_id: "new", label: "2", position: 1 },
      { activity_id: "new", label: "2a", position: 2 },
    ]);
  });

  it("sorts by position rather than trusting the order it was handed", () => {
    const rows = copiedQuestions("new", [question("q2", "2", 1), question("q1", "1", 0)]);
    expect(rows.map((r) => r.label)).toEqual(["1", "2"]);
  });

  it("carries no id — the copy's rows are new rows", () => {
    const rows = copiedQuestions("new", [question("q1", "1", 0)]);
    expect(rows[0]).not.toHaveProperty("id");
    expect(rows[0]).not.toHaveProperty("created_at");
  });

  it("copies nothing when there is nothing to copy", () => {
    expect(copiedQuestions("new", [])).toEqual([]);
  });
});

describe("copiedRubric", () => {
  it("carries question_label verbatim, which is what attaches a criterion", () => {
    const rows = copiedRubric("new", [
      criterion("r1", 0, "1"),
      criterion("r2", 1, "2a"),
      // NULL is the shared ladder from before 0012 — it applies to every
      // question, and turning it into a label would attach it to just one.
      criterion("r3", 2, null),
    ]);

    expect(rows.map((r) => r.question_label)).toEqual(["1", "2a", null]);
    expect(rows.every((r) => r.activity_id === "new")).toBe(true);
  });

  it("keeps is_custom, so a copied row is still deletable if the original was", () => {
    const rows = copiedRubric("new", [
      criterion("r1", 0, "1", { is_custom: true }),
      criterion("r2", 1, "1", { is_custom: false }),
    ]);
    expect(rows.map((r) => r.is_custom)).toEqual([true, false]);
  });

  it("keeps row_index and the deduction each row is worth", () => {
    const rows = copiedRubric("new", [
      criterion("r2", 5, "1", { deduction: 2.5, description: "missed the units" }),
    ]);
    expect(rows[0].row_index).toBe(5);
    expect(rows[0].deduction).toBe(2.5);
    expect(rows[0].description).toBe("missed the units");
  });

  it("sorts by row_index, so the ladder reads in the same order", () => {
    const rows = copiedRubric("new", [criterion("r2", 1, "1"), criterion("r1", 0, "1")]);
    expect(rows.map((r) => r.row_index)).toEqual([0, 1]);
  });

  it("carries no id", () => {
    const rows = copiedRubric("new", [criterion("r1", 0, "1")]);
    expect(rows[0]).not.toHaveProperty("id");
    expect(rows[0]).not.toHaveProperty("created_at");
  });
});

describe("the two together", () => {
  it("leaves every criterion pointing at a question that came across with it", () => {
    const questions = [question("q1", "1", 0), question("q2", "2", 1)];
    const rubric = [
      criterion("r1", 0, "1"),
      criterion("r2", 1, "2"),
      criterion("r3", 2, null),
    ];

    const labels = new Set(copiedQuestions("new", questions).map((q) => q.label));
    const attached = copiedRubric("new", rubric).filter((r) => r.question_label !== null);

    expect(attached.every((r) => labels.has(r.question_label as string))).toBe(true);
  });
});
