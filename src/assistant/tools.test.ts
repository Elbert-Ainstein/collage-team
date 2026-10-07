// The model's tool input is the one thing in this feature nobody typed and
// nobody checked. These pin what parseToolCall lets through to the browser:
// the right shape, trimmed, bounded — and a clear refusal for anything else,
// rather than a half-read proposal the preview would then draw.

import { describe, expect, it } from "vitest";
import { parseToolCall, TOOLS } from "./tools";

describe("TOOLS", () => {
  it("declares the proposal tools with an object schema", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(["form_teams", "import_attachment", "prepare_import", "seat_students"]);
    for (const t of TOOLS) {
      expect(t.schema.type).toBe("object");
      expect(t.description.length).toBeGreaterThan(40);
    }
  });
});

describe("parseToolCall — seat_students", () => {
  it("reads moves to an existing team and to a new one", () => {
    const out = parseToolCall("seat_students", {
      summary: "  Move Ada to Team 3 and start Team Helix.  ",
      moves: [
        { student: "s1", to_team: "t3" },
        { student: "s2", to_new_team: " Team Helix " },
      ],
    });
    expect(out).toEqual({
      ok: true,
      proposal: {
        kind: "seat",
        summary: "Move Ada to Team 3 and start Team Helix.",
        moves: [
          { student: "s1", toTeam: "t3", toNewTeam: null },
          { student: "s2", toTeam: null, toNewTeam: "Team Helix" },
        ],
        renames: [],
        unresolved: [],
      },
    });
  });

  it("keeps renames and the entries the model could not resolve", () => {
    const out = parseToolCall("seat_students", {
      summary: "Rename team 2.",
      moves: [],
      renames: [{ team: "t2", name: "Ribosome" }],
      unresolved: [{ entry: "Jon S.", reason: "Could be Jon Smith or Jon Silva." }],
    });
    expect(out.ok).toBe(true);
    if (!out.ok || out.proposal.kind !== "seat") throw new Error("expected a seat proposal");
    expect(out.proposal.renames).toEqual([{ team: "t2", name: "Ribosome" }]);
    expect(out.proposal.unresolved).toEqual([
      { entry: "Jon S.", reason: "Could be Jon Smith or Jon Silva." },
    ]);
  });

  it("refuses a move that names no team, or both kinds", () => {
    expect(
      parseToolCall("seat_students", { summary: "x", moves: [{ student: "s1" }] }).ok,
    ).toBe(false);
    expect(
      parseToolCall("seat_students", {
        summary: "x",
        moves: [{ student: "s1", to_team: "t1", to_new_team: "New" }],
      }).ok,
    ).toBe(false);
  });

  it("reads an empty to_new_team or renames as absent, not as a broken draft", () => {
    const out = parseToolCall("seat_students", {
      summary: "x",
      moves: [
        { student: "s1", to_team: "t2", to_new_team: null },
        { student: "s2", to_team: "t1", to_new_team: "" },
      ],
      renames: null,
      unresolved: null,
    });
    expect(out.ok).toBe(true);
  });

  it("refuses a missing summary and a moves list that is not a list", () => {
    expect(parseToolCall("seat_students", { moves: [] }).ok).toBe(false);
    expect(parseToolCall("seat_students", { summary: "x", moves: "s1 to t1" }).ok).toBe(false);
  });

  it("refuses a team name too long to be a name", () => {
    const out = parseToolCall("seat_students", {
      summary: "x",
      moves: [{ student: "s1", to_new_team: "x".repeat(81) }],
    });
    expect(out.ok).toBe(false);
  });
});

describe("parseToolCall — prepare_import", () => {
  it("reads rows, lower-cases nothing, and turns a blank team into null", () => {
    const out = parseToolCall("prepare_import", {
      summary: "24 students on 6 teams.",
      rows: [
        { name: " Ada Lovelace ", email: "Ada@x.edu", team: 1 },
        { name: "Alan Turing", email: "", team: null },
        { name: "Grace Hopper" },
      ],
    });
    expect(out).toEqual({
      ok: true,
      proposal: {
        kind: "import",
        summary: "24 students on 6 teams.",
        rows: [
          { name: "Ada Lovelace", email: "Ada@x.edu", team: 1 },
          { name: "Alan Turing", email: null, team: null },
          { name: "Grace Hopper", email: null, team: null },
        ],
      },
    });
  });

  it("refuses a team that is not a whole number", () => {
    expect(
      parseToolCall("prepare_import", { summary: "x", rows: [{ name: "Ada", team: 2.5 }] }).ok,
    ).toBe(false);
    expect(
      parseToolCall("prepare_import", { summary: "x", rows: [{ name: "Ada", team: "Helix" }] }).ok,
    ).toBe(false);
  });

  it("refuses a row with no name, and an empty list", () => {
    expect(parseToolCall("prepare_import", { summary: "x", rows: [{ name: " " }] }).ok).toBe(false);
    expect(parseToolCall("prepare_import", { summary: "x", rows: [] }).ok).toBe(false);
  });
});

