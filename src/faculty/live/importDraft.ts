// What the PDF import drafted, as builder questions.
//
// The route (src/assistant/server/liveImport.ts) has already checked the
// draft's shape; this turns each item into the DraftQuestion the builder
// edits, and keeps where its figure is so the page can be cropped. Keys the
// model worked out come in as SUGGESTIONS — every one is editable, and an
// item it couldn't key arrives marked "Needs an answer", which blocks Finish.

import type { DraftFigure, LeftOut, LiveDraft, SourceKind } from "@/assistant/liveDraft";
import { MAX_EXPRESSION_LENGTH } from "@/live/answers";
import { blankQuestion, MAX_OPTIONS, type DraftQuestion } from "./draft";

export interface ImportedQuestion {
  question: DraftQuestion;
  /** Where on the PDF its figure is, to crop; absent when it has none. */
  figure?: DraftFigure;
}

export function draftToQuestions(draft: LiveDraft): ImportedQuestion[] {
  return draft.items.map((item) => {
    const base = blankQuestion();
    // Accepted forms the checker can't read (over its length) would never
    // match anything; better to ask for the key than to keep a dead one.
    const accept = (item.accept ?? []).map((a) => a.trim()).filter((a) => a && a.length <= MAX_EXPRESSION_LENGTH);
    const options = (item.options ?? []).slice(0, MAX_OPTIONS);
    const correct =
      item.kind === "mc" && item.correctOption !== null && item.correctOption !== undefined && item.correctOption < options.length
        ? item.correctOption
        : null;
    const keyed =
      item.kind === "mc" ? correct !== null : item.kind === "number" ? Boolean(item.answer?.trim()) : accept.length > 0;
    const question: DraftQuestion = {
      ...base,
      kind: item.kind,
      stem: item.stem,
      // Two options at least, so a short one still shows where to type.
      options: item.kind === "mc" ? (options.length >= 2 ? options : [...options, "", ""].slice(0, 2)) : base.options,
      correct,
      answer: item.answer ?? "",
      unit: item.unit ?? "",
      tolerance: item.tolerance ?? "",
      accept,
      source: {
        page: item.page,
        ...(item.note ? { note: item.note } : {}),
        needsPick: item.needsPick || !keyed,
      },
    };
    return item.figure ? { question, figure: item.figure } : { question };
  });
}

const KIND_WORD: Record<SourceKind, string> = {
  mc: "multiple choice",
  numerical: "number",
  expression: "expression",
  direction: "direction",
  click: "click on a figure",
  ranking: "ranking",
  instructions: "instructions",
  other: "other",
};

/** "p.3 ranking, p.7 instructions" — what the import didn't turn into questions. */
export function leftOutLine(leftOut: LeftOut[]): string | null {
  if (leftOut.length === 0) return null;
  return leftOut.map((l) => `p.${l.page} ${KIND_WORD[l.kind] ?? l.kind}`).join(", ");
}

/** The builder's questions after an import: drafted ones replace an untouched blank start. */
export function withImported(current: DraftQuestion[], imported: DraftQuestion[]): DraftQuestion[] {
  const untouched = (q: DraftQuestion) =>
    !q.stem.trim() && q.options.every((o) => !o.trim()) && q.correct === null && !q.answer.trim() && q.accept.length === 0 && !q.figure_path;
  return [...current.filter((q) => !untouched(q)), ...imported];
}
