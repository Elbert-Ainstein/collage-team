// Writing the explanation students read once their team is done with a
// question (0051) — the prompt, the one tool, and the checks either side of
// the model.
//
// The model answers with ONE call to write_explanation, the same way the
// import answers with draft_questions: a model free to chat hands back a
// preamble ("Sure! Here's…") the instructor would have to delete. The key is
// given, never worked out: the explanation says why HER answer is right, so it
// cannot argue with the key students were marked against.

import { EXPLAIN_LIMITS, type ExplainQuestion } from "../liveExplain";
import type { LiveKind } from "../liveDraft";
import type { ToolSpec } from "../tools";

const KINDS: readonly LiveKind[] = ["mc", "number", "expression"];
const LETTERS = "ABCDEFGH";

export const LIVE_EXPLAIN_PROMPT = [
  "You write the short explanation a physics student reads right after their team has answered one question in class.",
  "You are given the question and its answer key. The key is correct: explain why that answer is right. Never disagree with it or offer a different answer.",
  "Write 2 to 5 plain sentences: the idea or principle that decides it, the step that gets there, and for multiple choice the tempting wrong option and why it is wrong.",
  "Plain text only: no headings, no bullet points, no bold, no LaTeX. Write math inline as plain text, e.g. v = d/t or F = ma, with units.",
  "Speak to the student directly and briefly. No greeting, no praise, no restating the whole question.",
  "If the question has a figure you are not shown, do not describe it or guess what it shows; explain from the words and the key.",
  "Answer by calling write_explanation exactly once.",
].join("\n");

export const WRITE_EXPLANATION: ToolSpec = {
  name: "write_explanation",
  description: "Hand back the explanation of the question, as plain text, 2 to 5 sentences. Call this exactly once.",
  schema: {
    type: "object",
    properties: {
      explanation: { type: "string", description: "The explanation, plain text, 2 to 5 sentences." },
    },
    required: ["explanation"],
  },
};

const tidy = (x: number): string => String(Number(x.toPrecision(12)));

/** The answer key, in words, for the user turn. */
function keyLine(q: ExplainQuestion): string {
  if (q.kind === "mc") return `Correct answer: ${LETTERS[q.correctOption ?? 0]}`;
  if (q.kind === "number") {
    const unit = q.unit ? ` ${q.unit}` : "";
    const within = q.tolerance ? ` (anything within ±${tidy(q.tolerance)}${unit} counts)` : "";
    return `Correct answer: ${tidy(q.answer ?? 0)}${unit}${within}`;
  }
  return `Accepted answers (any equivalent form counts): ${q.accept.join("; ")}`;
}

/** The question as the model reads it. */
export function describeQuestion(q: ExplainQuestion): string {
  const kind = q.kind === "mc" ? "multiple choice" : q.kind === "number" ? "number answer" : "expression answer";
  return [
    `Question (${kind}):`,
    q.stem,
    ...(q.kind === "mc" ? ["Options:", ...q.options.map((o, i) => `${LETTERS[i]}. ${o}`)] : []),
    keyLine(q),
    ...(q.figure ? ["(The question has a figure you are not shown.)"] : []),
  ].join("\n");
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const texts = (v: unknown, max: number): v is string[] => Array.isArray(v) && v.every((s) => text(s, max));
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function parseMc(b: Obj): Parsed<Pick<ExplainQuestion, "options" | "correctOption">> {
  const { options, correctOption } = b;
  const L = EXPLAIN_LIMITS;
  if (!texts(options, L.option) || options.length < L.minOptions || options.length > L.maxOptions) {
    return { ok: false, error: "the options are not 2 to 8 filled-in options" };
  }
  if (!Number.isInteger(correctOption) || (correctOption as number) < 0 || (correctOption as number) >= options.length) {
    return { ok: false, error: "no correct option" };
  }
  return { ok: true, value: { options: options.map((o) => o.trim()), correctOption: correctOption as number } };
}

function parseNumber(b: Obj): Parsed<Pick<ExplainQuestion, "answer" | "tolerance" | "unit">> {
  const { answer, tolerance, unit } = b;
  if (!finite(answer)) return { ok: false, error: "no answer" };
  if (tolerance !== null && tolerance !== undefined && (!finite(tolerance) || tolerance < 0)) {
    return { ok: false, error: "a tolerance that is not a number" };
  }
  if (unit !== null && unit !== undefined && unit !== "" && !text(unit, EXPLAIN_LIMITS.unit)) {
    return { ok: false, error: "a unit that is too long" };
  }
  return {
    ok: true,
    value: { answer, tolerance: finite(tolerance) ? tolerance : 0, unit: typeof unit === "string" && unit.trim() ? unit.trim() : null },
  };
}

function parseExpression(b: Obj): Parsed<Pick<ExplainQuestion, "accept">> {
  const { accept } = b;
  if (!texts(accept, EXPLAIN_LIMITS.form) || accept.length === 0 || accept.length > EXPLAIN_LIMITS.accept) {
    return { ok: false, error: "no accepted answers" };
  }
  return { ok: true, value: { accept: accept.map((a) => a.trim()) } };
}

/** The question from the request body, checked field by field; the browser is not trusted to have sent a whole one. */
export function parseExplainQuestion(v: unknown): Parsed<ExplainQuestion> {
  if (!isObj(v)) return { ok: false, error: "no question" };
  const { kind, stem, figure } = v;
  if (typeof kind !== "string" || !KINDS.includes(kind as LiveKind)) return { ok: false, error: "no question type" };
  if (!text(stem, EXPLAIN_LIMITS.stem)) return { ok: false, error: "no question" };
  if (figure !== undefined && typeof figure !== "boolean") return { ok: false, error: "an unreadable figure flag" };
  const base: ExplainQuestion = {
    kind: kind as LiveKind,
    stem: stem.trim(),
    options: [],
    correctOption: null,
    answer: null,
    tolerance: null,
    unit: null,
    accept: [],
    figure: figure === true,
  };
  const rest = kind === "mc" ? parseMc(v) : kind === "number" ? parseNumber(v) : parseExpression(v);
  return rest.ok ? { ok: true, value: { ...base, ...rest.value } } : rest;
}

/**
 * The explanation from the tool call, as plain text. The prompt asks for no
 * markdown, and a stray heading or bold mark is taken out here rather than
 * shown to students as asterisks.
 */
export function parseExplanation(input: unknown): Parsed<string> {
  if (!isObj(input) || typeof input.explanation !== "string") return { ok: false, error: "no explanation" };
  const plain = input.explanation
    .split("\n")
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .join("\n")
    .replace(/\*\*|__/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!plain) return { ok: false, error: "an empty explanation" };
  if (plain.length > EXPLAIN_LIMITS.explanation) return { ok: false, error: "an explanation that is too long" };
  return { ok: true, value: plain };
}
