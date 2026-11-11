// One team's peer evaluation, in the shape the screens ask questions of.
//
// Pure: the student's form ("what's left to rate"), the instructor's results
// table and a student's released summary all read the same numbers from here,
// so they cannot disagree. SCAFFOLD — not wired into a screen yet.
//
// Every function takes the team as a list of student ids from the activity's
// FROZEN roster. A rating of, or by, anyone not on it is dropped rather than
// counted: a student moved mid-term still has rows from the old team, and
// those belong to that team's evaluation, not this one.

import type { PeerDimension, PeerRating } from "./types";

export interface Gap {
  dimension: PeerDimension;
  rateeId: string;
}

/**
 * What this student still has to rate, dimension by dimension in the order
 * asked, teammates in team order. Empty means they can submit.
 */
export function missingFor(
  raterId: string,
  team: readonly string[],
  ratings: readonly PeerRating[],
  dimensions: readonly PeerDimension[],
  includeSelf: boolean,
): Gap[] {
  const have = new Set(
    ratings.filter((x) => x.rater_id === raterId).map((x) => `${x.dimension}|${x.ratee_id}`),
  );
  const ratees = includeSelf ? team : team.filter((id) => id !== raterId);
  return dimensions.flatMap((dimension) =>
    ratees
      .filter((rateeId) => !have.has(`${dimension}|${rateeId}`))
      .map((rateeId) => ({ dimension, rateeId })),
  );
}

export function isComplete(
  raterId: string,
  team: readonly string[],
  ratings: readonly PeerRating[],
  dimensions: readonly PeerDimension[],
  includeSelf: boolean,
): boolean {
  return missingFor(raterId, team, ratings, dimensions, includeSelf).length === 0;
}

export type ByDimension = Record<PeerDimension, number | null>;

export interface MemberSummary {
  studentId: string;
  /** Mean of teammates' scores per dimension; null when no teammate scored it. */
  fromPeers: ByDimension;
  /** Their score of themselves per dimension; null when they gave none. */
  self: ByDimension;
  /** Mean of every score teammates gave them, across dimensions. */
  peerOverall: number | null;
  selfOverall: number | null;
  /** How many teammates scored them at all. */
  raters: number;
  /** How many teammates scored them on each dimension. */
  ratersBy: Record<PeerDimension, number>;
  /**
   * Their average over the team's average, teammates' scores only. 1 is the
   * team's average member. Null when nobody rated them.
   */
  factor: number | null;
  /** The same, with their own scores counted among the rest. */
  factorWithSelf: number | null;
}

const mean = (xs: readonly number[]): number | null =>
  xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;

function perDimension(
  dimensions: readonly PeerDimension[],
  scores: (d: PeerDimension) => number[],
): ByDimension {
  const out = {} as ByDimension;
  for (const d of dimensions) out[d] = mean(scores(d));
  return out;
}

/**
 * The ratings that count: by and about members of the frozen team, on a
 * dimension the evaluation asks — and no self scores when it doesn't ask for
 * them, so rows left from before the instructor switched self-rating off, or
 * from a stale tab, can't move a number.
 */
export function keepRatings(
  team: readonly string[],
  ratings: readonly PeerRating[],
  dimensions: readonly PeerDimension[],
  includeSelf: boolean,
): PeerRating[] {
  const onTeam = new Set(team);
  const asked = new Set(dimensions);
  return ratings.filter(
    (x) =>
      onTeam.has(x.rater_id) &&
      onTeam.has(x.ratee_id) &&
      asked.has(x.dimension) &&
      (includeSelf || x.rater_id !== x.ratee_id),
  );
}

/** a / mean(all), or null for a member with no average of their own. */
function ratios(avgs: readonly (number | null)[]): (number | null)[] {
  const teamAvg = mean(avgs.filter((v): v is number => v !== null));
  return avgs.map((v) => (v === null || teamAvg === null || teamAvg === 0 ? null : v / teamAvg));
}

/**
 * Every member's numbers. The factor follows CATME's: a student's average
 * rating divided by the average of the team's members' averages — so a
 * student nobody rated is left out of the team's average rather than counted
 * as a zero.
 */
