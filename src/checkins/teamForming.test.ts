import { describe, expect, it } from "vitest";
import { attrValue, formTeams, orderForDealing, type Shuffle } from "./teamForming";
import { MIX_BY_NONE } from "./constants";
import type { Student, StudentAttrs } from "./types";

/** Identity "shuffle", so the dealing rule is what is under test. */
const noShuffle: Shuffle = (items) => [...items];

let seq = 0;
function student(name: string, attrs: StudentAttrs = {}): Student {
  seq += 1;
  return {
    id: `s${seq}`,
    course_id: "c1",
    name,
    email: null,
    avatar_tint: null,
    attrs,
    position: seq,
    created_at: "2026-01-01T00:00:00Z",
  };
}

const majors = (n: number, major: string) =>
  Array.from({ length: n }, (_, i) => student(`${major}${i + 1}`, { major }));

describe("attrValue", () => {
  it("is blank when mixing by nothing", () => {
    expect(attrValue(student("A", { major: "CS" }), MIX_BY_NONE)).toBe("");
  });

  it("collapses a missing attribute to one bucket", () => {
    expect(attrValue(student("A"), "major")).toBe("");
  });
});

describe("orderForDealing", () => {
  it("keeps each bucket contiguous, largest first", () => {
    const pool = [...majors(2, "cs"), ...majors(3, "bio")];
    const out = orderForDealing(pool, "major", noShuffle).map((s) => s.attrs.major);
    expect(out).toEqual(["bio", "bio", "bio", "cs", "cs"]);
  });

  it("keeps everyone exactly once", () => {
    const pool = [...majors(4, "bio"), ...majors(3, "cs"), ...majors(2, "chem")];
    const out = orderForDealing(pool, "major", noShuffle);
    expect(out).toHaveLength(pool.length);
    expect(new Set(out.map((s) => s.id)).size).toBe(pool.length);
  });
});

describe("formTeams", () => {
  it("deals into ceil(n / size) teams", () => {
    const teams = formTeams(majors(10, "bio"), 4, MIX_BY_NONE, noShuffle);
    expect(teams).toHaveLength(3); // ceil(10 / 4)
    expect(teams.flat()).toHaveLength(10);
  });

  it("places every student exactly once", () => {
    const pool = majors(23, "bio");
    const ids = formTeams(pool, 4, MIX_BY_NONE, noShuffle).flat().map((s) => s.id);
    expect(ids).toHaveLength(23);
    expect(new Set(ids).size).toBe(23);
  });

  it("mixes each team by the attribute as far as the class allows", () => {
    // 8 students, two majors, teams of 4 → each team should hold both majors.
    const pool = [...majors(4, "bio"), ...majors(4, "cs")];
    const teams = formTeams(pool, 4, "major", noShuffle);
    expect(teams).toHaveLength(2);
    for (const team of teams) {
      const distinct = new Set(team.map((s) => s.attrs.major));
      expect(distinct.size).toBe(2);
    }
  });

  it("spreads a dominant major rather than clumping it", () => {
    // 6 bio + 2 cs, teams of 4 → the two cs students land in different teams.
    const pool = [...majors(6, "bio"), ...majors(2, "cs")];
    const teams = formTeams(pool, 4, "major", noShuffle);
    const withCs = teams.filter((t) => t.some((s) => s.attrs.major === "cs"));
    expect(withCs).toHaveLength(2);
  });

  it("keeps teams within one of the target size", () => {
    const teams = formTeams(majors(14, "bio"), 4, MIX_BY_NONE, noShuffle);
    const sizes = teams.map((t) => t.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it("returns nothing for an empty pool", () => {
    expect(formTeams([], 4, MIX_BY_NONE, noShuffle)).toEqual([]);
  });

  it("still forms one team when the class is smaller than a team", () => {
    const teams = formTeams(majors(2, "bio"), 4, MIX_BY_NONE, noShuffle);
    expect(teams).toHaveLength(1);
    expect(teams[0]).toHaveLength(2);
  });
});
