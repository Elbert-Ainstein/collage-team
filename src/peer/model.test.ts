import { describe, expect, it } from "vitest";
import {
  applyFactor,
  feedbackFor,
  isComplete,
  missingFor,
  summarizeTeam,
  type MemberSummary,
} from "./model";
import type { PeerDimension, PeerRating, PeerScore } from "./types";

const DIMS: PeerDimension[] = ["contributing", "interacting"];
const team = ["a", "b", "c"];

const r = (rater_id: string, ratee_id: string, dimension: PeerDimension, score: PeerScore): PeerRating => ({
  activity_id: "x",
  rater_id,
  ratee_id,
  dimension,
  score,
  updated_at: "",
});

/** Every rater gives every ratee the same score on every dimension. */
function grid(scores: Record<string, Record<string, PeerScore>>, dims = DIMS): PeerRating[] {
  return Object.entries(scores).flatMap(([rater, row]) =>
    Object.entries(row).flatMap(([ratee, score]) => dims.map((d) => r(rater, ratee, d, score))),
  );
}

const byId = (rows: MemberSummary[]) => new Map(rows.map((m) => [m.studentId, m]));

describe("missingFor", () => {
  it("asks for every teammate and themselves on every dimension when self is on", () => {
    expect(missingFor("a", team, [], DIMS, true)).toHaveLength(6);
  });

  it("does not ask a student to rate themselves when self is off", () => {
    const gaps = missingFor("a", team, [], DIMS, false);
    expect(gaps).toHaveLength(4);
    expect(gaps.every((g) => g.rateeId !== "a")).toBe(true);
  });

  it("ignores ratings written by someone else", () => {
    const theirs = grid({ b: { a: 3, b: 3, c: 3 } });
    expect(missingFor("a", team, theirs, DIMS, true)).toHaveLength(6);
  });

  it("ignores a rating of someone no longer on the frozen team", () => {
    const stale = [r("a", "gone", "contributing", 4)];
    expect(missingFor("a", team, stale, DIMS, true)).toHaveLength(6);
  });

  it("is empty once everything is rated", () => {
    const done = grid({ a: { a: 4, b: 3, c: 5 } });
    expect(missingFor("a", team, done, DIMS, true)).toEqual([]);
    expect(isComplete("a", team, done, DIMS, true)).toBe(true);
  });

  it("lists gaps in dimension order, then team order", () => {
    const some = [r("a", "a", "contributing", 3), r("a", "b", "contributing", 3)];
    expect(missingFor("a", team, some, DIMS, true)).toEqual([
      { dimension: "contributing", rateeId: "c" },
      { dimension: "interacting", rateeId: "a" },
      { dimension: "interacting", rateeId: "b" },
      { dimension: "interacting", rateeId: "c" },
    ]);
  });
});

describe("summarizeTeam", () => {
  it("averages what teammates said, apart from what the student said of themselves", () => {
    const ratings = grid({
      a: { a: 5, b: 3, c: 4 },
      b: { a: 2, b: 3, c: 4 },
      c: { a: 4, b: 3, c: 4 },
    });
    const a = byId(summarizeTeam(team, ratings, DIMS)).get("a")!;
    expect(a.fromPeers.contributing).toBe(3); // (2 + 4) / 2
    expect(a.self.contributing).toBe(5);
    expect(a.peerOverall).toBe(3);
    expect(a.selfOverall).toBe(5);
    expect(a.raters).toBe(2);
  });

  it("leaves a dimension null when no teammate rated it", () => {
    const ratings = [r("b", "a", "contributing", 4)];
    const a = byId(summarizeTeam(team, ratings, DIMS)).get("a")!;
    expect(a.fromPeers.contributing).toBe(4);
    expect(a.fromPeers.interacting).toBeNull();
    expect(a.peerOverall).toBe(4);
  });

  it("drops ratings from or about anyone off the frozen team", () => {
    const ratings = [r("gone", "a", "contributing", 1), r("b", "a", "contributing", 5)];
    const a = byId(summarizeTeam(team, ratings, DIMS)).get("a")!;
    expect(a.fromPeers.contributing).toBe(5);
    expect(a.raters).toBe(1);
  });

  it("drops ratings on a dimension the evaluation no longer asks", () => {
    const ratings = [r("b", "a", "quality", 1), r("b", "a", "contributing", 5)];
    const a = byId(summarizeTeam(team, ratings, DIMS)).get("a")!;
    expect(a.peerOverall).toBe(5);
  });
});

