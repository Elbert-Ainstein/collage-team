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

  it("de-duplicates by email even when the name is spelled differently", () => {
    const csv = "Name,Email\nAda Lovelace,ada@harvard.edu\nAda B Lovelace,ada@harvard.edu";
    expect(parseRoster(csv).students).toHaveLength(1);
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
