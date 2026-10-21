// What counts as an answer, and what counts as the right one.
//
// Answers are stored as text in ONE canonical spelling per kind (0047): an
// option letter, a number as normalizeNumber writes it, or an expression with
// its spacing tidied. That matters twice. In team mode, "everyone agrees"
// compares strings — "0.30" and "0.3" have to be the same vote. And score_live
// checks multiple choice and numbers in SQL with exactly the rules isRight
// uses here, so the screen and the gradebook never disagree.
//
// Expressions are the one kind the database can't check: it doesn't do
// algebra. The staff client decides them here — by evaluating both sides at a
// handful of points, the way Learning Catalytics' checker does — and passes
// the verdicts to score_live. No AI anywhere in this.

import type { MathNode } from "mathjs";
import type { LiveKey, LiveKind, LiveQuestion } from "./types";

const LETTERS = "ABCDEFGH";

/** Longer than any physics answer; the database refuses past 200 (0047). */
export const MAX_EXPRESSION_LENGTH = 120;

export const optionLetter = (i: number): string => LETTERS[i] ?? "?";

export function letterIndex(letter: string): number | null {
  const i = LETTERS.indexOf(letter.trim().toUpperCase());
  return i === -1 ? null : i;
}

/**
 * "0.30", " .3 ", "3e-1" all become "0.3"; "1,200" becomes "1200". Anything
 * that isn't a plain number — a fraction, an expression, Infinity — is null.
 * The output always matches the pattern score_live checks before casting.
 */
