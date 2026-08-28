import { describe, expect, it } from "vitest";
import { isSupportedRosterFile, parseRoster } from "./rosterImport";

const names = (t: string) => parseRoster(t).students.map((s) => s.name);
const pairs = (t: string) => parseRoster(t).students;

describe("plain lists", () => {
  it("reads one name per line", () => {
    expect(names("Ada Lovelace\nGrace Hopper\nAlan Turing")).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
      "Alan Turing",
    ]);
  });

  it('flips "Last, First" without being fooled into splitting columns', () => {
    expect(names("Lovelace, Ada\nHopper, Grace")).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });

  it('keeps middle names when flipping: "Doe, Jane Marie"', () => {
    expect(names("Doe, Jane Marie")).toEqual(["Jane Marie Doe"]);
  });

  it("does not mangle a suffix", () => {
    expect(names('"King, Jr."')).toEqual(["King, Jr."]);
    expect(names('"Smith, III"')).toEqual(["Smith, III"]);
  });

  it("reads 'Name <email>'", () => {
    expect(pairs("Ada Lovelace <ada@harvard.edu>")).toEqual([
      { name: "Ada Lovelace", email: "ada@harvard.edu" },
    ]);
  });
});

describe("headers", () => {
  it("uses a name + email header", () => {
    const csv = "Name,Email\nAda Lovelace,ada@harvard.edu\nGrace Hopper,grace@harvard.edu";
    expect(pairs(csv)).toEqual([
      { name: "Ada Lovelace", email: "ada@harvard.edu" },
      { name: "Grace Hopper", email: "grace@harvard.edu" },
    ]);
  });

  it("joins separate first / last columns", () => {
    const csv = "First Name,Last Name,Email Address\nAda,Lovelace,ada@harvard.edu";
    expect(pairs(csv)).toEqual([{ name: "Ada Lovelace", email: "ada@harvard.edu" }]);
  });

  it("accepts Surname / Given name wording", () => {
    expect(names("Given Name,Surname\nAda,Lovelace")).toEqual(["Ada Lovelace"]);
  });

  it("finds a header that is not the first line", () => {
    const csv = [
      "Applied Physics 50 — Section A",
      "Generated 3 March 2026",
      "Name,Email",
      "Ada Lovelace,ada@harvard.edu",
    ].join("\n");
    const r = parseRoster(csv);
    expect(r.students).toEqual([{ name: "Ada Lovelace", email: "ada@harvard.edu" }]);
    expect(r.warnings.join(" ")).toMatch(/above the header/i);
  });

  it("is case- and spacing-insensitive about header names", () => {
    expect(pairs("STUDENT NAME , E-Mail\nAda Lovelace,ada@harvard.edu")).toEqual([
      { name: "Ada Lovelace", email: "ada@harvard.edu" },
    ]);
  });
});

describe("LMS and registrar exports", () => {
  it("handles a Canvas-style export with extra columns", () => {
    const csv = [
      "Student,ID,SIS User ID,SIS Login ID,Section",
      '"Lovelace, Ada",1234,99001,alovelace,AP50A',
      '"Hopper, Grace",1235,99002,ghopper,AP50A',
    ].join("\n");
    expect(names(csv)).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });

  it("does not treat a numeric id as a name", () => {
    const csv = "ID,Student\n1234,Ada Lovelace";
    expect(names(csv)).toEqual(["Ada Lovelace"]);
  });

  it("ignores report furniture rows", () => {
    const csv = [
      "Name,Email",
      "Ada Lovelace,ada@harvard.edu",
      "Showing 1-1 of 1",
      "Total: 1 student",
    ].join("\n");
    expect(names(csv)).toEqual(["Ada Lovelace"]);
  });

  it("picks the email column over a login id that is not an address", () => {
    const csv = "Student,Login ID,Email\nAda Lovelace,alovelace,ada@harvard.edu";
    expect(pairs(csv)).toEqual([{ name: "Ada Lovelace", email: "ada@harvard.edu" }]);
  });
});

