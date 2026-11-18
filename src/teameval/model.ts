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
//   - The grade is the points for submitting, less the late penalty for a
//     late one, and nothing for none.

import type { Student, TeamWithMembers } from "@/checkins/types";
import type {
  ReasonsMode,
  TeamEvalCategory,
  TeamEvalComment,
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

/** The gradebook score: what score_team_eval writes. */
export function gradeFor(
  sub: Pick<TeamEvalSubmission, "submitted_at" | "late_override"> | null | undefined,
  dueAt: string | null,
  total: number,
  latePenalty: number,
): number {
  if (!sub) return 0;
  if (!isLate(sub, dueAt)) return total;
  return Math.round(total * (1 - latePenalty / 100) * 100) / 100;
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
  /** The mean of the category averages that have one. */
  overall: number | null;
  /** The mean of what they gave themselves; null until they've submitted. */
  selfOverall: number | null;
  grade: number;
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
  pointsTotal: number;
}): TeamGroup[] {
  const { snapshot, teams, roster, dueAt, pointsTotal } = args;
  const submitted = new Set(snapshot.submissions.map((s) => s.student_id));
  const subOf = new Map(snapshot.submissions.map((s) => [s.student_id, s]));
  const row = (student: Student, team: TeamWithMembers | null): ResultRow => {
    const submission = subOf.get(student.id) ?? null;
    const categories = snapshot.categories.map((c) => ({
      ...peerAverage(snapshot.ratings, submitted, student.id, c.id),
      self: selfScore(snapshot.ratings, submitted, student.id, c.id),
    }));
    const avgs = categories.flatMap((c) => (c.avg === null ? [] : [c.avg]));
    const selfs = categories.flatMap((c) => (c.self === null ? [] : [c.self]));
    return {
      student,
      team,
      submission,
      late: isLate(submission, dueAt),
      clockLate: lateByClock(submission, dueAt),
      categories,
      overall: avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null,
      selfOverall: selfs.length ? selfs.reduce((a, b) => a + b, 0) / selfs.length : null,
      grade: gradeFor(submission, dueAt, pointsTotal, snapshot.settings.late_penalty),
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

export interface DraftRating {
  score: number | null;
  reason: string;
}

/** A student's evaluation as they're filling it in. */
export interface EvalDraft {
  /** ratee → category → rating */
  ratings: Record<string, Record<string, DraftRating>>;
  /** subject → question → answer */
  comments: Record<string, Record<string, string>>;
}

export function draftFrom(ratings: TeamEvalRating[], comments: TeamEvalComment[]): EvalDraft {
  const out: EvalDraft = { ratings: {}, comments: {} };
  for (const r of ratings) {
    (out.ratings[r.ratee_id] ??= {})[r.category_id] = { score: r.score, reason: r.reason ?? "" };
  }
  for (const c of comments) {
    (out.comments[c.subject_id] ??= {})[c.question_id] = c.body;
  }
  return out;
}

/** What save_team_eval takes. Unscored ratings and blank answers are left out. */
export function draftPayload(draft: EvalDraft): {
  ratings: { category_id: string; ratee_id: string; score: number; reason: string | null }[];
  comments: { question_id: string; subject_id: string; body: string }[];
} {
  const ratings = Object.entries(draft.ratings).flatMap(([ratee, byCat]) =>
    Object.entries(byCat).flatMap(([category, r]) =>
      r.score === null ? [] : [{ category_id: category, ratee_id: ratee, score: r.score, reason: r.reason.trim() || null }],
    ),
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

/** Does a rating of this score need a reason? The rule save_team_eval holds a submission to. */
export function reasonNeeded(mode: ReasonsMode, score: number | null): boolean {
  if (score === null || mode === "none") return false;
  return mode === "all" || score <= 2;
}

/** 0 when this rating is done, 1 when it still needs a score or a reason. */
function ratingLeft(r: DraftRating | undefined, mode: ReasonsMode): number {
  if (!r || r.score === null) return 1;
  return reasonNeeded(mode, r.score) && !r.reason.trim() ? 1 : 0;
}

// ------------------------------------------------- the form, by category

/** One screen of the student's form: a category, everyone side by side; their comments; their reflection. */
export type Step =
  | { kind: "category"; category: TeamEvalCategory }
  | { kind: "comments"; questions: TeamEvalQuestion[] }
  | { kind: "reflection"; questions: TeamEvalQuestion[] };

export function stepsFor(ev: {
  categories: TeamEvalCategory[];
  questions: TeamEvalQuestion[];
  settings: Pick<TeamEvalSettings, "peer_comments">;
}): Step[] {
  const steps: Step[] = ev.categories.map((category) => ({ kind: "category" as const, category }));
  const peer = questionsFor(ev.questions, ev.settings, false);
  const self = questionsFor(ev.questions, ev.settings, true);
  if (peer.length) steps.push({ kind: "comments", questions: peer });
  if (self.length) steps.push({ kind: "reflection", questions: self });
  return steps;
}

/** What's left on one step, for the people listed (the student first, then teammates). */
export function leftInStep(
  step: Step,
  draft: EvalDraft,
  people: { student_id: string; is_me: boolean }[],
  settings: Pick<TeamEvalSettings, "reasons">,
): number {
  if (step.kind === "category") {
    return people.reduce((n, p) => n + ratingLeft(draft.ratings[p.student_id]?.[step.category.id], settings.reasons), 0);
  }
  const who = people.filter((p) => (step.kind === "reflection" ? p.is_me : !p.is_me));
  return who.reduce(
    (n, p) => n + step.questions.filter((q) => !draft.comments[p.student_id]?.[q.id]?.trim()).length,
    0,
  );
}
