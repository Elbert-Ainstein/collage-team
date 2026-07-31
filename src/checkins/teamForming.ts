// Auto-forming, as a pure function so the rule is testable on its own.
//
// The design's rule: bucket students by the mix attribute, order the buckets
// largest-first, interleave round-robin across buckets, then deal into
// ceil(n / size) teams. The result is each team being as mixed as the class
// allows — the intent is to *mix* by an attribute, not to balance a score.

import { MIX_BY_NONE, type MixBy } from "./constants";
import type { Student } from "./types";

/** Fisher–Yates. Injectable so tests can form teams deterministically. */
export type Shuffle = <T>(items: T[]) => T[];

export const randomShuffle: Shuffle = (items) => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** The value a student is bucketed by; blank/absent collapses to one bucket. */
export function attrValue(student: Student, mixBy: MixBy): string {
  if (mixBy === MIX_BY_NONE) return "";
  return (student.attrs?.[mixBy] ?? "").trim();
}

/**
 * Order `pool` for dealing: bucket by the mix attribute, largest bucket first,
 * shuffled within each bucket, then concatenated.
 *
 * Concatenated, deliberately — *not* interleaved. Dealing is round-robin, so an
 * interleaved order aliases against the team count and un-mixes the result: with
 * two majors and two teams, alternating students hands each team exactly one
 * major. Keeping each bucket contiguous and rotating through the teams spreads
 * every bucket across all of them, which is what "as mixed as the class allows"
 * actually requires.
 */
export function orderForDealing(pool: Student[], mixBy: MixBy, shuffle: Shuffle): Student[] {
  if (mixBy === MIX_BY_NONE) return shuffle(pool);

  const buckets = new Map<string, Student[]>();
  for (const s of pool) {
    const key = attrValue(s, mixBy);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(s);
    else buckets.set(key, [s]);
  }

  // Shuffle within each bucket so a re-roll varies; largest bucket first so its
  // surplus is dealt while every team is still empty.
  return [...buckets.values()]
    .map((b) => shuffle(b))
    .sort((a, b) => b.length - a.length)
    .flat();
}

/**
 * Deal `pool` into teams of `size`, mixed by `mixBy`.
 *
 * Round-robin rather than sequential slicing: each attribute bucket is dealt
 * across all the teams in turn, so no team ends up holding one bucket. Sizes
 * come out within one of each other for free. Locked teams are handled by the
 * caller — their members never reach this pool.
 */
export function formTeams(
  pool: Student[],
  size: number,
  mixBy: MixBy,
  shuffle: Shuffle = randomShuffle,
): Student[][] {
  if (!pool.length) return [];
  const ordered = orderForDealing(pool, mixBy, shuffle);
  const count = Math.max(1, Math.ceil(ordered.length / size));
  const teams: Student[][] = Array.from({ length: count }, () => []);
  ordered.forEach((s, i) => teams[i % count].push(s));
  return teams;
}