describe("delimiters and encodings", () => {
  it("reads tab-separated files", () => {
    expect(pairs("Name\tEmail\nAda Lovelace\tada@harvard.edu")).toEqual([
      { name: "Ada Lovelace", email: "ada@harvard.edu" },
    ]);
  });

  it("reads semicolon-separated files (European Excel)", () => {
    expect(pairs("Name;Email\nAda Lovelace;ada@harvard.edu")).toEqual([
      { name: "Ada Lovelace", email: "ada@harvard.edu" },
    ]);
  });

  it("reads pipe-separated files", () => {
    expect(names("Name|Email\nAda Lovelace|ada@harvard.edu")).toEqual(["Ada Lovelace"]);
  });

  it("survives CRLF line endings", () => {
    expect(names("Name,Email\r\nAda Lovelace,ada@harvard.edu\r\n")).toEqual(["Ada Lovelace"]);
  });

  it("strips Excel's byte-order mark", () => {
    expect(names("﻿Name\nAda Lovelace")).toEqual(["Ada Lovelace"]);
  });

  it("handles non-breaking spaces and smart quotes", () => {
    expect(names("Ada Lovelace\n“Hopper, Grace”")).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
    ]);
  });

  it("handles quoted fields containing the delimiter", () => {
    const csv = 'Name,Note\n"Lovelace, Ada","enrolled, late"';
    expect(names(csv)).toEqual(["Ada Lovelace"]);
  });

  it("handles doubled quotes inside a field", () => {
    expect(names('Name\n"Ada ""Add"" Lovelace"')).toEqual(['Ada "Add" Lovelace']);
  });
});

describe("names the parser must not reject or mangle", () => {
  it("keeps single-word names", () => {
    expect(names("Prince\nMadonna")).toEqual(["Prince", "Madonna"]);
  });

  it("keeps name particles in the right order when flipping", () => {
    expect(names("van der Berg, Jan\nde la Cruz, Maria")).toEqual([
      "Jan van der Berg",
      "Maria de la Cruz",
    ]);
  });

  it("keeps non-Latin names", () => {
    expect(names("李雷\n山田 太郎")).toEqual(["李雷", "山田 太郎"]);
  });

  it("keeps a name containing a numeral", () => {
    expect(names("Henry VIII\nLouis 14")).toEqual(["Henry VIII", "Louis 14"]);
  });
});

describe("names with real-world characters", () => {
  it("keeps accents, apostrophes and hyphens", () => {
    expect(names("Chien-Shiung Wu\nSiobhán O'Brien\nJosé Álvarez")).toEqual([
      "Chien-Shiung Wu",
      "Siobhán O'Brien",
      "José Álvarez",
    ]);
  });

  it("collapses runs of whitespace", () => {
    expect(names("Ada    Lovelace")).toEqual(["Ada Lovelace"]);
  });
});

