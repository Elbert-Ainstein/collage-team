// The checks either side of the explanation model: what the browser may send,
// how the question reads to the model, and what comes back.

import { describe, expect, it } from "vitest";
import { EXPLAIN_LIMITS, type ExplainQuestion } from "../liveExplain";
import { describeQuestion, LIVE_EXPLAIN_PROMPT, parseExplainQuestion, parseExplanation } from "./liveExplain";

const base: ExplainQuestion = {
  kind: "mc",
  stem: "Which way does friction act on a box sliding right?",
  options: ["Left", "Right"],
  correctOption: 0,
  answer: null,
  tolerance: null,
  unit: null,
  accept: [],
  figure: false,
};

describe("parseExplainQuestion", () => {
  it("takes a whole multiple-choice question", () => {
    expect(parseExplainQuestion(base)).toEqual({ ok: true, value: base });
  });

  it("refuses a question without a stem, a type, or a key", () => {
    expect(parseExplainQuestion({ ...base, stem: "  " }).ok).toBe(false);
    expect(parseExplainQuestion({ ...base, kind: "essay" }).ok).toBe(false);
    expect(parseExplainQuestion({ ...base, correctOption: null }).ok).toBe(false);
    expect(parseExplainQuestion({ ...base, correctOption: 1.5 }).ok).toBe(false);
    expect(parseExplainQuestion({ ...base, kind: "number", answer: null }).ok).toBe(false);
    expect(parseExplainQuestion({ ...base, kind: "number", answer: Number.NaN }).ok).toBe(false);
    expect(parseExplainQuestion({ ...base, kind: "expression", accept: [] }).ok).toBe(false);
    expect(parseExplainQuestion(null).ok).toBe(false);
  });

  it("refuses options that are empty, too few, too many, or too long", () => {
    expect(parseExplainQuestion({ ...base, options: ["Left", ""] }).ok).toBe(false);
    expect(parseExplainQuestion({ ...base, options: ["Left"] }).ok).toBe(false);
    expect(parseExplainQuestion({ ...base, options: Array(9).fill("x") }).ok).toBe(false);
    expect(parseExplainQuestion({ ...base, options: ["x".repeat(EXPLAIN_LIMITS.option + 1), "y"] }).ok).toBe(false);
    expect(parseExplainQuestion({ ...base, stem: "x".repeat(EXPLAIN_LIMITS.stem + 1) }).ok).toBe(false);
  });

  it("refuses a negative tolerance and an odd figure flag", () => {
    expect(parseExplainQuestion({ kind: "number", stem: "v?", answer: 3, tolerance: -1 }).ok).toBe(false);
    expect(parseExplainQuestion({ ...base, figure: "yes" }).ok).toBe(false);
  });
});

describe("describeQuestion", () => {
  it("letters the options and names the right one", () => {
    const text = describeQuestion({ ...base, figure: true });
    expect(text).toContain("A. Left\nB. Right");
    expect(text).toContain("Correct answer: A");
    expect(text).toContain("figure you are not shown");
  });

  it("gives a number its unit and tolerance, and an expression its forms", () => {
    const n = describeQuestion({ ...base, kind: "number", options: [], correctOption: null, answer: 19.6, tolerance: 0.1, unit: "m/s" });
    expect(n).toContain("Correct answer: 19.6 m/s (anything within ±0.1 m/s counts)");
    expect(n).not.toContain("Options:");
    const e = describeQuestion({ ...base, kind: "expression", options: [], correctOption: null, accept: ["F/2", "0.5F"] });
    expect(e).toContain("F/2; 0.5F");
  });

  it("asks for a short plain-text explanation that agrees with the key", () => {
    expect(LIVE_EXPLAIN_PROMPT).toMatch(/2 to 5/);
    expect(LIVE_EXPLAIN_PROMPT).toMatch(/no headings/i);
    expect(LIVE_EXPLAIN_PROMPT).toMatch(/Never disagree/);
  });
});

describe("parseExplanation", () => {
  it("takes out stray headings and bold marks", () => {
    expect(parseExplanation({ explanation: "## Why\n**Friction** opposes sliding, so it points left." })).toEqual({
      ok: true,
      value: "Friction opposes sliding, so it points left.",
    });
  });

  it("refuses nothing, blank, and too long", () => {
    expect(parseExplanation({}).ok).toBe(false);
    expect(parseExplanation({ explanation: "# Only a heading" }).ok).toBe(false);
    expect(parseExplanation({ explanation: "x".repeat(EXPLAIN_LIMITS.explanation + 1) }).ok).toBe(false);
  });
});
