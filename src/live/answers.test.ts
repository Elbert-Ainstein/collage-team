import { describe, expect, it } from "vitest";
import {
  answerPrint,
  canMoveOn,
  canonicalAnswer,
  canonicalMulti,
  expressionPrint,
  expressionsEquivalent,
  expressionVerdicts,
  isRight,
  letterIndex,
  maxTries,
  multiAnswer,
  multiIndexes,
  multiLabel,
  normalizeNumber,
  optionLetter,
  samePrint,
  toggleOption,
  TRIALS,
  tryCredit,
  TYPED_TRIES,
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

  it("reads a fraction as the number it is", () => {
    expect(normalizeNumber("1/2")).toBe("0.5");
    expect(normalizeNumber(" 3 / 4 ")).toBe("0.75");
    expect(normalizeNumber("-1/4")).toBe("-0.25");
    expect(normalizeNumber("1/-4")).toBe("-0.25");
    expect(normalizeNumber("9.8/2")).toBe("4.9");
    expect(normalizeNumber("1/3")).toBe(String(1 / 3));
    // The same vote as the decimal, so a team that types both agrees.
    expect(normalizeNumber("2/4")).toBe(normalizeNumber("0.5"));
  });

  it("refuses what isn't a number", () => {
    expect(normalizeNumber("")).toBeNull();
    expect(normalizeNumber("abc")).toBeNull();
    expect(normalizeNumber("1/0")).toBeNull();
    expect(normalizeNumber("1/2/3")).toBeNull();
    expect(normalizeNumber("F/2")).toBeNull();
    expect(normalizeNumber("Infinity")).toBeNull();
    expect(normalizeNumber("4.37*10^-3")).toBeNull();
  });

  // score_live checks numbers with this pattern before casting; anything the
  // app saves has to pass it, or a right answer would score as wrong.
  it("always produces something the database reads as a number", () => {
    const sql = /^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?$/;
    for (const raw of ["1/3", "-2/3", "0.3", "1e21", "-1e-7", "12345678901234567890", "0.000001", "5", "-2.5"]) {
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
    expect(canonicalAnswer("multi", "c, a")).toBe("AC");
    expect(canonicalAnswer("multi", "zz")).toBeNull();
  });
});