describe("hygiene", () => {
  it("skips blank rows and separator-only rows", () => {
    expect(names("Ada Lovelace\n\n,,,\nGrace Hopper")).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });

  it("de-duplicates by name", () => {
    const r = parseRoster("Ada Lovelace\nAda Lovelace\nGrace Hopper");
    expect(r.students.map((s) => s.name)).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(r.warnings.join(" ")).toMatch(/duplicate/i);
  });

  it("keeps two students who genuinely share a name, and says so", () => {
    // Dropping one would silently remove a real person from the class.
    const csv = "Name,Email\nJohn Smith,john1@harvard.edu\nJohn Smith,john2@harvard.edu";
    const r = parseRoster(csv);
    expect(r.students).toHaveLength(2);
    expect(r.warnings.join(" ")).toMatch(/shared by more than one student/i);
  });

  it("keeps siblings who share one address, and flags that they cannot both sign in", () => {
    const csv = "Name,Email\nAmy Chen,family@harvard.edu\nBen Chen,family@harvard.edu";
    const r = parseRoster(csv);
    expect(r.students.map((s) => s.name)).toEqual(["Amy Chen", "Ben Chen"]);
    expect(r.warnings.join(" ")).toMatch(/more than one student/i);
  });

  it("collapses a true repeat and keeps the copy that has an address", () => {
    const csv = "Name,Email\nAda Lovelace,\nAda Lovelace,ada@harvard.edu";
    const r = parseRoster(csv);
    expect(r.students).toEqual([{ name: "Ada Lovelace", email: "ada@harvard.edu" }]);
  });

  it("strips a mailto: prefix, which would never match a login", () => {
    expect(pairs("Name,Email\nAda Lovelace,mailto:Ada@Harvard.edu")).toEqual([
      { name: "Ada Lovelace", email: "ada@harvard.edu" },
    ]);
  });

  it("keeps plus-tagged addresses intact", () => {
    expect(pairs("Name,Email\nAda Lovelace,ada+ap50@harvard.edu")).toEqual([
      { name: "Ada Lovelace", email: "ada+ap50@harvard.edu" },
    ]);
  });

  it("lowercases addresses so linking is not case-sensitive", () => {
    expect(pairs("Name,Email\nAda Lovelace,Ada@Harvard.EDU")).toEqual([
      { name: "Ada Lovelace", email: "ada@harvard.edu" },
    ]);
  });

  it("drops a row that is only an email with no name", () => {
    const r = parseRoster("Name\nAda Lovelace\nnobody@harvard.edu");
    expect(r.students.map((s) => s.name)).toEqual(["Ada Lovelace"]);
  });

  it("warns when nobody has an email, since they could not sign in", () => {
    expect(parseRoster("Ada Lovelace\nGrace Hopper").warnings.join(" ")).toMatch(
      /cannot sign in|no email/i,
    );
  });

  it("warns when only some have an email", () => {
    const csv = "Name,Email\nAda Lovelace,ada@harvard.edu\nGrace Hopper,";
    expect(parseRoster(csv).warnings.join(" ")).toMatch(/1 of 2 have no email/i);
  });

  it("reports an empty file instead of throwing", () => {
    const r = parseRoster("   \n\n");
    expect(r.students).toHaveLength(0);
    expect(r.warnings.join(" ")).toMatch(/empty/i);
  });
});

describe("headerless files the parser must not silently rearrange", () => {
  it('reads "First,Last" forwards, not backwards', () => {
    expect(names("Ada,Lovelace\nGrace,Hopper\nAlan,Turing")).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
      "Alan Turing",
    ]);
  });

  it("does not fuse a section column onto the name", () => {
    expect(names("Ada Lovelace,Section A\nGrace Hopper,Section B")).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
    ]);
  });

  it("keeps the quote-aware split when collapsing an inverted list", () => {
    expect(names('"Lovelace, Ada",Ada\n"Hopper, Grace",Amazing Grace')).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
    ]);
  });

  it("does not invent a person from two names on one line", () => {
    const r = parseRoster("Ada Lovelace, Grace Hopper\nAlan Turing, Barbara Liskov");
    expect(r.students.map((s) => s.name)).toEqual(["Ada Lovelace", "Alan Turing"]);
    expect(r.warnings.join(" ")).toMatch(/no header row/i);
  });

  it("says so when it guesses at a headerless file", () => {
    expect(parseRoster("Ada,Lovelace").warnings.join(" ")).toMatch(/no header row/i);
    expect(parseRoster("Lovelace, Ada\nHopper, Grace").warnings.join(" ")).toMatch(
      /last, first/i,
    );
  });

  it("one mononym does not cost the whole class its first names", () => {
    expect(names("Lovelace, Ada\nHopper, Grace\nSukarno")).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
      "Sukarno",
    ]);
  });

  it("keeps a trailing suffix at the end of the name", () => {
    expect(names("Lovelace, Ada\nKing, Martin Luther, Jr.")).toEqual([
      "Ada Lovelace",
      "Martin Luther King, Jr.",
    ]);
  });
});

