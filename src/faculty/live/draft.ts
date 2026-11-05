// The builder's questions, as the instructor edits them.
//
// Everything is text while it's being typed — "1." is half of a number, not a
// wrong one — and becomes a QuestionDraft (src/live/data.ts) only on Finish.
// What blocks Finish is said once, for every question at once, so a forty-
// question import doesn't make her find the next problem by clicking Finish
// forty times.

import { multiAnswer, multiLabel, normalizeNumber } from "@/live/answers";
import type { QuestionDraft } from "@/live/data";
import type { LiveExplanation, LiveKey, LiveKind, LiveQuestion } from "@/live/types";

export const MAX_OPTIONS = 8;

/** Multiple choice or select multiple: the kinds with lettered options. */
export const hasOptions = (q: Pick<DraftQuestion, "kind">): boolean => q.kind === "mc" || q.kind === "multi";

export interface DraftQuestion {
  /** The question's id: kept across saves, so answers stay attached to it. */
  id: string;
  kind: LiveKind;
  stem: string;
  /** Multiple choice and select multiple. */
  options: string[];
  /** Multiple choice: the right option. */
  correct: number | null;
  /** Select multiple: the right options, in no particular order. */
  corrects: number[];
  /** Number: the key, its unit, and how far off still counts as right. */
  answer: string;
  unit: string;
  tolerance: string;
  /** Expression: every form that counts as right. */
  accept: string[];
  figure_path: string | null;
  /**
   * What students read once their team is done with the question (0051). Not
   * part of what a question IS, so it stays editable after team mode starts,
   * like the key. Empty is none.
   */
  explanation: string;
  /** Set on questions the PDF import drafted. */
  source?: {
    page: number;
    note?: string;
    /** The import couldn't suggest a key; she has to choose one. */
    needsPick: boolean;
  };
}

const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : // Old Safari: still a v4 UUID, which is what the id column takes.
      "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.floor(Math.random() * 256) & (15 >> (Number(c) / 4)))).toString(16),
      );

export const blankQuestion = (): DraftQuestion => ({
  id: newId(),
  kind: "mc",
  stem: "",
  options: ["", "", "", ""],
  correct: null,
  corrects: [],
  answer: "",
  unit: "",
  tolerance: "",
  accept: [],
  figure_path: null,
  explanation: "",
});

/** The saved questions, back as drafts, in order. */
export function draftsFrom(
  questions: LiveQuestion[],
  keys: LiveKey[],
  explanations: readonly LiveExplanation[] = [],
): DraftQuestion[] {
  const keyOf = new Map(keys.map((k) => [k.question_id, k]));
  const explained = new Map(explanations.map((e) => [e.question_id, e.body]));
  return [...questions]
    .sort((a, b) => a.position - b.position)
    .map((q) => {
      const k = keyOf.get(q.id);
      return {
        id: q.id,
        kind: q.kind,
        stem: q.stem,
        options: hasOptions(q) ? [...q.options] : ["", "", "", ""],
        correct: k?.correct_option ?? null,
        corrects: [...(k?.correct_options ?? [])],
        answer: k?.answer === null || k?.answer === undefined ? "" : String(k.answer),
        unit: q.unit ?? "",
        tolerance: k?.tolerance === null || k?.tolerance === undefined ? "" : String(k.tolerance),
        accept: k ? [...k.accept] : [],
        figure_path: q.figure_path,
        explanation: explained.get(q.id) ?? "",
      };
    });
}

/** The right options of a select-multiple question, as saved: within its options, each once, in order. */
export const correctsOf = (q: Pick<DraftQuestion, "corrects" | "options">): number[] =>
  [...new Set(q.corrects)].filter((i) => i >= 0 && i < q.options.length).sort((a, b) => a - b);

/**
 * The same question as another kind. Between multiple choice and select
 * multiple the options come along, and so does the key where it still means
 * something: one right option becomes the one ticked box, and one ticked box
 * becomes the right option.
 */
export function withKind(q: DraftQuestion, kind: LiveKind): DraftQuestion {
  if (kind === q.kind) return q;
  const next = { ...q, kind };
  if (kind === "multi" && q.kind === "mc" && q.corrects.length === 0 && q.correct !== null) next.corrects = [q.correct];
  if (kind === "mc" && q.kind === "multi" && q.correct === null && correctsOf(q).length === 1) next.correct = correctsOf(q)[0];
  return next;
}