export function normalizeNumber(text: string): string | null {
  const t = text.trim().replace(/,/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  // String(-0) is "0" already; String(1e21) is "1e+21", which still parses.
  return String(n === 0 ? 0 : n);
}

/** The one spelling an answer is stored and compared in, or null if it isn't one. */
export function canonicalAnswer(kind: LiveKind, raw: string): string | null {
  if (kind === "mc") {
    const i = letterIndex(raw);
    return i === null ? null : optionLetter(i);
  }
  if (kind === "number") return normalizeNumber(raw);
  const t = raw.trim().replace(/\s+/g, " ");
  return t === "" || t.length > MAX_EXPRESSION_LENGTH ? null : t;
}

/**
 * Multiple choice and number, exactly as live_answer_correct (0047) decides
 * them. Expressions need expressionsEquivalent — this says false for them.
 */
export function isRight(question: LiveQuestion, key: LiveKey | null | undefined, answer: string | null): boolean {
  if (answer === null || !key) return false;
  if (question.kind === "mc") {
    return key.correct_option !== null && answer.trim().toUpperCase() === optionLetter(key.correct_option);
  }
  if (question.kind === "number") {
    const n = normalizeNumber(answer);
    if (n === null || key.answer === null) return false;
    // A hair of slack for binary floating point: 19.6 + 0.5 is 20.099999….
    return Math.abs(Number(n) - Number(key.answer)) <= Number(key.tolerance ?? 0) + 1e-9;
  }
  return false;
}

// --------------------------------------------------------- expressions

/** What students actually type, made into something the parser reads. */
const prepare = (s: string): string =>
  s
    .replace(/[·×∙⋅]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-");

// Not variables: the functions and constants a physics answer uses.
const FUNCTIONS = new Set(["sqrt", "sin", "cos", "tan", "log", "ln", "exp", "abs"]);
const NOT_VARIABLES = new Set(["pi", "e", ...FUNCTIONS]);

// Another student's answer is evaluated on every teammate's phone and in the
// instructor's browser, so it may only be arithmetic: numbers, letters,
// operators, brackets and the functions above. `sum(range(1, 1e9))` parses
// fine and would hang the tab that checks it.
const SAFE_NODES = new Set(["ConstantNode", "SymbolNode", "OperatorNode", "ParenthesisNode", "FunctionNode"]);
// The operators of an answer — not comparisons, `and`, `mod` or `!`, which
// would let an answer switch between values and match the key only where
// it's checked.
const SAFE_OPERATORS = new Set(["add", "subtract", "multiply", "divide", "pow", "unaryMinus", "unaryPlus"]);

function onlyArithmetic(node: MathNode): boolean {
  let ok = true;
  node.traverse((n) => {
    if (!SAFE_NODES.has(n.type)) ok = false;
    else if (n.type === "OperatorNode") {
      if (!SAFE_OPERATORS.has((n as unknown as { fn: string }).fn)) ok = false;
    } else if (n.type === "FunctionNode") {
      const fn = (n as unknown as { fn: { type: string; name?: string } }).fn;
      if (fn.type !== "SymbolNode" || !fn.name || !FUNCTIONS.has(fn.name)) ok = false;
    } else if (n.type === "ConstantNode" && typeof (n as unknown as { value: unknown }).value !== "number") ok = false;
  });
  return ok;
}

// Twenty points: an answer built to agree with the key at exactly the points
// checked — "F/2 + (F-p1)(F-p2)…" — needs a factor per point, and twenty of
// those don't fit in MAX_EXPRESSION_LENGTH.
const TRIALS = 20;
const MIN_COMPARED = 10;

// A fixed sequence, so the same two answers always get the same verdict.
function* points(seed = 7): Generator<number> {
  let x = seed;
  for (;;) {
    x = (x * 16807) % 2147483647;
    yield 0.5 + (x / 2147483647) * 2.5;
  }
}

/**
 * Are these the same expression? Both are evaluated at twenty points; they
 * must use the same variables, be defined at the same points, and agree to a
 * relative 1e-9 wherever they are (at least ten points). So "F/2", "0.5F" and "F·0.5" agree,
 * and "0.33v" for "v/3" does not — decimals for fractions are wrong, as in
 * Learning Catalytics.
 */
export async function expressionsEquivalent(a: string, b: string): Promise<boolean> {
  if (!a.trim() || !b.trim() || a.length > MAX_EXPRESSION_LENGTH || b.length > MAX_EXPRESSION_LENGTH) return false;
  const math = await import("mathjs");
  let na: MathNode;
  let nb: MathNode;
  try {
    na = math.parse(prepare(a));
    nb = math.parse(prepare(b));
  } catch {
    return false;
  }
  if (!onlyArithmetic(na) || !onlyArithmetic(nb)) return false;

  const variables = (node: MathNode): Set<string> => {
    const fns = new Set(
      node
        .filter((n) => n.type === "FunctionNode")
        .map((n) => (n as unknown as { fn: { name: string } }).fn.name),
    );
    return new Set(
      node
        .filter((n) => n.type === "SymbolNode")
        .map((n) => (n as unknown as { name: string }).name)
        .filter((name) => !fns.has(name) && !NOT_VARIABLES.has(name)),
    );
  };
  const va = variables(na);
  const vb = variables(nb);
  if (va.size !== vb.size || [...va].some((v) => !vb.has(v))) return false;

  let fa: { evaluate: (scope: Record<string, number>) => unknown };
  let fb: typeof fa;
  try {
    fa = na.compile();
    fb = nb.compile();
  } catch {
    return false;
  }

  const gen = points();
  let compared = 0;
  for (let trial = 0; trial < TRIALS; trial++) {
    const scope: Record<string, number> = {};
    for (const v of va) scope[v] = gen.next().value as number;
    let x: unknown;
    let y: unknown;
    try {
      x = fa.evaluate(scope);
      y = fb.evaluate(scope);
    } catch {
      return false;
    }
    const realX = typeof x === "number" && Number.isFinite(x);
    const realY = typeof y === "number" && Number.isFinite(y);
    // Defined where the key is, and nowhere else: "F/2 + 0*sqrt(F-2)" is not F/2.
    if (realX !== realY) return false;
    if (!realX) continue;
    compared++;
    if (Math.abs((x as number) - (y as number)) > 1e-9 * Math.max(1, Math.abs(x as number), Math.abs(y as number))) return false;
  }
  return compared >= MIN_COMPARED;
}

/**
 * score_live's `verdicts`: for every expression question, every distinct
 * answer anybody gave (own or team), right or wrong against its accepted forms.
 */
export async function expressionVerdicts(
  questions: LiveQuestion[],
  keys: LiveKey[],
  answers: Array<{ question_id: string; answer: string }>,
): Promise<Record<string, Record<string, boolean>>> {
  const out: Record<string, Record<string, boolean>> = {};
  for (const question of questions) {
    if (question.kind !== "expression") continue;
    const accept = keys.find((k) => k.question_id === question.id)?.accept ?? [];
    const given = [...new Set(answers.filter((a) => a.question_id === question.id).map((a) => a.answer))];
    if (given.length === 0) continue;
    const verdicts: Record<string, boolean> = {};
    for (const answer of given) {
      let right = false;
      for (const form of accept) {
        if (await expressionsEquivalent(form, answer)) {
          right = true;
          break;
        }
      }
      verdicts[answer] = right;
    }
    out[question.id] = verdicts;
  }
  return out;
}
