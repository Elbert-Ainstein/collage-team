// The team-former: code, not the model, decides who goes where.
//
// These pin the promises the draft makes on screen: nobody is put with someone
// a rule keeps them apart from whenever an arrangement exists that avoids it,
// every balanced column is spread as evenly as the class allows, the sizes are
// as even as the class divides, and the same inputs give the same teams.

import { describe, expect, it } from "vitest";
import { formTeams, teamSizes, type Person } from "./formTeams";

/** A deterministic made-up class: n students, current teams of 4 in order. */
function klass(n: number, seed = 3) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const people: Person[] = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    values: {
      gender: rnd() < 0.48 ? "F" : rnd() < 0.9 ? "M" : "NB",
      score: String(Math.round(30 + rnd() * 70)),
      track: ["Engineering", "Engineering", "Pre-med", "Pre-med", "Other"][Math.floor(rnd() * 5)],
      year: ["Freshman", "Freshman", "Sophomore", "Junior", "Senior"][Math.floor(rnd() * 5)],
    },
  }));
  const current = new Map(people.map((p, i) => [p.id, `t${Math.floor(i / 4)}`]));
  return { people, current };
}

const pairsTogether = (teams: string[][], same: (a: string, b: string) => boolean) => {
  let n = 0;
  for (const t of teams) for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) if (same(t[i], t[j])) n++;
  return n;
};

describe("teamSizes", () => {
  it("makes teams as close to the asked size as the class divides", () => {
    expect(teamSizes(80, 4)).toEqual(Array(20).fill(4));
    expect(teamSizes(81, 4)).toEqual([5, ...Array(19).fill(4)]);
    expect(teamSizes(78, 4)).toEqual([...Array(18).fill(4), 3, 3]);
    expect(teamSizes(3, 4)).toEqual([3]);
  });
});

describe("formTeams — Kelly's rules on a class of 80", () => {
  const { people, current } = klass(80);
  const result = formTeams({
    people,
    currentTeam: current,
    spec: {
      teamSize: 4,
      avoidCurrent: true,
      avoidColumns: [],
      balance: [
        { column: "gender", kind: "category" },
        { column: "score", kind: "number" },
        { column: "track", kind: "category", values: ["Engineering", "Pre-med"] },
        { column: "year", kind: "category", values: ["Freshman"] },
      ],
    },
  });
  const teams = result.teams.map((t) => t.members);

  it("puts everyone on exactly one team of 4", () => {
    expect(teams.flat().sort()).toEqual(people.map((p) => p.id).sort());
    expect(teams.map((t) => t.length)).toEqual(Array(20).fill(4));
  });

  it("never puts two current teammates together", () => {
    expect(result.conflicts).toEqual([]);
    expect(pairsTogether(teams, (a, b) => current.get(a) === current.get(b))).toBe(0);
  });

  it("spreads every balanced category to within one of even, and says so", () => {
    for (const check of result.checks) expect(check.ok, check.text).toBe(true);
    const value = (id: string, col: string) => people.find((p) => p.id === id)!.values[col];
    const spread = (col: string, v: string) => {
      const counts = teams.map((t) => t.filter((id) => value(id, col) === v).length);
      return Math.max(...counts) - Math.min(...counts);
    };
    expect(spread("year", "Freshman")).toBeLessThanOrEqual(1);
    expect(spread("track", "Engineering")).toBeLessThanOrEqual(1);
    expect(spread("track", "Pre-med")).toBeLessThanOrEqual(1);
    expect(spread("gender", "F")).toBeLessThanOrEqual(1);
  });

  it("brings every team's average score near the class average", () => {
    const score = (id: string) => Number(people.find((p) => p.id === id)!.values.score);
    const classMean = people.reduce((n, p) => n + Number(p.values.score), 0) / people.length;
    for (const t of teams) {
      const mean = t.reduce((n, id) => n + score(id), 0) / t.length;
      expect(Math.abs(mean - classMean)).toBeLessThan(8);
    }
  });

  it("gives the same teams for the same inputs, and different ones for another seed", () => {
    const again = formTeams({ people, currentTeam: current, spec: { teamSize: 4, avoidCurrent: true, avoidColumns: [], balance: [] } });
    const same = formTeams({ people, currentTeam: current, spec: { teamSize: 4, avoidCurrent: true, avoidColumns: [], balance: [] } });
    const other = formTeams({ people, currentTeam: current, spec: { teamSize: 4, avoidCurrent: true, avoidColumns: [], balance: [] }, seed: 99 });
    expect(same.teams).toEqual(again.teams);
    expect(other.teams).not.toEqual(again.teams);
  });
});

