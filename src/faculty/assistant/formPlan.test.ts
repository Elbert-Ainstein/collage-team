// From the model's settings and the attached file to a draft the app can apply.
// The columns the model named are checked against the real file, the file is
// joined to the roster, the teams are formed by code, and the result is a
// seating — so Apply and Undo are the same as for any other draft.

import { describe, expect, it } from "vitest";
import type { FormProposal } from "@/assistant/types";
import { student, team } from "./fixtures";
import { planForm } from "./formPlan";
import { parseTable } from "./table";

const roster = Array.from({ length: 8 }, (_, i) => student(`id${i}`, `Student ${String.fromCharCode(65 + i)}`, `s${i}@x.edu`, i));
// Two current teams of four.
const teams = [team("tA", "Team 1", 0, roster.slice(0, 4)), team("tB", "Team 2", 1, roster.slice(4, 8))];
const csv = ["Name,Email,Gender", ...roster.map((s, i) => `${s.name},${s.email},${i % 2 ? "F" : "M"}`)].join("\n");
const table = parseTable(csv, "class.csv");

function proposal(over: Partial<FormProposal> = {}): FormProposal {
  return {
    kind: "form",
    summary: "New teams of 4.",
    teamSize: 4,
    leftovers: "either",
    teamCount: null,
    layout: [],
    avoidCurrent: true,
    avoidColumns: [],
    nameColumns: ["Name"],
    emailColumn: "Email",
    balance: [{ column: "gender", kind: "category", values: [] }],
    noIsolation: [],
    atMost: [],
    notApplied: [],
    ...over,
  };
}

