// Team evaluation (0058): the arithmetic, kept out of the screens so both
// sides — and the tests — agree on it.
//
// The rules are the database's (team_eval_results, score_team_eval). They are
// repeated here only so the instructor sees the same numbers before anything
// is written to the gradebook:
//   - Only SUBMITTED evaluations count. A draft counts for nobody.
//   - A student's average leaves out their own rating of themselves.
//   - Late is the staff's word when they've given one, else submitted after
//     the due date.
//   - The grade is the sum of a student's category averages (each out of 5),
//     less the late penalty if their own evaluation was late, and 0 if they
//     never submitted one. Nobody rated them yet: no grade.

import type { Student, TeamWithMembers } from "@/checkins/types";
import { POINTS_PER_CATEGORY } from "./types";
import type {
  TeamEvalComment,
  TeamEvalMember,
  TeamEvalQuestion,
  TeamEvalRating,
  TeamEvalSettings,
  TeamEvalSnapshot,
  TeamEvalSubmission,
} from "./types";

/** Was this submission late? */
export function isLate(sub: Pick<TeamEvalSubmission, "submitted_at" | "late_override"> | null | undefined, dueAt: string | null): boolean {
  if (!sub) return false;
  if (sub.late_override !== null && sub.late_override !== undefined) return sub.late_override;
  if (!dueAt) return false;
  const due = Date.parse(dueAt);
  const at = Date.parse(sub.submitted_at);
  return !Number.isNaN(due) && !Number.isNaN(at) && at > due;
}