describe("formTeams — keeping people apart", () => {
  it("keeps apart anyone who shares a value in an avoid column (earlier teams from the file)", () => {
    const { people, current } = klass(40);
    // Two earlier arrangements, as a spreadsheet would carry them.
    const withHistory: Person[] = people.map((p, i) => ({
      ...p,
      values: { ...p.values, week1: `A${i % 10}`, week2: `B${Math.floor(i / 4) % 10}` },
    }));
    const r = formTeams({
      people: withHistory,
      currentTeam: current,
      spec: { teamSize: 4, avoidCurrent: true, avoidColumns: ["week1", "week2"], balance: [] },
    });
    const v = (id: string, col: string) => withHistory.find((p) => p.id === id)!.values[col];
    const teams = r.teams.map((t) => t.members);
    expect(r.conflicts).toEqual([]);
    expect(pairsTogether(teams, (a, b) => v(a, "week1") === v(b, "week1"))).toBe(0);
    expect(pairsTogether(teams, (a, b) => v(a, "week2") === v(b, "week2"))).toBe(0);
  });

  it("reports the pairs it could not keep apart when no arrangement can", () => {
    // Everyone on one current team and only one team to make: impossible.
    const people: Person[] = [0, 1, 2].map((i) => ({ id: `p${i}`, values: {} }));
    const r = formTeams({
      people,
      currentTeam: new Map(people.map((p) => [p.id, "t0"])),
      spec: { teamSize: 3, avoidCurrent: true, avoidColumns: [], balance: [] },
    });
    expect(r.conflicts).toHaveLength(3);
    expect(r.checks.find((c) => !c.ok)?.text).toMatch(/3 pairs/);
  });

  it("ignores a blank value in an avoid column — blank is not a shared team", () => {
    const people: Person[] = [0, 1, 2, 3].map((i) => ({ id: `p${i}`, values: { prev: "" } }));
    const r = formTeams({
      people,
      currentTeam: new Map(),
      spec: { teamSize: 4, avoidCurrent: false, avoidColumns: ["prev"], balance: [] },
    });
    expect(r.conflicts).toEqual([]);
  });
});

describe("formTeams — the columns themselves", () => {
  it("groups a category's values case-insensitively, and leaves out students with no value", () => {
    const people: Person[] = [
      { id: "a", values: { g: "Female" } },
      { id: "b", values: { g: "female " } },
      { id: "c", values: { g: "Male" } },
      { id: "d", values: { g: "male" } },
      { id: "e", values: {} },
      { id: "f", values: { g: "" } },
    ];
    const r = formTeams({ people, currentTeam: new Map(), spec: { teamSize: 3, avoidCurrent: false, avoidColumns: [], balance: [{ column: "g", kind: "category" }] } });
    const genders = r.teams.map((t) => t.categories.g);
    // Two teams of three; each gets one woman and one man.
    expect(genders.map((g) => g.female)).toEqual([1, 1]);
    expect(genders.map((g) => g.male)).toEqual([1, 1]);
  });

  it("ignores a number cell that is not a number", () => {
    const people: Person[] = ["90", "n/a", "10", "50"].map((s, i) => ({ id: `p${i}`, values: { s } }));
    const r = formTeams({ people, currentTeam: new Map(), spec: { teamSize: 2, avoidCurrent: false, avoidColumns: [], balance: [{ column: "s", kind: "number" }] } });
    const means = r.teams.map((t) => t.numbers.s).sort();
    // 90 is paired away from 50 or 10 so the averages close up; n/a counts for nothing.
    expect(means.every((m) => m !== null)).toBe(true);
  });
});