describe("delimiters that tie with the comma inside a name", () => {
  it("splits a headerless semicolon file on the semicolon", () => {
    expect(pairs("Lovelace, Ada;ada@harvard.edu\nHopper, Grace;grace@harvard.edu")).toEqual([
      { name: "Ada Lovelace", email: "ada@harvard.edu" },
      { name: "Grace Hopper", email: "grace@harvard.edu" },
    ]);
  });

  it("splits a headerless pipe file on the pipe, with a clean address", () => {
    expect(pairs("Lovelace, Ada|ada@harvard.edu")).toEqual([
      { name: "Ada Lovelace", email: "ada@harvard.edu" },
    ]);
  });

  it("splits a headerless tab file on the tab", () => {
    expect(pairs("Lovelace, Ada\tada@harvard.edu")).toEqual([
      { name: "Ada Lovelace", email: "ada@harvard.edu" },
    ]);
  });

  it("rejects a malformed address rather than storing an unusable login", () => {
    const r = parseRoster("Name,Email\nAlan Turing,alan@@x.edu");
    expect(r.students).toEqual([{ name: "Alan Turing" }]);
    expect(r.warnings.join(" ")).toMatch(/no email/i);
  });
});

describe("finding the real header", () => {
  it("looks past a decorative row that names no column", () => {
    const csv = "Course,Section\nCS50,A\nName,Email\nAda Lovelace,ada@harvard.edu";
    expect(pairs(csv)).toEqual([{ name: "Ada Lovelace", email: "ada@harvard.edu" }]);
  });

  it("is not fooled by a title line that merely starts with \"Sis\"", () => {
    const csv = "Sisters of Mercy College — AP50\nName,Email\nAda Lovelace,ada@harvard.edu";
    expect(pairs(csv)).toEqual([{ name: "Ada Lovelace", email: "ada@harvard.edu" }]);
  });
});

describe("isSupportedRosterFile", () => {
  it("accepts text roster formats and rejects workbooks", () => {
    expect(isSupportedRosterFile("roster.csv")).toBe(true);
    expect(isSupportedRosterFile("roster.TSV")).toBe(true);
    expect(isSupportedRosterFile("names.txt")).toBe(true);
    expect(isSupportedRosterFile("roster.xlsx")).toBe(false);
    expect(isSupportedRosterFile("roster.pdf")).toBe(false);
    expect(isSupportedRosterFile("roster.numbers")).toBe(false);
  });
});

describe("a team column with a header", () => {
  it("reads name, email and team", () => {
    const csv = [
      "Name,Email,Team",
      "Ada Lovelace,ada@harvard.edu,1",
      "Grace Hopper,grace@harvard.edu,1",
      "Alan Turing,alan@harvard.edu,2",
    ].join("\n");
    expect(pairs(csv)).toEqual([
      { name: "Ada Lovelace", email: "ada@harvard.edu", team: 1 },
      { name: "Grace Hopper", email: "grace@harvard.edu", team: 1 },
      { name: "Alan Turing", email: "alan@harvard.edu", team: 2 },
    ]);
  });

  it("accepts the headers a spreadsheet actually uses", () => {
    for (const header of ["Team", "Team #", "team number", "Team No.", "Group", "Group Number", "Table", "TABLE #"]) {
      expect(pairs(`Name,${header}\nAda Lovelace,4`)).toEqual([{ name: "Ada Lovelace", team: 4 }]);
    }
  });

  it('reads "Team 3" and "Group 3" as values, not just bare numbers', () => {
    expect(pairs("Name,Team\nAda Lovelace,Team 3\nGrace Hopper,Group #4\nAlan Turing,#5")).toEqual([
      { name: "Ada Lovelace", team: 3 },
      { name: "Grace Hopper", team: 4 },
      { name: "Alan Turing", team: 5 },
    ]);
  });

  it("treats a blank team cell as no team, which is not team 0", () => {
    const csv = "Name,Email,Team\nAda Lovelace,ada@harvard.edu,\nGrace Hopper,grace@harvard.edu,2";
    expect(pairs(csv)).toEqual([
      { name: "Ada Lovelace", email: "ada@harvard.edu", team: null },
      { name: "Grace Hopper", email: "grace@harvard.edu", team: 2 },
    ]);
  });

  it("lists team among the detected columns", () => {
    const r = parseRoster("Name,Email,Team\nAda Lovelace,ada@harvard.edu,1\nGrace Hopper,grace@harvard.edu,1");
    expect(r.warnings[0]).toMatch(/detected columns.*team/i);
  });

  it("does not claim a team column that produced no number", () => {
    const r = parseRoster("Name,Team\nAda Lovelace,\nGrace Hopper,");
    expect(r.warnings.join(" ")).not.toMatch(/detected column.*team/i);
  });

  it("keeps the team when it drops a duplicate of the same student", () => {
    const r = parseRoster("Name,Team\nAda Lovelace,\nAda Lovelace,3");
    expect(r.students).toEqual([{ name: "Ada Lovelace", team: 3 }]);
  });

  it("still finds the name and email columns around it", () => {
    const csv = "Student,Team,Email\n\"Lovelace, Ada\",2,ada@harvard.edu";
    expect(pairs(csv)).toEqual([{ name: "Ada Lovelace", email: "ada@harvard.edu", team: 2 }]);
  });
});

