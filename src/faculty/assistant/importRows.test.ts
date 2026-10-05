// The assistant's rows go into the Teams importer as text, through the same
// parseRoster a dropped file goes through — so they get the same cleaning and
// the same preview. These pin that nothing is lost on the way through.

import { describe, expect, it } from "vitest";
import { parseRoster } from "@/checkins/rosterImport";
import { emailsNotIn, rowsToCsv } from "./importRows";

// An address is what a student signs in with, so one the model mis-copied is a
// roster row nobody can ever claim. Every address it hands over has to be one
// the instructor actually typed or pasted.
describe("emailsNotIn", () => {
  const rows = [
    { name: "Ada Lovelace", email: "ada@x.edu", team: 1 },
    { name: "Alan Turing", email: "alan@x.edu", team: 1 },
    { name: "Grace Hopper", email: null, team: 2 },
  ];

  it("finds nothing when every address appears in what she sent, in any case", () => {
    expect(emailsNotIn(rows, ["Team 1: ADA@x.edu, alan@X.edu\nTeam 2: Grace Hopper"])).toEqual([]);
  });

  it("looks across every message she sent, not only the last", () => {
    expect(emailsNotIn(rows, ["ada@x.edu", "and alan@x.edu"])).toEqual([]);
  });

  it("names an address she never wrote", () => {
    expect(emailsNotIn(rows, ["Team 1: ada@x.edu, Alan Turing"])).toEqual(["alan@x.edu"]);
  });

  it("does not take a longer address as a match for a shorter one", () => {
    expect(emailsNotIn([{ name: "Al", email: "al@x.edu", team: 1 }], ["sal@x.edu"])).toEqual(["al@x.edu"]);
  });
});

describe("rowsToCsv", () => {
  it("round-trips through parseRoster: names, emails and team numbers", () => {
    const rows = [
      { name: "Ada Lovelace", email: "ada@x.edu", team: 1 },
      { name: "Alan Turing", email: null, team: 2 },
      { name: "Grace Hopper", email: "grace@x.edu", team: null },
    ];
    const parsed = parseRoster(rowsToCsv(rows));
    expect(parsed.students).toEqual([
      { name: "Ada Lovelace", email: "ada@x.edu", team: 1 },
      { name: "Alan Turing", team: 2 },
      { name: "Grace Hopper", email: "grace@x.edu", team: null },
    ]);
  });

  it("quotes a name with a comma or a quote in it", () => {
    const csv = rowsToCsv([{ name: 'Ada "Countess" Lovelace, Jr', email: null, team: 3 }]);
    expect(csv.split("\n")[1]).toBe('"Ada ""Countess"" Lovelace, Jr",,3');
  });

  it("keeps an accented name intact", () => {
    const parsed = parseRoster(rowsToCsv([{ name: "Zoë Ångström", email: "zoe@x.edu", team: 4 }]));
    expect(parsed.students[0]).toMatchObject({ name: "Zoë Ångström", team: 4 });
  });
});