/** What a question's key reads as, or null if it has none yet. */
export function keyLabel(q: DraftQuestion): string | null {
  if (q.kind === "mc") return q.correct === null || q.correct >= q.options.length ? null : "ABCDEFGH"[q.correct];
  if (q.kind === "multi") {
    const set = multiAnswer(correctsOf(q));
    return set === null ? null : multiLabel(set);
  }
  if (q.kind === "number") {
    const n = normalizeNumber(q.answer);
    return n === null ? null : `${n}${q.unit.trim() ? ` ${q.unit.trim()}` : ""}`;
  }
  return q.accept.length ? q.accept[0] : null;
}

export type Problem =
  | "needs a question"
  | "has an empty option"
  | "has a tolerance that isn’t a number"
  | "needs an answer";

export function problemWith(q: DraftQuestion): Problem | null {
  if (!q.stem.trim()) return "needs a question";
  if (hasOptions(q) && q.options.some((o) => !o.trim())) return "has an empty option";
  if (q.kind === "number" && q.tolerance.trim()) {
    const t = normalizeNumber(q.tolerance);
    if (t === null || Number(t) < 0) return "has a tolerance that isn’t a number";
  }
  if (q.source?.needsPick || keyLabel(q) === null) return "needs an answer";
  return null;
}

/**
 * Every blocked question at once, grouped by what is wrong:
 * "Q3, Q8 and Q12 need an answer · Q5 has an empty option".
 */
export function summarizeProblems(questions: DraftQuestion[]): string | null {
  if (questions.length === 0) return "Add a question";
  const groups = new Map<Problem, number[]>();
  questions.forEach((q, i) => {
    const p = problemWith(q);
    if (p) groups.set(p, [...(groups.get(p) ?? []), i + 1]);
  });
  if (groups.size === 0) return null;
  const list = (ns: number[]) => {
    const qs = ns.map((n) => `Q${n}`);
    return qs.length < 2 ? qs[0] : `${qs.slice(0, -1).join(", ")} and ${qs[qs.length - 1]}`;
  };
  const plural = (p: Problem, many: boolean) =>
    !many
      ? p
      : p.replace(/^needs/, "need").replace(/^has /, "have ").replace("a tolerance that isn’t", "tolerances that aren’t");
  return [...groups.entries()].map(([p, ns]) => `${list(ns)} ${plural(p, ns.length > 1)}`).join(" · ");
}

/** Ready to save. Only called once summarizeProblems says nothing. */
export function toQuestionDraft(q: DraftQuestion): QuestionDraft {
  const n = normalizeNumber(q.answer);
  const t = normalizeNumber(q.tolerance);
  return {
    id: q.id,
    kind: q.kind,
    stem: q.stem.trim(),
    options: hasOptions(q) ? q.options.map((o) => o.trim()) : [],
    unit: q.kind === "number" && q.unit.trim() ? q.unit.trim() : null,
    figure_path: q.figure_path,
    correct_option: q.kind === "mc" ? q.correct : null,
    correct_options: q.kind === "multi" ? correctsOf(q) : [],
    answer: q.kind === "number" && n !== null ? Number(n) : null,
    tolerance: q.kind === "number" ? (t === null ? 0 : Number(t)) : null,
    accept: q.kind === "expression" ? q.accept.map((a) => a.trim()).filter(Boolean) : [],
    // Always a string, so clearing the box deletes the saved one (data.ts).
    explanation: q.explanation.trim(),
  };
}

/**
 * What saving these drafts would do to answers students have already given,
 * one sentence each — empty when nothing. A removed question takes its answers
 * with it; a question whose kind changes (multiple choice to select multiple
 * included: "B" and "B alone" are different answers), or that loses an option
 * (re-lettering the rest), keeps answers that no longer mean what the student
 * chose.
 */
export function answersAtRisk(
  saved: DraftQuestion[],
  drafts: DraftQuestion[],
  /** Question id → how many students have answered it. */
  answered: Map<string, number>,
): string[] {
  const out: string[] = [];
  const answers = (n: number) => `${n} answer${n === 1 ? "" : "s"}`;
  saved.forEach((was, i) => {
    const n = answered.get(was.id) ?? 0;
    if (n === 0) return;
    const now = drafts.find((d) => d.id === was.id);
    if (!now) out.push(`Q${i + 1} is removed, with its ${answers(n)}.`);
    else if (now.kind !== was.kind) out.push(`Q${i + 1} changes type; its ${answers(n)} were given as the old one.`);
    else if (hasOptions(was) && now.options.length < was.options.length)
      out.push(`Q${i + 1} loses an option; its ${answers(n)} may now point at a different one.`);
  });
  return out;
}
