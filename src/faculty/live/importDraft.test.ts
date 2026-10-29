import { describe, expect, it } from "vitest";
import type { LiveDraft } from "@/assistant/liveDraft";
import { blankQuestion, problemWith, summarizeProblems } from "./draft";
import { draftToQuestions, leftOutLine, withImported } from "./importDraft";

const draft: LiveDraft = {
  title: "Module 9",
  items: [
    { page: 2, kind: "mc", stem: "Which way?", options: ["Up", "Down", "Left"], correctOption: 1, needsPick: false },
    { page: 3, kind: "number", stem: "How fast?", answer: "9.8", unit: "m/s", tolerance: "0.1", needsPick: false },
    { page: 4, kind: "expression", stem: "Tension?", accept: ["F/2", "x".repeat(200)], needsPick: false },
    {
      page: 5,
      kind: "mc",
      stem: "Which arrow?",
      options: ["a", "b"],
      correctOption: null,
      figure: { page: 5, box: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 } },
      note: "Depends on the figure",
      needsPick: true,
    },
  ],
  leftOut: [{ page: 7, kind: "ranking", reason: "Rankings can't be one answer" }],
};

describe("draftToQuestions", () => {
  const out = draftToQuestions(draft);

  it("keeps each kind's key as a suggestion she can edit", () => {
    expect(out[0].question).toMatchObject({ kind: "mc", options: ["Up", "Down", "Left"], correct: 1 });
    expect(out[1].question).toMatchObject({ kind: "number", answer: "9.8", unit: "m/s", tolerance: "0.1" });
    expect(problemWith(out[0].question)).toBeNull();
    expect(problemWith(out[1].question)).toBeNull();
  });

  it("drops accepted forms the checker could never match", () => {
    expect(out[2].question.accept).toEqual(["F/2"]);
  });

  it("holds an unkeyed question until she picks, and keeps its figure to crop", () => {
    expect(out[3].question.source).toMatchObject({ page: 5, needsPick: true, note: "Depends on the figure" });
    expect(out[3].figure).toEqual({ page: 5, box: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 } });
    expect(summarizeProblems(out.map((o) => o.question))).toBe("Q4 needs an answer");
  });

  it("gives every drafted question its own id", () => {
    expect(new Set(out.map((o) => o.question.id)).size).toBe(4);
  });
});

describe("withImported", () => {
  it("replaces the blank question a new activity starts with, and keeps written ones", () => {
    const imported = draftToQuestions(draft).map((o) => o.question);
    expect(withImported([blankQuestion()], imported)).toHaveLength(4);
    const written = { ...blankQuestion(), stem: "Mine" };
    expect(withImported([written], imported)[0].stem).toBe("Mine");
    const explained = { ...blankQuestion(), explanation: "Mine" };
    expect(withImported([explained], imported)[0].explanation).toBe("Mine");
  });
});

describe("leftOutLine", () => {
  it("says what was left out, by page", () => {
    expect(leftOutLine(draft.leftOut)).toBe("p.7 ranking");
    expect(leftOutLine([])).toBeNull();
  });
});

describe("titleFromFileName", () => {
  it("makes a title out of the file's name when the PDF has none", async () => {
    const { titleFromFileName } = await import("./ImportCard");
    expect(titleFromFileName("AP50 F2025 S2026 Readiness Assurance Module 9.pdf")).toBe("AP50 F2025 S2026 Readiness Assurance Module 9");
    expect(titleFromFileName("module_9-quiz.PDF")).toBe("module 9 quiz");
    expect(titleFromFileName(".pdf")).toBeNull();
  });
});