describe("a roster with no team column is unchanged", () => {
  it("leaves team off the student entirely", () => {
    const r = parseRoster("Name,Email\nAda Lovelace,ada@harvard.edu");
    expect(r.students[0]).not.toHaveProperty("team");
  });

  it("does not invent a team from a headered file that names no team column", () => {
    // The header answered the question already: there is no team here, and the
    // ID column must not be read as one.
    const csv = "Name,ID,Email\nAda Lovelace,7,ada@harvard.edu\nGrace Hopper,7,grace@harvard.edu";
    expect(pairs(csv)).toEqual([
      { name: "Ada Lovelace", email: "ada@harvard.edu" },
      { name: "Grace Hopper", email: "grace@harvard.edu" },
    ]);
  });
});

describe("a headerless team column", () => {
  const headerless = (third: string[]) =>
    ["Ada Lovelace,ada@harvard.edu", "Grace Hopper,grace@harvard.edu", "Alan Turing,alan@harvard.edu"]
      .map((row, i) => `${row},${third[i]}`)
      .join("\n");

  it("reads three columns pasted with no header at all", () => {
    expect(pairs(headerless(["1", "1", "2"]))).toEqual([
      { name: "Ada Lovelace", email: "ada@harvard.edu", team: 1 },
      { name: "Grace Hopper", email: "grace@harvard.edu", team: 1 },
      { name: "Alan Turing", email: "alan@harvard.edu", team: 2 },
    ]);
  });

  it("says that it guessed", () => {
    expect(parseRoster(headerless(["1", "1", "2"])).warnings.join(" ")).toMatch(
      /no header row — a column of numbers was read as the team/i,
    );
  });

  it("allows a student with no team on a line of their own", () => {
    const csv = [
      "Ada Lovelace,ada@harvard.edu,1",
      "Grace Hopper,grace@harvard.edu,",
      "Alan Turing,alan@harvard.edu,1",
      "Barbara Liskov,barbara@harvard.edu,2",
    ].join("\n");
    expect(pairs(csv)).toEqual([
      { name: "Ada Lovelace", email: "ada@harvard.edu", team: 1 },
      { name: "Grace Hopper", email: "grace@harvard.edu", team: null },
      { name: "Alan Turing", email: "alan@harvard.edu", team: 1 },
      { name: "Barbara Liskov", email: "barbara@harvard.edu", team: 2 },
    ]);
  });

  it('reads "Team 3" without needing the numbers to repeat', () => {
    expect(pairs(headerless(["Team 3", "Team 4", "Team 5"]))).toEqual([
      { name: "Ada Lovelace", email: "ada@harvard.edu", team: 3 },
      { name: "Grace Hopper", email: "grace@harvard.edu", team: 4 },
      { name: "Alan Turing", email: "alan@harvard.edu", team: 5 },
    ]);
  });

  it('does not claim to have guessed when the file spells out "Team"', () => {
    expect(parseRoster(headerless(["Team 3", "Team 4", "Team 5"])).warnings.join(" ")).not.toMatch(
      /read as the team/i,
    );
  });

  it("does not fuse a spelled-out team onto the name", () => {
    expect(names("Ada,Table 7\nGrace,Table 7\nAlan,Table 8")).toEqual(["Ada", "Grace", "Alan"]);
    expect(parseRoster("Ada,Table 7\nGrace,Table 7\nAlan,Table 8").students[0].team).toBe(7);
  });

  it("works without an email column in between", () => {
    expect(pairs("Ada Lovelace,1\nGrace Hopper,1\nAlan Turing,2")).toEqual([
      { name: "Ada Lovelace", team: 1 },
      { name: "Grace Hopper", team: 1 },
      { name: "Alan Turing", team: 2 },
    ]);
  });
});

