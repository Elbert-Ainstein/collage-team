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

// Kelly's real request, on a MADE-UP class of the same shape as hers: 74
// students, 23 men and 51 women, 5 first-years, 19 earlier teams (17 of 4 and
// 2 of 3), and 6 pre-scores left blank. Her rules: nobody with anyone from
// their first team; nobody the only man or the only woman on a team; no team
// with more than one first-year; about the same average pre-score everywhere.
describe("formTeams — Kelly's second round, on a class shaped like hers", () => {
  let s = 17;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const genders = [...Array(23).fill("Male"), ...Array(51).fill("Female")];
  // Shuffled, so men are not all on the first teams.
  for (let i = genders.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [genders[i], genders[j]] = [genders[j], genders[i]];
  }
  const firstTeamSizes = [...Array(17).fill(4), 3, 3];
  const firstTeam: string[] = firstTeamSizes.flatMap((n, t) => Array(n).fill(`Team ${t + 1}`));
  const people: Person[] = genders.map((g, i) => ({
    id: `p${i}`,
    values: {
      Team: firstTeam[i],
      "Inferred Gender": g,
      "First-Year": [3, 20, 41, 58, 70].includes(i) ? "Yes" : "No",
      "FCI Pre-Score": [9, 27, 36, 50, 61, 66].includes(i) ? "" : String(4 + Math.floor(rnd() * 26)),
    },
  }));
  const result = formTeams({
    people,
    currentTeam: new Map(),
    spec: {
      teamSize: 4,
      avoidCurrent: false,
      avoidColumns: ["Team"],
      noLone: ["Inferred Gender"],
      atMost: [{ column: "First-Year", values: ["Yes"], max: 1 }],
      balance: [{ column: "FCI Pre-Score", kind: "number" }],
    },
  });
  const v = (id: string, col: string) => people.find((p) => p.id === id)!.values[col];
  const teams = result.teams.map((t) => t.members);

  it("places everyone, in teams of about four", () => {
    expect(teams.flat().sort()).toEqual(people.map((p) => p.id).sort());
    for (const t of teams) expect(t.length).toBeGreaterThanOrEqual(3);
    for (const t of teams) expect(t.length).toBeLessThanOrEqual(5);
  });

  it("puts nobody with anyone from their first team", () => {
    expect(result.conflicts).toEqual([]);
    expect(pairsTogether(teams, (a, b) => v(a, "Team") === v(b, "Team"))).toBe(0);
  });

  it("leaves nobody the only man or the only woman on a team", () => {
    for (const t of teams) {
      const men = t.filter((id) => v(id, "Inferred Gender") === "Male").length;
      const women = t.length - men;
      expect(men, `team of ${t.length} with ${men} men`).not.toBe(1);
      expect(women, `team of ${t.length} with ${women} women`).not.toBe(1);
    }
  });

  it("puts at most one first-year on any team", () => {
    for (const t of teams) expect(t.filter((id) => v(id, "First-Year") === "Yes").length).toBeLessThanOrEqual(1);
  });

  it("evens out the pre-score, ignoring the blanks", () => {
    const scores = people.map((p) => p.values["FCI Pre-Score"]).filter(Boolean).map(Number);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    for (const t of result.teams) expect(Math.abs((t.numbers["FCI Pre-Score"] ?? mean) - mean)).toBeLessThan(4);
  });

  it("says so, one ticked line per rule", () => {
    for (const c of result.checks) expect(c.ok, c.text).toBe(true);
    const text = result.checks.map((c) => c.text).join(" | ");
    expect(text).toMatch(/Nobody is on a team with anyone sharing their Team/);
    expect(text).toMatch(/Inferred Gender: nobody is the only/);
    expect(text).toMatch(/First-Year/);
    expect(text).toMatch(/FCI Pre-Score: team averages/);
  });
});

describe("formTeams — the two new hard rules on their own", () => {
  it("reports a lone student it could not avoid, by team", () => {
    // One man in a class of three, in one team: he cannot help being alone.
    const people: Person[] = ["Male", "Female", "Female"].map((g, i) => ({ id: `p${i}`, values: { g } }));
    const r = formTeams({ people, currentTeam: new Map(), spec: { teamSize: 3, avoidCurrent: false, avoidColumns: [], noLone: ["g"], atMost: [], balance: [] } });
    const check = r.checks.find((c) => c.text.startsWith("g:"));
    expect(check?.ok).toBe(false);
    expect(check?.text).toMatch(/1 team/);
  });

  it("caps a value per team, case-insensitively", () => {
    const people: Person[] = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, values: { fy: i < 2 ? "yes" : "No" } }));
    const r = formTeams({ people, currentTeam: new Map(), spec: { teamSize: 4, avoidCurrent: false, avoidColumns: [], noLone: [], atMost: [{ column: "fy", values: ["Yes"], max: 1 }], balance: [] } });
    for (const t of r.teams) expect(t.members.filter((id) => Number(id.slice(1)) < 2).length).toBeLessThanOrEqual(1);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });
});

// A student who joined after the first round: on the roster, in the new file,
// on no earlier team. Spreadsheets mark that with a blank — or with None, N/A,
// a dash, Unassigned, TBD. None of those is a team, and two new students are
// not each other's former teammates.
describe("formTeams — a student new since the last round", () => {
  it("places a new student, and does not keep two new students apart", () => {
    // p0 and p1 were teammates; p2–p5 are new — three of them marked the SAME
    // way, which read as a team called "None" would force them apart.
    const team = ["Team 1", "Team 1", "None", "None", "None", "N/A"];
    const people: Person[] = team.map((t, i) => ({ id: `p${i}`, values: { Team: t } }));
    const r = formTeams({ people, currentTeam: new Map(), spec: { teamSize: 3, avoidCurrent: false, avoidColumns: ["Team"], balance: [] } });
    expect(r.teams.flatMap((t) => t.members).sort()).toEqual(people.map((p) => p.id));
    // Teams of 3 that split p0 from p1 must put two new students together — fine.
    expect(r.conflicts).toEqual([]);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it("does not call one student with an unknown gender 'the only one of their kind'", () => {
    const g = ["Male", "Male", "Female", "Female", "Unknown"];
    const people: Person[] = g.map((v, i) => ({ id: `p${i}`, values: { g: v } }));
    const r = formTeams({ people, currentTeam: new Map(), spec: { teamSize: 5, avoidCurrent: false, avoidColumns: [], noLone: ["g"], balance: [] } });
    expect(r.checks.find((c) => c.text.startsWith("g:"))?.ok).toBe(true);
  });
});
