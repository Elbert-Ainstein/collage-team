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
    avoidCurrent: true,
    avoidColumns: [],
    nameColumns: ["Name"],
    emailColumn: "Email",
    balance: [{ column: "gender", kind: "category", values: [] }],
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

  it("gives a different arrangement for another seed", () => {
    const a = planForm(proposal({ teamSize: 2 }), table, roster, teams, 1);
    const b = planForm(proposal({ teamSize: 2 }), table, roster, teams, 2);
    expect(a.proposal.moves).not.toEqual(b.proposal.moves);
  });
});
