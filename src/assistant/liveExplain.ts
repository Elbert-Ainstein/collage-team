// What the builder's "Generate explanation" asks for, and what comes back.
//
// Shared by the route (src/assistant/server/liveExplain*.ts) and the browser
// (src/faculty/live/explainClient.ts), so there is one place that says what
// the request is. The question travels whole, key included, as the instructor
// has it in the builder right now — saved or not — because that is the
// question she wants explained. Nothing is written: the explanation lands in
// her textbox, and she edits and saves it like anything she typed.

import type { LiveKind } from "./liveDraft";

/** Same ceilings as the import's draft (liveImport.ts), so anything it drafts can be explained. */
export const EXPLAIN_LIMITS = {
  stem: 4_000,
  option: 1_000,
  minOptions: 2,
  maxOptions: 8,
  unit: 40,
  accept: 20,
  form: 300,
  /** The longest explanation handed back. Two to five sentences is far under it. */
  explanation: 2_000,
} as const;

/** One question, with its key. Only the fields its kind uses are set. */
export interface ExplainQuestion {
  kind: LiveKind;
  stem: string;
  /** mc: 2–8 options, in order. Empty otherwise. */
  options: string[];
  /** mc: index into options of the right one. Null otherwise. */
  correctOption: number | null;
  /** number: the right answer. Null otherwise. */
  answer: number | null;
  /** number: how far off still counts, ± in the unit. Null otherwise. */
  tolerance: number | null;
  /** number: its unit, when it has one. */
  unit: string | null;
  /** expression: every form that counts as right. Empty otherwise. */
  accept: string[];
  /** The question has an image the model is not sent. */
  figure: boolean;
}

export interface LiveExplainRequest {
  activityId: string;
  question: ExplainQuestion;
}

export type LiveExplainResponse = { ok: true; explanation: string } | { ok: false; error: string };
