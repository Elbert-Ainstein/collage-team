import { describe, expect, it } from "vitest";
import {
  canonicalAnswer,
  expressionsEquivalent,
  expressionVerdicts,
  isRight,
  letterIndex,
  normalizeNumber,
  optionLetter,
} from "./answers";
import type { LiveKey, LiveQuestion } from "./types";

const q = (over: Partial<LiveQuestion>): LiveQuestion => ({
  id: "q",
  activity_id: "a",
  position: 0,
  kind: "mc",
  stem: "",
  options: [],
  unit: null,
  figure_path: null,
  created_at: "",
  ...over,
});
const k = (over: Partial<LiveKey>): LiveKey => ({
  question_id: "q",
  activity_id: "a",
  correct_option: null,
  answer: null,
  tolerance: null,
  accept: [],
  ...over,
});

describe("normalizeNumber", () => {
  it("gives one spelling for the same number", () => {
    expect(normalizeNumber("0.30")).toBe("0.3");
    expect(normalizeNumber(" .3 ")).toBe("0.3");
    expect(normalizeNumber("3e-1")).toBe("0.3");
    expect(normalizeNumber("1,200")).toBe("1200");
    expect(normalizeNumber("-0")).toBe("0");
  });

  it("refuses what isn't a number", () => {
    expect(normalizeNumber("")).toBeNull();
    expect(normalizeNumber("abc")).toBeNull();
    expect(normalizeNumber("1/3")).toBeNull();
    expect(normalizeNumber("Infinity")).toBeNull();
    expect(normalizeNumber("4.37*10^-3")).toBeNull();
  });

  // score_live checks numbers with this pattern before casting; anything the
  // app saves has to pass it, or a right answer would score as wrong.
  it("always produces something the database reads as a number", () => {
    const sql = /^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?$/;
    for (const raw of ["0.3", "1e21", "-1e-7", "12345678901234567890", "0.000001", "5", "-2.5"]) {
      const n = normalizeNumber(raw);
      expect(n).not.toBeNull();
      expect(sql.test(n!)).toBe(true);
    }
  });
});

describe("letters", () => {
  it("round-trips", () => {
    expect(optionLetter(0)).toBe("A");
    expect(optionLetter(7)).toBe("H");
    expect(letterIndex("c")).toBe(2);
    expect(letterIndex("Z")).toBeNull();
  });
});

describe("canonicalAnswer", () => {
  it("normalizes per kind", () => {
    expect(canonicalAnswer("mc", " b ")).toBe("B");
    expect(canonicalAnswer("mc", "Q")).toBeNull();
    expect(canonicalAnswer("number", "0.30")).toBe("0.3");
    expect(canonicalAnswer("number", "x")).toBeNull();
    expect(canonicalAnswer("expression", "  F  /  2 ")).toBe("F / 2");
    expect(canonicalAnswer("expression", "   ")).toBeNull();
  });
});

describe("isRight (multiple choice and number)", () => {
  it("multiple choice matches the letter", () => {
    expect(isRight(q({ kind: "mc" }), k({ correct_option: 1 }), "B")).toBe(true);
    expect(isRight(q({ kind: "mc" }), k({ correct_option: 1 }), "C")).toBe(false);
    expect(isRight(q({ kind: "mc" }), k({ correct_option: null }), "A")).toBe(false);
  });

  it("number is right within the tolerance, inclusive", () => {
    const qq = q({ kind: "number" });
    const kk = k({ answer: 19.6, tolerance: 0.5 });
    expect(isRight(qq, kk, "20.1")).toBe(true);
    expect(isRight(qq, kk, "19.1")).toBe(true);
    expect(isRight(qq, kk, "20.2")).toBe(false);
    expect(isRight(qq, k({ answer: 0.3, tolerance: null }), "0.3")).toBe(true);
    expect(isRight(qq, kk, "nope")).toBe(false);
  });

  it("no answer is never right", () => {
    expect(isRight(q({ kind: "mc" }), k({ correct_option: 0 }), null)).toBe(false);
  });
});

describe("expressionsEquivalent", () => {
  it("accepts the same expression written differently", async () => {
    expect(await expressionsEquivalent("F/2", "0.5F")).toBe(true);
    expect(await expressionsEquivalent("F/2", "F·0.5")).toBe(true);
    expect(await expressionsEquivalent("F/2", "(1/2)*F")).toBe(true);
    expect(await expressionsEquivalent("x*y", "y x")).toBe(true);
    expect(await expressionsEquivalent("v/3", "(1/3)v")).toBe(true);
    expect(await expressionsEquivalent("sqrt(2*g*h)", "(2 g h)^(1/2)")).toBe(true);
  });

  it("rejects what isn't equal", async () => {
    expect(await expressionsEquivalent("F/2", "2F")).toBe(false);
    expect(await expressionsEquivalent("F/2", "F/2 + 1")).toBe(false);
    expect(await expressionsEquivalent("x*y", "x+y")).toBe(false);
    // Decimals for fractions are wrong on purpose (Learning Catalytics' rule).
    expect(await expressionsEquivalent("v/3", "0.33v")).toBe(false);
  });

  it("treats a different variable as different", async () => {
    expect(await expressionsEquivalent("F/2", "G/2")).toBe(false);
  });

  it("doesn't throw on nonsense", async () => {
    expect(await expressionsEquivalent("F/2", "F/(")).toBe(false);
    expect(await expressionsEquivalent("F/2", "")).toBe(false);
  });

  it("evaluates nothing but arithmetic, so another student's answer can't hang the page", async () => {
    const started = Date.now();
    expect(await expressionsEquivalent("F", "F + 0*sum(range(1, 1e9))")).toBe(false);
    expect(await expressionsEquivalent("F", "F + 0*size(zeros(1e5, 1e5))[1]")).toBe(false);
    expect(await expressionsEquivalent("F", "[F]")).toBe(false);
    expect(await expressionsEquivalent("F", 'F + 0*"x"')).toBe(false);
    expect(await expressionsEquivalent("F", `F${"+0".repeat(80)}`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
    // Nor an answer that only matches the key where it's real, or switches value.
    expect(await expressionsEquivalent("F/2", "F/2 + 0*sqrt(F-2)")).toBe(false);
    expect(await expressionsEquivalent("F", "F + (F > 0) - 1")).toBe(false);
    expect(await expressionsEquivalent("F", "F + 0*(F mod 2)")).toBe(false);
    // ...while the functions a physics answer uses still work.
    expect(await expressionsEquivalent("abs(sin(x))", "abs(sin(x)) * 1")).toBe(true);
  });
});

describe("expressionVerdicts", () => {
  it("decides every distinct answer to every expression question", async () => {
    const questions = [q({ id: "e1", kind: "expression" }), q({ id: "m1", kind: "mc" })];
    const keys = [k({ question_id: "e1", accept: ["F/2"] }), k({ question_id: "m1", correct_option: 0 })];
    const answers = [
      { question_id: "e1", answer: "0.5F" },
      { question_id: "e1", answer: "2F" },
      { question_id: "e1", answer: "0.5F" },
      { question_id: "m1", answer: "A" },
    ];
    expect(await expressionVerdicts(questions, keys, answers)).toEqual({
      e1: { "0.5F": true, "2F": false },
    });
  });
});
