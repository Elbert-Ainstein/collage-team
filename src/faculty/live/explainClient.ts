// Asking /api/live-explain for a question's explanation, from the builder.
//
// The question goes as she has it on screen, key included — saved or not —
// with her Supabase session, which the route checks owns the activity. What
// comes back only fills the textbox; it is saved with the questions, or not.

import type { ExplainQuestion, LiveExplainResponse } from "@/assistant/liveExplain";
import { requireSupabase } from "@/lib/supabaseClient";
import { problemWith, toQuestionDraft, type DraftQuestion } from "./draft";

/** Whether a question is whole enough to explain: written, with a key. */
export const canExplain = (q: DraftQuestion): boolean => problemWith(q) === null;

/** The question as the route reads it, from the same tidy-up saving does. */
export function explainQuestionOf(q: DraftQuestion): ExplainQuestion {
  const d = toQuestionDraft(q);
  return {
    kind: d.kind,
    stem: d.stem,
    options: d.options,
    correctOption: d.correct_option,
    answer: d.answer,
    tolerance: d.tolerance,
    unit: d.unit,
    accept: d.accept,
    figure: Boolean(d.figure_path),
  };
}

export async function explainQuestion(activityId: string, q: DraftQuestion, signal?: AbortSignal): Promise<string> {
  const { data } = await requireSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your sign-in has expired. Reload the page and sign in again.");

  let res: Response;
  try {
    res = await fetch("/api/live-explain", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ activityId, question: explainQuestionOf(q) }),
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }

  let body: LiveExplainResponse | null = null;
  try {
    body = (await res.json()) as LiveExplainResponse;
  } catch {
    // A host timeout or crash page is HTML, not the route's JSON.
  }
  if (!body) throw new Error("No explanation came back. Try again.");
  if (!body.ok) throw new Error(body.error);
  return body.explanation;
}