export function summarizeTeam(
  team: readonly string[],
  ratings: readonly PeerRating[],
  dimensions: readonly PeerDimension[],
  includeSelf = true,
): MemberSummary[] {
  const kept = keepRatings(team, ratings, dimensions, includeSelf);

  const parts = team.map((id) => {
    const received = kept.filter((x) => x.ratee_id === id);
    const fromOthers = received.filter((x) => x.rater_id !== id);
    const own = received.filter((x) => x.rater_id === id);
    return {
      studentId: id,
      fromPeers: perDimension(dimensions, (d) => fromOthers.filter((x) => x.dimension === d).map((x) => x.score)),
      self: perDimension(dimensions, (d) => own.filter((x) => x.dimension === d).map((x) => x.score)),
      peerOverall: mean(fromOthers.map((x) => x.score)),
      selfOverall: mean(own.map((x) => x.score)),
      allOverall: mean(received.map((x) => x.score)),
      raters: new Set(fromOthers.map((x) => x.rater_id)).size,
      ratersBy: Object.fromEntries(
        dimensions.map((d) => [d, new Set(fromOthers.filter((x) => x.dimension === d).map((x) => x.rater_id)).size]),
      ) as Record<PeerDimension, number>,
    };
  });

  const factors = ratios(parts.map((p) => p.peerOverall));
  // With self: only for a member someone ELSE rated. Their own score alone is
  // not a rating, and a factor from it would reward rating yourself highly.
  const withSelf = ratios(parts.map((p) => (p.peerOverall === null ? null : p.allOverall)));

  return parts.map(({ allOverall: _all, ...p }, i) => ({
    ...p,
    factor: factors[i],
    factorWithSelf: withSelf[i],
  }));
}

export interface ApplyOptions {
  /** What the team's score is out of; the result never goes past it. */
  max: number;
  /**
   * The most a factor may lift a score — e.g. 1.05. A cap keeps a generous
   * team from turning one member's 90 into 112.
   */
  cap?: number;
}

/**
 * A team score turned into one member's, rounded to two places and never past
 * `max`. No factor (or one that isn't a number) leaves the team's score as it
 * is; a team score that isn't a number is a caller's bug, and says so.
 */
export function applyFactor(teamScore: number, factor: number | null, opts: ApplyOptions): number {
  if (!Number.isFinite(teamScore)) throw new RangeError(`Team score is not a number: ${teamScore}`);
  const raw = factor !== null && Number.isFinite(factor) ? factor : 1;
  const f = opts.cap === undefined ? raw : Math.min(raw, opts.cap);
  const scaled = Math.min(teamScore * f, opts.max);
  return Math.round(scaled * 100) / 100;
}

export interface FeedbackRow {
  dimension: PeerDimension;
  fromPeers: number | null;
  self: number | null;
  /** The mean of every member's teammates' average on this dimension. */
  team: number | null;
}

export interface Feedback {
  rows: FeedbackRow[];
  peerOverall: number | null;
  selfOverall: number | null;
}

/**
 * What a student sees of their own result once it is released: averages
 * only, never who said what.
 *
 * Null when fewer than `minRaters` teammates rated them on ANY dimension.
 * With one rater the "average" IS that teammate's scores, and on a team of
 * three the student knows exactly who that was — so two raters overall is not
 * enough if one of them stopped after the first screen. The caller should
 * pass only the ratings of students who submitted.
 */
export function feedbackFor(
  studentId: string,
  summaries: readonly MemberSummary[],
  dimensions: readonly PeerDimension[],
  minRaters: number,
): Feedback | null {
  const me = summaries.find((m) => m.studentId === studentId);
  if (!me || me.raters < minRaters) return null;
  if (dimensions.some((d) => (me.ratersBy[d] ?? 0) < minRaters)) return null;
  const rows = dimensions.map((dimension) => ({
    dimension,
    fromPeers: me.fromPeers[dimension],
    self: me.self[dimension],
    team: mean(
      summaries.map((m) => m.fromPeers[dimension]).filter((v): v is number => v !== null),
    ),
  }));
  return { rows, peerOverall: me.peerOverall, selfOverall: me.selfOverall };
}