describe("numbers a headerless file must not mistake for a team", () => {
  const withThird = (third: string[]) =>
    parseRoster(
      ["Ada Lovelace,ada@harvard.edu", "Grace Hopper,grace@harvard.edu", "Alan Turing,alan@harvard.edu"]
        .map((row, i) => `${row},${third[i]}`)
        .join("\n"),
    ).students;

  const noTeams = (rows: ReturnType<typeof withThird>) => rows.every((s) => s.team === undefined);

  it("refuses a student id, which is distinct per student", () => {
    expect(noTeams(withThird(["90210", "90211", "90212"]))).toBe(true);
  });

  it("refuses a short id that would fit inside the team range", () => {
    expect(noTeams(withThird(["11", "12", "13"]))).toBe(true);
  });

  it("refuses a row number", () => {
    expect(noTeams(withThird(["1", "2", "3"]))).toBe(true);
  });

  it("refuses a year", () => {
    expect(noTeams(withThird(["2027", "2027", "2028"]))).toBe(true);
  });

  it("refuses a phone number", () => {
    expect(noTeams(withThird(["617-555-0101", "617-555-0102", "617-555-0103"]))).toBe(true);
  });

  it("refuses a 0/1 flag column", () => {
    expect(noTeams(withThird(["1", "0", "1"]))).toBe(true);
  });

  it("refuses a column where every value is the same", () => {
    expect(noTeams(withThird(["1", "1", "1"]))).toBe(true);
  });

  it("refuses a graduation year even when it repeats", () => {
    expect(noTeams(withThird(["2027", "2028", "2027"]))).toBe(true);
  });

  it("refuses a column of letters, which is not a number in any spelling", () => {
    expect(noTeams(withThird(["A", "A", "B"]))).toBe(true);
  });

  it("refuses a column of two teams where nothing repeats", () => {
    // Two students on two teams is indistinguishable from two students with two
    // ids, and half a class of eighty would be on a team of one.
    expect(noTeams(withThird(["1", "2", ""]))).toBe(true);
  });
});

describe("teams that are named rather than numbered", () => {
  it("warns instead of numbering them itself, under a Team header", () => {
    const r = parseRoster("Name,Team\nAda Lovelace,Red\nGrace Hopper,Red\nAlan Turing,Helix");
    expect(r.students).toEqual([
      { name: "Ada Lovelace", team: null },
      { name: "Grace Hopper", team: null },
      { name: "Alan Turing", team: null },
    ]);
    expect(r.warnings.join(" ")).toMatch(/not a number.*“Red”/i);
  });

  it('warns at a headerless "Team Red", where the intent is unmistakable', () => {
    const r = parseRoster(
      "Ada Lovelace,ada@harvard.edu,Team Red\nGrace Hopper,grace@harvard.edu,Team Helix",
    );
    expect(r.students.map((s) => s.team)).toEqual([null, null]);
    expect(r.warnings.join(" ")).toMatch(/not a number/i);
  });

  it("does not warn about a headerless column of words that never says team", () => {
    // "Physics" could be a major, a dorm or a note; guessing it is a team, even
    // to complain about it, would cry wolf on ordinary rosters.
    const r = parseRoster("Ada Lovelace,ada@harvard.edu,Physics\nGrace Hopper,grace@harvard.edu,Physics");
    expect(r.warnings.join(" ")).not.toMatch(/not a number/i);
  });

  it("keeps the numbered rows when only some rows are named", () => {
    const r = parseRoster("Name,Team\nAda Lovelace,1\nGrace Hopper,Red");
    expect(r.students).toEqual([
      { name: "Ada Lovelace", team: 1 },
      { name: "Grace Hopper", team: null },
    ]);
    expect(r.warnings.join(" ")).toMatch(/1 row came in with no team/i);
  });
});