describe("select multiple (0056)", () => {
  it("spells a set one way: letters in order, each once", () => {
    expect(multiAnswer([2, 0])).toBe("AC");
    expect(multiAnswer([0, 0, 1])).toBe("AB");
    expect(multiAnswer([])).toBeNull();
    expect(multiAnswer([9])).toBeNull();
    expect(canonicalMulti("C A")).toBe("AC");
    expect(canonicalMulti("ca")).toBe("AC");
    expect(canonicalMulti("A, A, B")).toBe("AB");
    expect(canonicalMulti("")).toBeNull();
  });

  // live_answer_fits checks a multi answer against ^A?B?C?D?E?F?G?H?$: what
  // the app saves has to pass it, or a right answer would be refused.
  it("always produces something the database takes", () => {
    const sql = /^A?B?C?D?E?F?G?H?$/;
    for (const picks of [[0], [7, 0], [3, 1, 2], [0, 1, 2, 3, 4, 5, 6, 7]]) {
      const a = multiAnswer(picks)!;
      expect(sql.test(a)).toBe(true);
    }
  });

  it("reads a set back, labels it, and ticks one box at a time", () => {
    expect(multiIndexes("AC")).toEqual([0, 2]);
    expect(multiIndexes("ca")).toEqual([0, 2]);
    expect(multiLabel("ACD")).toBe("A, C, D");
    expect(toggleOption(null, 2)).toBe("C");
    expect(toggleOption("C", 0)).toBe("AC");
    expect(toggleOption("AC", 2)).toBe("A");
    expect(toggleOption("A", 0)).toBeNull();
  });

  it("is right only as the whole set — all or nothing", () => {
    const qq = q({ kind: "multi", options: ["w", "x", "y", "z"] });
    const kk = k({ correct_options: [2, 0] });
    expect(isRight(qq, kk, "AC")).toBe(true);
    expect(isRight(qq, kk, "ac")).toBe(true);
    expect(isRight(qq, kk, "A")).toBe(false);
    expect(isRight(qq, kk, "ABC")).toBe(false);
    expect(isRight(qq, k({ correct_options: [] }), "A")).toBe(false);
    // A key read from a database without 0056 has no set at all.
    expect(isRight(qq, k({}), "A")).toBe(false);
  });

  it("is tried like a typed answer in team mode: no limit, and moving on once a try pays nothing", () => {
    const qq = q({ kind: "multi", options: ["w", "x", "y", "z"] });
    expect(maxTries(qq)).toBe(TYPED_TRIES);
    expect(canMoveOn(qq, 2)).toBe(false);
    expect(canMoveOn(qq, 3)).toBe(true);
    expect(canMoveOn(q({ kind: "mc", options: ["w", "x", "y", "z"] }), 3)).toBe(false);
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

describe("team tries", () => {
  it("halves what a question is worth with each try, then nothing", () => {
    expect([1, 2, 3, 4, 8].map(tryCredit)).toEqual([1, 0.5, 0.25, 0, 0]);
  });

  it("lets multiple choice try every option, and a typed answer a hundred times", () => {
    expect(maxTries(q({ kind: "mc", options: ["a", "b", "c", "d"] }))).toBe(4);
    expect(maxTries(q({ kind: "number" }))).toBe(100);
    expect(maxTries(q({ kind: "expression" }))).toBe(100);
  });

  it("lets a team move on from a typed answer once another try is worth nothing", () => {
    const typed = q({ kind: "number" });
    expect([0, 1, 2, 3, 4, 12].map((n) => canMoveOn(typed, n))).toEqual([false, false, false, true, true, true]);
    expect(canMoveOn(q({ kind: "expression" }), 3)).toBe(true);
  });

  it("never moves a team on from multiple choice: the options run out instead", () => {
    expect(canMoveOn(q({ kind: "mc", options: ["a", "b", "c", "d", "e"] }), 3)).toBe(false);
  });
});

describe("expression prints", () => {
  it("evaluates in sorted variable order, so the same expression prints the same", async () => {
    const a = await expressionPrint("x*y");
    const b = await expressionPrint("y x");
    expect(a?.vars).toEqual(["x", "y"]);
    expect(a?.values).toHaveLength(TRIALS);
    expect(samePrint(a!, b!)).toBe(true);
  });

  // The print goes to the database as JSON and is compared there: it has to
  // survive the trip exactly, or a right answer would be told it's wrong.
  it("survives JSON, which is how it reaches the database", async () => {
    const key = await expressionPrint("sqrt(2*g*h)");
    const sent = JSON.parse(JSON.stringify(await answerPrint("(2 g h)^(1/2)")));
    expect(sent.answer).toBe("(2 g h)^(1/2)");
    expect(samePrint(JSON.parse(JSON.stringify(key)), sent)).toBe(true);
  });

  it("marks where an expression isn't real, and holds the key to it", async () => {
    const p = await expressionPrint("sqrt(F-2)");
    expect(p?.values.some((v) => v === null)).toBe(true);
    expect(samePrint((await expressionPrint("F/2"))!, (await expressionPrint("F/2 + 0*sqrt(F-2)"))!)).toBe(false);
  });

  it("sends nothing that can match for an answer it can't check", async () => {
    const sent = await answerPrint("F/(");
    expect(sent.vars).toEqual([]);
    expect(sent.values.every((v) => v === null)).toBe(true);
    expect(await expressionPrint("F/(")).toBeNull();
    expect(await expressionPrint("sum(range(1, 1e9))")).toBeNull();
  });
});