describe("adjustment factor", () => {
  it("is each student's average over the team's average", () => {
    // Without self: a gets 3, b gets 3, c gets 4.5 → team 3.5.
    const ratings = grid({
      a: { a: 5, b: 3, c: 4 },
      b: { a: 2, b: 3, c: 5 },
      c: { a: 4, b: 3, c: 4 },
    });
    const m = byId(summarizeTeam(team, ratings, DIMS));
    expect(m.get("a")!.factor).toBeCloseTo(3 / 3.5);
    expect(m.get("c")!.factor).toBeCloseTo(4.5 / 3.5);
  });

  it("counts the student's own rating in the with-self factor", () => {
    // With self: a (5+2+4)/3, b 3, c (4+5+4)/3.
    const ratings = grid({
      a: { a: 5, b: 3, c: 4 },
      b: { a: 2, b: 3, c: 5 },
      c: { a: 4, b: 3, c: 4 },
    });
    const m = byId(summarizeTeam(team, ratings, DIMS));
    const avgs = [11 / 3, 3, 13 / 3];
    const teamAvg = avgs.reduce((s, v) => s + v, 0) / 3;
    expect(m.get("a")!.factorWithSelf).toBeCloseTo(11 / 3 / teamAvg);
  });

  it("is 1 for everyone when everyone rates everyone the same", () => {
    const ratings = grid({ a: { a: 4, b: 4, c: 4 }, b: { a: 4, b: 4, c: 4 }, c: { a: 4, b: 4, c: 4 } });
    for (const m of summarizeTeam(team, ratings, DIMS)) expect(m.factor).toBe(1);
  });

  it("is null for a student nobody rated, and they do not drag the team average", () => {
    const ratings = grid({ a: { b: 4 }, b: { a: 2 } });
    const m = byId(summarizeTeam(team, ratings, DIMS));
    expect(m.get("c")!.factor).toBeNull();
    expect(m.get("a")!.factor).toBeCloseTo(2 / 3);
    expect(m.get("b")!.factor).toBeCloseTo(4 / 3);
  });
});

describe("applyFactor", () => {
  it("scales the team's score", () => {
    expect(applyFactor(80, 0.9, { max: 100 })).toBe(72);
  });

  it("caps the factor when asked", () => {
    expect(applyFactor(80, 1.3, { max: 100, cap: 1.05 })).toBe(84);
  });

  it("never goes past the maximum", () => {
    expect(applyFactor(98, 1.2, { max: 100 })).toBe(100);
  });

  it("leaves the team's score alone without a factor", () => {
    expect(applyFactor(80, null, { max: 100 })).toBe(80);
  });
});

describe("feedbackFor", () => {
  const ratings = grid({
    a: { a: 5, b: 3, c: 4 },
    b: { a: 2, b: 3, c: 4 },
    c: { a: 4, b: 3, c: 4 },
  });

  it("gives a student their teammates' average, their own, and the team's", () => {
    const fb = feedbackFor("a", summarizeTeam(team, ratings, DIMS), DIMS, 2);
    expect(fb).not.toBeNull();
    expect(fb!.rows[0]).toEqual({ dimension: "contributing", fromPeers: 3, self: 5, team: (3 + 3 + 4) / 3 });
  });

  it("shows nothing when too few teammates rated them to keep raters anonymous", () => {
    const one = ratings.filter((x) => x.rater_id !== "c");
    expect(feedbackFor("a", summarizeTeam(team, one, DIMS), DIMS, 2)).toBeNull();
  });

  it("shows nothing for a student who is not on the team", () => {
    expect(feedbackFor("zz", summarizeTeam(team, ratings, DIMS), DIMS, 2)).toBeNull();
  });
});

describe("review fixes", () => {
  it("hides feedback when one dimension was scored by a single teammate", () => {
    // c only got as far as one dimension, so "interacting" is b's score alone.
    const ratings = [
      ...grid({ b: { a: 4 } }),
      r("c", "a", "contributing", 2),
    ];
    const s = summarizeTeam(team, ratings, DIMS);
    expect(byId(s).get("a")!.raters).toBe(2);
    expect(feedbackFor("a", s, DIMS, 2)).toBeNull();
  });

  it("drops stray self scores when the evaluation doesn't ask for them", () => {
    const ratings = [...grid({ b: { a: 4 }, c: { a: 4 } }), ...grid({ a: { a: 1 } })];
    const a = byId(summarizeTeam(team, ratings, DIMS, false)).get("a")!;
    expect(a.selfOverall).toBeNull();
    expect(a.self.contributing).toBeNull();
    expect(a.factorWithSelf).toBe(a.factor);
  });

  it("leaves a self-only member without either factor", () => {
    const a = byId(summarizeTeam(team, grid({ a: { a: 5 } }), DIMS)).get("a")!;
    expect(a.factor).toBeNull();
    expect(a.factorWithSelf).toBeNull();
  });

  it("is empty for an empty team", () => {
    expect(summarizeTeam([], [], DIMS)).toEqual([]);
  });

  it("still caps a team score over the maximum when there is no factor", () => {
    expect(applyFactor(105, null, { max: 100 })).toBe(100);
  });

  it("treats a non-finite factor as no factor", () => {
    expect(applyFactor(80, Number.NaN, { max: 100 })).toBe(80);
  });

  it("refuses a team score that isn't a number", () => {
    expect(() => applyFactor(Number.NaN, 1, { max: 100 })).toThrow(RangeError);
  });
});