/** Would it be late by the clock alone? For saying "overridden" honestly. */
export function lateByClock(sub: Pick<TeamEvalSubmission, "submitted_at"> | null | undefined, dueAt: string | null): boolean {
  return isLate(sub ? { submitted_at: sub.submitted_at, late_override: null } : null, dueAt);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The gradebook score: what score_team_eval writes. `points` is the sum of
 * their category averages, null when nobody has rated them.
 */
export function gradeFor(
  sub: Pick<TeamEvalSubmission, "submitted_at" | "late_override"> | null | undefined,
  dueAt: string | null,
  points: number | null,
  latePenalty: number,
): number | null {
  if (!sub) return 0;
  if (points === null) return null;
  return round2(isLate(sub, dueAt) ? points * (1 - latePenalty / 100) : points);
}

/** What an evaluation with these categories is out of. */
export function outOf(categories: readonly unknown[]): number {
  return POINTS_PER_CATEGORY * categories.length;
}

export interface Average {
  /** Null when no submitted teammate rated them. */
  avg: number | null;
  /** How many submitted teammates did. */
  n: number;
}

/**
 * The average a student was given in one category by teammates who submitted,
 * themselves left out.
 */
export function peerAverage(
  ratings: TeamEvalRating[],
  submitted: ReadonlySet<string>,
  rateeId: string,
  categoryId: string,
): Average {
  const scores = ratings
    .filter((r) => r.ratee_id === rateeId && r.category_id === categoryId && r.rater_id !== rateeId && submitted.has(r.rater_id))
    .map((r) => r.score);
  if (!scores.length) return { avg: null, n: 0 };
  return { avg: scores.reduce((a, b) => a + b, 0) / scores.length, n: scores.length };
}

/** What a student gave themselves in a category, if they've submitted. */
export function selfScore(ratings: TeamEvalRating[], submitted: ReadonlySet<string>, studentId: string, categoryId: string): number | null {
  if (!submitted.has(studentId)) return null;
  return ratings.find((r) => r.rater_id === studentId && r.ratee_id === studentId && r.category_id === categoryId)?.score ?? null;
}

/** "3.7", or a dash for nobody. */
export function fmtAvg(avg: number | null): string {
  if (avg === null) return "—";
  return (Math.round(avg * 10) / 10).toFixed(1);
}

/** "8", "8.5", "8.25" — points as people write them. */
export function fmtPoints(n: number): string {
  return String(Math.round(n * 100) / 100);
}

// ------------------------------------------------------- instructor results

export interface ResultRow {
  student: Student;
  team: TeamWithMembers | null;
  submission: TeamEvalSubmission | null;
  late: boolean;
  /** Late by the clock, before any override. */
  clockLate: boolean;
  /** One per category, in category order. */
  categories: (Average & { self: number | null })[];
  /** The mean of the category averages: where they stand on the 1–5 scale. */
  overall: number | null;
  /** The sum of the category averages; null when nobody rated them. */
  points: number | null;
  /** What goes in the gradebook: points less any late penalty, 0 for no submission. */
  grade: number | null;
}

export interface TeamGroup {
  team: TeamWithMembers | null;
  rows: ResultRow[];
}

/**
 * Every student on the evaluation's teams, team by team, with their averages
 * and grade. Students on no team come last, in a group of their own: they had
 * nobody to rate and nobody rated them, which is worth seeing.
 */
export function buildResults(args: {
  snapshot: TeamEvalSnapshot;
  teams: TeamWithMembers[];
  roster: Student[];
  dueAt: string | null;
}): TeamGroup[] {
  const { snapshot, teams, roster, dueAt } = args;
  const submitted = new Set(snapshot.submissions.map((s) => s.student_id));
  const subOf = new Map(snapshot.submissions.map((s) => [s.student_id, s]));
  const row = (student: Student, team: TeamWithMembers | null): ResultRow => {
    const submission = subOf.get(student.id) ?? null;
    const categories = snapshot.categories.map((c) => ({
      ...peerAverage(snapshot.ratings, submitted, student.id, c.id),
      self: selfScore(snapshot.ratings, submitted, student.id, c.id),
    }));
    const avgs = categories.flatMap((c) => (c.avg === null ? [] : [c.avg]));
    const points = avgs.length ? avgs.reduce((a, b) => a + b, 0) : null;
    return {
      student,
      team,
      submission,
      late: isLate(submission, dueAt),
      clockLate: lateByClock(submission, dueAt),
      categories,
      overall: points === null ? null : points / avgs.length,
      points,
      grade: gradeFor(submission, dueAt, points, snapshot.settings.late_penalty),
    };
  };

  const placed = new Set<string>();
  const groups: TeamGroup[] = teams.map((t) => {
    const rows = t.members.map((m) => {
      placed.add(m.id);
      // The roster row is the fresher one when it's there.
      return row(roster.find((s) => s.id === m.id) ?? m, t);
    });
    return { team: t, rows };
  });
  const loose = roster.filter((s) => !placed.has(s.id));
  if (loose.length) groups.push({ team: null, rows: loose.map((s) => row(s, null)) });
  return groups.filter((g) => g.rows.length > 0);
}

// --------------------------------------------------------- the student form

/** A student's evaluation as they're filling it in. */
export interface EvalDraft {
  /** ratee → category → score */
  ratings: Record<string, Record<string, number>>;
  /** subject → question → answer */
  comments: Record<string, Record<string, string>>;
}

export function draftFrom(ratings: TeamEvalRating[], comments: TeamEvalComment[]): EvalDraft {
  const out: EvalDraft = { ratings: {}, comments: {} };
  for (const r of ratings) {
    (out.ratings[r.ratee_id] ??= {})[r.category_id] = r.score;
  }
  for (const c of comments) {
    (out.comments[c.subject_id] ??= {})[c.question_id] = c.body;
  }
  return out;
}

/** What save_team_eval takes. Blank answers are left out. */
export function draftPayload(draft: EvalDraft): {
  ratings: { category_id: string; ratee_id: string; score: number }[];
  comments: { question_id: string; subject_id: string; body: string }[];
} {
  const ratings = Object.entries(draft.ratings).flatMap(([ratee, byCat]) =>
    Object.entries(byCat).map(([category, score]) => ({ category_id: category, ratee_id: ratee, score })),
  );
  const comments = Object.entries(draft.comments).flatMap(([subject, byQ]) =>
    Object.entries(byQ).flatMap(([question, body]) =>
      body.trim() ? [{ question_id: question, subject_id: subject, body: body.trim() }] : [],
    ),
  );
  return { ratings, comments };
}

/** The questions asked on one person's page. */
export function questionsFor(
  questions: TeamEvalQuestion[],
  settings: Pick<TeamEvalSettings, "peer_comments">,
  isMe: boolean,
): TeamEvalQuestion[] {
  return questions.filter((q) => (isMe ? q.audience === "self" : q.audience === "peer" && settings.peer_comments));
}

/** One page per person: each teammate in team order, then the student themselves. */
export function pagesFor(team: TeamEvalMember[]): TeamEvalMember[] {
  return [...team.filter((m) => !m.is_me), ...team.filter((m) => m.is_me)];
}

/** What's left on one person's page: categories not rated, questions not answered. */
export function leftFor(
  person: Pick<TeamEvalMember, "student_id" | "is_me">,
  ev: { categories: { id: string }[]; questions: TeamEvalQuestion[]; settings: Pick<TeamEvalSettings, "peer_comments"> },
  draft: EvalDraft,
): number {
  const rated = draft.ratings[person.student_id] ?? {};
  const answered = draft.comments[person.student_id] ?? {};
  const unrated = ev.categories.filter((c) => rated[c.id] === undefined).length;
  const unanswered = questionsFor(ev.questions, ev.settings, person.is_me).filter((q) => !answered[q.id]?.trim()).length;
  return unrated + unanswered;
}
