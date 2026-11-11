import { describe, expect, it } from "vitest";
import { flagTeam, ratingPatterns } from "./flags";
import type { PeerDimension, PeerRating, PeerScore } from "./types";

const ONE: PeerDimension[] = ["contributing"];
const four = ["a", "b", "c", "d"];

const r = (rater_id: string, ratee_id: string, dimension: PeerDimension, score: PeerScore): PeerRating => ({
  activity_id: "x",
  rater_id,
  ratee_id,
  dimension,
  score,
  updated_at: "",
});

/** rater → ratee → score, the same on every dimension given. */
function grid(scores: Record<string, Record<string, PeerScore>>, dims: PeerDimension[] = ONE): PeerRating[] {
  return Object.entries(scores).flatMap(([rater, row]) =>
    Object.entries(row).flatMap(([ratee, score]) => dims.map((d) => r(rater, ratee, d, score))),
  );
}

/** Everyone on `team` rates every teammate `base`, then `over` replaces cells. */
function team(members: string[], base: PeerScore, over: Record<string, Record<string, PeerScore>> = {}) {
  const scores: Record<string, Record<string, PeerScore>> = {};
  for (const a of members) {
    scores[a] = {};
    for (const b of members) if (a !== b) scores[a][b] = base;
    Object.assign(scores[a], over[a] ?? {});
  }
  return grid(scores);
}

const flagsOf = (members: string[], ratings: PeerRating[]) =>
  new Map(flagTeam(members, ratings, ONE).map((f) => [f.studentId, f.flags]));

describe("flagTeam", () => {
  it("flags nothing on a team that rates everyone alike", () => {
    for (const f of flagsOf(four, team(four, 4)).values()) expect(f).toEqual([]);
  });

  it("Low: teammates rate them under 2.5", () => {
    const f = flagsOf(four, team(four, 4, { a: { d: 2 }, b: { d: 2 }, c: { d: 2 } }));
    expect(f.get("d")).toEqual(["low"]);
    // 4 is exactly half a point over the team's 3.5 — not "more than".
    expect(f.get("a")).toEqual([]);
  });

  it("High: over 3.5 and more than half a point over the team", () => {
    const f = flagsOf(four, team(four, 3, { a: { d: 5 }, b: { d: 5 }, c: { d: 5 } }));
    expect(f.get("d")).toContain("high");
  });

  it("Overconfident: rated under 3 by teammates, a point or more higher by themselves", () => {
    const ratings = [...team(four, 4, { b: { a: 2 }, c: { a: 2 }, d: { a: 2 } }), r("a", "a", "contributing", 4)];
    expect(flagsOf(four, ratings).get("a")).toContain("overconfident");
  });

  it("does not call a well-rated student overconfident for rating themselves higher still", () => {
    const ratings = [...team(four, 4), r("a", "a", "contributing", 5)];
    expect(flagsOf(four, ratings).get("a")).not.toContain("overconfident");
  });

  it("Underconfident: rated over 3 by teammates, a point or more lower by themselves", () => {
    const ratings = [...team(four, 4), r("a", "a", "contributing", 2)];
    expect(flagsOf(four, ratings).get("a")).toEqual(["underconfident"]);
  });

  it("Manipulator: self 4+ and every teammate 2+ points lower", () => {
    const ratings = [...team(four, 4, { a: { b: 1, c: 1, d: 1 } }), r("a", "a", "contributing", 5)];
    expect(flagsOf(four, ratings).get("a")).toContain("manipulator");
  });

  it("is not a manipulator while any teammate is rated within 2 of self", () => {
    const ratings = [...team(four, 4, { a: { b: 4, c: 1, d: 1 } }), r("a", "a", "contributing", 5)];
    expect(flagsOf(four, ratings).get("a")).not.toContain("manipulator");
  });

  it("Conflict: on the rater who scored someone 2 or lower whom the rest rate 3+", () => {
    const f = flagsOf(four, team(four, 4, { b: { d: 1 }, a: { d: 5 } }));
    expect(f.get("b")).toContain("conflict");
    expect(f.get("d")).not.toContain("conflict");
  });

  it("is no conflict when the rest of the team rates them low too", () => {
    const f = flagsOf(four, team(four, 4, { a: { d: 2 }, b: { d: 2 }, c: { d: 2 } }));
    expect(f.get("a")).not.toContain("conflict");
  });

  // Three pairs who rate their partner 5 and everyone else 2. No one is Low
  // (each gets 5,2,2,2,2 = 2.6) and no 2 is a Conflict (the rest's median is
  // 2), but the spread is 1.2 points — so only Clique explains it.
  const six = ["a", "b", "c", "d", "e", "f"];
  const pairs = { a: { b: 5 }, b: { a: 5 }, c: { d: 5 }, d: { c: 5 }, e: { f: 5 }, f: { e: 5 } } as const;

  it("Clique: a team whose ratings spread wide with nothing else to explain it", () => {
    for (const f of flagsOf(six, team(six, 2, pairs)).values()) expect(f).toEqual(["clique"]);
  });

  it("Clique on a team of four, when scores swing within a dimension but even out", () => {
    // Every pair averages 3 overall — nobody is Low, High or in Conflict — but
    // each dimension is half 1s and half 5s.
    const TWO: PeerDimension[] = ["contributing", "quality"];
    const swing = (rater: string, ratee: string, up: boolean): PeerRating[] => [
      r(rater, ratee, "contributing", up ? 5 : 1),
      r(rater, ratee, "quality", up ? 1 : 5),
    ];
    const ratings = [
      ...swing("a", "b", true), ...swing("a", "c", false), ...swing("a", "d", true),
      ...swing("b", "a", false), ...swing("b", "c", true), ...swing("b", "d", false),
      ...swing("c", "a", true), ...swing("c", "b", false), ...swing("c", "d", true),
      ...swing("d", "a", false), ...swing("d", "b", true), ...swing("d", "c", false),
    ];
    for (const f of flagTeam(four, ratings, TWO)) expect(f.flags).toEqual(["clique"]);
  });

  it("gives way to any other flag on the team", () => {
    // b no longer rates a well, so a is Low — the spread now has an explanation.
    const f = flagsOf(six, team(six, 2, { ...pairs, b: { a: 2 } }));
    expect(f.get("a")).toEqual(["low"]);
    for (const flags of f.values()) expect(flags).not.toContain("clique");
  });

  it("ignores ratings from or about anyone off the team", () => {
    const ratings = [...team(four, 4), r("gone", "d", "contributing", 1), r("d", "gone", "contributing", 1)];
    for (const f of flagsOf(four, ratings).values()) expect(f).toEqual([]);
  });
});