describe("parseToolCall — form_teams", () => {
  it("reads Kelly's rules as settings for the code that forms the teams", () => {
    const out = parseToolCall("form_teams", {
      summary: "New teams of 4, balanced, nobody with a current teammate.",
      team_size: 4,
      avoid_current_teammates: true,
      name_columns: ["Name"],
      email_column: "Email",
      balance: [
        { column: "Gender", kind: "category" },
        { column: "Pre-class assessment", kind: "number" },
        { column: "Track", kind: "category", values: ["Engineering", "Pre-med"] },
        { column: "Year", kind: "category", values: ["Freshman"] },
      ],
      not_applied: ["Keep the two TAs' sections separate"],
    });
    expect(out).toEqual({
      ok: true,
      proposal: {
        kind: "form",
        summary: "New teams of 4, balanced, nobody with a current teammate.",
        teamSize: 4,
        avoidCurrent: true,
        avoidColumns: [],
        nameColumns: ["Name"],
        emailColumn: "Email",
        balance: [
          { column: "Gender", kind: "category", values: [] },
          { column: "Pre-class assessment", kind: "number", values: [] },
          { column: "Track", kind: "category", values: ["Engineering", "Pre-med"] },
          { column: "Year", kind: "category", values: ["Freshman"] },
        ],
        noIsolation: [],
        atMost: [],
        notApplied: ["Keep the two TAs' sections separate"],
      },
    });
  });

  it("reads Kelly's second-round rules: nobody alone by gender, at most one first-year", () => {
    const out = parseToolCall("form_teams", {
      summary: "x",
      team_size: 4,
      avoid_together_columns: ["Team"],
      no_isolation_columns: ["Inferred Gender"],
      at_most: [{ column: "First-Year", values: ["Yes"], max: 1 }],
      balance: [{ column: "FCI Pre-Score", kind: "number" }],
      email_column: "Email Address",
    });
    expect(out.ok && out.proposal.kind === "form" && out.proposal).toMatchObject({
      avoidColumns: ["Team"],
      noIsolation: ["Inferred Gender"],
      atMost: [{ column: "First-Year", values: ["Yes"], max: 1 }],
    });
  });

  it("refuses an at-most rule with no values or a cap that is not a count", () => {
    expect(parseToolCall("form_teams", { summary: "x", team_size: 4, at_most: [{ column: "Y", values: [], max: 1 }] }).ok).toBe(false);
    expect(parseToolCall("form_teams", { summary: "x", team_size: 4, at_most: [{ column: "Y", values: ["Yes"], max: -1 }] }).ok).toBe(false);
  });

  it("works with no file at all — just no repeat teammates", () => {
    const out = parseToolCall("form_teams", { summary: "x", team_size: 4, avoid_current_teammates: true });
    expect(out.ok && out.proposal.kind === "form" && out.proposal.balance).toEqual([]);
  });

  it("refuses a team size that is not a size, and a balance kind it does not know", () => {
    expect(parseToolCall("form_teams", { summary: "x", team_size: 1 }).ok).toBe(false);
    expect(parseToolCall("form_teams", { summary: "x", team_size: 4.5 }).ok).toBe(false);
    expect(
      parseToolCall("form_teams", { summary: "x", team_size: 4, balance: [{ column: "G", kind: "vibes" }] }).ok,
    ).toBe(false);
  });
});

describe("parseToolCall — import_attachment", () => {
  it("needs only a summary", () => {
    expect(parseToolCall("import_attachment", { summary: "24 students on 6 teams." })).toEqual({
      ok: true,
      proposal: { kind: "import-file", summary: "24 students on 6 teams." },
    });
  });
});

describe("parseToolCall — anything else", () => {
  it("refuses a tool it did not offer, and input that is not an object", () => {
    expect(parseToolCall("delete_team", { team: "t1" }).ok).toBe(false);
    expect(parseToolCall("seat_students", null).ok).toBe(false);
    expect(parseToolCall("seat_students", ["s1"]).ok).toBe(false);
  });
});
