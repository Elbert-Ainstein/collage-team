// The released grade, spelled out: which ladder row each question got.
//
// The grading screen files a mark under the question's ID, falling back to the
// position for marks written before 0026 and for the questions it synthesises
// on an activity with no question rows (src/faculty/GradingScreen.tsx keyOf /
// markKey). This reads marks back under exactly those rules, so the breakdown
// a student reads is the one their marker actually made — and an activity
// whose questions were renumbered since never shows a mark under a question
// it was not made on.

import type { RubricItem, SubmissionMark } from "@/checkins/types";
import { awardForDeduction, type PointedQuestion } from "@/faculty/model";

export interface GradedQuestionRow {
  key: string;
  /** "Q1", "Q2a" — the label the rubric and the hand-in screen both use. */
  label: string;
  /** The picked ladder row's words, or null when nothing was taken off. */
  criterion: string | null;
  deduction: number;
  /**
   * What the question is out of, when it declares a worth of its own (0034).
   * Null on a question that deducts from the activity total — showing the
   * whole total against every question would read as six times the points.
   */
  worth: number | null;
  /** worth - deduction, only when the worth is known. */
  award: number | null;
}

/**
 * One row per question of a released, points-marked result.
 *
 * Empty when there are no marks to explain: an unmarked release (full points
 * everywhere) has no breakdown to show, and neither does a database the
 * student cannot read the marks from yet.
 */
export function gradedRubric(
  activity: { id: string; question_count: number },
  questions: PointedQuestion[],
  items: RubricItem[],
  marks: SubmissionMark[],
): GradedQuestionRow[] {
  if (marks.length === 0) return [];

  // The same synthesis the grading screen does for an activity with no
  // question rows: one per legacy question_count, marks keyed by position.
  const qs: PointedQuestion[] = questions.length
    ? [...questions].sort((a, b) => a.position - b.position)
    : (Array.from({ length: Math.max(activity.question_count, 1) }, (_, i) => ({
        id: `synthetic-${i}`,
        activity_id: activity.id,
        label: String(i + 1),
        position: i,
        created_at: "",
      })) as PointedQuestion[]);

  const itemById = new Map(items.map((r) => [r.id, r]));
  const byQuestionId = new Map(
    marks.filter((m) => m.question_id != null).map((m) => [m.question_id as string, m]),
  );
  // Only the marks with no question to point at: a mark that HAS one must
  // never be found by position, which moves (see SubmissionMark.question_index).
  const byIndex = new Map(
    marks.filter((m) => m.question_id == null).map((m) => [m.question_index, m]),
  );

  return qs.map((q) => {
    const mark = byQuestionId.get(q.id) ?? byIndex.get(q.position);
    const item = mark ? itemById.get(mark.rubric_item_id) : undefined;
    const deduction = item?.deduction ?? 0;
    const worth = q.points ?? null;
    return {
      key: q.id,
      label: `Q${q.label}`,
      criterion: item?.description ?? null,
      deduction,
      worth,
      award: worth == null ? null : awardForDeduction(worth, deduction),
    };
  });
}
