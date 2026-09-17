// The released grade, spelled out: each question's full ladder with the rung
// the marker picked.
//
// The grading screen files a mark under the question's ID, falling back to the
// position for marks written before 0026 and for the questions it synthesises
// on an activity with no question rows (src/faculty/GradingScreen.tsx keyOf /
// markKey). This reads marks back under exactly those rules, so the breakdown
// a student reads is the one their marker actually made — and an activity
// whose questions were renumbered since never shows a mark under a question
// it was not made on. The ladder is filtered the way the grading screen
// filters it too: a question's own rungs plus the shared pre-0012 ladder.

import type { Activity, RubricItem, SubmissionMark } from "@/checkins/types";
import { awardOfItem, type PointedQuestion } from "@/faculty/model";

type ActivityShape = Pick<
  Activity,
  "id" | "question_count" | "points_total" | "points_per_question"
>;

export interface GradedRung {
  item: RubricItem;
  /** What picking this rung awards, read under its question's worth. */
  award: number;
  picked: boolean;
}

export interface GradedQuestion {
  key: string;
  /** "Challenge Problem 1: At Home Effort", or "Question 1" for a bare "1". */
  label: string;
  /**
   * What the question is out of, when it declares a worth of its own (0034).
   * Null on a question that deducts from the activity total — showing the
   * whole total against every question would read as six times the points.
   */
  worth: number | null;
  /** The rung the marker picked, or null when nothing was taken off. */
  picked: RubricItem | null;
  deduction: number;
  /** worth - deduction, only when the worth is known. */
  award: number | null;
  /** The question's whole ladder, pickable rungs in the rubric's own order. */
  ladder: GradedRung[];
}

/** "1" and "2a" read as bare digits on a heading; a written-out label is itself. */
const displayLabel = (label: string): string =>
  /^\d+[a-z]?$/i.test(label.trim()) ? `Question ${label.trim()}` : label;

/**
 * One entry per question of a released, points-marked result.
 *
 * Empty when there are no marks to explain: an unmarked release (full points
 * everywhere) has no breakdown to show, and neither does a database the
 * student cannot read the marks from yet.
 */
export function gradedQuestions(
  activity: ActivityShape,
  questions: PointedQuestion[],
  items: RubricItem[],
  marks: SubmissionMark[],
): GradedQuestion[] {
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
    const picked = (mark && itemById.get(mark.rubric_item_id)) ?? null;
    const deduction = picked?.deduction ?? 0;
    const worth = q.points ?? null;
    const ladder = items
      .filter((r) => !r.question_label || r.question_label === q.label)
      .sort((a, b) => a.row_index - b.row_index)
      .map((item) => ({
        item,
        award: awardOfItem(activity, item, questions),
        picked: item.id === picked?.id,
      }));
    return {
      key: q.id,
      label: displayLabel(q.label),
      worth,
      picked,
      deduction,
      award: worth == null ? null : Math.round((worth - deduction) * 1e6) / 1e6,
      ladder,
    };
  });
}
