// Checking a practice answer, once the session has closed. The key is the
// student's to read by then (0047's live_key_visible), so this happens on the
// device: nothing is written, and nothing reaches the gradebook.

import { expressionsEquivalent } from "@/live/answers";
import type { LiveModel } from "@/live/model";

/**
 * Whether this answer is right. An expression counts in any equivalent form,
 * as score_live has it. Null when there's no key to check against.
 */
export async function practiceRight(m: LiveModel, q: number, answer: string): Promise<boolean | null> {
  const question = m.questions[q];
  const key = m.key(q);
  if (!question || !key) return null;
  if (question.kind !== "expression") return m.right(q, answer);
  if (m.right(q, answer) === true) return true;
  for (const form of key.accept) {
    if (await expressionsEquivalent(form, answer)) return true;
  }
  return false;
}
