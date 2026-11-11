// The patterns an instructor should look at: CATME's "exceptional conditions"
// and its two red rating patterns, by the rules CATME publishes
// (info.catme.org/instructor/instructor-help/catme-terms/). SCAFFOLD.
//
// Flags are prompts to look, not verdicts. CATME itself says Conflict and
// Clique are not validated, and the confidence flags read a strict rater as
// "underconfident" — the results screen shows them; nothing applies them to a
// grade. Thresholds live in THRESHOLDS so a course can tune them in one place.
//
// "Overall" below is a mean across the dimensions asked; "from teammates"
// never includes the student's own scores.

import { keepRatings, summarizeTeam } from "./model";
import type { PeerDimension, PeerRating } from "./types";

export type PeerFlag =
  | "low"
  | "high"
  | "overconfident"
  | "underconfident"
  | "manipulator"
  | "conflict"
  | "clique";

export const FLAG_LABEL: Readonly<Record<PeerFlag, string>> = {
  low: "Low",
  high: "High",
  overconfident: "Overconfident",
  underconfident: "Underconfident",
  manipulator: "Manipulator",
  conflict: "Conflict",
  clique: "Clique",
};

/** One line each, for a tooltip. */
export const FLAG_MEANS: Readonly<Record<PeerFlag, string>> = {
  low: "Teammates rate them below 2.5.",
  high: "Teammates rate them above 3.5, and well above the team.",
  overconfident: "Rated low by teammates, and a point or more higher by themselves.",
  underconfident: "Rated well by teammates, and a point or more lower by themselves.",
  manipulator: "Rates themselves 4+ and every teammate 2+ points lower.",
  conflict: "Rated a teammate 2 or lower whom the rest of the team rated 3+.",
  clique: "Ratings vary a lot across the team, and no other flag explains it.",
};

/**
 * Flags that make the student's adjustment factor suspect: CATME highlights
 * the factor when one of these fires, because the ratings behind it may not
 * be honest ones.
 */
export const DOUBTS_FACTOR: ReadonlySet<PeerFlag> = new Set(["manipulator", "conflict", "clique"]);

export const THRESHOLDS = {
  /** low: from teammates under this. */
  lowBelow: 2.5,
  /** high: from teammates over this... */
  highAbove: 3.5,
  /** ...and more than this over the team's average. */
  highOverTeam: 0.5,
  /** over/underconfident: teammates' average under/over this... */
  confidenceMid: 3,
  /** ...and self at least this far above/below it. */
  confidenceGap: 1,
  /** manipulator: self at least this... */
  manipulatorSelf: 4,
  /** ...and every teammate rated at least this far below self. */
  manipulatorGap: 2,
  /** conflict: a score this low or lower from the rater... */
  conflictLow: 2,
  /** ...about someone the rest of the team rates, by median, at least this. */
  conflictRestMedian: 3,
} as const;

/**
 * Slack for comparing means. A mean of thirds or fifths is not exact in
 * binary — 13/3 − 7/3 comes out 1.9999… — and every CATME boundary is
 * inclusive, so an exact 2-point gap must still count as 2.
 */
const EPS = 1e-9;
const atLeast = (x: number, bound: number) => x >= bound - EPS;
const above = (x: number, bound: number) => x > bound + EPS;
const below = (x: number, bound: number) => x < bound - EPS;

export interface MemberFlags {
  studentId: string;
  flags: PeerFlag[];
}

const mean = (xs: readonly number[]): number | null =>
  xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;

function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Population standard deviation. */
function sd(xs: readonly number[]): number {
  const m = mean(xs);
  if (m === null) return 0;
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))!);
}

/** rater → ratee → mean of the rater's scores of them across dimensions. */
function overallMatrix(kept: readonly PeerRating[]): Map<string, Map<string, number>> {
  const cells = new Map<string, Map<string, number[]>>();
  for (const x of kept) {
    const row = cells.get(x.rater_id) ?? new Map<string, number[]>();
    row.set(x.ratee_id, [...(row.get(x.ratee_id) ?? []), x.score]);
    cells.set(x.rater_id, row);
  }
  return new Map(
    [...cells].map(([rater, row]) => [rater, new Map([...row].map(([ratee, xs]) => [ratee, mean(xs)!]))]),
  );
}

type Matrix = ReturnType<typeof overallMatrix>;

function isManipulator(m: Matrix, team: readonly string[], id: string): boolean {
  const self = m.get(id)?.get(id);
  if (self === undefined || below(self, THRESHOLDS.manipulatorSelf)) return false;
  const others = team.filter((o) => o !== id).map((o) => m.get(id)?.get(o));
  // Alone on a team, "every teammate rated low" is true of nobody.
  if (others.length === 0 || others.some((v) => v === undefined)) return false;
  return others.every((v) => atLeast(self - v!, THRESHOLDS.manipulatorGap));
}

