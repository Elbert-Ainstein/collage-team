import { describe, expect, it } from "vitest";
import { answersAtRisk, blankQuestion, draftsFrom, keyLabel, problemWith, summarizeProblems, toQuestionDraft, type DraftQuestion } from "./draft";

const mc = (over: Partial<DraftQuestion> = {}): DraftQuestion => ({
  ...blankQuestion(),
  stem: "Which way?",
  options: ["Up", "Down"],
  correct: 1,
  ...over,
});

describe("problemWith", () => {
  it("passes a finished question", () => {
    expect(problemWith(mc())).toBeNull();
  });

  it("says what is missing, in order of what she'd fix first", () => {
    expect(problemWith(mc({ stem: " " }))).toBe("needs a question");
    expect(problemWith(mc({ options: ["Up", ""] }))).toBe("has an empty option");
    expect(problemWith(mc({ correct: null }))).toBe("needs an answer");
  });

  it("checks a number's key and tolerance", () => {
    const n = { ...mc(), kind: "number" as const, answer: "19.6", tolerance: "" };
    expect(problemWith(n)).toBeNull();
    expect(problemWith({ ...n, answer: "about 20" })).toBe("needs an answer");
    expect(problemWith({ ...n, tolerance: "half" })).toBe("has a tolerance that isn’t a number");
    expect(problemWith({ ...n, tolerance: "-1" })).toBe("has a tolerance that isn’t a number");
  });

  it("holds an imported question until she picks its key", () => {
    expect(problemWith(mc({ source: { page: 3, needsPick: true } }))).toBe("needs an answer");
  });
});

describe("summarizeProblems", () => {
  it("lists every blocked question at once", () => {
    const qs = [mc(), mc({ correct: null }), mc({ options: ["", "x"] }), mc({ correct: null }), mc({ correct: null })];
    expect(summarizeProblems(qs)).toBe("Q2, Q4 and Q5 need an answer · Q3 has an empty option");
  });

  it("is quiet when nothing blocks, and asks for a question when there are none", () => {
    expect(summarizeProblems([mc()])).toBeNull();
    expect(summarizeProblems([])).toBe("Add a question");
  });
});

describe("saving", () => {
  it("turns text into the saved shape, keeping only what the kind uses", () => {
    const d = toQuestionDraft({ ...mc(), kind: "number", answer: "19.60", unit: " m/s ", tolerance: "" });
    expect(d).toMatchObject({ kind: "number", options: [], unit: "m/s", answer: 19.6, tolerance: 0, correct_option: null, accept: [] });
    expect(toQuestionDraft(mc()).correct_option).toBe(1);
  });

  it("round-trips through the saved rows", () => {
    const q = { ...mc(), kind: "expression" as const, accept: ["F/2"] };
    const saved = toQuestionDraft(q);
    const [back] = draftsFrom(
      [{ id: q.id, activity_id: "a", position: 0, kind: "expression", stem: saved.stem, options: [], unit: null, figure_path: null, created_at: "" }],
      [{ question_id: q.id, activity_id: "a", correct_option: null, answer: null, tolerance: null, accept: ["F/2"] }],
    );
    expect(keyLabel(back)).toBe("F/2");
    expect(back.id).toBe(q.id);
  });

  it("carries the explanation both ways, trimmed, and blank when there is none", () => {
    const q = mc({ explanation: "  Down, because gravity.  " });
    expect(toQuestionDraft(q).explanation).toBe("Down, because gravity.");
    // Always sent, so clearing the box removes the saved one.
    expect(toQuestionDraft(mc()).explanation).toBe("");
    const row = { id: q.id, activity_id: "a", position: 0, kind: "mc" as const, stem: "Which way?", options: ["Up", "Down"], unit: null, figure_path: null, created_at: "" };
    const [back] = draftsFrom([row], [], [{ question_id: q.id, activity_id: "a", body: "Down, because gravity." }]);
    expect(back.explanation).toBe("Down, because gravity.");
    expect(draftsFrom([row], [])[0].explanation).toBe("");
    expect(blankQuestion().explanation).toBe("");
  });

  it("gives every new question its own id", () => {
    expect(blankQuestion().id).not.toBe(blankQuestion().id);
  });
});

describe("answersAtRisk", () => {
  const saved = [mc(), mc(), { ...mc(), options: ["a", "b", "c"] }];
  const answered = new Map(saved.map((q) => [q.id, 4]));

  it("says nothing when the answers stay what they were", () => {
    const edited = saved.map((q) => ({ ...q, stem: `${q.stem}?`, correct: 0 }));
    expect(answersAtRisk(saved, edited, answered)).toEqual([]);
    expect(answersAtRisk(saved, [saved[0]], new Map())).toEqual([]);
  });

  it("names every question whose answers would be lost or scrambled", () => {
    const edited = [{ ...saved[1], kind: "number" as const }, { ...saved[2], options: ["a", "c"] }];
    expect(answersAtRisk(saved, edited, answered)).toEqual([
      "Q1 is removed, with its 4 answers.",
      "Q2 changes type; its 4 answers were given as the old one.",
      "Q3 loses an option; its 4 answers may now point at a different one.",
    ]);
  });
});