describe("planForm", () => {
  it("forms the teams and lands them on the existing team rows, everyone moved", () => {
    const p = planForm(proposal({ teamSize: 2 }), table, roster, teams, 1);
    expect(p.problems).toEqual([]);
    expect(p.result?.conflicts).toEqual([]);
    expect(p.result?.teams).toHaveLength(4);
    // Two existing rows reused, two new ones named after them.
    expect(p.targets.map((t) => [t.name, t.teamId])).toEqual([
      ["Team 1", "tA"],
      ["Team 2", "tB"],
      ["Team 3", null],
      ["Team 4", null],
    ]);
    expect(p.proposal.moves).toHaveLength(8);
    expect(p.proposal.moves.filter((m) => m.toNewTeam).map((m) => m.toNewTeam)).toEqual(["Team 3", "Team 3", "Team 4", "Team 4"]);
  });

  it("with teams in use, lands them in a NEW set — Team 1 to Team N, no existing row reused", () => {
    const p = planForm(proposal({ teamSize: 2 }), table, roster, teams, 1, true);
    expect(p.intoNewSet).toBe(true);
    expect(p.targets).toEqual([
      { name: "Team 1", teamId: null },
      { name: "Team 2", teamId: null },
      { name: "Team 3", teamId: null },
      { name: "Team 4", teamId: null },
    ]);
    // Still kept apart from who they are with NOW — the set in use.
    expect(p.result?.conflicts).toEqual([]);
  });

  it("fills the set in use when nobody is on it yet, as before", () => {
    const empty = [team("tA", "Team 1", 0, []), team("tB", "Team 2", 1, [])];
    const p = planForm(proposal({ teamSize: 2 }), table, roster, empty, 1, true);
    expect(p.intoNewSet).toBe(false);
    expect(p.targets.slice(0, 2).map((t) => t.teamId)).toEqual(["tA", "tB"]);
  });

  it("finds a column whatever its case — the model may not copy it exactly", () => {
    const p = planForm(proposal(), table, roster, teams, 1);
    expect(p.problems).toEqual([]);
    expect(p.result?.checks.some((c) => c.text.startsWith("Gender"))).toBe(true);
  });

  it("refuses a column the file does not have, naming it", () => {
    const p = planForm(proposal({ balance: [{ column: "Major", kind: "category", values: [] }] }), table, roster, teams, 1);
    expect(p.problems).toEqual(['The file has no column called "Major".']);
    expect(p.result).toBeNull();
  });

  // A value the model names that the column does not hold would otherwise be
  // ignored by the team-former while the check still showed a tick.
  it("refuses a value the column does not hold, rather than ignoring the rule", () => {
    const p = planForm(proposal({ balance: [{ column: "Gender", kind: "category", values: ["Female"] }] }), table, roster, teams, 1);
    expect(p.problems).toEqual(['The "Gender" column has no value "Female" — it holds F, M.']);
  });

  it("finds a value whatever its case", () => {
    const p = planForm(proposal({ balance: [{ column: "Gender", kind: "category", values: ["f"] }] }), table, roster, teams, 1);
    expect(p.problems).toEqual([]);
  });

  // Separately: in teams of two, "nobody the only woman" and "at most one woman"
  // cannot both hold — the team-former would say so, which is not this test.
  it("passes a nobody-alone rule through, by the file's own column", () => {
    const p = planForm(proposal({ teamSize: 2, balance: [], noIsolation: ["GENDER"] }), table, roster, teams, 1);
    expect(p.problems).toEqual([]);
    const lone = p.result!.checks.find((c) => c.text.startsWith("Gender:"));
    expect(lone).toEqual({ ok: true, text: "Gender: nobody is the only M or the only F on their team." });
  });

  it("passes an at-most rule through, by the file's own value", () => {
    const p = planForm(proposal({ teamSize: 2, balance: [], atMost: [{ column: "gender", values: ["f"], max: 1 }] }), table, roster, teams, 1);
    expect(p.problems).toEqual([]);
    expect(p.result!.checks.find((c) => c.text.startsWith("Gender F"))).toMatchObject({ ok: true });
  });

  it("refuses an at-most value the column does not hold", () => {
    const p = planForm(proposal({ atMost: [{ column: "Gender", values: ["Woman"], max: 1 }] }), table, roster, teams, 1);
    expect(p.problems).toEqual(['The "Gender" column has no value "Woman" — it holds F, M.']);
  });

  it("says which students the file gives no earlier team, and places them", () => {
    const newcomer = student("idN", "Student New", "new@x.edu", 9);
    const withNew = parseTable(
      ["Name,Email,Gender,Team", ...roster.map((s, i) => `${s.name},${s.email},${i % 2 ? "F" : "M"},Old ${i % 4}`), "Student New,new@x.edu,F,N/A"].join("\n"),
      "f",
    );
    const p = planForm(
      proposal({ teamSize: 3, balance: [], avoidColumns: ["Team"], avoidCurrent: false }),
      withNew,
      [...roster, newcomer],
      teams,
      1,
    );
    expect(p.problems).toEqual([]);
    expect(p.result!.teams.some((t) => t.members.includes("idN"))).toBe(true);
    expect(p.notes.join(" ")).toMatch(/Student New has no Team in the file — counted as new to the course/);
  });

  it("refuses a rule that needs a file when none is attached", () => {
    const p = planForm(proposal(), null, roster, teams, 1);
    expect(p.problems[0]).toMatch(/attach/);
  });

  it("needs no file just to keep current teammates apart", () => {
    // Teams of 2: with two current teams of four, any team of four would have to
    // repeat a pair — formTeams.test pins that case (reported, never hidden).
    const p = planForm(proposal({ teamSize: 2, balance: [], nameColumns: [], emailColumn: null }), null, roster, teams, 1);
    expect(p.problems).toEqual([]);
    expect(p.result?.conflicts).toEqual([]);
  });

  it("says who the file and the roster disagree about", () => {
    const short = parseTable(["Name,Email,Gender", ...roster.slice(0, 7).map((s) => `${s.name},${s.email},F`), "Someone Else,se@x.edu,M"].join("\n"), "f");
    const p = planForm(proposal(), short, roster, teams, 1);
    expect(p.notes.join(" ")).toMatch(/Student H/);
    expect(p.notes.join(" ")).toMatch(/Someone Else/);
  });

  it("refuses a written-out layout that does not place the whole class, saying by how much", () => {
    const p = planForm(proposal({ layout: [{ size: 2, count: 1 }] }), table, roster, teams, 1);
    expect(p.result).toBeNull();
    expect(p.problems[0]).toMatch(new RegExp(`place 2 students, and the class has ${roster.length}`));
  });

  it("makes exactly the layout written out when it does add up", () => {
    const p = planForm(proposal({ layout: [{ size: roster.length, count: 1 }] }), table, roster, teams, 1);
    expect(p.result?.teams.map((t) => t.members.length)).toEqual([roster.length]);
  });

  it("gives a different arrangement for another seed", () => {
    const a = planForm(proposal({ teamSize: 2 }), table, roster, teams, 1);
    const b = planForm(proposal({ teamSize: 2 }), table, roster, teams, 2);
    expect(a.proposal.moves).not.toEqual(b.proposal.moves);
  });
});