describe("ratingPatterns", () => {
  const TWO: PeerDimension[] = ["contributing", "quality"];

  it("spots a rater giving one person the same score on every dimension", () => {
    const ratings = [
      r("a", "b", "contributing", 4), r("a", "b", "quality", 4),
      r("a", "c", "contributing", 3), r("a", "c", "quality", 5),
    ];
    expect(ratingPatterns(["a", "b", "c"], ratings, TWO)).toEqual([
      { kind: "same_every_dimension", raterId: "a", rateeId: "b" },
    ]);
  });

  it("spots a rater giving everyone the same score on a dimension", () => {
    const ratings = [
      r("a", "b", "contributing", 4), r("a", "c", "contributing", 4),
      r("a", "b", "quality", 2), r("a", "c", "quality", 5),
    ];
    expect(ratingPatterns(["a", "b", "c"], ratings, TWO)).toEqual([
      { kind: "same_for_everyone", raterId: "a", dimension: "contributing" },
    ]);
  });

  it("needs two things to compare: one dimension, or one ratee, never trips it", () => {
    expect(ratingPatterns(["a", "b"], [r("a", "b", "contributing", 4)], ["contributing"])).toEqual([]);
  });

  it("does not count a half-finished rater as flat", () => {
    const ratings = [r("a", "b", "contributing", 4)];
    expect(ratingPatterns(["a", "b", "c"], ratings, TWO)).toEqual([]);
  });
});

describe("review fixes", () => {
  const THREE: PeerDimension[] = ["contributing", "quality", "knowledge"];
  const scores = (rater: string, ratee: string, xs: PeerScore[]): PeerRating[] =>
    THREE.map((d, i) => r(rater, ratee, d, xs[i]));

  it("Manipulator on its own, when the low scores aren't low enough for Conflict", () => {
    const ratings = [...team(four, 4, { a: { b: 3, c: 3, d: 3 } }), r("a", "a", "contributing", 5)];
    expect(flagsOf(four, ratings).get("a")).toEqual(["manipulator"]);
  });

  it("is no manipulator alone on a team", () => {
    const ratings = [r("a", "a", "contributing", 5)];
    expect(flagTeam(["a"], ratings, ONE)[0].flags).toEqual([]);
  });

  it("fires at exactly the gap, even when the means are thirds", () => {
    // Self 13/3, every teammate 7/3: exactly 2 below, which floats as 1.9999…
    const ratings = [
      ...scores("a", "a", [5, 4, 4]),
      ...scores("a", "b", [3, 2, 2]), ...scores("a", "c", [3, 2, 2]),
      ...scores("b", "a", [4, 4, 4]), ...scores("b", "c", [4, 4, 4]),
      ...scores("c", "a", [4, 4, 4]), ...scores("c", "b", [4, 4, 4]),
    ];
    expect(flagTeam(["a", "b", "c"], ratings, THREE)[0].flags).toContain("manipulator");
  });

  it("Overconfident at exactly a point, in thirds", () => {
    // Teammates say 5/3, self says 8/3.
    const ratings = [
      ...scores("a", "a", [3, 3, 2]),
      ...scores("b", "a", [2, 2, 1]), ...scores("c", "a", [2, 2, 1]),
    ];
    expect(flagTeam(["a", "b", "c"], ratings, THREE)[0].flags).toContain("overconfident");
  });

  it("ignores stray self scores when the evaluation doesn't ask for them", () => {
    const ratings = [...team(four, 2), r("a", "a", "contributing", 5)];
    const a = flagTeam(four, ratings, ONE, false)[0];
    expect(a.flags).not.toContain("overconfident");
  });

  it("does not call a rater flat until they've rated every teammate", () => {
    const TWO: PeerDimension[] = ["contributing", "quality"];
    const half = [r("a", "a", "contributing", 4), r("a", "b", "contributing", 4)];
    expect(ratingPatterns(["a", "b", "c"], half, TWO)).toEqual([]);
    const all = [...half, r("a", "c", "contributing", 4)];
    expect(ratingPatterns(["a", "b", "c"], all, TWO)).toEqual([
      { kind: "same_for_everyone", raterId: "a", dimension: "contributing" },
    ]);
  });
});