/** On the RATER: they scored someone low whom the rest of the team did not. */
function isConflict(m: Matrix, team: readonly string[], id: string): boolean {
  return team.some((t) => {
    if (t === id) return false;
    const mine = m.get(id)?.get(t);
    if (mine === undefined || above(mine, THRESHOLDS.conflictLow)) return false;
    const rest = team
      .filter((o) => o !== id && o !== t)
      .map((o) => m.get(o)?.get(t))
      .filter((v): v is number => v !== undefined);
    const med = median(rest);
    return med !== null && atLeast(med, THRESHOLDS.conflictRestMedian);
  });
}

/**
 * CATME's Clique: the spread of teammates' scores, summed over dimensions,
 * exceeds the number of dimensions (an average SD over 1 point) — and nothing
 * on the team explains it. Team-wide, so it marks every member.
 */
function isCliqueTeam(kept: readonly PeerRating[], dims: readonly PeerDimension[]): boolean {
  const peerOnly = kept.filter((x) => x.rater_id !== x.ratee_id);
  const spread = dims.reduce((s, d) => s + sd(peerOnly.filter((x) => x.dimension === d).map((x) => x.score)), 0);
  return above(spread, dims.length);
}

/** Every member's flags, in team order. */
export function flagTeam(
  team: readonly string[],
  ratings: readonly PeerRating[],
  dimensions: readonly PeerDimension[],
  includeSelf = true,
): MemberFlags[] {
  const kept = keepRatings(team, ratings, dimensions, includeSelf);
  const m = overallMatrix(kept);
  const summaries = summarizeTeam(team, kept, dimensions);
  const teamAvg = mean(summaries.map((s) => s.peerOverall).filter((v): v is number => v !== null));

  const each = summaries.map((s) => {
    const flags: PeerFlag[] = [];
    const peer = s.peerOverall;
    const self = s.selfOverall;
    if (peer !== null) {
      if (below(peer, THRESHOLDS.lowBelow)) flags.push("low");
      if (above(peer, THRESHOLDS.highAbove) && teamAvg !== null && above(peer - teamAvg, THRESHOLDS.highOverTeam)) {
        flags.push("high");
      }
      if (self !== null) {
        if (below(peer, THRESHOLDS.confidenceMid) && atLeast(self - peer, THRESHOLDS.confidenceGap)) {
          flags.push("overconfident");
        }
        if (above(peer, THRESHOLDS.confidenceMid) && atLeast(peer - self, THRESHOLDS.confidenceGap)) {
          flags.push("underconfident");
        }
      }
    }
    if (isManipulator(m, team, s.studentId)) flags.push("manipulator");
    if (isConflict(m, team, s.studentId)) flags.push("conflict");
    return { studentId: s.studentId, flags };
  });

  const explained = each.some((e) => e.flags.length > 0);
  if (explained || !isCliqueTeam(kept, dimensions)) return each;
  return each.map((e) => ({ ...e, flags: ["clique" as const] }));
}

export type RatingPatternKind =
  /** One rater gave one person the same score on every dimension. */
  | "same_every_dimension"
  /** One rater gave everyone the same score on one dimension. */
  | "same_for_everyone";

export interface RatingPattern {
  kind: RatingPatternKind;
  raterId: string;
  /** same_every_dimension: who they rated. */
  rateeId?: string;
  /** same_for_everyone: on what. */
  dimension?: PeerDimension;
}

/**
 * CATME's two red patterns: a rater not telling dimensions apart, or not
 * telling people apart. Each needs two or more things to compare, so one
 * dimension or one teammate never trips them — and a rater part-way through
 * the form is not judged on the part they've done. "Everyone" is their
 * teammates; a self score is not a judgement of the team.
 */
export function ratingPatterns(
  team: readonly string[],
  ratings: readonly PeerRating[],
  dimensions: readonly PeerDimension[],
): RatingPattern[] {
  const kept = keepRatings(team, ratings, dimensions, true);
  const flat = (xs: readonly number[]) => xs.length >= 2 && xs.every((x) => x === xs[0]);
  const out: RatingPattern[] = [];
  for (const raterId of team) {
    const mine = kept.filter((x) => x.rater_id === raterId);
    for (const rateeId of team) {
      const scores = mine.filter((x) => x.ratee_id === rateeId).map((x) => x.score);
      if (scores.length === dimensions.length && flat(scores)) {
        out.push({ kind: "same_every_dimension", raterId, rateeId });
      }
    }
    const teammates = team.length - 1;
    for (const dimension of dimensions) {
      const scores = mine
        .filter((x) => x.dimension === dimension && x.ratee_id !== raterId)
        .map((x) => x.score);
      if (scores.length === teammates && flat(scores)) {
        out.push({ kind: "same_for_everyone", raterId, dimension });
      }
    }
  }
  return out;
}
